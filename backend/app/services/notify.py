from bson import ObjectId

from app.database.mongo import get_db
from app.utils.dates import utcnow


def create(
    *,
    user_id: ObjectId,
    title: str,
    body: str,
    type_: str,
    project_id: ObjectId | None = None,
    link: str | None = None,
) -> None:
    get_db().notifications.insert_one(
        {
            "user_id": user_id,
            "project_id": project_id,
            "type": type_,
            "title": title[:120],
            "body": body[:400],
            "link": link,
            "read_at": None,
            "created_at": utcnow(),
        }
    )


def notify_project_managers(project: dict, title: str, body: str, type_: str, link: str) -> None:
    db = get_db()
    manager_ids = {project["manager_id"]}
    for member in db.project_members.find({"project_id": project["_id"], "project_role": "project_manager"}):
        manager_ids.add(member["user_id"])
    for uid in manager_ids:
        create(user_id=uid, title=title, body=body, type_=type_, project_id=project["_id"], link=link)
