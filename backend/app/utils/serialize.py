from typing import Any

from bson import ObjectId
from bson.decimal128 import Decimal128
from datetime import date, datetime


def jsonable(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, Decimal128):
        text = format(value.to_decimal().normalize(), "f")
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        return text or "0"
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [jsonable(v) for v in value]
    return value


def entity(doc: dict | None) -> dict | None:
    """Convert a Mongo document to an API object: _id -> id, secrets removed."""
    if doc is None:
        return None
    out = jsonable({k: v for k, v in doc.items() if k != "_id"})
    out["id"] = str(doc["_id"])
    out.pop("password_hash", None)
    return out


def page(items: list[dict], total: int, page_no: int, page_size: int) -> dict:
    return {
        "items": items,
        "total": total,
        "page": page_no,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size else 0,
    }
