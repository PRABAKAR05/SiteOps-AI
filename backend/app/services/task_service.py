from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.services.project_service import ProjectContext
from app.utils.dates import oid, today_ist, utcnow
from app.utils.serialize import entity, page

ACTIVE = ["not_started", "in_progress", "blocked"]


def _serialize(doc: dict, db) -> dict:
    data = entity(doc)
    assignee = db.users.find_one({"_id": doc["assigned_to"]}, {"name": 1}) if doc.get("assigned_to") else None
    data["assigned_to_name"] = assignee["name"] if assignee else None
    return data


def list_tasks(ctx: ProjectContext, *, status: str | None, category: str | None, assigned_to: str | None,
               overdue: bool, q: str | None, page_no: int, page_size: int) -> dict:
    db = get_db()
    query: dict = {"project_id": ctx.project_id}
    if status:
        query["status"] = status
    if category:
        query["category"] = category
    if assigned_to:
        query["assigned_to"] = oid(assigned_to)
    if overdue:
        query["due_date"] = {"$lt": today_ist().isoformat()}
        query["status"] = {"$in": ACTIVE}
    if q:
        query["$or"] = [{"title": {"$regex": q, "$options": "i"}}, {"location": {"$regex": q, "$options": "i"}}]
    total = db.tasks.count_documents(query)
    docs = db.tasks.find(query).sort([("due_date", 1)]).skip((page_no - 1) * page_size).limit(page_size)
    return page([_serialize(d, db) for d in docs], total, page_no, page_size)


def get_task(ctx: ProjectContext, task_id: str) -> dict:
    db = get_db()
    doc = db.tasks.find_one({"_id": oid(task_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Task")
    return _serialize(doc, db)


def _has_cycle(db, project_id, start_id, dependencies: list[str]) -> bool:
    graph: dict[str, list[str]] = {}
    for task in db.tasks.find({"project_id": project_id}):
        graph[str(task["_id"])] = [str(d) for d in task.get("dependencies", [])]
    graph[str(start_id)] = [str(d) for d in dependencies]

    def visit(node: str, stack: set[str], seen: set[str]) -> bool:
        if node in stack:
            return True
        if node in seen:
            return False
        stack.add(node)
        for nxt in graph.get(node, []):
            if visit(nxt, stack, seen):
                return True
        stack.discard(node)
        seen.add(node)
        return False

    return any(visit(node, set(), set()) for node in list(graph))


def _validate_refs(db, ctx: ProjectContext, assignee: str | None, dependencies: list[str] | None, task_id: str | None = None):
    if assignee:
        if not db.project_members.find_one({"project_id": ctx.project_id, "user_id": oid(assignee)}):
            raise AppError("VALIDATION_ERROR", "Assigned user must be a member of this project.", 422)
    if dependencies:
        found = db.tasks.count_documents({"_id": {"$in": [oid(d) for d in dependencies]}, "project_id": ctx.project_id})
        if found != len(set(dependencies)):
            raise AppError("VALIDATION_ERROR", "All dependencies must belong to this project.", 422)
        if task_id and _has_cycle(db, ctx.project_id, task_id, dependencies):
            raise AppError("TASK_DEPENDENCY_CYCLE", "This dependency would create a cycle.", 422)


def create_task(ctx: ProjectContext, payload) -> dict:
    if not role_has(ctx.role, "task:create"):
        raise forbidden()
    db = get_db()
    _validate_refs(db, ctx, payload.assigned_to, payload.dependencies)
    now = utcnow()
    doc = {
        **payload.model_dump(),
        "project_id": ctx.project_id,
        "start_date": payload.start_date.isoformat(),
        "due_date": payload.due_date.isoformat(),
        "assigned_to": oid(payload.assigned_to) if payload.assigned_to else None,
        "dependencies": [oid(d) for d in payload.dependencies],
        "created_by": ctx.user["_id"],
        "completed_at": now if payload.status == "completed" else None,
        "progress": 100 if payload.status == "completed" else payload.progress,
        "created_at": now,
        "updated_at": now,
    }
    result = db.tasks.insert_one(doc)
    doc["_id"] = result.inserted_id
    _recompute_progress(ctx.project_id)
    return get_task(ctx, str(result.inserted_id))


def update_task(ctx: ProjectContext, task_id: str, payload) -> dict:
    db = get_db()
    doc = db.tasks.find_one({"_id": oid(task_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Task")
    if not role_has(ctx.role, "task:create") and doc.get("assigned_to") != ctx.user["_id"]:
        raise forbidden()
    changes = payload.model_dump(exclude_unset=True)
    _validate_refs(db, ctx, changes.get("assigned_to"), changes.get("dependencies"), task_id)
    if "start_date" in changes and changes["start_date"]:
        changes["start_date"] = changes["start_date"].isoformat()
    if "due_date" in changes and changes["due_date"]:
        changes["due_date"] = changes["due_date"].isoformat()
    if "assigned_to" in changes:
        changes["assigned_to"] = oid(changes["assigned_to"]) if changes["assigned_to"] else None
    if "dependencies" in changes:
        changes["dependencies"] = [oid(d) for d in (changes["dependencies"] or [])]
    if changes.get("status") == "completed":
        changes["progress"] = 100
        changes["completed_at"] = utcnow()
    if changes.get("progress") == 100 and "status" not in changes:
        changes["status"] = "completed"
    if not changes:
        return _serialize(doc, db)
    changes["updated_at"] = utcnow()
    db.tasks.update_one({"_id": doc["_id"]}, {"$set": changes})
    _recompute_progress(ctx.project_id)
    return get_task(ctx, task_id)


def _recompute_progress(project_id):
    db = get_db()
    total_weight = 0
    weighted = 0.0
    for task in db.tasks.find({"project_id": project_id, "status": {"$ne": "cancelled"}}):
        weight = int(task.get("weight", 1))
        total_weight += weight
        weighted += weight * int(task.get("progress", 0))
    percent = int(round(weighted / total_weight)) if total_weight else 0
    db.projects.update_one({"_id": project_id}, {"$set": {"progress_percent": percent, "updated_at": utcnow()}})


def analytics(ctx: ProjectContext) -> dict:
    db = get_db()
    pid = ctx.project_id
    total = db.tasks.count_documents({"project_id": pid, "status": {"$ne": "cancelled"}})
    done = db.tasks.count_documents({"project_id": pid, "status": "completed"})
    overdue = db.tasks.count_documents(
        {"project_id": pid, "status": {"$in": ACTIVE}, "due_date": {"$lt": today_ist().isoformat()}}
    )
    by_status = list(db.tasks.aggregate([
        {"$match": {"project_id": pid}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]))
    by_category = list(db.tasks.aggregate([
        {"$match": {"project_id": pid}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}, "avg_progress": {"$avg": "$progress"}}},
        {"$sort": {"count": -1}},
    ]))
    return {
        "total": total,
        "completed": done,
        "overdue": overdue,
        "completion_percent": round((done / total) * 100) if total else 0,
        "by_status": [{"status": r["_id"], "count": r["count"]} for r in by_status],
        "by_category": [
            {"category": r["_id"], "count": r["count"], "avg_progress": round(r["avg_progress"] or 0)}
            for r in by_category
        ],
    }
