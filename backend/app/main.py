import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api.v1 import ai, analytics, auth, documents, inventory, invoices, issues, misc, projects, reports, tasks
from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import RequestContextMiddleware, log_event
from app.core.security import hash_password  # noqa: F401  (ensures argon2 backend loads early)
from app.database.indexes import ensure_indexes
from app.database.mongo import close, connect, get_db

logger = logging.getLogger("siteops")

settings.validate_production()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        connect()
        ensure_indexes(get_db())
        log_event(level="info", event="startup", database="connected", env=settings.app_env, ai=settings.ai_mode)
    except Exception as exc:  # keep the API up so /health reports the problem
        log_event(level="error", event="startup_database_failed", error=str(exc))
    if settings.seed_demo_data and not settings.is_production:
        try:
            from app.database.seed import seed_demo

            summary = seed_demo()
            log_event(level="info", event="seed", **summary)
        except Exception as exc:
            log_event(level="error", event="seed_failed", error=str(exc))
    yield
    close()


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "Content-Disposition"],
)
app.add_middleware(RequestContextMiddleware)


def _envelope(code: str, message: str, details: list | None = None, request: Request | None = None) -> dict:
    request_id = getattr(request.state, "request_id", None) if request else None
    return {"error": {"code": code, "message": message, "details": details or []}, "request_id": request_id}


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status_code, content=_envelope(exc.code, exc.message, exc.details, request))


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    details = []
    for error in exc.errors():
        field = ".".join(str(part) for part in error.get("loc", []) if part not in ("body", "query", "path"))
        details.append({"field": field or "body", "issue": error.get("msg", "invalid value")})
    return JSONResponse(status_code=422, content=_envelope("VALIDATION_ERROR", "The request contains invalid fields.", details, request))


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN_ROLE", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(
        exc.status_code, "HTTP_ERROR"
    )
    return JSONResponse(status_code=exc.status_code, content=_envelope(code, str(exc.detail), None, request))


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    log_event(level="error", event="unhandled_exception", path=request.url.path, error=type(exc).__name__)
    return JSONResponse(status_code=500, content=_envelope("INTERNAL_ERROR", "Something went wrong. Try again.", None, request))


@app.get("/", include_in_schema=False)
def root():
    return {"name": settings.app_name, "version": __version__, "docs": "/docs" if settings.enable_docs else None}


for router in (auth.router, projects.router, reports.router, inventory.router, issues.router, tasks.router,
               invoices.router, documents.router, ai.router, analytics.router, misc.router):
    app.include_router(router, prefix=settings.api_v1_prefix)
