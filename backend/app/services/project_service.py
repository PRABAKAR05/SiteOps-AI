from dataclasses import dataclass

from bson import ObjectId

from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.utils.dates import oid, utcnow
from app.utils.serialize import entity, page


@dataclass
class ProjectContext:
    project: dict
    user: dict
    role: str

    @property
    def project_id(self) -> ObjectId:
        return self.project["_id"]

    def require(self, capability: str) -> None:
        if not role_has(self.role, capability):
            raise forbidden()


def access(user: dict, project_id: str) -> ProjectContext:
    db = get_db()
    try:
        pid = oid(project_id)
    except Exception:
        raise not_found("Project")
    project = db.projects.find_one({"_id": pid})
    if not project:
        raise not_found("Project")
    member = db.project_members.find_one({"project_id": pid, "user_id": user["_id"]})
    if not member and project.get("manager_id") != user["_id"]:
        # 404 rather than 403: do not confirm that the project exists.
        raise not_found("Project")
    role = (member or {}).get("project_role") or user["role"]
    return ProjectContext(project=project, user=user, role=role)


def create(user: dict, payload) -> dict:
    if user["role"] != "project_manager":
        raise forbidden("Only project managers can create projects.")
    db = get_db()
    code = payload.code.upper()
    if db.projects.find_one({"code": code}):
        raise AppError("CONFLICT", "A project with this code already exists.", 409)
    now = utcnow()
    doc = {
        "name": payload.name,
        "code": code,
        "description": payload.description,
        "client_name": payload.client_name,
        "location": payload.location,
        "project_type": payload.project_type,
        "start_date": payload.start_date.isoformat(),
        "expected_end_date": payload.expected_end_date.isoformat(),
        "actual_end_date": None,
        "status": payload.status,
        "manager_id": user["_id"],
        "progress_percent": 0,
        "delay_flag": False,
        "delay_reason": None,
        "is_demo": False,
        "created_by": user["_id"],
        "created_at": now,
        "updated_at": now,
    }
    result = db.projects.insert_one(doc)
    doc["_id"] = result.inserted_id
    db.project_members.insert_one(
        {
            "project_id": result.inserted_id,
            "user_id": user["_id"],
            "project_role": "project_manager",
            "added_by": user["_id"],
            "added_at": now,
        }
    )
    return entity(doc)


def list_for_user(user: dict, *, status: str | None, q: str | None, page_no: int, page_size: int) -> dict:
    db = get_db()
    memberships = list(db.project_members.find({"user_id": user["_id"]}))
    ids = [m["project_id"] for m in memberships]
    if not ids:
        return page([], 0, page_no, page_size)
    query: dict = {"_id": {"$in": ids}}
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"code": {"$regex": q, "$options": "i"}},
            {"client_name": {"$regex": q, "$options": "i"}},
        ]
    total = db.projects.count_documents(query)
    docs = (
        db.projects.find(query)
        .sort([("created_at", 1), ("_id", 1)])
        .skip((page_no - 1) * page_size)
        .limit(page_size)
    )
    items = []
    for doc in docs:
        item = entity(doc)
        item["member_count"] = db.project_members.count_documents({"project_id": doc["_id"]})
        item["open_issues"] = db.site_issues.count_documents(
            {"project_id": doc["_id"], "status": {"$in": ["open", "assigned", "in_progress", "waiting"]}}
        )
        items.append(item)
    return page(items, total, page_no, page_size)


def get(user: dict, project_id: str) -> dict:
    ctx = access(user, project_id)
    data = entity(ctx.project)
    data["member_count"] = get_db().project_members.count_documents({"project_id": ctx.project_id})
    return data


def update(ctx: ProjectContext, payload) -> dict:
    if not role_has(ctx.role, "project:update"):
        raise forbidden()
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("delay_flag") and not changes.get("delay_reason") and not ctx.project.get("delay_reason"):
        raise AppError("VALIDATION_ERROR", "delay_reason is required when delay_flag is set.", 422)
    for key in ("start_date", "expected_end_date"):
        if key in changes and changes[key] is not None:
            changes[key] = changes[key].isoformat()
    if not changes:
        return entity(ctx.project)
    changes["updated_at"] = utcnow()
    get_db().projects.update_one({"_id": ctx.project_id}, {"$set": changes})
    return entity(get_db().projects.find_one({"_id": ctx.project_id}))


def members(ctx: ProjectContext) -> list[dict]:
    db = get_db()
    out = []
    for member in db.project_members.find({"project_id": ctx.project_id}):
        user = db.users.find_one({"_id": member["user_id"]})
        if not user:
            continue
        out.append(
            {
                "user_id": str(user["_id"]),
                "name": user["name"],
                "email": user["email"],
                "role": user["role"],
                "project_role": member.get("project_role") or user["role"],
                "added_at": member.get("added_at"),
            }
        )
    out.sort(key=lambda m: (m["project_role"] != "project_manager", m["name"]))
    return out


def add_member(ctx: ProjectContext, payload) -> dict:
    if not role_has(ctx.role, "project:members"):
        raise forbidden()
    db = get_db()
    target = db.users.find_one({"_id": oid(payload.user_id), "is_active": True})
    if not target:
        raise AppError("VALIDATION_ERROR", "User not found or inactive.", 422)
    existing = db.project_members.find_one({"project_id": ctx.project_id, "user_id": target["_id"]})
    if existing:
        raise AppError("CONFLICT", "User is already a member of this project.", 409)
    db.project_members.insert_one(
        {
            "project_id": ctx.project_id,
            "user_id": target["_id"],
            "project_role": payload.project_role or target["role"],
            "added_by": ctx.user["_id"],
            "added_at": utcnow(),
        }
    )
    return {"user_id": str(target["_id"]), "name": target["name"], "role": target["role"]}


def remove_member(ctx: ProjectContext, user_id: str) -> None:
    if not role_has(ctx.role, "project:members"):
        raise forbidden()
    db = get_db()
    if str(ctx.project.get("manager_id")) == user_id:
        raise AppError("CONFLICT", "The project manager cannot be removed from the project.", 409)
    db.project_members.delete_one({"project_id": ctx.project_id, "user_id": oid(user_id)})


def summary(ctx: ProjectContext) -> dict:
    db = get_db()
    pid = ctx.project_id
    open_statuses = ["open", "assigned", "in_progress", "waiting"]
    return {
        "project": entity(ctx.project),
        "tasks_total": db.tasks.count_documents({"project_id": pid}),
        "tasks_completed": db.tasks.count_documents({"project_id": pid, "status": "completed"}),
        "tasks_overdue": db.tasks.count_documents(
            {"project_id": pid, "status": {"$nin": ["completed", "cancelled"]},
             "due_date": {"$lt": str(__import__("datetime").date.today())}}
        ),
        "reports_pending": db.daily_reports.count_documents({"project_id": pid, "status": "submitted"}),
        "issues_open": db.site_issues.count_documents({"project_id": pid, "status": {"$in": open_statuses}}),
        "issues_critical": db.site_issues.count_documents(
            {"project_id": pid, "priority": "critical", "status": {"$in": open_statuses}}
        ),
        "materials_low_stock": db.materials.count_documents(
            {"project_id": pid, "$expr": {"$lte": ["$current_stock", "$reorder_level"]}}
        ),
        "members": members(ctx),
    }
