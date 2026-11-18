# SiteOps AI — AI-Powered Field Operations and Project Intelligence

A full-stack portfolio application for construction, interior execution, auditorium/acoustic, and technical installation contractors. It digitizes daily site reporting, inventory, issues, invoices, and project documents, and adds AI that is **grounded, validated, and always human-approved**.

> **Demo project:** all people, projects, invoices, and documents in this repository are fictional. "Demo Educational Institution", "Smart Auditorium Modernization", and every user account are invented for demonstration. This project is not affiliated with any real company.

---

## Status

Phase 1 (architecture and design) is complete. No application code exists yet — the repository currently contains design documents and configuration templates only.

| Phase | Scope | Status |
|---|---|---|
| 1 | Requirements, architecture, schema, API spec, AI design, security design | Done |
| 2 | FastAPI foundation, MongoDB, auth, RBAC, indexes, seed data | Not started |
| 3 | React app shell, routing, auth screens, responsive layout | Not started |
| 4 | Projects, daily reports, inventory, issues, tasks, invoices, documents | Not started |
| 5 | AI features 1–8 with validation and tests | Not started |
| 6 | Analytics, charts, PDF reports | Not started |
| 7 | Test suite, security review, hardening | Not started |
| 8 | Deployment (Vercel / Render / Atlas) | Not started |
| 9 | README polish, screenshots, demo script, interview notes | Not started |

The status table is updated as each phase lands. A feature is only marked working after its tests pass (see `docs/08-ai-verification-matrix.md`).

---

## Planned stack

**Frontend** — React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, Axios, TanStack Query, React Hook Form, Zod, Recharts, Lucide.
**Backend** — Python 3.12, FastAPI, Pydantic v2, PyMongo, PyJWT, Argon2 (passlib), python-multipart.
**Data** — MongoDB Atlas; ChromaDB (persistent local) for document embeddings.
**AI** — Groq (OpenAI-compatible chat completions, configurable model), Faster-Whisper (local STT), Tesseract OCR, Sentence-Transformers `all-MiniLM-L6-v2` (384-d), scikit-learn / transparent rules for forecasting and risk.
**Docs** — PyMuPDF, Pillow, ReportLab, pandas.
**Deploy** — Vercel (frontend), Render (backend + persistent disk), MongoDB Atlas.

---

## Repository layout

```
fde/
├── backend/            FastAPI service (Phase 2+)
│   ├── app/{api,core,database,schemas,services,ai,utils}
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── frontend/           React + Vite app (Phase 3+)
│   ├── src/{components,pages,services,hooks,context,types,utils}
│   └── .env.example
├── docs/               Design and delivery documentation
├── sample-data/        Fictional seed data (Phase 2)
├── .gitignore
└── README.md
```

---

## Environment configuration

Two files, both git-ignored, both with committed examples:

- `backend/.env` — MongoDB URI, JWT secrets, Groq key, storage paths, model names.
- `frontend/.env` — only `VITE_API_BASE_URL`. No secrets.

The application starts in **degraded mode** without AI credentials: everything except AI still works, and AI endpoints return a typed `503 AI_NOT_CONFIGURED` error instead of pretending to succeed. There is no mock AI mode that returns invented content.

---

## AI features and failure behavior

| # | Feature | Deterministic core | LLM role | If AI unavailable |
|---|---|---|---|---|
| 1 | Daily report generator | Schema + numeric guard | Structures free notes into fields | `503`, notes preserved, manual entry works |
| 2 | Voice-to-report | Faster-Whisper transcription | Structures edited transcript | `503`, manual text path works |
| 3 | Issue classification | Category/priority enums | Suggests category, severity, action | `503`, manual form works |
| 4 | Invoice extraction | OCR text + deterministic totals + PO diff | Maps text to JSON fields | `503`, manual entry + totals still computed |
| 5 | Project chatbot | Authorized Mongo retrieval | Explains retrieved records | `503`, dashboard/table views still work |
| 6 | Document Q&A (RAG) | Chunking, embeddings, retrieval, citations | Answers from retrieved chunks | `503`, document text/pages still searchable |
| 7 | Material forecasting | Stock math + moving average / days-of-cover | Optional explanation | Forecast still computed, explanation omitted |
| 8 | Delay-risk analysis | Rule-based weighted score | Optional narrative | Score and factors still computed |

AI never approves reports or invoices, never changes stock, never closes issues, and never grants access.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | Personas, user journeys, functional and non-functional requirements, acceptance criteria |
| [docs/02-architecture.md](docs/02-architecture.md) | System context, components, request flows, module boundaries, deployment topology |
| [docs/03-database-design.md](docs/03-database-design.md) | Collections, fields, indexes, inventory atomicity, retention |
| [docs/04-api-specification.md](docs/04-api-specification.md) | Endpoints, roles, validation, pagination, error envelope, rate limits |
| [docs/05-ai-integration.md](docs/05-ai-integration.md) | AI service design, per-feature pipelines, prompt contracts, fallbacks |
| [docs/06-security.md](docs/06-security.md) | Auth model, authorization rules, upload safety, audit, threat model |
| [docs/07-implementation-plan.md](docs/07-implementation-plan.md) | Phase-by-phase delivery plan, exit criteria, risks |
| [docs/08-ai-verification-matrix.md](docs/08-ai-verification-matrix.md) | How each AI feature is proven functional, with concrete test cases |

---

## Demo accounts (planned, Phase 2)

Seeded only when `SEED_DEMO_DATA=true` and `APP_ENV != production`. Passwords are generated from `DEMO_PASSWORD` in `backend/.env`; there is no built-in default in code.

| Role | Email (planned) |
|---|---|
| Project Manager | `manager@demo.siteops.local` |
| Site Engineer | `engineer1@demo.siteops.local` |
| Site Engineer | `engineer2@demo.siteops.local` |
| Supervisor | `supervisor1@demo.siteops.local` |
| Supervisor | `supervisor2@demo.siteops.local` |
| Storekeeper | `store@demo.siteops.local` |

---

## Known limitations (by design, for a portfolio build)

- Single-tenant logical model: project membership isolates data, but there is no organization/tenant layer.
- File storage is a local directory on the backend host (persistent disk on Render); no S3 adapter in v1.
- Embeddings are computed locally on CPU; large documents are processed in a background task, not instantly.
- Forecasting uses transparent heuristics plus a small regression only when enough transaction history exists. It is not presented as a validated predictive model.
- No mobile native app; the web app is responsive and touch-optimized for field use.
- No push notifications; in-app notifications only.

---

## License

Code is provided for portfolio and educational use. The demo data is fictional.
