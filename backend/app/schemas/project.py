from datetime import date

from pydantic import Field, field_validator

from app.core.constants import PROJECT_STATUSES, PROJECT_TYPES, ROLES
from app.schemas.auth import Strict


class ProjectCreate(Strict):
    name: str = Field(min_length=3, max_length=120)
    code: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9\-_]+$")
    description: str = Field(default="", max_length=2000)
    client_name: str = Field(min_length=2, max_length=120)
    location: str = Field(min_length=2, max_length=120)
    project_type: str = "mixed"
    start_date: date
    expected_end_date: date
    status: str = "active"

    @field_validator("project_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in PROJECT_TYPES:
            raise ValueError(f"project_type must be one of {PROJECT_TYPES}")
        return v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in PROJECT_STATUSES:
            raise ValueError(f"status must be one of {PROJECT_STATUSES}")
        return v

    @field_validator("expected_end_date")
    @classmethod
    def end_after_start(cls, v: date, info):
        start = info.data.get("start_date")
        if start and v < start:
            raise ValueError("expected_end_date must be on or after start_date")
        return v


class ProjectUpdate(Strict):
    name: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    client_name: str | None = Field(default=None, min_length=2, max_length=120)
    location: str | None = Field(default=None, min_length=2, max_length=120)
    project_type: str | None = None
    start_date: date | None = None
    expected_end_date: date | None = None
    status: str | None = None
    delay_flag: bool | None = None
    delay_reason: str | None = Field(default=None, max_length=300)

    @field_validator("project_type")
    @classmethod
    def valid_type(cls, v):
        if v is not None and v not in PROJECT_TYPES:
            raise ValueError(f"project_type must be one of {PROJECT_TYPES}")
        return v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v is not None and v not in PROJECT_STATUSES:
            raise ValueError(f"status must be one of {PROJECT_STATUSES}")
        return v


class MemberAdd(Strict):
    user_id: str = Field(min_length=24, max_length=24)
    project_role: str | None = None

    @field_validator("project_role")
    @classmethod
    def valid_role(cls, v):
        if v is not None and v not in ROLES:
            raise ValueError(f"project_role must be one of {ROLES}")
        return v
