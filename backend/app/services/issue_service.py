from app.core.constants import ISSUE_TRANSITIONS
from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.services import audit, notify
from app.services.project_service import ProjectContext
from app.utils.dates import oid, utcnow
from app.utils.serialize import entity, page

OPEN = ["open", "assigned", "in_progress", "waiting"]


def _serialize(doc: dict, db) -> dict:
    data = entity(doc)
    reporter = db.users.find_one({"_id": doc["reported_by"]}, {"name": 1})
    assignee = db.users.find_one({"_id": doc["assigned_to"]}, {"name": 1}) if doc.get("assigned_to") else None
    data["reported_by_name"] = reporter["name"] if reporter else "Unknown"
    data["assigned_to_name"] = assignee["name"] if assignee else None
    return data


def list_issues(ctx: ProjectContext, *, status: str | None, priority: str | None, category: str | None,
                assigned_to: str | None, q: str | None, page_no: int, page_size: int) -> dict:
    db = get_db()
    query: dict = {"project_id": ctx.project_id}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    if category:
        query["category"] = category
    if assigned_to:
        query["assigned_to"] = oid(assigned_to)
    if q:
        query["$or"] = [{"title": {"$regex": q, "$options": "i"}}, {"description": {"$regex": q, "$options": "i"}}]
    total = db.site_issues.count_documents(query)
    docs = db.site_issues.find(query).sort([("created_at", -1)]).skip((page_no - 1) * page_size).limit(page_size)
    return page([_serialize(d, db) for d in docs], total, page_no, page_size)


def get_issue(ctx: ProjectContext, issue_id: str) -> dict:
    db = get_db()
    doc = db.site_issues.find_one({"_id": oid(issue_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Issue")
    return _serialize(doc, db)


def create_issue(ctx: ProjectContext, payload) -> dict:
    if not role_has(ctx.role, "issue:create"):
        raise forbidden()
    db = get_db()
    now = utcnow()
    doc = {
        **payload.model_dump(exclude={"status"}),
        "project_id": ctx.project_id,
        "status": "open",
        "reported_by": ctx.user["_id"],
        "assigned_to": None,
        "resolution_notes": None,
        "resolved_at": None,
        "closed_at": None,
        "due_date": payload.due_date.isoformat() if payload.due_date else None,
        "created_at": now,
        "updated_at": now,
    }
    result = db.site_issues.insert_one(doc)
    doc["_id"] = result.inserted_id
    if payload.ai_suggestion:
        doc["ai_suggestion"] = {**payload.ai_suggestion, "accepted": True}
        db.site_issues.update_one({"_id": result.inserted_id}, {"$set": {"ai_suggestion": doc["ai_suggestion"]}})
    if doc["priority"] in {"high", "critical"}:
        notify.notify_project_managers(
            ctx.project, f"{doc['priority'].title()} priority issue",
            f"{ctx.user['name']} reported: {doc['title']}", "issue_assigned", f"/issues/{result.inserted_id}",
        )
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="issue.create",
                 entity_type="site_issue", entity_id=result.inserted_id, after={"title": doc["title"], "priority": doc["priority"]})
    return get_issue(ctx, str(result.inserted_id))


def update_issue(ctx: ProjectContext, issue_id: str, payload) -> dict:
    db = get_db()
    doc = db.site_issues.find_one({"_id": oid(issue_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Issue")
    if doc["reported_by"] != ctx.user["_id"] and doc.get("assigned_to") != ctx.user["_id"] and not role_has(ctx.role, "issue:assign"):
        raise forbidden()
    changes = payload.model_dump(exclude_unset=True)
    if "due_date" in changes and changes["due_date"] is not None:
        changes["due_date"] = changes["due_date"].isoformat()
    if not changes:
        return get_issue(ctx, issue_id)
    changes["updated_at"] = utcnow()
    db.site_issues.update_one({"_id": doc["_id"]}, {"$set": changes})
    return get_issue(ctx, issue_id)


def assign(ctx: ProjectContext, issue_id: str, assignee_id: str) -> dict:
    if not role_has(ctx.role, "issue:assign"):
        raise forbidden()
    db = get_db()
    doc = db.site_issues.find_one({"_id": oid(issue_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Issue")
    member = db.project_members.find_one({"project_id": ctx.project_id, "user_id": oid(assignee_id)})
    if not member:
        raise AppError("VALIDATION_ERROR", "Assignee must be a member of this project.", 422)
    db.site_issues.update_one(
        {"_id": doc["_id"]},
        {"$set": {"assigned_to": oid(assignee_id), "status": "assigned", "updated_at": utcnow()}},
    )
    notify.create(user_id=oid(assignee_id), title="Issue assigned",
                  body=f"{doc['title']} was assigned to you.", type_="issue_assigned",
                  project_id=ctx.project_id, link=f"/issues/{issue_id}")
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="issue.assign",
                 entity_type="site_issue", entity_id=doc["_id"], after={"assigned_to": assignee_id})
    return get_issue(ctx, issue_id)


def set_status(ctx: ProjectContext, issue_id: str, new_status: str) -> dict:
    db = get_db()
    doc = db.site_issues.find_one({"_id": oid(issue_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Issue")
    if new_status not in ISSUE_TRANSITIONS:
        raise AppError("VALIDATION_ERROR", "Unknown issue status.", 422)
    if doc["status"] == new_status:
        return get_issue(ctx, issue_id)
    if new_status not in ISSUE_TRANSITIONS[doc["status"]]:
        raise AppError("CONFLICT", f"Cannot move an issue from '{doc['status']}' to '{new_status}'.", 409)
    if not role_has(ctx.role, "issue:resolve"):
        raise forbidden()
    now = utcnow()
    updates = {"status": new_status, "updated_at": now}
    if new_status == "resolved":
        updates["resolved_at"] = now
    if new_status == "closed":
        updates["closed_at"] = now
    db.site_issues.update_one({"_id": doc["_id"]}, {"$set": updates})
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action=f"issue.{new_status}",
                 entity_type="site_issue", entity_id=doc["_id"], before={"status": doc["status"]}, after={"status": new_status})
    return get_issue(ctx, issue_id)


def resolve(ctx: ProjectContext, issue_id: str, notes: str) -> dict:
    if not role_has(ctx.role, "issue:resolve"):
        raise forbidden()
    db = get_db()
    doc = db.site_issues.find_one({"_id": oid(issue_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Issue")
    if doc["status"] not in {"open", "assigned", "in_progress", "waiting"}:
        raise AppError("CONFLICT", f"An issue in '{doc['status']}' cannot be resolved.", 409)
    now = utcnow()
    db.site_issues.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "resolved", "resolution_notes": notes, "resolved_at": now, "updated_at": now}},
    )
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="issue.resolve",
                 entity_type="site_issue", entity_id=doc["_id"], after={"resolution_notes": notes[:200]})
    return get_issue(ctx, issue_id)


def analytics(ctx: ProjectContext) -> dict:
    db = get_db()
    by_status = {s: db.site_issues.count_documents({"project_id": ctx.project_id, "status": s})
                 for s in ["open", "assigned", "in_progress", "waiting", "resolved", "closed"]}
    by_category = list(db.site_issues.aggregate([
        {"$match": {"project_id": ctx.project_id}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]))
    by_priority = list(db.site_issues.aggregate([
        {"$match": {"project_id": ctx.project_id, "status": {"$in": OPEN}}},
        {"$group": {"_id": "$priority", "count": {"$sum": 1}}},
    ]))
    return {
        "total": db.site_issues.count_documents({"project_id": ctx.project_id}),
        "open": db.site_issues.count_documents({"project_id": ctx.project_id, "status": {"$in": OPEN}}),
        "critical": db.site_issues.count_documents({"project_id": ctx.project_id, "priority": "critical", "status": {"$in": OPEN}}),
        "by_status": by_status,
        "by_category": [{"category": r["_id"], "count": r["count"]} for r in by_category],
        "by_priority": [{"priority": r["_id"], "count": r["count"]} for r in by_priority],
    }
