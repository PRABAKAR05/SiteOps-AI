# 01 — Requirements Analysis

Project: SiteOps AI — AI-Powered Field Operations and Project Intelligence
Document status: Phase 1 baseline
Scope of this document: what the product must do, for whom, and how "done" is judged.

---

## 1. Problem statement

Small and mid-sized technical contractors (interior execution, auditorium/acoustic, electrical automation, CCTV, fire alarm, AV, networking, BMS) run projects from WhatsApp, paper logs, and spreadsheets. The consequences:

- Daily progress is reported verbally and reconstructed later; no reliable record for billing or disputes.
- Material stock is discovered to be short only when a crew is already on site.
- Issues are reported as photos in chat groups and get lost; nobody knows which are still open.
- Supplier invoices are re-typed by hand, and totals are rarely cross-checked against purchase orders.
- Technical specifications in PDFs are hard to search on site; supervisors guess.
- Delay risk is noticed after the deadline, not before.

SiteOps AI centralizes these workflows and applies AI only where it demonstrably reduces typing or retrieval effort.

## 2. Personas

| Persona | Environment | Primary goal | Constraints |
|---|---|---|---|
| Priya — Project Manager | Office laptop + phone | Know real status across 3–6 concurrent projects; approve reports; spot delay risk | Time-poor; needs summary first, detail on demand |
| Arjun — Site Engineer | Site, phone, gloves, sunlight | Record today's work fast; report issues with photo; check material availability | One-handed use, poor connectivity, bright glare, minimal typing |
| Meena — Supervisor | Site, phone; may be semi-literate in English | Submit progress and worker counts; use voice instead of typing | Prefers voice/regional speech; needs forgiving transcription editing |
| Ravi — Storekeeper | Site store room, shared laptop/tablet | Receive material, record consumption, upload supplier invoice | Needs strict stock accuracy; distrusts silent auto-changes |
| Demo reviewer (recruiter/hiring manager) | Desktop | Evaluate engineering quality and AI honesty in <15 minutes | Needs a working demo login and obvious seeded data |

## 3. User journeys (primary)

### J1 — Daily report from informal notes (AI-1)
1. Arjun opens **Daily Reports → New**, picks the project (defaults to his only active project).
2. Writes 3–5 informal lines, or taps **Record** (J2).
3. Taps **Structure with AI**.
4. Backend validates input, calls the LLM with a strict schema, validates the JSON, and returns proposed fields marked `ai_generated`.
5. UI shows the proposal in editable fields with a "Review before submitting" banner. Nothing is saved until Arjun confirms.
6. Arjun fixes one number, attaches 2 photos, taps **Submit**; status becomes `submitted`.
7. Priya sees it in **Pending approvals**, reads it, taps **Approve**; status becomes `approved`, an audit entry is written.

Failure path: Groq times out → UI keeps the raw notes, shows "AI structuring unavailable, your notes are safe", manual fields remain usable. No report is created automatically.

### J2 — Voice to report (AI-2)
1. Meena taps **Record**, speaks 40 seconds, stops.
2. Audio uploads to `POST /ai/voice-transcription`; backend enforces size/duration, converts with Faster-Whisper.
3. Transcript returns with a confidence signal and a warning if audio was too short/quiet.
4. Meena edits the transcript (mandatory explicit "Use this text" action).
5. Text flows into the AI-1 pipeline. Same review-before-submit rule.

Failure path: silent or unintelligible audio → `422 AUDIO_UNINTELLIGIBLE` with guidance; manual text entry remains.

### J3 — Inventory receipt and consumption
1. Ravi opens **Inventory**, selects material "CAT6 Cable (305m box)", taps **Receive**, enters 12, reference "PO-2026-014", confirms.
2. Backend runs a single atomic update with a guard (`current_stock + 12`), appends an immutable transaction with before/after values.
3. Stock and low-stock badges update. If the new stock is still below reorder level, an alert remains visible.
4. Same day, a supervisor records consumption of 3 boxes against a task; the transaction records the link.
5. Attempting to consume more than available returns `409 INSUFFICIENT_STOCK` with the current balance; nothing is written.

### J4 — Site issue with AI triage (AI-3)
1. Arjun creates an issue "Water leaking near DB panel on 2nd floor", attaches a photo.
2. Taps **Suggest classification**. Backend returns category, severity, priority, impact, next action, and a visible confidence.
3. Suggestions are pre-filled but editable; the issue is saved only when Arjun submits. The stored issue records which fields came from AI and whether a human changed them.
4. Priya assigns it to an engineer; status transitions are recorded with who/when.

### J5 — Invoice extraction and verification (AI-4)
1. Ravi uploads `invoice-014.pdf` against PO-2026-014.
2. Backend: MIME + size check → text extraction (PyMuPDF, OCR fallback for scans) → LLM returns JSON → Pydantic validation → **deterministic** recomputation of line totals, subtotal, tax, grand total → comparison with the PO.
3. UI shows two panes: extracted fields (editable) and computed checks. Mismatches are listed with severity (e.g., "Line 2 total 12,000 ≠ qty 10 × 1,250 = 12,500").
4. Ravi confirms with **Mark as verified** or **Reject**; the decision, user, timestamp, and field values are stored. The system never auto-approves.

Failure path: no OCR text → `422 INVOICE_UNREADABLE`; invoice stays `failed` with the file retained for manual entry.

### J6 — Ask the project (AI-5)
1. Priya asks: "How many CCTV cameras are still pending on the second floor?"
2. Backend resolves authorized projects, runs structured Mongo retrieval (tasks, reports, issues limited to her projects), builds a compact context, calls the LLM.
3. Answer cites the records used (task IDs/titles, report dates). If retrieval is empty, it says data is unavailable rather than guessing.
4. The endpoint is read-only: no tool can change data.

### J7 — Document Q&A (AI-6)
1. Arjun uploads the fire-alarm specification PDF.
2. Background task: text + page mapping → chunking → embeddings → Chroma (project-scoped collection).
3. He asks "What cable type is specified for the fire alarm loop?" The system retrieves top-k chunks and answers with document name + page numbers, plus the quoted excerpts.
4. If best similarity < threshold, the answer is "Not found in the uploaded documents" with the closest pages offered for manual reading.

### J8 — Forecast and delay risk (AI-7, AI-8)
1. Ravi opens **Inventory → Forecast**. For materials with ≥ 14 days of transaction history, the system shows daily consumption rate, days of cover, suggested reorder quantity, and the rule used.
2. With insufficient history, the UI states "Limited history — estimate based on reorder level and recent receipts" instead of a confident prediction.
3. Priya opens **Analytics → Delay risk** for a project: score, band, contributing factors with weights, affected tasks, and mitigation suggestions. The LLM may add narrative, clearly labeled as a suggestion; the score itself is computed in Python.

## 4. Functional requirements

Requirement IDs are stable and referenced by tests and the API spec.

### 4.1 Authentication and users (FR-AUTH)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-AUTH-1 | Email + password registration with role selection restricted to seeded/admin-managed roles | Invalid role → 422; duplicate email → 409; weak password → 422 |
| FR-AUTH-2 | Login returns a short-lived access token and sets a refresh cookie | Access TTL 15 min; refresh 7 days; refresh rotates on use |
| FR-AUTH-3 | Logout revokes the refresh token server-side | Reusing a revoked refresh token → 401 |
| FR-AUTH-4 | `GET /auth/me` returns profile without password hash | Response schema excludes `password_hash`, `_id` |
| FR-AUTH-5 | Protected routes require a valid, unexpired token | Missing/expired/invalid → 401 with stable error codes |
| FR-AUTH-6 | Role-based access is enforced server-side per endpoint | Forbidden role → 403; no data leakage in error body |

### 4.2 Projects and membership (FR-PROJ)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-PROJ-1 | Managers create/update projects; all roles can list only their projects | Non-member project ID → 404 (not 403, to avoid existence leaks) |
| FR-PROJ-2 | Managers add/remove members and set project-scoped roles | Only manager of that project or global manager may do it |
| FR-PROJ-3 | Project status derives from explicit fields, not guesses | `delayed` requires at least one overdue task or manual flag with reason |

### 4.3 Daily reports (FR-REP)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-REP-1 | Create/edit draft with structured fields and photos | Draft is visible only to author + manager |
| FR-REP-2 | Submit transitions `draft → submitted` and locks edits to author | Post-submit edit by author → 409 |
| FR-REP-3 | Manager approves/rejects with optional reason | Reject requires a non-empty reason; approval records `approved_by` + timestamp |
| FR-REP-4 | PDF export of a single report | PDF includes project, date, author, fields, photo thumbnails, approval state |
| FR-REP-5 | Authority: only project manager (or project-scoped manager) approves | Engineer/supervisor approval attempt → 403 |

### 4.4 Inventory (FR-INV)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-INV-1 | Material CRUD per project with unit, reorder level, supplier | Duplicate name in project → 409 |
| FR-INV-2 | Receive/consume/adjust via transaction records only | Direct stock PATCH is rejected; stock changes only through transactions |
| FR-INV-3 | Atomic updates prevent lost updates under concurrency | Parallel consumption never yields negative stock; 50 concurrent consumes of 1 unit → exactly stock transactions succeed |
| FR-INV-4 | Immutable history | No update/delete endpoints for transactions; corrections are new `adjustment` records |
| FR-INV-5 | Low-stock alerts computed as `current_stock <= reorder_level` | Alert list matches recomputed values |
| FR-INV-6 | Closing stock invariant | For every material: opening + Σreceipts + Σreturns − Σconsumption − Σwastage + Σadjustments = current |

### 4.5 Site issues (FR-ISS)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-ISS-1 | Create issue with category/priority/location/photos | Unknown category → 422 |
| FR-ISS-2 | Assignment records assignee and timestamp | Assign to non-member → 422 |
| FR-ISS-3 | Status transitions are validated (no `closed → open`) | Invalid transition → 409 |
| FR-ISS-4 | Resolution requires notes | Empty notes on resolve → 422 |

### 4.6 Tasks and progress (FR-TASK)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-TASK-1 | CRUD tasks with dates, progress, dependencies | Progress 0–100; due ≥ start |
| FR-TASK-2 | Progress rollup for project is weighted by task weight | Rollup matches recomputation; dependency cycles rejected |
| FR-TASK-3 | Task analytics endpoint aggregates by status/category/assignee | Figures match MongoDB aggregation |

### 4.7 Invoices (FR-INV2)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-INV-2-1 | Upload PDF/PNG/JPEG with MIME+magic-byte+size validation | Executable/zip masquerade → 415; >10 MB → 413 |
| FR-INV-2-2 | Extraction produces validated JSON, then deterministic totals | `line_total = qty × unit_price`; totals recomputed server-side and stored separately from AI values |
| FR-INV-2-3 | PO comparison flags missing/inconsistent items, quantity, price | Discrepancy list with severity and field paths |
| FR-INV-2-4 | Verification is a human decision with audit trail | Only manager/storekeeper may verify; decision stored with before/after JSON |

### 4.8 Documents and RAG (FR-DOC)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-DOC-1 | Upload PDF/TXT/MD with project scoping and checksum dedupe | Same file twice in one project → 409 with existing document ID |
| FR-DOC-2 | Background extraction/chunking/embedding with visible status | Status transitions `uploaded → processing → ready|failed` |
| FR-DOC-3 | Answers carry document name + page + excerpt | Response includes `citations[]`; empty citations when none |
| FR-DOC-4 | Project isolation of documents and vectors | Cross-project document ID → 404; Chroma query filtered by project collection |

### 4.9 Analytics and reports (FR-AN)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-AN-1 | Dashboard KPIs computed from DB with project + date filters | Every KPI traceable to an aggregation; no constants in code |
| FR-AN-2 | Weekly/monthly summary PDF with DB-derived numbers + optional AI narrative | Narrative labeled "AI summary"; numbers never taken from the model |
| FR-AN-3 | Empty states when filters yield nothing | Zero-state copy, not `NaN` or blank cards |

### 4.10 AI (FR-AI)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-AI-1 | All AI calls go through one backend service with timeout, retries, validation, logging | Direct provider calls elsewhere → code review failure |
| FR-AI-2 | AI output is never persisted as fact without human confirmation | Draft records store `ai_assisted: true`; approvals require human actor |
| FR-AI-3 | Invalid model JSON is rejected and surfaced | Malformed JSON → `502 AI_INVALID_OUTPUT`, no partial write |
| FR-AI-4 | Degraded mode: AI outage never blocks non-AI features | With `AI_ENABLED=false`, all non-AI tests pass |
| FR-AI-5 | Every AI call is logged (feature, model, latency, status, tokens if provided) | `ai_logs` rows exist; no raw confidential prompt text |

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | p95 < 400 ms for list endpoints on 5k records; dashboard < 900 ms; AI calls bounded by 30 s timeout |
| Availability | AI provider failure degrades features, never the app; no single point of failure besides MongoDB/Atlas |
| Scalability | Stateless API (except local file/Chroma disk); 50 concurrent users on a 512 MB Render instance |
| Mobile | All primary flows usable at 360 px width, touch targets ≥ 44 px, forms work with camera/voice |
| Accessibility | WCAG 2.1 AA contrast, keyboard-operable dialogs, visible focus, labeled inputs, reduced-motion respected |
| Security | OWASP ASVS L1-aligned: hashed passwords, short-lived tokens, object-level authorization, upload validation, rate limits |
| Privacy | No real client data required; documentation states what leaves the server when AI is enabled |
| Observability | Structured logs with request IDs; `/health` and `/health/ready`; AI usage counters |
| Testability | Backend ≥ 70% line coverage on services; all FR-AI and FR-INV invariants covered by tests |
| Maintainability | Routers thin, services own logic, schemas per module, no duplicated business rules |

## 6. Explicit non-goals (v1)

- Multi-tenant SaaS billing, organizations, SSO.
- Native mobile apps, offline-first sync.
- Real-time collaboration (websockets), chat between users.
- Payroll, accounting ledgers, GST filing.
- Autonomous agents that take actions in the system.
- CAD/BIM ingestion, drawing markup.
- Vision-based defect detection (only if a verified vision model is configured; otherwise evidence photo only).

## 7. Demo acceptance script (used in Phase 9)

1. Log in as PM → dashboard shows 1 project, real counts from seed data, 5 charts with data.
2. Log in as Site Engineer → only assigned project; create report from informal notes with AI → edit → submit.
3. Log in as PM → approve the report → PDF downloads with approval block.
4. Storekeeper consumes 5 units → stock decreases; try 9999 units → blocked; alerts list updates.
5. Upload invoice against seeded PO → extraction + mismatch highlighted → verify → audit entry visible.
6. Upload a 6-page spec PDF → RAG question returns answer with page citations; ask an out-of-scope question → explicit "not found".
7. Ask chatbot "What materials are below reorder level?" → answer matches the alerts screen.
8. Set `AI_ENABLED=false`, restart → all above except AI actions work; AI actions show a clear degraded message.
9. Cross-project test: engineer calls another project's report ID → 404.

## 8. Assumptions and open decisions

| # | Assumption / decision | Rationale |
|---|---|---|
| A1 | Roles are global on the user, with optional project-scoped override in `project_members` | Matches the brief; supports one user on multiple projects |
| A2 | Money stored as integer paise (INR minor units) + `currency` field | Avoids float rounding in invoices |
| A3 | Quantities stored as Decimal128 with unit-specific precision | Cable in metres vs. cameras as integers |
| A4 | File storage local, behind a `StorageService` interface | Render persistent disk now, S3 later without route changes |
| A5 | One Chroma collection per project | Structural isolation, simpler authorization |
| A6 | Refresh tokens in httpOnly cookies, access tokens in memory | Limits XSS blast radius; CSRF mitigated by SameSite + CORS allowlist |
| A7 | Notifications are in-app only | Scope control; email/SMS out of v1 |
| A8 | `project_members` is the single source of truth for access checks | Avoids drift with `users.project_ids` |
