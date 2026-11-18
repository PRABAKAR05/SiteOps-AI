from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # runtime
    app_env: str = "development"
    app_name: str = "SiteOps AI"
    api_v1_prefix: str = "/api/v1"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    public_app_url: str = "http://localhost:5173"
    enable_docs: bool = True
    allow_registration: bool = True

    # database
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_db: str = "siteops"
    mongodb_test_db: str = "siteops_test"

    # auth
    jwt_secret: str = "dev-access-secret-change-me-0123456789abcdef"
    jwt_refresh_secret: str = "dev-refresh-secret-change-me-0123456789abcdef"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    refresh_cookie_name: str = "siteops_refresh"
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: str = "lax"

    # storage
    storage_dir: str = str(BACKEND_DIR / "var" / "uploads")
    max_document_mb: int = 20
    max_invoice_mb: int = 10
    max_image_mb: int = 8
    max_audio_mb: int = 25
    max_photos_per_report: int = 6

    # ai
    ai_enabled: bool = True
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-120b"
    groq_reasoning_effort: str = "low"
    groq_vision_model: str = ""
    groq_request_timeout_seconds: int = 30
    groq_max_retries: int = 2
    groq_max_output_tokens: int = 1024
    stt_provider: str = "local"
    whisper_model: str = "base"

    # rag
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    rag_chunk_tokens: int = 450
    rag_chunk_overlap_tokens: int = 60
    rag_top_k: int = 6
    rag_min_score: float = 0.15
    rag_collection: str = "document_vectors"

    # limits
    rate_limit_ai_per_minute: int = 20
    rate_limit_upload_per_minute: int = 10
    rate_limit_login_per_15_min: int = 10

    # demo
    seed_demo_data: bool = False
    demo_password: str = "DemoPass!2026"

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ai_mode(self) -> str:
        if not self.ai_enabled:
            return "disabled"
        return "groq" if self.groq_api_key.strip() else "local"

    def validate_production(self) -> None:
        if not self.is_production:
            return
        problems = []
        if "change-me" in self.jwt_secret or len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be >=32 chars and not a placeholder")
        if "change-me" in self.jwt_refresh_secret or len(self.jwt_refresh_secret) < 32:
            problems.append("JWT_REFRESH_SECRET must be >=32 chars and not a placeholder")
        if self.jwt_secret == self.jwt_refresh_secret:
            problems.append("JWT secrets must differ")
        if not self.refresh_cookie_secure:
            problems.append("REFRESH_COOKIE_SECURE must be true in production")
        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
