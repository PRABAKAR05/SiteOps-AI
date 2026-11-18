from bson import ObjectId

from app.database.mongo import get_db
from app.utils.dates import utcnow


def record(
    *,
    actor_id: ObjectId | None,
    action: str,
    entity_type: str,
    entity_id: ObjectId | str | None,
    project_id: ObjectId | None = None,
    before: dict | None = None,
    after: dict | None = None,
    request_id: str | None = None,
) -> None:
    get_db().audit_logs.insert_one(
        {
            "actor_id": actor_id,
            "project_id": project_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "before": before,
            "after": after,
            "request_id": request_id,
            "created_at": utcnow(),
        }
    )
