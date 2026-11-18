from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from bson import ObjectId
from bson.decimal128 import Decimal128

IST_OFFSET = timedelta(hours=5, minutes=30)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def today_ist() -> date:
    return (datetime.now(timezone.utc) + IST_OFFSET).date()


def ist_day_range(date_from: str, date_to: str) -> tuple[datetime, datetime]:
    """Inclusive IST calendar dates as a half-open UTC datetime range for stored timestamps."""
    start = datetime.fromisoformat(date_from)
    end = datetime.fromisoformat(date_to) + timedelta(days=1)
    return (
        (start - IST_OFFSET).replace(tzinfo=timezone.utc),
        (end - IST_OFFSET).replace(tzinfo=timezone.utc),
    )


def parse_date(value: str | date | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value))


def dec(value) -> Decimal128:
    if isinstance(value, Decimal128):
        return value
    if isinstance(value, Decimal):
        return Decimal128(value)
    return Decimal128(Decimal(str(value)))


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal128):
        return value.to_decimal()
    return Decimal(str(value))


def oid(value: str | ObjectId) -> ObjectId:
    if isinstance(value, ObjectId):
        return value
    return ObjectId(value)


def money(minor: int | None) -> float | None:
    if minor is None:
        return None
    return round(minor / 100, 2)


def fmt_qty(value) -> str:
    """Canonical quantity string: 10, 12.5, 0.001 (no trailing zeros)."""
    text = format(to_decimal(value).normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"
