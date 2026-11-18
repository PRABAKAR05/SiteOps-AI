from datetime import date

from pydantic import Field, field_validator, model_validator

from app.core.constants import TASK_CATEGORIES, TASK_STATUSES
from app.schemas.auth import Strict


class TaskCreate(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    title: str = Field(min_length=3, max_length=140)
    description: str | None = Field(default=None, max_length=2000)
    category: str = "other"
    location: str | None = Field(default=None, max_length=120)
    assigned_to: str | None = None
    start_date: date
    due_date: date
    estimated_days: int | None = Field(default=None, ge=1, le=365)
    dependencies: list[str] = Field(default_factory=list, max_length=10)
    weight: int = Field(default=1, ge=1, le=10)
    progress: int = Field(default=0, ge=0, le=100)
    status: str = "not_started"

    @field_validator("category")
    @classmethod
    def cat(cls, v):
        if v not in TASK_CATEGORIES:
            raise ValueError(f"category must be one of {TASK_CATEGORIES}")
        return v

    @field_validator("status")
    @classmethod
    def st(cls, v):
        if v not in TASK_STATUSES:
            raise ValueError(f"status must be one of {TASK_STATUSES}")
        return v

    @model_validator(mode="after")
    def dates(self):
        if self.due_date < self.start_date:
            raise ValueError("due_date must be on or after start_date")
        return self


class TaskUpdate(Strict):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = None
    location: str | None = Field(default=None, max_length=120)
    assigned_to: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimated_days: int | None = Field(default=None, ge=1, le=365)
    dependencies: list[str] | None = None
    weight: int | None = Field(default=None, ge=1, le=10)
    progress: int | None = Field(default=None, ge=0, le=100)
    status: str | None = None

    @field_validator("category")
    @classmethod
    def cat(cls, v):
        if v is not None and v not in TASK_CATEGORIES:
            raise ValueError(f"category must be one of {TASK_CATEGORIES}")
        return v

    @field_validator("status")
    @classmethod
    def st(cls, v):
        if v is not None and v not in TASK_STATUSES:
            raise ValueError(f"status must be one of {TASK_STATUSES}")
        return v
