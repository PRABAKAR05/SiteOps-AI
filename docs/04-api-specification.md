# 04 — API Specification

Base: `{API_V1_PREFIX}` = `/api/v1`
Content type: `application/json` (uploads: `multipart/form-data`)
Docs: FastAPI-generated OpenAPI at `/docs` (disabled in production unless `ENABLE_DOCS=true`).

---

## 1. Conventions

### 1.1 Authentication

```
Authorization: Bearer <access_token>
```

Access tokens are JWTs (`sub` = user id, `role`, `type=access`, `exp`, `iat`, `jti`). Refresh tokens are `type=refresh`, rotated on every use, and delivered as an httpOnly cookie. `POST /auth/refresh` reads the cookie; the response body never contains the refresh token.

### 1.2 Error envelope

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 2 pcs of 'CCTV Camera 4MP' are available.",
    "details": [{"field": "quantity", "issue": "requested 5, available 2"}]
  },
  "request_id": "01J8Z3K4T9Q2M7X1"
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Pydantic/field validation failed |
| `UNAUTHENTICATED` | 401 | Missing/invalid/expired access token |
| `INVALID_CREDENTIALS` | 401 | Login failed (same message for unknown email) |
| `FORBIDDEN_ROLE` | 403 | Authenticated but role not permitted |
| `PROJECT_NOT_FOUND` | 404 | Not a member, or does not exist (no existence leak) |
| `NOT_FOUND` | 404 | Entity not found within an authorized project |
| `CONFLICT` | 409 | Duplicate key / invalid state transition |
| `INSUFFICIENT_STOCK` | 409 | Stock guard rejected the movement |
| `FILE_TOO_LARGE` | 413 | Upload exceeds configured limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | MIME/magic-byte check failed |
| `RATE_LIMITED` | 429 | Per-user quota exceeded (`Retry-After` set) |
| `AI_NOT_CONFIGURED` | 503 | `GROQ_API_KEY` missing or `AI_ENABLED=false` |
| `AI_UNAVAILABLE` | 503 | Provider timeout, 5xx, or rate limit after retries |
| `AI_INVALID_OUTPUT` | 502 | Model output failed JSON/schema validation |
| `AI_UNGROUNDED` | 422 | Answer failed grounding check (no supporting retrieval) |
| `AUDIO_UNINTELLIGIBLE` | 422 | Transcription produced no usable text |
| `INVOICE_UNREADABLE` | 422 | No text extractable from upload |
| `INTERNAL_ERROR` | 500 | Unexpected; details never leaked |

### 1.3 Pagination

Request: `?page=1&page_size=20` (`page_size` max 100).
Response:

```json
{ "items": [], "total": 0, "page": 1, "page_size": 20, "pages": 0 }
```

### 1.4 Common filters

`project_id` (required on project-scoped lists), `date_from`, `date_to`, `status`, `category`, `q` (text), `sort` (`created_at|-created_at|due_date|name`).

### 1.5 Rate limits

| Group | Limit | Key |
|---|---|---|
| `POST /auth/login` | 10 / 15 min | IP + email |
| AI endpoints | 20 / min | user |
| Uploads | 10 / min | user |
| Everything else | 300 / min | user |

### 1.6 Roles shorthand

`PM` = project_manager, `SE` = site_engineer, `SV` = supervisor, `SK` = storekeeper.
"Member" = any of the four with a `project_members` row. `PM(project)` = manager of that project.

---

## 2. Authentication

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/auth/register` | public (configurable) | Creates account with `role`; production disables open registration unless `ALLOW_REGISTRATION=true` |
| POST | `/auth/login` | public | Returns access token + sets refresh cookie |
| POST | `/auth/refresh` | cookie | Rotates refresh token, returns new access token |
| POST | `/auth/logout` | any | Revokes refresh token, clears cookie |
| GET | `/auth/me` | any | Profile |
| PATCH | `/auth/me` | any | Name, phone |
| POST | `/auth/change-password` | any | Requires current password |

**POST /auth/login**

```json
{ "email": "manager@demo.siteops.local", "password": "…" }
```

```json
{
  "access_token": "eyJ…",
  "token_type": "bearer",
  "expires_in": 900,
  "user": { "id": "66f…", "name": "Priya Nair", "role": "project_manager", "email": "…" }
}
```

Errors: `INVALID_CREDENTIALS` (401), `ACCOUNT_DISABLED` (403), `RATE_LIMITED` (429).

---

## 3. Projects and membership

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/projects` | any | Auto-scoped to membership; `status`, `q`, paging |
| POST | `/projects` | PM | Creates project + manager membership atomically |
| GET | `/projects/{project_id}` | member | Includes counts summary |
| PUT | `/projects/{project_id}` | PM(project) | |
| GET | `/projects/{project_id}/members` | member | |
| POST | `/projects/{project_id}/members` | PM(project) | `{user_id, project_role?}` |
| DELETE | `/projects/{project_id}/members/{user_id}` | PM(project) | Cannot remove the last manager |
| GET | `/projects/{project_id}/summary` | member | KPIs + recent activity for the project header |

---

## 4. Daily reports

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/reports` | member | Filters: date range, status, submitter |
| POST | `/reports` | SE, SV, PM | Creates draft |
| GET | `/reports/{report_id}` | member | Author sees own drafts; others never see `draft` |
| PUT | `/reports/{report_id}` | author (draft/rejected) | 409 if `submitted`/`approved` |
| POST | `/reports/{report_id}/submit` | author | `draft|rejected → submitted` |
| POST | `/reports/{report_id}/approve` | PM(project) | `submitted → approved` |
| POST | `/reports/{report_id}/reject` | PM(project) | Requires `reason`; `submitted → rejected` |
| GET | `/reports/{report_id}/pdf` | member | `application/pdf` |
| GET | `/reports/summary` | member | Aggregated period summary for the dashboard |

**POST /reports**

```json
{
  "project_id": "66f1…",
  "report_date": "2026-11-18",
  "location": "2nd floor, auditorium hall",
  "activities": "CCTV rough-in and containment",
  "work_completed": ["Installed 12 cameras", "Pulled cable in corridor"],
  "work_pending": ["Cable testing in rooms 204, 205"],
  "workers_present": { "total": 8, "by_trade": [{"trade": "technician", "count": 6}, {"trade": "helper", "count": 2}] },
  "materials_consumed": [{"material_id": "66f2…", "quantity": "120.000", "unit": "m"}],
  "equipment_used": ["Drill", "Cable tester"],
  "delays": "1 hour lost waiting for conduit delivery",
  "safety_observations": "Harness used at ceiling grid",
  "notes": "",
  "status": "draft"
}
```

Validation: `report_date <= today`; `workers_present.total` equals the sum of trades when trades are given (422 otherwise); `materials_consumed[].material_id` must belong to the project; photos are attached via `POST /reports/{id}/photos` (multipart) or included as already-uploaded file ids.

Approval response includes the updated report and writes `audit_logs(action="report.approve")`.

---

## 5. Inventory

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/materials` | member | `category`, `q`, `low_stock=true`, paging |
| POST | `/materials` | PM, SK | Creates material with opening stock + `opening` transaction |
| GET | `/materials/{material_id}` | member | Includes last 20 transactions |
| PUT | `/materials/{material_id}` | PM, SK | Name/unit/category/reorder/supplier; **not** stock |
| POST | `/inventory/transactions` | PM, SK, SV (consumption only) | Receive/consume/adjust |
| GET | `/inventory/transactions` | member | Filters: material, type, date range |
| GET | `/inventory/alerts` | member | `current_stock <= reorder_level` |
| GET | `/inventory/forecast` | PM, SK | Per-material demand + reorder suggestion |
| GET | `/inventory/reconcile` | PM | Ledger vs cache diagnostic |

**POST /inventory/transactions**

```json
{
  "project_id": "66f1…",
  "material_id": "66f2…",
  "type": "consumption",
  "quantity": "3.000",
  "reference_type": "task",
  "reference_id": "66f3…",
  "remarks": "Camera mounting, 2nd floor"
}
```

```json
{
  "transaction": { "id": "66f4…", "type": "consumption", "quantity": "3.000", "stock_before": "14.000", "stock_after": "11.000", "created_at": "…" },
  "material": { "id": "66f2…", "name": "CCTV Camera 4MP", "current_stock": "11.000", "reorder_level": "10.000", "is_low_stock": false }
}
```

Errors: `INSUFFICIENT_STOCK` (409, includes available), `VALIDATION_ERROR` (quantity ≤ 0, unit mismatch), `FORBIDDEN_ROLE` (supervisor attempting `receipt`/`adjustment`).

---

## 6. Site issues

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/issues` | member | `status`, `priority`, `category`, `assigned_to`, paging |
| POST | `/issues` | SE, SV, PM, SK | Creates `open` issue |
| GET | `/issues/{issue_id}` | member | Includes `ai_suggestion` if present |
| PUT | `/issues/{issue_id}` | reporter, assignee, PM | Editable fields; status has its own routes |
| POST | `/issues/{issue_id}/assign` | PM | Requires project member assignee |
| POST | `/issues/{issue_id}/status` | assignee, PM | Validated transitions |
| POST | `/issues/{issue_id}/resolve` | assignee, PM | Requires `resolution_notes` |
| GET | `/issues/analytics` | member | Counts by status/category/priority + avg age |

Transitions:

```
open → assigned | in_progress | waiting
assigned → in_progress | waiting | open
in_progress → waiting | resolved
waiting → in_progress | resolved
resolved → closed | in_progress
closed → (terminal)
```

---

## 7. Tasks

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/tasks` | member | `status`, `category`, `assigned_to`, `overdue=true` |
| POST | `/tasks` | PM, SE | |
| GET | `/tasks/{task_id}` | member | |
| PUT | `/tasks/{task_id}` | PM, assignee | Progress/status/dates |
| DELETE | `/tasks/{task_id}` | PM | Soft delete (status `cancelled`) |
| GET | `/tasks/analytics` | member | Completion, overdue, by category/assignee |

Validation: `0 <= progress <= 100`; `due_date >= start_date`; dependencies in same project and acyclic; `assigned_to` is a member.

---

## 8. Invoices

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/invoices/upload` | PM, SK | multipart: `file`, `project_id`, optional `purchase_order_id`; validates magic bytes, stores, creates record (`uploaded`) |
| GET | `/invoices` | member | `verification_status`, vendor, date range |
| GET | `/invoices/{invoice_id}` | member | Full extraction, computed vs stated, discrepancies |
| POST | `/invoices/{invoice_id}/extract` | PM, SK | Runs OCR + LLM extraction; idempotent re-run allowed |
| POST | `/invoices/{invoice_id}/verify` | PM, SK | `{decision: "verified"|"rejected", notes?, corrected_fields?}` |
| GET | `/invoices/{invoice_id}/file` | member | Streams original file with `Content-Disposition` (authorized only) |

Extraction response highlights:

```json
{
  "id": "66f5…",
  "verification_status": "needs_review",
  "stated": { "subtotal_minor": 1450000, "tax_minor": 261000, "total_minor": 1711000 },
  "computed": { "subtotal_minor": 1450000, "tax_minor": 261000, "total_minor": 1711000 },
  "discrepancies": [
    { "code": "QUANTITY_MISMATCH", "field": "items[1].quantity", "expected": "20", "found": "18", "severity": "high",
      "message": "Invoice quantity differs from PO-2026-014" }
  ],
  "ai_extraction": { "model": "llama-3.3-70b-versatile", "prompt_version": "invoice.v1", "confidence": "medium" }
}
```

Rules: missing values are `null`, never `0`; totals are always recomputed; verification cannot be applied to `failed`; re-extraction after verification is blocked (`409`) and requires a manager reset (audited).

---

## 9. Documents and RAG

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/documents/upload` | all members | multipart PDF/TXT/MD, ≤20 MB, dedupe by sha256 per project |
| GET | `/documents` | member | `processing_status`, category |
| GET | `/documents/{document_id}` | member | Metadata + chunk count |
| GET | `/documents/{document_id}/text` | member | Extracted pages (paginated by page) |
| POST | `/documents/{document_id}/ask` | member | RAG question over this document |
| POST | `/documents/ask` | member | RAG across all ready documents in a project |
| POST | `/documents/{document_id}/retry` | PM, uploader | Re-queue failed processing |
| DELETE | `/documents/{document_id}` | PM, uploader | Deletes file, chunks, and vectors |

**POST /documents/{document_id}/ask**

```json
{ "question": "What cable type is specified for the fire alarm loop?" }
```

```json
{
  "answer": "The specification requires 2-core 1.5 sq mm FRLS copper cable for the fire alarm loop.",
  "grounded": true,
  "citations": [
    { "document_id": "66f6…", "filename": "fire-alarm-spec.pdf", "page": 12, "chunk_index": 34,
      "excerpt": "…fire alarm loop shall be wired with 2C × 1.5 sq.mm FRLS copper cable…", "score": 0.81 }
  ],
  "model": "llama-3.3-70b-versatile",
  "usage": { "prompt_tokens": 1180, "completion_tokens": 96 }
}
```

No retrieval above `RAG_MIN_SCORE` → `200` with `grounded: false`, `answer` stating the information was not found, empty citations. Never a fabricated spec.

---

## 10. AI endpoints

All require authentication, project membership, and the AI rate limit. All return typed errors, never a fake success.

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/ai/report-summary` | SE, SV, PM | Notes → structured draft (proposal only) |
| POST | `/ai/voice-transcription` | SE, SV, PM | Audio → transcript |
| POST | `/ai/classify-issue` | SE, SV, PM, SK | Description (+ optional image reference) → classification |
| POST | `/ai/invoice-extraction` | PM, SK | File-based extraction (standalone; usually invoked by invoice route) |
| POST | `/ai/project-chat` | member | Grounded Q&A over authorized project data |
| POST | `/ai/document-question` | member | Alias of document RAG with project scope |
| POST | `/ai/project-summary` | PM | Period narrative from computed stats |
| POST | `/ai/delay-analysis` | PM, SE | Risk score explanation for computed score |
| POST | `/ai/material-forecast` | PM, SK | Forecast explanation (numbers computed first) |

Example — `POST /ai/report-summary`:

```json
{
  "project_id": "66f1…",
  "notes": "Today 8 workers completed CCTV installation on the second floor. 12 cameras installed. Cable testing is pending in two rooms. Work stopped for one hour because of a material delivery delay."
}
```

```json
{
  "proposal": {
    "work_completed": ["Installed 12 CCTV cameras on the second floor"],
    "work_pending": ["Cable testing in two rooms"],
    "workers_present": { "total": 8, "by_trade": [] },
    "materials_consumed": [],
    "delays": "Work stopped for one hour due to a material delivery delay",
    "safety_observations": "",
    "next_day_recommendations": ["Complete cable testing in the two pending rooms"],
    "summary": "8 workers installed 12 CCTV cameras on the second floor; cable testing remains pending in two rooms after a one-hour material delay."
  },
  "ai_assisted": true,
  "warnings": ["Workers by trade not specified in the source notes"],
  "model": "llama-3.3-70b-versatile",
  "prompt_version": "report.v1"
}
```

`workers_present.total` is only populated when the note states it; otherwise `null` with a warning. The endpoint never writes a report.

Example — `POST /ai/project-chat`:

```json
{ "project_id": "66f1…", "message": "What materials are below reorder level?" }
```

```json
{
  "answer": "Three materials are at or below reorder level: CAT6 cable (2 boxes left, reorder at 3), fire alarm detectors (4 left, reorder at 6), and acoustic panels (0 left, reorder at 10).",
  "facts_used": [
    { "type": "material", "id": "66f2…", "label": "CAT6 Cable 305m" },
    { "type": "material", "id": "66f7…", "label": "Fire Alarm Detector" }
  ],
  "retrieval": { "collections": ["materials", "inventory_transactions"], "records": 3 },
  "model": "llama-3.3-70b-versatile"
}
```

The chat endpoint is read-only by construction: its retrieval tools are find/count only, and no tool exists to write.

---

## 11. Analytics

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/analytics/dashboard` | member | KPI + chart payload for selected project scope and date range |
| GET | `/analytics/project-progress` | member | Task/report progress series |
| GET | `/analytics/inventory` | member | Usage, low stock, top consumers |
| GET | `/analytics/issues` | member | Distribution, age, resolution time |
| GET | `/analytics/reports/summary` | PM | Weekly/monthly PDF (returns PDF; optional `ai_summary=true`) |

`/analytics/dashboard` response shape:

```json
{
  "kpis": {
    "projects_total": 3, "projects_active": 2, "projects_completed": 1, "projects_delayed": 0,
    "issues_open": 7, "issues_critical": 2, "materials_total": 20, "materials_low_stock": 3,
    "reports_pending_approval": 2, "tasks_overdue": 4
  },
  "charts": {
    "progress": [{ "date": "2026-11-12", "percent": 42 }],
    "issue_status": [{ "status": "open", "count": 5 }],
    "inventory_usage": [{ "material": "CAT6 Cable", "consumed": "340.000", "unit": "m" }],
    "task_completion": [{ "status": "completed", "count": 6 }]
  },
  "recent_reports": [],
  "upcoming_deadlines": [],
  "range": { "from": "2026-10-20", "to": "2026-11-18" }
}
```

Every number comes from an aggregation; the endpoint is covered by a test that mutates data and asserts the KPI changes.

---

## 12. Notifications, health, ops

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/notifications` | any | Unread first, paging |
| POST | `/notifications/{id}/read` | owner | |
| POST | `/notifications/read-all` | any | |
| GET | `/health` | public | `{status, version}` — no internals |
| GET | `/health/ready` | public | Mongo ping, AI configured (boolean), embedding model loaded |
| GET | `/meta/enums` | any | Roles, statuses, categories, units for UI dropdowns |

`/health/ready` is the Render health check. It reports `ai_configured: false` without failing readiness, so AI-less deployments still serve the app.

---

## 13. Contract testing

- Pydantic response models are the single source of truth; OpenAPI is generated from them.
- `tests/api/test_contract.py` asserts every route's success and error shape against a JSON schema snapshot, so accidental field leaks (e.g., `password_hash`) fail CI.
- Frontend types in `src/types/api.ts` are generated (`openapi-typescript`) and committed, with a CI check that regeneration produces no diff.
