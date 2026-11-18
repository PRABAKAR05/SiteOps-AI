from datetime import date

from pydantic import Field, field_validator

from app.core.constants import ISSUE_CATEGORIES
from app.schemas.auth import Strict
from app.schemas.inventory import ForecastQuery  # noqa: F401  (re-exported for routes)


class ReportNotesIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    notes: str = Field(min_length=10, max_length=4000)
    report_date: date | None = None
    location: str | None = Field(default=None, max_length=120)


class ClassifyIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5, max_length=2000)
    photo_id: str | None = None


class ChatIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    message: str = Field(min_length=2, max_length=1000)


class ProjectSummaryIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    date_from: date
    date_to: date

    @field_validator("date_to")
    @classmethod
    def order(cls, v, info):
        start = info.data.get("date_from")
        if start and v < start:
            raise ValueError("date_to must be on or after date_from")
        return v


class DelayAnalysisIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)


class ForecastExplainIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    horizon_days: int = Field(default=14, ge=1, le=90)


class InvoiceAiIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    invoice_id: str = Field(min_length=24, max_length=24)


class CategoryValue(Strict):
    category: str

    @field_validator("category")
    @classmethod
    def valid(cls, v):
        if v not in ISSUE_CATEGORIES:
            raise ValueError("unknown category")
        return v
