from typing import Literal

from pydantic import Field, field_validator

from app.core.constants import MATERIAL_CATEGORIES, TRANSACTION_TYPES, UNITS
from app.schemas.auth import Strict


class MaterialCreate(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    name: str = Field(min_length=2, max_length=120)
    sku: str | None = Field(default=None, max_length=40)
    category: str = "other"
    unit: str = "pcs"
    opening_stock: float = Field(default=0, ge=0)
    reorder_level: float = Field(default=0, ge=0)
    supplier: str | None = Field(default=None, max_length=120)
    unit_cost: float | None = Field(default=None, ge=0)

    @field_validator("category")
    @classmethod
    def valid_category(cls, v: str) -> str:
        if v not in MATERIAL_CATEGORIES:
            raise ValueError(f"category must be one of {MATERIAL_CATEGORIES}")
        return v

    @field_validator("unit")
    @classmethod
    def valid_unit(cls, v: str) -> str:
        if v not in UNITS:
            raise ValueError(f"unit must be one of {UNITS}")
        return v


class MaterialUpdate(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    sku: str | None = Field(default=None, max_length=40)
    category: str | None = None
    unit: str | None = None
    reorder_level: float | None = Field(default=None, ge=0)
    supplier: str | None = Field(default=None, max_length=120)
    unit_cost: float | None = Field(default=None, ge=0)
    is_active: bool | None = None

    @field_validator("category")
    @classmethod
    def valid_category(cls, v):
        if v is not None and v not in MATERIAL_CATEGORIES:
            raise ValueError(f"category must be one of {MATERIAL_CATEGORIES}")
        return v

    @field_validator("unit")
    @classmethod
    def valid_unit(cls, v):
        if v is not None and v not in UNITS:
            raise ValueError(f"unit must be one of {UNITS}")
        return v


class TransactionCreate(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    material_id: str = Field(min_length=24, max_length=24)
    type: Literal["receipt", "consumption", "return", "wastage", "adjustment"]
    quantity: float = Field(gt=0, le=1_000_000)
    reference_type: str | None = None
    reference_id: str | None = None
    remarks: str | None = Field(default=None, max_length=500)
    allow_negative: bool = False
    direction: Literal["increase", "decrease"] | None = None

    @field_validator("type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in TRANSACTION_TYPES or v == "opening":
            raise ValueError("type must be receipt, consumption, return, wastage, or adjustment")
        return v


class ForecastQuery(Strict):
    horizon_days: int = Field(default=14, ge=1, le=90)
