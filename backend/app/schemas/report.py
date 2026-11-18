from datetime import date

from pydantic import Field, field_validator, model_validator

from app.schemas.auth import Strict
from app.utils.dates import today_ist

MAX_BULLETS = 20


def _clean_list(values: list[str]) -> list[str]:
    out = [v.strip()[:240] for v in values if v and v.strip()]
    return list(dict.fromkeys(out))[:MAX_BULLETS]


class TradeCount(Strict):
    trade: str = Field(min_length=2, max_length=40)
    count: int = Field(ge=0, le=1000)


class WorkersPresent(Strict):
    total: int | None = Field(default=None, ge=0, le=1000)
    by_trade: list[TradeCount] = Field(default_factory=list)

    @model_validator(mode="after")
    def totals_match(self):
        if self.by_trade:
            summed = sum(t.count for t in self.by_trade)
            if self.total is None:
                self.total = summed
            elif self.total != summed:
                raise ValueError("workers_present.total must equal the sum of by_trade counts")
        return self


class MaterialConsumed(Strict):
    material_id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=12)


class ReportCreate(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    report_date: date
    location: str = Field(min_length=1, max_length=120)
    activities: str = Field(default="", max_length=4000)
    work_completed: list[str] = Field(default_factory=list)
    work_pending: list[str] = Field(default_factory=list)
    workers_present: WorkersPresent = Field(default_factory=WorkersPresent)
    materials_consumed: list[MaterialConsumed] = Field(default_factory=list)
    equipment_used: list[str] = Field(default_factory=list)
    delays: str | None = Field(default=None, max_length=1000)
    safety_observations: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)
    photos: list[dict] = Field(default_factory=list, max_length=6)
    ai_assisted: bool = False
    ai_summary: str | None = Field(default=None, max_length=2000)
    status: str = "draft"

    @field_validator("work_completed", "work_pending", "equipment_used")
    @classmethod
    def clean(cls, v: list[str]) -> list[str]:
        return _clean_list(v)

    @field_validator("status")
    @classmethod
    def only_draft_or_submitted(cls, v: str) -> str:
        if v not in {"draft", "submitted"}:
            raise ValueError("status must be 'draft' or 'submitted' on create")
        return v

    @field_validator("report_date")
    @classmethod
    def not_future(cls, v: date) -> date:
        if v > today_ist():
            raise ValueError("report_date cannot be in the future")
        return v


class ReportUpdate(Strict):
    location: str | None = Field(default=None, min_length=1, max_length=120)
    activities: str | None = Field(default=None, max_length=4000)
    work_completed: list[str] | None = None
    work_pending: list[str] | None = None
    workers_present: WorkersPresent | None = None
    materials_consumed: list[MaterialConsumed] | None = None
    equipment_used: list[str] | None = None
    delays: str | None = Field(default=None, max_length=1000)
    safety_observations: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)
    photos: list[dict] | None = None
    ai_assisted: bool | None = None
    ai_summary: str | None = Field(default=None, max_length=2000)

    @field_validator("work_completed", "work_pending", "equipment_used")
    @classmethod
    def clean(cls, v):
        return _clean_list(v) if v is not None else None


class RejectIn(Strict):
    reason: str = Field(min_length=3, max_length=500)
