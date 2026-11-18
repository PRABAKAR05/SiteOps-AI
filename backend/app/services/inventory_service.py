from datetime import timedelta
from decimal import Decimal, ROUND_CEILING

from bson import ObjectId
from bson.decimal128 import Decimal128
from pymongo import ReturnDocument

from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.services import audit, notify
from app.services.project_service import ProjectContext
from app.utils.dates import dec, fmt_qty, ist_day_range, oid, to_decimal, utcnow
from app.utils.serialize import entity, page

DIRECTION = {
    "receipt": 1,
    "return": 1,
    "consumption": -1,
    "wastage": -1,
}
MANAGED_TYPES = {"receipt", "return", "wastage", "adjustment"}


def list_materials(ctx: ProjectContext, *, category: str | None, q: str | None, low_only: bool, page_no: int, page_size: int) -> dict:
    db = get_db()
    query: dict = {"project_id": ctx.project_id, "is_active": True}
    if category:
        query["category"] = category
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"sku": {"$regex": q, "$options": "i"}}]
    if low_only:
        query["$expr"] = {"$lte": ["$current_stock", "$reorder_level"]}
    total = db.materials.count_documents(query)
    docs = db.materials.find(query).sort("name", 1).skip((page_no - 1) * page_size).limit(page_size)
    items = []
    for doc in docs:
        item = entity(doc)
        item["is_low_stock"] = to_decimal(doc["current_stock"]) <= to_decimal(doc["reorder_level"])
        items.append(item)
    return page(items, total, page_no, page_size)


def get_material(ctx: ProjectContext, material_id: str) -> dict:
    db = get_db()
    doc = db.materials.find_one({"_id": oid(material_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Material")
    data = entity(doc)
    data["is_low_stock"] = to_decimal(doc["current_stock"]) <= to_decimal(doc["reorder_level"])
    data["transactions"] = [
        entity(t) for t in db.inventory_transactions.find(
            {"material_id": doc["_id"], "project_id": ctx.project_id}
        ).sort("created_at", -1).limit(20)
    ]
    return data


def create_material(ctx: ProjectContext, payload) -> dict:
    if not role_has(ctx.role, "inventory:manage"):
        raise forbidden()
    db = get_db()
    if db.materials.find_one({"project_id": ctx.project_id, "name": payload.name}):
        raise AppError("CONFLICT", "A material with this name already exists in this project.", 409)
    now = utcnow()
    opening = Decimal(str(payload.opening_stock))
    doc = {
        "project_id": ctx.project_id,
        "name": payload.name,
        "sku": payload.sku,
        "category": payload.category,
        "unit": payload.unit,
        "opening_stock": dec(opening),
        "current_stock": dec(opening),
        "reorder_level": dec(payload.reorder_level),
        "supplier": payload.supplier,
        "unit_cost_minor": int(round(payload.unit_cost * 100)) if payload.unit_cost else None,
        "is_active": True,
        "created_by": ctx.user["_id"],
        "created_at": now,
        "updated_at": now,
    }
    result = db.materials.insert_one(doc)
    doc["_id"] = result.inserted_id
    if opening > 0:
        db.inventory_transactions.insert_one(
            {
                "project_id": ctx.project_id,
                "material_id": doc["_id"],
                "type": "opening",
                "quantity": dec(opening),
                "unit": doc["unit"],
                "stock_before": dec(0),
                "stock_after": dec(opening),
                "reference_type": "manual",
                "reference_id": None,
                "remarks": "Opening stock",
                "created_by": ctx.user["_id"],
                "created_at": now,
            }
        )
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="material.create",
                 entity_type="material", entity_id=doc["_id"], after={"name": doc["name"], "opening": str(opening)})
    return get_material(ctx, str(doc["_id"]))


def update_material(ctx: ProjectContext, material_id: str, payload) -> dict:
    if not role_has(ctx.role, "inventory:manage"):
        raise forbidden()
    db = get_db()
    doc = db.materials.find_one({"_id": oid(material_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Material")
    changes = payload.model_dump(exclude_unset=True)
    if "reorder_level" in changes and changes["reorder_level"] is not None:
        changes["reorder_level"] = dec(changes["reorder_level"])
    if "unit_cost" in changes and changes["unit_cost"] is not None:
        changes["unit_cost_minor"] = int(round(changes.pop("unit_cost") * 100))
    changes.pop("unit_cost", None)
    if not changes:
        return get_material(ctx, material_id)
    changes["updated_at"] = utcnow()
    db.materials.update_one({"_id": doc["_id"]}, {"$set": changes})
    return get_material(ctx, material_id)


def transact(ctx: ProjectContext, payload) -> dict:
    db = get_db()
    is_managed = payload.type in MANAGED_TYPES
    if is_managed and not role_has(ctx.role, "inventory:manage"):
        raise forbidden(f"Role '{ctx.role}' cannot perform '{payload.type}' transactions.")
    if not is_managed and not role_has(ctx.role, "inventory:consume"):
        raise forbidden()

    material = db.materials.find_one({"_id": oid(payload.material_id), "project_id": ctx.project_id})
    if not material:
        raise not_found("Material")

    qty = Decimal(str(payload.quantity)).quantize(Decimal("0.001"))
    if qty <= 0:
        raise AppError("VALIDATION_ERROR", "Quantity must be greater than zero.", 422)

    if payload.type == "adjustment":
        if payload.direction not in {"increase", "decrease"}:
            raise AppError("VALIDATION_ERROR", "Adjustment requires direction=increase|decrease.", 422)
        delta = qty if payload.direction == "increase" else -qty
    else:
        delta = qty * DIRECTION[payload.type]

    now = utcnow()
    update_filter: dict = {"_id": material["_id"], "project_id": ctx.project_id}
    if delta < 0 and not payload.allow_negative:
        update_filter["current_stock"] = {"$gte": dec(qty)}

    result = db.materials.find_one_and_update(
        update_filter,
        {"$inc": {"current_stock": Decimal128(delta)}, "$set": {"updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        current = to_decimal(material["current_stock"])
        raise AppError(
            "INSUFFICIENT_STOCK",
            f"Only {current} {material['unit']} of '{material['name']}' are available.",
            409,
            [{"field": "quantity", "issue": f"requested {qty}, available {current}"}],
        )

    after = to_decimal(result["current_stock"])
    before = after - delta
    txn = {
        "project_id": ctx.project_id,
        "material_id": material["_id"],
        "type": payload.type,
        "quantity": dec(qty),
        "unit": material["unit"],
        "stock_before": dec(before),
        "stock_after": dec(after),
        "reference_type": payload.reference_type,
        "reference_id": oid(payload.reference_id) if payload.reference_id else None,
        "remarks": payload.remarks,
        "created_by": ctx.user["_id"],
        "created_at": now,
    }
    inserted = db.inventory_transactions.insert_one(txn)

    reorder = to_decimal(result["reorder_level"])
    low = after <= reorder
    if low:
        notify.notify_project_managers(
            ctx.project,
            "Low stock alert",
            f"{material['name']} is at {after} {material['unit']} (reorder at {reorder}).",
            "low_stock",
            "/inventory",
        )
    audit.record(
        actor_id=ctx.user["_id"], project_id=ctx.project_id, action=f"inventory.{payload.type}",
        entity_type="inventory_transaction", entity_id=inserted.inserted_id,
        before={"stock": str(before)}, after={"stock": str(after), "quantity": str(qty)},
    )
    return {
        "transaction": entity({**txn, "_id": inserted.inserted_id}),
        "material": {
            **entity(result),
            "is_low_stock": low,
        },
    }


def list_transactions(ctx: ProjectContext, *, material_id: str | None, type_: str | None, date_from: str | None,
                      date_to: str | None, page_no: int, page_size: int) -> dict:
    db = get_db()
    query: dict = {"project_id": ctx.project_id}
    if material_id:
        query["material_id"] = oid(material_id)
    if type_:
        query["type"] = type_
    if date_from or date_to:
        start = ist_day_range(date_from or "1970-01-01", date_from or "1970-01-01")[0] if date_from else None
        end = ist_day_range(date_to, date_to)[1] if date_to else None
        rng = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lt"] = end
        query["created_at"] = rng
    total = db.inventory_transactions.count_documents(query)
    docs = db.inventory_transactions.find(query).sort("created_at", -1).skip((page_no - 1) * page_size).limit(page_size)
    items = []
    for txn in docs:
        item = entity(txn)
        mat = db.materials.find_one({"_id": txn["material_id"]}, {"name": 1, "unit": 1})
        user = db.users.find_one({"_id": txn["created_by"]}, {"name": 1})
        item["material_name"] = mat["name"] if mat else "Deleted material"
        item["created_by_name"] = user["name"] if user else "Unknown"
        items.append(item)
    return page(items, total, page_no, page_size)


def alerts(ctx: ProjectContext) -> list[dict]:
    db = get_db()
    docs = db.materials.find(
        {"project_id": ctx.project_id, "is_active": True, "$expr": {"$lte": ["$current_stock", "$reorder_level"]}}
    ).sort("name", 1)
    out = []
    for doc in docs:
        stock = to_decimal(doc["current_stock"])
        reorder = to_decimal(doc["reorder_level"])
        gap = reorder - stock
        out.append({
            "id": str(doc["_id"]),
            "name": doc["name"],
            "unit": doc["unit"],
            "current_stock": fmt_qty(stock),
            "reorder_level": fmt_qty(reorder),
            "shortfall": fmt_qty(gap if gap > 0 else Decimal("0")),
            "supplier": doc.get("supplier"),
        })
    return out


def forecast(ctx: ProjectContext, horizon_days: int = 14) -> dict:
    db = get_db()
    materials = list(db.materials.find({"project_id": ctx.project_id, "is_active": True}).sort("name", 1))
    since = utcnow() - timedelta(days=90)
    results = []
    for material in materials:
        txns = list(db.inventory_transactions.find({
            "project_id": ctx.project_id,
            "material_id": material["_id"],
            "type": "consumption",
            "created_at": {"$gte": since},
        }))
        total_consumed = sum((to_decimal(t["quantity"]) for t in txns), Decimal("0"))
        events = len(txns)
        span_days = 90 if events else 0
        if events and txns:
            first = min(t["created_at"] for t in txns)
            span_days = max(1, min(90, (utcnow() - first).days + 1))
        daily_rate = (total_consumed / Decimal(span_days)) if span_days else Decimal("0")
        stock = to_decimal(material["current_stock"])
        reorder = to_decimal(material["reorder_level"])
        demand = daily_rate * Decimal(horizon_days)
        suggested = max(Decimal("0"), demand + reorder - stock)
        suggested = suggested.quantize(Decimal("0.001"), rounding=ROUND_CEILING)
        days_cover = (stock / daily_rate) if daily_rate > 0 else None
        if events >= 3 and span_days >= 14:
            method = "moving_average_90d"
            confidence = "medium" if events >= 10 else "low"
            reason = (
                f"Consumed {total_consumed.quantize(Decimal('0.001'))} {material['unit']} across {events} "
                f"transactions in {span_days} days; {stock} in stock."
            )
        else:
            method = "rule_based"
            confidence = "low"
            reason = (
                "Insufficient consumption history (fewer than 3 events or 14 days). "
                "Estimate uses the reorder level and current stock only."
            )
        results.append({
            "material": {
                "id": str(material["_id"]),
                "name": material["name"],
                "unit": material["unit"],
                "current_stock": fmt_qty(stock),
                "reorder_level": fmt_qty(reorder),
            },
            "method": method,
            "confidence": confidence,
            "data_points": events,
            "horizon_days": horizon_days,
            "daily_rate": fmt_qty(daily_rate),
            "days_of_cover": round(float(days_cover), 1) if days_cover is not None else None,
            "expected_demand": fmt_qty(demand),
            "suggested_reorder": fmt_qty(suggested),
            "reason": reason,
            "limitations": ["Based on the last 90 days of transactions; seasonality is not modeled."]
            if method == "moving_average_90d" else
            ["Not enough history for trend analysis."],
        })
    return {
        "generated_at": utcnow().isoformat(),
        "horizon_days": horizon_days,
        "items": results,
        "note": "Forecasts are transparent estimates, not validated predictions.",
    }


def reconcile(ctx: ProjectContext) -> list[dict]:
    db = get_db()
    out = []
    for material in db.materials.find({"project_id": ctx.project_id}):
        signed = Decimal("0")
        for txn in db.inventory_transactions.find({"project_id": ctx.project_id, "material_id": material["_id"]}):
            qty = to_decimal(txn["quantity"])
            t = txn["type"]
            if t in {"opening", "receipt", "return"}:
                signed += qty
            elif t in {"consumption", "wastage"}:
                signed -= qty
            elif t == "adjustment":
                signed += qty if to_decimal(txn["stock_after"]) >= to_decimal(txn["stock_before"]) else -qty
        actual = to_decimal(material["current_stock"])
        out.append({
            "material_id": str(material["_id"]),
            "name": material["name"],
            "ledger_balance": fmt_qty(signed),
            "current_stock": fmt_qty(actual),
            "consistent": signed == actual,
        })
    return out
