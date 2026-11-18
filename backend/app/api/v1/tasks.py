from fastapi import APIRouter

from app.api.deps import CurrentUser, Pagination
from app.schemas.task import TaskCreate, TaskUpdate
from app.services import task_service
from app.services.project_service import access

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("")
def list_tasks(
    project_id: str,
    user: CurrentUser,
    pg: Pagination,
    status: str | None = None,
    category: str | None = None,
    assigned_to: str | None = None,
    overdue: bool = False,
    q: str | None = None,
):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return task_service.list_tasks(
        ctx, status=status, category=category, assigned_to=assigned_to, overdue=overdue,
        q=q, page_no=page_no, page_size=page_size,
    )


@router.post("", status_code=201)
def create_task(payload: TaskCreate, user: CurrentUser):
    ctx = access(user, payload.project_id)
    return task_service.create_task(ctx, payload)


@router.get("/analytics")
def analytics(project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return task_service.analytics(ctx)


@router.get("/{task_id}")
def get_task(task_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return task_service.get_task(ctx, task_id)


@router.put("/{task_id}")
def update_task(task_id: str, project_id: str, payload: TaskUpdate, user: CurrentUser):
    ctx = access(user, project_id)
    return task_service.update_task(ctx, task_id, payload)
