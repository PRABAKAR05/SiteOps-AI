from datetime import date

from pydantic import Field, field_validator

from app.core.constants import ISSUE_CATEGORIES, ISSUE_PRIORITIES, ISSUE_SEVERITIES
from app.schemas.auth import Strict


class IssueCreate(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5, max_length=2000)
    location: str | None = Field(default=None, max_length=120)
    category: str = "other"
    priority: str = "medium"
    severity: str = "moderate"
    due_date: date | None = None
    photos: list[dict] = Field(default_factory=list, max_length=6)
    ai_suggestion: dict | None = None

    @field_validator("category")
    @classmethod
    def cat(cls, v):
        if v not in ISSUE_CATEGORIES:
            raise ValueError(f"category must be one of {ISSUE_CATEGORIES}")
        return v

    @field_validator("priority")
    @classmethod
    def pri(cls, v):
        if v not in ISSUE_PRIORITIES:
            raise ValueError(f"priority must be one of {ISSUE_PRIORITIES}")
        return v

    @field_validator("severity")
    @classmethod
    def sev(cls, v):
        if v not in ISSUE_SEVERITIES:
            raise ValueError(f"severity must be one of {ISSUE_SEVERITIES}")
        return v


class IssueUpdate(Strict):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    description: str | None = Field(default=None, min_length=5, max_length=2000)
    location: str | None = Field(default=None, max_length=120)
    category: str | None = None
    priority: str | None = None
    severity: str | None = None
    due_date: date | None = None
    photos: list[dict] | None = None

    @field_validator("category")
    @classmethod
    def cat(cls, v):
        if v is not None and v not in ISSUE_CATEGORIES:
            raise ValueError(f"category must be one of {ISSUE_CATEGORIES}")
        return v

    @field_validator("priority")
    @classmethod
    def pri(cls, v):
        if v is not None and v not in ISSUE_PRIORITIES:
            raise ValueError(f"priority must be one of {ISSUE_PRIORITIES}")
        return v

    @field_validator("severity")
    @classmethod
    def sev(cls, v):
        if v is not None and v not in ISSUE_SEVERITIES:
            raise ValueError(f"severity must be one of {ISSUE_SEVERITIES}")
        return v


class AssignIn(Strict):
    assigned_to: str = Field(min_length=24, max_length=24)


class StatusIn(Strict):
    status: str


class ResolveIn(Strict):
    resolution_notes: str = Field(min_length=5, max_length=2000)
