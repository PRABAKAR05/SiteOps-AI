from fastapi import APIRouter

from app.api.deps import CurrentUser, Pagination
from app.core import constants
from app.core.config import settings
from app.core.errors import AppError
from app.core.permissions import CAPABILITIES
from app.database.mongo import get_db, ping
from app.ai import service as ai_service
from app.utils.dates import utcnow
from app.utils.serialize import entity, page

router = APIRouter(tags=["meta"])


@router.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name, "env": settings.app_env}


@router.get("/health/ready")
def ready():
    db_ok = ping()
    if not db_ok:
        raise AppError("DATABASE_UNAVAILABLE", "Database is not reachable.", 503)
    return {
        "status": "ready",
        "database": "up",
        "ai": ai_service.status(),
        "embedding_default": settings.embedding_model,
        "time": utcnow().isoformat(),
    }


@router.get("/meta/enums")
def enums(user: CurrentUser):
    return {
        "roles": constants.ROLES,
        "project_types": constants.PROJECT_TYPES,
        "project_statuses": constants.PROJECT_STATUSES,
        "report_statuses": constants.REPORT_STATUSES,
        "issue_categories": constants.ISSUE_CATEGORIES,
        "issue_priorities": constants.ISSUE_PRIORITIES,
        "issue_severities": constants.ISSUE_SEVERITIES,
        "issue_statuses": constants.ISSUE_STATUSES,
        "material_categories": constants.MATERIAL_CATEGORIES,
        "units": constants.UNITS,
        "transaction_types": constants.TRANSACTION_TYPES,
        "invoice_statuses": constants.INVOICE_STATUSES,
        "document_statuses": constants.DOCUMENT_STATUSES,
        "document_categories": constants.DOCUMENT_CATEGORIES,
        "task_categories": constants.TASK_CATEGORIES,
        "capabilities": {k: sorted(v) for k, v in CAPABILITIES.items()},
    }


@router.get("/notifications")
def list_notifications(user: CurrentUser, pg: Pagination, unread_only: bool = False):
    db = get_db()
    query: dict = {"user_id": user["_id"]}
    if unread_only:
        query["read_at"] = None
    page_no, page_size = pg
    total = db.notifications.count_documents(query)
    docs = db.notifications.find(query).sort("created_at", -1).skip((page_no - 1) * page_size).limit(page_size)
    items = []
    for doc in docs:
        item = entity(doc)
        item["is_read"] = doc.get("read_at") is not None
        items.append(item)
    unread = db.notifications.count_documents({"user_id": user["_id"], "read_at": None})
    return {**page(items, total, page_no, page_size), "unread": unread}


@router.post("/notifications/read-all")
def read_all(user: CurrentUser):
    result = get_db().notifications.update_many(
        {"user_id": user["_id"], "read_at": None}, {"$set": {"read_at": utcnow()}}
    )
    return {"updated": result.modified_count}


@router.post("/notifications/{notification_id}/read")
def read_one(notification_id: str, user: CurrentUser):
    from bson import ObjectId

    result = get_db().notifications.update_one(
        {"_id": ObjectId(notification_id), "user_id": user["_id"]}, {"$set": {"read_at": utcnow()}}
    )
    if result.matched_count == 0:
        raise AppError("NOTIFICATION_NOT_FOUND", "Notification not found.", 404)
    return {"ok": True}


@router.get("/users")
def search_users(user: CurrentUser, pg: Pagination, q: str | None = None):
    if user["role"] != "project_manager":
        raise AppError("FORBIDDEN_ROLE", "Only project managers can search the user directory.", 403)
    db = get_db()
    query: dict = {"is_active": True}
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    page_no, page_size = pg
    total = db.users.count_documents(query)
    docs = db.users.find(query, {"password_hash": 0}).sort("name", 1).skip((page_no - 1) * page_size).limit(page_size)
    return page([entity(d) for d in docs], total, page_no, page_size)
