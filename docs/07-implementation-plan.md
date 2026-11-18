# 07 — Implementation Plan

Ground rule: a phase is complete only when its exit criteria are met **and** its tests run green. "Looks done" is not a status.

---

## Phase 1 — Requirements and architecture ✅

Deliverables: docs 01–08, env templates, README, git-ignore.
Exit criteria: every module has requirement IDs, every endpoint has a role and an error contract, every AI feature has a deterministic/LLM split and a failure mode, every collection has indexes.

---

## Phase 2 — Backend foundation

Tasks:

1. `pyproject`/`requirements.txt` with pinned versions; Python 3.12.
2. `core/config.py` (settings, production assertions), `core/errors.py` (envelope + handlers), `core/logging.py` (JSON + request id middleware).
3. `database/mongo.py` (client, ping, DB handle, test override), `database/indexes.py` (INDEX_SPECS, idempotent creation).
4. Auth: hashing, JWT issue/verify, refresh rotation + revocation collection, `deps.py` (current user, roles).
5. `core/permissions.py` with the matrix as data + tests.
6. Health endpoints, `/meta/enums`.
7. Seed script with the exact dataset in doc 03 §6; `--reset` guarded by `APP_ENV != production`.
8. Test harness: `pytest`, `mongomock-motor` or a disposable Atlas test DB (decided by what actually works locally — documented), auth fixtures per role.

Exit criteria:

- `uvicorn app.main:app` boots and `GET /health/ready` reports Mongo up.
- All indexes exist and match `INDEX_SPECS` (test asserts).
- Login/logout/refresh/me work against the seeded DB.
- Authorization matrix tests pass for every implemented route.
- Seeding twice does not duplicate records.

---

## Phase 3 — Frontend foundation

Tasks:

1. Vite + TS + Tailwind + shadcn/ui; design tokens (colors, spacing, radii, type scale) as CSS variables.
2. `AppShell`: sidebar (collapsible, role-aware), topbar with project selector, notifications, user menu; mobile bottom nav + drawer.
3. Auth context, axios client with single-flight refresh, route guards, 401/403 handling.
4. Common components: `PageHeader`, `DataTable` (sort, paginate, empty state), `StatCard`, `StatusBadge`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `FileDropzone`, `FormField`.
5. Error boundary + toast conventions; loading skeletons.

Exit criteria:

- Login → dashboard shell renders for each role; nav items match the matrix.
- Expired access token triggers one refresh, not a redirect loop.
- 360 px layout: no horizontal scroll; touch targets ≥ 44 px.
- Lighthouse accessibility ≥ 95 on the shell.

---

## Phase 4 — Core modules

Order matters: projects → reports → inventory → issues → tasks → invoices → documents.

For each module: schemas → repository → service → router → tests → frontend service/hooks → pages/forms → states.

Module gates:

| Module | Must pass before moving on |
|---|---|
| Projects | Membership CRUD, 404 isolation, summary endpoint |
| Reports | Draft → submit → approve/reject; author lock; PDF with real fields |
| Inventory | Receive/consume/adjust; 50-way concurrent consumption test; ledger reconciliation; alerts |
| Issues | Transitions, assignment validation, resolution notes |
| Tasks | Dependency cycle rejection, rollup accuracy, overdue analytics |
| Invoices | Upload validation, extraction pipeline, discrepancy detection, verification audit |
| Documents | Async processing to `ready`, dedupe, deletion removes vectors |

Exit criteria: each module's requirement IDs covered by at least one API test and one UI path; no placeholder buttons (a route that returns 501 is not a feature).

---

## Phase 5 — AI features

Implementation order is fixed by dependency and risk:

1. **AI-1 report structuring** — establishes `AIService`, prompt registry, validation, logging.
2. **AI-2 voice** — adds audio validation and Faster-Whisper.
3. **AI-3 issue classification** — reuses structured path with enums + safety flag.
4. **AI-4 invoice extraction** — adds OCR, PO diffing, deterministic totals.
5. **AI-5 project chat** — adds intent router + read-only retrieval.
6. **AI-6 document RAG** — adds chunking, embeddings, Chroma, citations.
7. **AI-7 forecasting** — deterministic math first, explanation second.
8. **AI-8 delay risk** — deterministic score first, narrative second.

Per-feature definition of done (also used as the review checklist):

- [ ] Real provider call with a versioned prompt and JSON schema.
- [ ] Input validation (lengths, enums, project ownership).
- [ ] Output validation (Pydantic + provenance/grounding).
- [ ] Typed failure path (`503`/`502`/`422`) with a UI message that keeps manual work possible.
- [ ] `ai_logs` row written for success, failure, and invalid output.
- [ ] Human confirmation before any persistence.
- [ ] Tests: happy path, malformed output, timeout, 429, AI disabled, unauthorized project.
- [ ] No AI path can mutate stock/approve/close.

Exit criteria: doc 08 matrix fully green, including the two kill-switch runs.

---

## Phase 6 — Analytics and reporting

- Implement the five named aggregations; dashboard endpoint returns KPIs + chart series from one request.
- Recharts: progress line, issue donut, inventory bars, task completion bars, daily work area.
- Period summary PDF: ReportLab with a header block, KPI table, AI summary section (labeled), appendix tables.
- Filters: project, date range, status; filter state in URL.

Exit criteria: mutating a record changes the KPI within one refetch (test proves it); PDF numbers equal API numbers; empty filters render zero states, not errors.

---

## Phase 7 — Testing and hardening

- Backend coverage ≥ 70% overall, ≥ 85% on `services/` and `ai/`.
- Concurrency test for stock (async gather of 50 consumptions).
- Upload fuzz set: 0-byte, 50 MB, `.exe` renamed `.pdf`, PDF with 500 pages, image with PDF header.
- Authorization sweep: for every route, one allow and one deny test, generated from the permission matrix.
- AI kill-switch run: entire suite passes with `AI_ENABLED=false` except the AI-live marker.
- Frontend: Vitest for formatters and guards, Playwright for 3 critical journeys (login, report submit+approve, inventory consume).
- Lint/type gates: `ruff`, `mypy` (backend), `eslint`, `tsc --noEmit` (frontend).

Exit criteria: no high/critical `pip-audit`/`npm audit` findings; the security checklist in doc 06 is ticked with evidence.

---

## Phase 8 — Deployment

1. Atlas cluster + database user + network access; run index init and seed against it.
2. Render web service + persistent disk; env vars; health check; first-boot model download documented.
3. Vercel project with SPA rewrite and CSP headers; `VITE_API_BASE_URL` set to the Render URL.
4. Post-deploy smoke: login, dashboard, one AI call, one upload, one PDF, one cross-project 404.
5. Backup instructions and a restore drill on a scratch database.

Exit criteria: the demo script in doc 01 §7 passes against production URLs.

---

## Phase 9 — Presentation

- README with screenshots (desktop + 390 px mobile), architecture diagram, and honest limitations.
- `docs/user-guide.md`, `docs/test-cases.md` (generated from the test suite), `docs/deployment-guide.md`.
- A 3–5 minute demo video script: problem → report-from-notes → approval → invoice mismatch → RAG citation → delay risk → AI-off resilience.
- Interview notes: why modular monolith, why retrieval-before-generation, why rule-based risk, what I would do with another two weeks.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Groq model IDs change or model is retired | AI endpoints fail | Model from env, startup validation call in `/health/ready`, prompt/response validation independent of model name |
| Render free instance CPU too slow for Whisper | Poor demo experience | `base` + `int8`, 60 s cap, progress UI, documented expectation; optional `STT_PROVIDER=groq` |
| Embedding model download on cold start | Slow first upload | Warm on startup, health reports readiness, uploads queue instead of failing |
| Local Chroma on ephemeral disk | Lost vectors after redeploy | Persistent disk path; re-index endpoint; documented as a deployment requirement |
| MongoDB standalone locally (no transactions) | Multi-item consumption not atomic | Single-document guarded updates always used; multi-item path uses a compensating rollback with a test when transactions are unavailable |
| Scope creep | Unfinished modules | Phase gates; non-goals list is explicit; new ideas go to "Later" |
| AI output quality judged as product quality | Credibility risk | Human-in-loop everywhere, provenance checks, clear labeling, no invented numbers |

## Later (explicitly deferred)

S3 storage adapter, Redis-backed rate limits and job queue, Android design pass, multi-tenant orgs, email/SMS notifications, drawing markup, offline PWA caching, vision defect detection.
