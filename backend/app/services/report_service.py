from bson import ObjectId

from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.services import audit, notify
from app.services.project_service import ProjectContext
from app.utils.dates import dec, oid, utcnow
from app.utils.serialize import entity, page


def _serialize(doc: dict) -> dict:
    data = entity(doc)
    workers = doc.get("workers_present") or {}
    data["workers_present"] = {
        "total": workers.get("total"),
        "by_trade": workers.get("by_trade", []),
    }
    return data


def _visible_filter(ctx: ProjectContext) -> dict:
    query: dict = {"project_id": ctx.project_id}
    if not role_has(ctx.role, "report:approve"):
        query["$or"] = [
            {"status": {"$ne": "draft"}},
            {"submitted_by": ctx.user["_id"]},
        ]
    return query


def list_reports(
    ctx: ProjectContext,
    *,
    status: str | None,
    date_from: str | None,
    date_to: str | None,
    submitted_by: str | None,
    page_no: int,
    page_size: int,
) -> dict:
    db = get_db()
    query = _visible_filter(ctx)
    if status:
        query["status"] = status
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        query["report_date"] = rng
    if submitted_by:
        query["submitted_by"] = oid(submitted_by)
    total = db.daily_reports.count_documents(query)
    docs = (
        db.daily_reports.find(query)
        .sort([("report_date", -1), ("created_at", -1)])
        .skip((page_no - 1) * page_size)
        .limit(page_size)
    )
    items = []
    for doc in docs:
        item = _serialize(doc)
        author = db.users.find_one({"_id": doc["submitted_by"]})
        item["submitted_by_name"] = author["name"] if author else "Unknown"
        items.append(item)
    return page(items, total, page_no, page_size)


def get_report(ctx: ProjectContext, report_id: str) -> dict:
    doc = _load(ctx, report_id)
    if doc["status"] == "draft" and doc["submitted_by"] != ctx.user["_id"] and not role_has(ctx.role, "report:approve"):
        raise not_found("Report")
    data = _serialize(doc)
    author = get_db().users.find_one({"_id": doc["submitted_by"]})
    data["submitted_by_name"] = author["name"] if author else "Unknown"
    return data


def _load(ctx: ProjectContext, report_id: str) -> dict:
    try:
        doc = get_db().daily_reports.find_one({"_id": oid(report_id), "project_id": ctx.project_id})
    except Exception:
        doc = None
    if not doc:
        raise not_found("Report")
    return doc


def create_report(ctx: ProjectContext, payload) -> dict:
    if not role_has(ctx.role, "report:create"):
        raise forbidden()
    db = get_db()
    now = utcnow()
    data = payload.model_dump()
    for item in data["materials_consumed"]:
        if item.get("material_id"):
            material = db.materials.find_one({"_id": oid(item["material_id"]), "project_id": ctx.project_id})
            if not material:
                raise AppError("VALIDATION_ERROR", "Material does not belong to this project.", 422)
            item["quantity"] = dec(item["quantity"])
        else:
            item["quantity"] = dec(item["quantity"])
    doc = {
        **data,
        "project_id": ctx.project_id,
        "report_date": payload.report_date.isoformat(),
        "submitted_by": ctx.user["_id"],
        "status": payload.status,
        "submitted_at": now if payload.status == "submitted" else None,
        "approved_by": None,
        "approved_at": None,
        "rejection_reason": None,
        "created_at": now,
        "updated_at": now,
    }
    result = db.daily_reports.insert_one(doc)
    doc["_id"] = result.inserted_id
    if payload.status == "submitted":
        notify.notify_project_managers(
            ctx.project,
            "Report submitted",
            f"{ctx.user['name']} submitted the {payload.report_date} report.",
            "report_submitted",
            f"/reports/{result.inserted_id}",
        )
    audit.record(
        actor_id=ctx.user["_id"],
        project_id=ctx.project_id,
        action="report.create",
        entity_type="daily_report",
        entity_id=result.inserted_id,
        after={"status": payload.status, "report_date": doc["report_date"]},
    )
    return get_report(ctx, str(result.inserted_id))


def update_report(ctx: ProjectContext, report_id: str, payload) -> dict:
    doc = _load(ctx, report_id)
    if doc["submitted_by"] != ctx.user["_id"]:
        raise forbidden("Only the author can edit this report.")
    if doc["status"] not in {"draft", "rejected"}:
        raise AppError("CONFLICT", "Reports can only be edited while draft or rejected.", 409)
    changes = payload.model_dump(exclude_unset=True)
    if "materials_consumed" in changes and changes["materials_consumed"] is not None:
        for item in changes["materials_consumed"]:
            item["quantity"] = dec(item["quantity"])
    if not changes:
        return _serialize(doc)
    changes["updated_at"] = utcnow()
    get_db().daily_reports.update_one({"_id": doc["_id"]}, {"$set": changes})
    return get_report(ctx, report_id)


def submit_report(ctx: ProjectContext, report_id: str) -> dict:
    doc = _load(ctx, report_id)
    if doc["submitted_by"] != ctx.user["_id"] and not role_has(ctx.role, "report:approve"):
        raise forbidden()
    if doc["status"] not in {"draft", "rejected"}:
        raise AppError("CONFLICT", "Only draft or rejected reports can be submitted.", 409)
    db = get_db()
    db.daily_reports.update_one(
        {"_id": doc["_id"], "status": doc["status"]},
        {"$set": {"status": "submitted", "submitted_at": utcnow(), "rejection_reason": None, "updated_at": utcnow()}},
    )
    notify.notify_project_managers(
        ctx.project,
        "Report submitted",
        f"{ctx.user['name']} submitted the {doc['report_date']} report.",
        "report_submitted",
        f"/reports/{report_id}",
    )
    audit.record(
        actor_id=ctx.user["_id"], project_id=ctx.project_id, action="report.submit",
        entity_type="daily_report", entity_id=doc["_id"], before={"status": doc["status"]}, after={"status": "submitted"},
    )
    return get_report(ctx, report_id)


def approve_report(ctx: ProjectContext, report_id: str) -> dict:
    if not role_has(ctx.role, "report:approve"):
        raise forbidden()
    doc = _load(ctx, report_id)
    if doc["status"] != "submitted":
        raise AppError("CONFLICT", "Only submitted reports can be approved.", 409)
    db = get_db()
    result = db.daily_reports.update_one(
        {"_id": doc["_id"], "status": "submitted"},
        {"$set": {"status": "approved", "approved_by": ctx.user["_id"], "approved_at": utcnow(), "updated_at": utcnow()}},
    )
    if result.modified_count != 1:
        raise AppError("CONFLICT", "Report changed while approving. Reload and try again.", 409)
    notify.create(
        user_id=doc["submitted_by"], title="Report approved",
        body=f"Your {doc['report_date']} report was approved.", type_="report_approved",
        project_id=ctx.project_id, link=f"/reports/{report_id}",
    )
    audit.record(
        actor_id=ctx.user["_id"], project_id=ctx.project_id, action="report.approve",
        entity_type="daily_report", entity_id=doc["_id"], before={"status": "submitted"}, after={"status": "approved"},
    )
    return get_report(ctx, report_id)


def reject_report(ctx: ProjectContext, report_id: str, reason: str) -> dict:
    if not role_has(ctx.role, "report:approve"):
        raise forbidden()
    doc = _load(ctx, report_id)
    if doc["status"] != "submitted":
        raise AppError("CONFLICT", "Only submitted reports can be rejected.", 409)
    get_db().daily_reports.update_one(
        {"_id": doc["_id"], "status": "submitted"},
        {"$set": {"status": "rejected", "rejection_reason": reason, "updated_at": utcnow()}},
    )
    notify.create(
        user_id=doc["submitted_by"], title="Report needs changes",
        body=f"Your {doc['report_date']} report was returned: {reason}", type_="report_rejected",
        project_id=ctx.project_id, link=f"/reports/{report_id}",
    )
    audit.record(
        actor_id=ctx.user["_id"], project_id=ctx.project_id, action="report.reject",
        entity_type="daily_report", entity_id=doc["_id"], after={"status": "rejected", "reason": reason[:200]},
    )
    return get_report(ctx, report_id)


def attach_photo(ctx: ProjectContext, report_id: str, photo: dict) -> dict:
    doc = _load(ctx, report_id)
    if doc["submitted_by"] != ctx.user["_id"]:
        raise forbidden("Only the author can attach photos.")
    if len(doc.get("photos") or []) >= 6:
        raise AppError("VALIDATION_ERROR", "A report can have at most 6 photos.", 422)
    get_db().daily_reports.update_one(
        {"_id": doc["_id"]},
        {"$push": {"photos": photo}, "$set": {"updated_at": utcnow()}},
    )
    return get_report(ctx, report_id)


def report_summary(ctx: ProjectContext, date_from: str, date_to: str) -> dict:
    db = get_db()
    match = {"project_id": ctx.project_id, "report_date": {"$gte": date_from, "$lte": date_to}}
    docs = list(db.daily_reports.find(match))
    workers = [((d.get("workers_present") or {}).get("total") or 0) for d in docs]
    return {
        "reports": len(docs),
        "approved": sum(1 for d in docs if d["status"] == "approved"),
        "pending": sum(1 for d in docs if d["status"] == "submitted"),
        "rejected": sum(1 for d in docs if d["status"] == "rejected"),
        "worker_days": sum(workers),
        "avg_workers": round(sum(workers) / len(workers), 1) if workers else 0,
        "delays_reported": sum(1 for d in docs if (d.get("delays") or "").strip()),
    }
