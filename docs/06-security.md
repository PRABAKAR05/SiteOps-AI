# 06 — Security Design

Scope: authentication, authorization, file handling, AI-specific risks, secrets, logging, and the operational controls that make the claims testable. This is a portfolio application, but the controls are the same ones a small production SaaS would use — with residual risks stated honestly.

---

## 1. Authentication

### 1.1 Chosen model

| Item | Decision |
|---|---|
| Password storage | Argon2id via `passlib`, per-password salt, parameters from env (`time_cost=3`, `memory_cost=64 MiB`) |
| Access token | JWT HS256, 15 min, held **in memory** in the SPA |
| Refresh token | JWT HS256 with separate secret, 7 days, `httpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth` |
| Refresh rotation | Each refresh issues a new token and revokes the previous `jti` (stored hash in `refresh_tokens`) |
| Revocation | Logout, password change, and admin disable revoke all refresh tokens for the user |
| Login throttling | 10 attempts / 15 min per IP+email; generic `INVALID_CREDENTIALS` for unknown email vs. wrong password |
| Timing | Dummy Argon2 verify on unknown email to reduce user-enumeration timing signal |

Why not localStorage for the access token: an XSS bug would then hand over a long-lived credential. In memory, the token dies with the tab. The trade-off — a refresh call on reload — is handled by a single-flight interceptor.

Why a cookie for refresh: it is not readable by JavaScript, and `SameSite=Lax` blocks cross-site POSTs. Combined with an explicit CORS allowlist, CSRF risk on `/auth/refresh` is low; the endpoint also requires the request to originate from an allowed origin (`Origin` header check) and does not return data beyond a new access token.

### 1.2 Token contents

```json
{ "sub": "66f1…", "role": "site_engineer", "type": "access", "iat": 1732000000, "exp": 1732000900, "jti": "…" }
```

No email, name, or project list in the token — role can change server-side, so the user is loaded from MongoDB on every request (one indexed lookup) and `is_active` is re-checked. A deactivated user loses access within one request, not one token lifetime.

### 1.3 Registration policy

`ALLOW_REGISTRATION` defaults to `false` in production. Demo deployments may enable it with the four fixed roles; nobody can self-assign a role outside the enum, and the first project manager is created by the seed script or an operator command.

---

## 2. Authorization

### 2.1 Two layers

1. **Role gate** — `require_roles("project_manager")` on the route.
2. **Object gate** — `get_project_access(project_id, user)` resolves membership from `project_members` and returns a `ProjectContext`. Every project-scoped route calls it before touching data, and every entity loaded is re-checked with `entity.project_id == ctx.project_id`.

Non-membership returns **404 `PROJECT_NOT_FOUND`**, so an attacker cannot distinguish "exists but forbidden" from "does not exist".

### 2.2 Permission matrix

| Capability | PM | SE | SV | SK |
|---|---|---|---|---|
| View project, reports, inventory, issues, tasks | ✓ | ✓ | ✓ | ✓ |
| Create/edit project | ✓ | — | — | — |
| Manage members | ✓ | — | — | — |
| Create report | ✓ | ✓ | ✓ | — |
| Edit own draft/rejected report | ✓ | ✓ | ✓ | — |
| Submit report | ✓ | ✓ | ✓ | — |
| Approve/reject report | ✓ | — | — | — |
| Create/edit material, receive stock, adjust | ✓ | — | — | ✓ |
| Consume stock | ✓ | ✓* | ✓ | ✓ |
| Create issue | ✓ | ✓ | ✓ | ✓ |
| Assign issue | ✓ | — | — | — |
| Resolve issue | ✓ | assignee | assignee | — |
| Create task | ✓ | ✓ | — | — |
| Update task progress | ✓ | assignee | — | — |
| Upload invoice / verify | ✓ | — | — | ✓ |
| Upload document / delete own upload | ✓ | ✓ | ✓ | ✓ |
| Delete any document | ✓ | — | — | — |
| Use AI assistant, document Q&A | ✓ | ✓ | ✓ | ✓ |
| View analytics | ✓ | ✓ | ✓ | ✓ |
| Download period reports | ✓ | — | — | — |

`*` Site engineers may consume stock only with a `reference_type=task` link, so consumption is attributable.

These rules live in `core/permissions.py` as data (`ROLE_CAPABILITIES`) and are unit-tested against the matrix, preventing route-level drift.

### 2.3 Access checks that are easy to forget (and explicitly tested)

- `GET /reports/{id}` for a report from another project → 404.
- `POST /issues/{id}/assign` with an assignee who is not a member of that project → 422.
- `POST /invoices/{id}/verify` by a site engineer → 403.
- `GET /documents/{id}/file` with a valid ID but no membership → 404 (not a stream).
- `POST /ai/project-chat` with `project_id` of a non-member → 404, with no partial context in the error.
- `GET /analytics/dashboard?project_id=X` where X is not a member → 404.

---

## 3. File upload security

| Control | Implementation |
|---|---|
| Size | Per-type limits (`MAX_DOCUMENT_MB`, `MAX_INVOICE_MB`, `MAX_IMAGE_MB`), enforced by streaming read with a hard cap (not `Content-Length` trust) |
| Type | Allowlist by `Content-Type` **and** magic bytes (`python-magic`/manual signatures): PDF `%PDF`, PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`, WEBM/OGG/WAV for audio |
| Filename | Never used as a path. Stored key = `{uuid4}.{ext}` under a per-project directory; original name kept in metadata only |
| Path traversal | Path built from validated UUID + fixed root, then `Path.resolve()` checked to be inside `STORAGE_DIR` |
| Execution | No filename is ever executed; PDFs are parsed with PyMuPDF, not shelled out |
| Serving | Files streamed through an authorized endpoint with `Content-Disposition: attachment` (or `inline` only for images), `X-Content-Type-Options: nosniff`, no directory listing |
| Zip bombs / page bombs | Page count cap (300) and rendered-image pixel cap (50 MP) for PDFs; OCR only on the first 40 pages, with a clear error beyond that |
| Deduplication | SHA-256 per project; duplicates return 409 with the existing ID (also prevents repeated embedding cost) |
| Cleanup | Temporary audio and failed uploads deleted; orphan sweep documented in ops |

Uploads are stored outside the web root; in development `var/uploads` is a sibling of the app code, and the static files app is never mounted on it.

---

## 4. AI-specific risks

| Risk | Control |
|---|---|
| Prompt injection from documents or notes | Document/user text wrapped in `<untrusted>`; system prompt states it is data; no tools are exposed to the model; retrieved content cannot change authorization |
| Fabricated facts in records | Numeric provenance check, enum validation, grounding guard, and human confirmation before persistence |
| AI used for consequential actions | No AI endpoint can approve, verify, close, or mutate stock. Those routes require a human actor and are audited |
| Cross-project data in prompts | Context is built only from rows already filtered by the caller's `project_id`; chat retrieval takes `ProjectContext`, not a raw ID |
| Sensitive data leaving the server | Only the minimum context for the current request is sent; no full project dumps; document text is sent only on an explicit question; privacy note on upload screens |
| Cost abuse / denial of wallet | Per-user rate limits, token caps, input truncation, circuit breaker |
| Provider outage | Typed errors, degraded mode, non-AI fallbacks; the app never depends on AI for core flows |
| Model/prompt drift | Prompt versions recorded on records; `ai_logs` captures model + version per call |
| Storing raw prompts | Off by default; `AI_LOG_PROMPTS=true` is dev-only with 7-day TTL and redaction |

---

## 5. Input validation and output encoding

- Pydantic v2 models on every request: string length bounds, enum membership, date sanity, Decimal ranges, `extra="forbid"` on write schemas.
- ObjectId fields validated as 24-hex before hitting Mongo, so malformed IDs produce 422, not a driver exception.
- Mongo injection is avoided by never passing request dictionaries as filters; repositories construct filters field-by-field and coerce types.
- Response schemas are separate classes; `password_hash`, internal keys, and `raw_text` are not serializable by design.
- The frontend renders text through React (escaped by default); `dangerouslySetInnerHTML` is banned by lint rule, and Markdown rendering (AI answers) uses a sanitizer with an allowlist.
- File names in `Content-Disposition` are sanitized and RFC 5987-encoded.

---

## 6. Transport and browser hardening

| Control | Value |
|---|---|
| HTTPS | Enforced by Vercel/Render; backend redirects in production |
| CORS | Explicit allowlist from `CORS_ORIGINS`; credentials allowed only for those origins; no wildcard with credentials |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()` (camera/mic are needed for uploads/voice), `Content-Security-Policy` on the frontend via Vercel headers |
| Cookies | `Secure` in production, `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth` |
| CSRF | Cookie is SameSite + origin-checked; state-changing APIs require the `Authorization` header, which a cross-site form cannot set |
| Clickjacking | `frame-ancestors 'none'` |

---

## 7. Rate limiting

In-process sliding window (single Render instance, documented as instance-local):

| Route group | Limit | Response |
|---|---|---|
| Login | 10 / 15 min per IP+email | 429 + `Retry-After` |
| AI endpoints | 20 / min per user | 429 |
| Uploads | 10 / min per user | 429 |
| Writes (POST/PUT/DELETE) | 120 / min per user | 429 |
| Reads | 300 / min per user | 429 |

If the service scales beyond one instance, this moves to Redis — stated as a known scale limitation rather than silently breaking.

---

## 8. Secrets and configuration

- All secrets in environment variables; `pydantic-settings` fails startup in production if `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MONGODB_URI`, or `CORS_ORIGINS` are missing, or if the two JWT secrets are equal or shorter than 32 chars.
- `.env` is git-ignored; only `.env.example` is committed, with `CHANGE_ME` placeholders.
- The frontend bundle contains only `VITE_*` public values; there is a test that greps the built bundle for `GROQ`, `JWT`, `MONGODB` and fails if found.
- Render environment variables are set in the dashboard; Atlas credentials are scoped to one database user with read/write on `siteops` only.
- Rotating `JWT_REFRESH_SECRET` invalidates all sessions (documented behavior).

---

## 9. Logging, audit, and privacy

- Structured JSON logs with `request_id`, `user_id`, route, status, duration. No tokens, passwords, cookies, file contents, or full prompts.
- `audit_logs` covers: login success/failure, report submit/approve/reject, invoice upload/extract/verify/reset, inventory transactions (including negative overrides), member add/remove, document delete, AI suggestion accepted with edits.
- `ai_logs` covers telemetry for every AI call; content is not stored by default.
- IP addresses are hashed with a server-side pepper before storage (`ip_hash`), enough for abuse investigation without retaining raw IPs.
- Demo data is fictional; the README and UI state this. Users are warned not to upload real client documents to the public demo.

---

## 10. Threat model (abbreviated STRIDE)

| Threat | Scenario | Control | Residual |
|---|---|---|---|
| Spoofing | Stolen access token | 15 min TTL, memory-only storage, `is_active` re-check | Token theft within TTL is possible |
| Spoofing | Refresh cookie replay | Rotation + revocation list, SameSite/Secure | Attacker with the cookie can act until rotation |
| Tampering | Client sends `project_id` of another project | Object gate on every route; 404 | None known |
| Tampering | Supervisor tries to approve a report | Role + owner checks, audit | None known |
| Repudiation | Manager denies approving | `audit_logs` with actor, timestamp, before/after | Log tampering requires DB access |
| Information disclosure | Document Q&A leaks another project's spec | Project collection + metadata filter + membership check | A bug in Chroma filtering would need a second failure |
| Information disclosure | Error body leaks internals | Central handler; unknown errors → generic 500 | Debug mode off in production |
| DoS | AI endpoint hammered | Rate limit, token caps, breaker | Single instance can still be saturated |
| Elevation | User edits JWT role claim | Signature verification; role reloaded from DB | None if secret is safe |
| Supply chain | Malicious dependency | Pinned versions, `pip-audit` in CI, npm audit | Third-party risk remains |

---

## 11. Secure defaults checklist (verified in Phase 7)

- [ ] Production refuses to boot with placeholder secrets.
- [ ] `APP_ENV=production` disables `/docs`, registration, and demo seeding.
- [ ] Every route listed in doc 04 has a role test (allow + deny).
- [ ] Cross-project access tests exist for reports, issues, invoices, documents, tasks, analytics, AI.
- [ ] Upload tests cover: oversized, wrong MIME, wrong magic bytes, path traversal name, duplicate.
- [ ] AI kill-switch test: `AI_ENABLED=false` → all non-AI flows pass, AI returns `AI_NOT_CONFIGURED`.
- [ ] Built frontend bundle scanned for secret patterns.
- [ ] Dependency audit (`pip-audit`, `npm audit --omit=dev`) has no high/critical findings.
- [ ] `audit_logs` rows verified for approve, verify, stock adjust, member change.
