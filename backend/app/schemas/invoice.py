from typing import Literal

from pydantic import Field

from app.schemas.auth import Strict


class VerifyIn(Strict):
    decision: Literal["verified", "rejected"]
    notes: str | None = Field(default=None, max_length=1000)
    corrected_fields: dict | None = None


class InvoiceManualIn(Strict):
    vendor: str | None = Field(default=None, max_length=120)
    invoice_number: str | None = Field(default=None, max_length=60)
    purchase_order_id: str | None = None
