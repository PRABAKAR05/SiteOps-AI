# 02 — Architecture

## 1. Style

A **modular monolith**: one FastAPI deployable, one React SPA, one MongoDB database, one local Chroma store. Modules are separated by directory and dependency direction, not by network calls. This keeps operational cost low (portfolio scale) while preserving clean boundaries that could be split later.

Guiding rules:

1. Routers do HTTP only: parse, authorize, delegate, serialize.
2. Services own business rules and are the only callers of repositories.
3. Repositories own Mongo queries; no raw `db.collection` access outside them.
4. AI providers are reached only through `AIService`.
5. Deterministic math (stock, totals, risk scores) never goes through an LLM.

## 2. System context

```mermaid
flowchart LR
    subgraph Users
        PM[Project Manager<br/>desktop]
        SE[Site Engineer<br/>phone]
        SV[Supervisor<br/>phone]
        SK[Storekeeper<br/>tablet]
    end

    subgraph Vercel
        SPA[React SPA<br/>Vite + TS + Tailwind]
    end

    subgraph Render
        API[FastAPI<br/>/api/v1]
        WK[Background workers<br/>in-process tasks]
        FS[(Persistent disk<br/>uploads/ PDFs)]
        CH[(ChromaDB<br/>vectors)]
    end

    subgraph External
        AT[(MongoDB Atlas)]
        GQ[Groq API]
        HF[HuggingFace model hub<br/>first-run download]
    end

    PM -->|HTTPS| SPA
    SE --> SPA
    SV --> SPA
    SK --> SPA
    SPA -->|JSON + refresh cookie| API
    API --> AT
    API --> FS
    API --> CH
    API -->|chat / transcription| GQ
    API -->|model weights| HF
    WK --> AT
    WK --> CH
```

## 3. Containers and responsibilities

```mermaid
flowchart TB
    subgraph Frontend
        R[Router + guards]
        Q[TanStack Query cache]
        P[Pages]
        C[Components / shadcn ui]
        S[API client: axios + interceptors]
        R --> P --> C
        P --> Q --> S
    end

    subgraph Backend
        MW[Middleware<br/>request-id, CORS, rate limit, error handler]
        AU[Auth dependency<br/>JWT decode + user load]
        PZ[Project authorization<br/>membership guard]
        RT[Routers<br/>auth, projects, reports, inventory, issues,<br/>tasks, invoices, documents, ai, analytics]
        SV[Domain services]
        AIS[AI service]
        RP[Repositories]
        SC[Pydantic schemas]
        FL[File/PDF/OCR utilities]
        BG[Task runner]
        MW --> AU --> PZ --> RT --> SV
        RT --> SC
        SV --> RP
        SV --> AIS
        SV --> FL
        SV --> BG
        BG --> RP
        BG --> AIS
    end

    S -->|/api/v1| MW
    RP --> M[(MongoDB)]
    AIS -->|OpenAI-compatible| G[Groq]
    BG --> V[(Chroma)]
    FL --> D[(storage dir)]
```

## 4. Backend module layout

```
backend/app/
├── main.py                  app factory, lifespan (mongo connect, index init, model warmup), routers
├── api/
│   ├── deps.py              get_current_user, require_roles, get_project_access, pagination
│   └── v1/
│       ├── auth.py  projects.py  reports.py  inventory.py
│       ├── issues.py  tasks.py   invoices.py  documents.py
│       └── ai.py   analytics.py  health.py
├── core/
│   ├── config.py            pydantic-settings, env parsing, validation
│   ├── security.py          hashing, token issue/verify, cookie helpers
│   ├── permissions.py       role matrix + project membership resolution
│   ├── errors.py            AppError hierarchy, error envelope, exception handlers
│   ├── logging.py           structured JSON logs, request id
│   ├── rate_limit.py        in-process sliding window per user/route
│   └── constants.py         enums: roles, statuses, categories, units
├── database/
│   ├── mongo.py             client, db, ping, graceful shutdown
│   ├── indexes.py           idempotent index creation
│   └── repositories/        users, projects, reports, inventory, issues,
│                            tasks, invoices, documents, notifications, ai_logs
├── schemas/                 one module per domain, request/response split
├── services/                auth, project, report, inventory, issue, task,
│                            invoice, document, analytics, notification, audit
├── ai/
│   ├── client.py            Groq HTTP client: timeouts, retries, JSON mode
│   ├── service.py           feature methods, schema validation, logging, fallback
│   ├── prompts/             versioned prompt templates (report, issue, invoice, chat, rag)
│   ├── rag.py               chunk, embed, upsert, retrieve
│   ├── stt.py               Faster-Whisper wrapper
│   ├── ocr.py               PyMuPDF + Tesseract extraction
│   └── forecasting.py       moving average, days-of-cover, optional Ridge
├── utils/
│   ├── files.py             MIME + magic bytes, size, safe paths, checksums
│   ├── pdf.py               ReportLab report builders
│   ├── dates.py             timezone-aware date helpers (Asia/Kolkata)
│   └── text.py              chunking, redaction, token estimates
└── workers/
    └── documents.py         background document pipeline
```

Dependency direction: `api → services → repositories/database`, `services → ai`, `ai → utils`. Repositories never import services. Schemas never import services.

## 5. Frontend architecture

```
frontend/src/
├── main.tsx                 providers: QueryClient, Auth, Theme, Toaster
├── App.tsx                  router tree
├── routes/
│   ├── public.tsx           /login
│   └── protected.tsx        AppShell + role-aware routes
├── components/
│   ├── common/              PageHeader, EmptyState, ErrorState, DataTable,
│   │                        ConfirmDialog, FileDropzone, StatusBadge, StatCard
│   ├── layout/              Sidebar, Topbar, MobileNav, ProjectSelector,
│   │                        NotificationPanel, UserMenu
│   ├── dashboard/           KpiGrid, charts
│   ├── reports/             ReportForm, AiReportPanel, VoiceRecorder, PhotoUploader
│   ├── inventory/           StockTable, TransactionForm, LowStockList, ForecastCard
│   ├── issues/              IssueForm, AiSuggestionCard, IssueBoard
│   ├── invoices/            UploadPanel, ExtractionReview, DiscrepancyList
│   ├── documents/           UploadPanel, DocumentList, CitationViewer, AskPanel
│   └── assistant/           ChatPanel, MessageBubble, SourceChips
├── pages/                   one per nav item + detail pages
├── services/                api client, one module per domain, zod-validated responses
├── hooks/                   useAuth, useProjects, useDebounce, useMediaQuery, useVoiceRecorder
├── context/                 AuthContext, ProjectContext, ToastContext
├── types/                   shared API types
└── utils/                   formatters (currency, dates), cn, error mapping
```

State rules:

- **Server state** lives in TanStack Query; no entity is duplicated into React state.
- **Auth state** is minimal: access token (memory), user profile, `isLoading`. Refresh happens on 401 with a single-flight retry.
- **Selected project** is URL state (`?project=`), with the last choice remembered in `localStorage` — so refresh and deep links behave.

## 6. Request lifecycle

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as Middleware
    participant A as Auth dep
    participant P as Project guard
    participant S as Service
    participant R as Repository
    participant DB as MongoDB

    B->>M: GET /api/v1/reports?project_id=...
    M->>M: assign request_id, rate limit, CORS
    M->>A: Authorization: Bearer ...
    A->>A: verify JWT, load user, check is_active
    A->>P: require_project(project_id, user)
    P->>R: project_members.find(project_id, user_id)
    R->>DB: query (indexed)
    alt not a member
        P-->>B: 404 PROJECT_NOT_FOUND
    else member
        P->>S: list_reports(project, filters, page)
        S->>R: find + count
        R->>DB: find(...).sort(...).skip().limit()
        S-->>B: 200 {items,total,page,page_size,pages}
    end
```

Authorization is resolved **before** any domain query, so an unauthorized project ID cannot be used as an oracle. Not-a-member returns 404, not 403.

## 7. AI request lifecycle (shared)

```mermaid
sequenceDiagram
    participant UI
    participant API as /ai/*
    participant G as Guard
    participant SV as Feature service
    participant AI as AIService
    participant GQ as Groq

    UI->>API: POST with payload
    API->>G: auth + role + project access + rate limit
    G->>SV: validated request model
    SV->>SV: deterministic prep (retrieval, OCR, numbers)
    SV->>AI: prompt + JSON schema + budget
    AI->>GQ: chat.completions (timeout 30s, 2 retries on 429/5xx)
    alt success
        GQ-->>AI: content
        AI->>AI: strip fences → json.loads → Pydantic validate
        AI-->>SV: validated model or AI_INVALID_OUTPUT
        SV->>SV: post-validate against retrieved facts
        SV->>SV: write ai_logs
        SV-->>UI: proposal + ai_assisted=true
    else timeout / rate limit / invalid JSON
        AI->>SV: typed AIServiceError
        SV->>SV: write ai_logs(status=error|fallback)
        SV-->>UI: 503 AI_UNAVAILABLE or 502 AI_INVALID_OUTPUT
    end
```

Key properties:

- The LLM is a **formatter and explainer**, not a source of numbers. Retrieval, OCR, stock math, totals, and risk scoring happen before the call and are passed in as ground truth.
- All AI responses are proposals. Persisted records carrying AI text store `ai_assisted`, the model name, and a prompt-template version.
- No AI endpoint has write side effects other than `ai_logs` and (for uploads) document processing status.

## 8. Background processing

v1 uses FastAPI `BackgroundTasks` with a simple in-process queue and a persisted status field:

| Job | Trigger | Status field | Timeout | Retry |
|---|---|---|---|---|
| Document extraction/embedding | `POST /documents/upload` | `documents.processing_status` | 10 min | manual retry endpoint |
| Invoice OCR/extraction | `POST /invoices/{id}/extract` (sync) or upload follow-up | `invoices.verification_status` | 90 s | manual retry |
| Weekly summary PDF | explicit request | returned inline, not queued | 60 s | user retriggers |

If the process restarts mid-job, documents stuck in `processing` for > 15 minutes are marked `failed` with `error="interrupted"` by a startup sweep. This is documented rather than hidden: it is the trade-off of avoiding a Celery/Redis deployment for this scope.

## 9. Data flow: inventory atomicity

```mermaid
flowchart LR
    REQ[POST /inventory/transactions<br/>type=consumption, qty=3] --> V[Validate qty > 0<br/>and unit matches]
    V --> U["materials.updateOne(<br/>{_id, current_stock: {$gte: 3}},<br/>{$inc: {current_stock: -3}})"]
    U --> C{modifiedCount}
    C -->|0| E[409 INSUFFICIENT_STOCK<br/>return current stock]
    C -->|1| T[insert inventory_transaction<br/>stock_before/after, user, ref]
    T --> N[recompute alert state<br/>notify if crossed reorder level]
```

`findOneAndUpdate` with a stock guard is the concurrency primitive; no read-then-write race. MongoDB transactions are used for multi-material operations (e.g., consuming several items in one submission), enabled only on replica-set Atlas clusters and skipped with a documented fallback for local standalone Mongo.

## 10. Deployment topology

```mermaid
flowchart LR
    subgraph GitHub
        REPO[(repo main)]
    end
    subgraph Vercel
        FE[Static build<br/>SPA fallback rewrite]
    end
    subgraph Render
        BE[Web service<br/>uvicorn, 1 instance]
        DISK[(/var/data<br/>uploads + chroma)]
    end
    subgraph Atlas
        CL[(M0/M10 cluster)]
    end

    REPO -->|push| FE
    REPO -->|push| BE
    FE -->|VITE_API_BASE_URL| BE
    BE --> CL
    BE --> DISK
```

- Render: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check `/health`.
- Persistent disk mounted at `/var/data`; `STORAGE_DIR=/var/data/uploads`, `CHROMA_DIR=/var/data/chroma`.
- First request after deploy may be slow while the embedding model downloads (~90 MB); the health check warms it and `READY` reports model state.
- Vercel rewrite sends all non-asset paths to `index.html`; `VITE_API_BASE_URL` points at the Render service.

## 11. Cross-cutting concerns

| Concern | Approach |
|---|---|
| Errors | `AppError(code, message, status, details)` → single JSON envelope + request ID; unexpected exceptions logged, returned as `500 INTERNAL_ERROR` without internals |
| Validation | Pydantic v2 on input; separate response models prevent leaking `_id`, hashes, internal fields |
| Pagination | `page`, `page_size` (max 100), stable sort (`created_at desc, _id desc`), `total` via `count_documents` |
| Time | All timestamps UTC (`datetime.now(timezone.utc)`); `report_date`/`due_date` are date-only in `Asia/Kolkata` context; serialized ISO-8601 |
| IDs | ObjectId internally, serialized as 24-char hex `id`; opaque to the client |
| Logging | JSON lines: `ts, level, request_id, user_id, route, status, duration_ms`; AI calls add `feature, model, latency_ms, tokens` |
| Config | `pydantic-settings`, fails fast on missing required secrets in production |
| Feature flags | `AI_ENABLED`, `SEED_DEMO_DATA`; no dark-launch complexity |
