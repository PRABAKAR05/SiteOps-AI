# 08 — AI Feature Review and Verification Matrix

Purpose: answer "is this AI feature genuinely functional or a UI placeholder?" with evidence instead of opinion, and give a repeatable protocol to run after implementation.

---

## 0. Current verdict

**There is no application code in this repository yet.** Phase 1 produced design artifacts only. Therefore:

- No AI feature has been reviewed against a running system.
- No test case below has been executed.
- Status for all eight features: **Not implemented — blocked on Phase 5**.

Any statement that a feature "works" at this point would be false. This document defines exactly what will be measured, so the claim can be verified later rather than asserted.

---

## 1. Evidence standard (what "functional" means)

A feature passes only if **all eight** of the following produce observable evidence:

| # | Dimension | Evidence required |
|---|---|---|
| 1 | Real AI/ML processing | Network egress to the provider with the feature's prompt (or local model execution log); response content differs meaningfully from a template; `ai_logs` row with model + latency + tokens |
| 2 | Backend API integration | The UI calls a real endpoint; the endpoint exists in OpenAPI; disabling the endpoint breaks the feature visibly (no client-side simulation) |
| 3 | Input validation | Invalid payloads rejected with 422 and a field path; oversized/empty inputs refused before any provider call |
| 4 | Output validation | Malformed JSON, wrong enums, and invented numbers are rejected (`502`/`422`), proven by injecting fake provider responses |
| 5 | Error handling | Timeout, 429, 5xx, and missing key each produce a typed error and a UI message; non-AI functionality still works |
| 6 | Database integration | Persisted results appear in MongoDB with the expected fields; unauthorized project IDs return 404; no orphan writes on failure |
| 7 | Human review | There is no path from model output to a committed record without an explicit user action; the record shows `ai_assisted` / `ai_suggestion` provenance |
| 8 | Security and project access | Cross-project attempts fail; AI never mutates stock, approves, verifies, or closes; logs contain no secrets or full prompts |

A feature that fails any row is marked **Placeholder** regardless of how good it looks.

### Placeholder smells this protocol catches

- Spinner that resolves to the same hardcoded string.
- "AI" result generated in the frontend without an HTTP request.
- Endpoint that echoes input back with light formatting (compare output structure against schema; probe with facts absent from input).
- No failure state — a real provider call can fail.
- Numbers in output that were never in the input (provenance probe).
- Approving a record immediately after generation with no human step.
- `ai_logs` empty while the UI claims success.

---

## 2. Feature status table

| # | Feature | API | Deterministic core | Status | Blocker |
|---|---|---|---|---|---|
| AI-1 | Daily report generator | `POST /ai/report-summary` | Schema + numeric guard | Not implemented | Phase 5 |
| AI-2 | Voice to report | `POST /ai/voice-transcription` | Audio validation + Whisper | Not implemented | Phase 5 |
| AI-3 | Issue classification | `POST /ai/classify-issue` | Enum + safety flag | Not implemented | Phase 5 |
| AI-4 | Invoice extraction | `POST /invoices/{id}/extract` | OCR + totals + PO diff | Not implemented | Phase 5 |
| AI-5 | Project chatbot | `POST /ai/project-chat` | Authorized retrieval | Not implemented | Phase 5 |
| AI-6 | Document Q&A | `POST /documents/{id}/ask` | Chunking, embedding, citations | Not implemented | Phase 5 |
| AI-7 | Material forecasting | `GET /inventory/forecast` | Moving average / days of cover | Not implemented | Phase 5 |
| AI-8 | Delay-risk analysis | `POST /ai/delay-analysis` | Weighted rules | Not implemented | Phase 5 |
| AI-9 | Period summary | `POST /ai/project-summary` | Aggregates first | Not implemented | Phase 5 |

Status values: `Not implemented` → `Implemented, untested` → `Tests passing` → `Verified (evidence linked)`. Only the last state counts as done.

---

## 3. Per-feature test protocols

Conventions: `PM`/`SE`/`SV`/`SK` tokens from seeded accounts; `PROJECT_A` = seeded project; `PROJECT_B` = a second project created for isolation tests. Each test records: request, response, `ai_logs` row, DB state.

### AI-1 — Report generator

| ID | Action | Expected |
|---|---|---|
| R1-1 | POST notes with 8 workers, 12 cameras, 1-hour delay | Fields populated; `workers_present.total=8`; delay sentence preserved; `ai_assisted=true` |
| R1-2 | Same request, note says nothing about safety | `safety_observations` is `null`/empty, plus warning "not stated" — never invented |
| R1-3 | Notes: "Work done." (no numbers) | No quantities in output; warnings list missing info |
| R1-4 | Fake provider returns `workers_present.total=15` not in input | 502 `AI_INVALID_OUTPUT`; no report created; error logged |
| R1-5 | Provider timeout (fake 30 s) | 503 `AI_UNAVAILABLE`; client keeps notes; manual form still submits |
| R1-6 | `AI_ENABLED=false` | 503 `AI_NOT_CONFIGURED`; manual report creation works |
| R1-7 | Empty notes / 5000 chars | 422 with field path; no provider call |
| R1-8 | Verify no write | `daily_reports` count unchanged after 5 calls |

### AI-2 — Voice to report

| ID | Action | Expected |
|---|---|---|
| R2-1 | Upload 20 s clear speech WAV | Transcript ≥ 10 chars; language + probability; segments present |
| R2-2 | Upload 1 s silence | 422 `AUDIO_UNINTELLIGIBLE`; temp file deleted |
| R2-3 | Upload 30 MB file | 413 before decoding |
| R2-4 | Rename `.mp4` to `.wav` | 415 magic-byte rejection |
| R2-5 | Confirm transcript → AI-1 | Two distinct calls logged (`voice_transcribe`, `report_generate`) |
| R2-6 | Never auto-submit | No report row exists until the user presses Submit |

### AI-3 — Issue classification

| ID | Action | Expected |
|---|---|---|
| R3-1 | "Water leaking near DB panel" | category `electrical`, priority ≥ high, `safety_flag=true`, impact + next action present |
| R3-2 | Provider returns category `plumbing` (not in enum) | 502, no issue created |
| R3-3 | Description mentions "10 cameras" but input said 4 | 502 (numeric provenance) |
| R3-4 | SE saves issue accepting suggestion | `ai_suggestion.accepted=true`; enum values persisted |
| R3-5 | SE edits category before save | `edited_fields=["category"]` recorded |
| R3-6 | Photo supplied with no vision model configured | Classification is text-only and UI says so; photo stored as evidence |

### AI-4 — Invoice extraction

| ID | Action | Expected |
|---|---|---|
| R4-1 | Clean PDF with 3 items | Items mapped; `computed.total == stated.total`; status `extracted` |
| R4-2 | Line total printed wrong (12,000 vs 10×1,250) | `computed` uses 12,500; `LINE_TOTAL_MISMATCH` discrepancy |
| R4-3 | Quantity differs from PO | `QUANTITY_MISMATCH` with expected/found |
| R4-4 | Missing tax field | `stated.tax=null`, not 0; computed tax from items/rate or flagged |
| R4-5 | Scanned image invoice | OCR text extracted; same validations apply |
| R4-6 | Blank/corrupt PDF | 422 `INVOICE_UNREADABLE`; file retained; status `failed` |
| R4-7 | Provider returns total 999999 (not printed) | Rejected; recomputed value used; discrepancy if stated differs |
| R4-8 | SE attempts verify | 403 `FORBIDDEN_ROLE` |
| R4-9 | Storekeeper verifies | Status `verified`; `verification.by/at` set; audit row exists |
| R4-10 | Re-extract after verification | 409; no overwrite |
| R4-11 | Invoice number duplicated | `DUPLICATE_INVOICE_NUMBER` discrepancy, not a 500 |

### AI-5 — Project chatbot

| ID | Action | Expected |
|---|---|---|
| R5-1 | "What materials are below reorder level?" | Answer matches `/inventory/alerts` exactly in count; `facts_used` ids are real |
| R5-2 | "Which issues are open?" | Counts equal `/issues?status=open` |
| R5-3 | Ask about `PROJECT_B` while member of A only | 404; no partial answer |
| R5-4 | "Delete all CCTV issues" | Refusal; no write; no endpoint exists to comply |
| R5-5 | Provider names a material not retrieved | 422 `AI_UNGROUNDED`; safe refusal shown |
| R5-6 | Project with zero data | Canned "no matching records"; no provider call logged |
| R5-7 | Retrieval > budget | Answer marks `truncated=true`; still grounded in the reduced set |

### AI-6 — Document Q&A

| ID | Action | Expected |
|---|---|---|
| R6-1 | Upload 6-page spec PDF | status `processing → ready`; `pages=6`; `chunk_count>0`; vectors in `proj_<A>` |
| R6-2 | Ask "What cable type for the fire alarm loop?" | Answer cites filename + page + excerpt with score ≥ threshold |
| R6-3 | Ask about a topic not in the document | `grounded=false`, citations empty, explicit not-found text |
| R6-4 | Ask about a document in `PROJECT_B` | 404 |
| R6-5 | Citation to a non-retrieved page (fake provider) | 502 `AI_INVALID_OUTPUT` |
| R6-6 | Delete document | File, chunks, and vectors removed; subsequent ask 404 |
| R6-7 | Duplicate upload (same sha256) | 409 with existing document id |
| R6-8 | Chroma offline | Q&A returns 503; document list and raw text still work |

### AI-7 — Material forecasting

| ID | Action | Expected |
|---|---|---|
| R7-1 | Material with 31 consumption events in 90 days | `method=moving_average`, rate and suggested reorder consistent with the ledger (recompute by hand) |
| R7-2 | New material with 1 transaction | `method=rule_based`, `confidence=low`, explicit limitation text |
| R7-3 | Zero consumption history | No fabricated rate; `days_of_cover=null`, message shown |
| R7-4 | Inbound PO open | Suggested reorder subtracts open PO quantity |
| R7-5 | AI disabled | Numbers unchanged; explanation absent |
| R7-6 | Model explanation cites a number not in payload | Explanation dropped, forecast kept |

### AI-8 — Delay-risk analysis

| ID | Action | Expected |
|---|---|---|
| R8-1 | Recompute score from the response factors | Score equals the published weighted formula (within rounding) |
| R8-2 | Add an overdue critical issue, re-run | Score increases; factor evidence updates |
| R8-3 | Task with incomplete dependency | `blocked_dependencies` factor > 0 |
| R8-4 | AI disabled | Score, band, factors still returned; narrative flagged unavailable |
| R8-5 | Narrative claims "guaranteed completion by Friday" | Rejected by post-validation; mitigation rewritten or omitted |
| R8-6 | Disclaimer present | Response includes "not a statistically validated prediction" |

### AI-9 — Period summary

| ID | Action | Expected |
|---|---|---|
| R9-1 | Summary for last week | Every number appears in the supplied aggregates |
| R9-2 | Fake provider invents a number | Regeneration attempt, then template fallback with `summary_source=template` |
| R9-3 | Empty period | Template states no activity; no model call |

---

## 4. Cross-cutting tests

| ID | Action | Expected |
|---|---|---|
| X-1 | Remove `GROQ_API_KEY`, restart | `/health/ready` shows `ai_configured=false`; app boots; AI routes return `AI_NOT_CONFIGURED`; all core tests pass |
| X-2 | Fake 429 twice then success | Retries with backoff, succeeds, one `ai_logs` row per attempt |
| X-3 | Fake 401 from provider | Immediate failure (no retry), `AI_UNAVAILABLE`, logged once |
| X-4 | Open breaker with 5 failures, then call | Fast-fail for 60 s without provider traffic |
| X-5 | 21 AI calls in a minute | 21st returns 429 with `Retry-After` |
| X-6 | Grep built frontend bundle | No `GROQ`, `JWT_SECRET`, `MONGODB_URI` strings |
| X-7 | Inspect `ai_logs` after all tests | One row per call attempt; no prompt text |
| X-8 | Revoke user access mid-session | AI calls for that project return 404 on the next request |

---

## 5. How to run

Planned (Phase 5), subject to final tooling:

```bash
cd backend
pytest -q                              # full suite, provider faked
pytest -q -m "not ai_live"             # CI default
pytest -q -m ai_live                   # opt-in, needs GROQ_API_KEY

# kill switch
AI_ENABLED=false pytest -q

# one feature with verbose logs
pytest tests/ai/test_report_summary.py -q -s
pytest tests/ai/test_invoice_extraction.py -q -s
```

Manual evidence collection per feature (recorded in the sign-off log):

1. `curl` the endpoint (or use the UI with DevTools network tab) → save request/response.
2. `mongosh` query the affected collection → save the document.
3. `db.ai_logs.find({feature: "...", created_at: {$gt: ...}})` → save the row.
4. Toggle `AI_ENABLED=false` → repeat → save the typed error.
5. Cross-project call → save the 404.

---

## 6. Sign-off log (to be filled during Phase 5/7)

| Feature | Tests passing | Evidence link | Reviewed by | Date |
|---|---|---|---|---|
| AI-1 | — | — | — | — |
| AI-2 | — | — | — | — |
| AI-3 | — | — | — | — |
| AI-4 | — | — | — | — |
| AI-5 | — | — | — | — |
| AI-6 | — | — | — | — |
| AI-7 | — | — | — | — |
| AI-8 | — | — | — | — |
| AI-9 | — | — | — | — |

A blank row is a placeholder. That is the honest state today.

---

## 7. What I will report after each implementation pass

1. Feature, commit, and endpoint exercised.
2. Tests run with counts (passed/failed/skipped) and the command.
3. The three artifacts: HTTP response, DB document, `ai_logs` row.
4. The failure-path result with AI disabled.
5. The cross-project result.
6. Remaining gaps, stated as gaps — not deferred silently.
