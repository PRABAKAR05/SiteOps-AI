from fastapi import APIRouter

from app.api.deps import CurrentUser, Pagination
from app.schemas.issue import AssignIn, IssueCreate, IssueUpdate, ResolveIn, StatusIn
from app.services import issue_service
from app.services.project_service import access

router = APIRouter(prefix="/issues", tags=["issues"])


@router.get("")
def list_issues(
    project_id: str,
    user: CurrentUser,
    pg: Pagination,
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    assigned_to: str | None = None,
    q: str | None = None,
):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return issue_service.list_issues(
        ctx, status=status, priority=priority, category=category, assigned_to=assigned_to,
        q=q, page_no=page_no, page_size=page_size,
    )


@router.post("", status_code=201)
def create_issue(payload: IssueCreate, user: CurrentUser):
    ctx = access(user, payload.project_id)
    return issue_service.create_issue(ctx, payload)


@router.get("/analytics")
def analytics(project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return issue_service.analytics(ctx)


@router.get("/{issue_id}")
def get_issue(issue_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return issue_service.get_issue(ctx, issue_id)


@router.put("/{issue_id}")
def update_issue(issue_id: str, project_id: str, payload: IssueUpdate, user: CurrentUser):
    ctx = access(user, project_id)
    return issue_service.update_issue(ctx, issue_id, payload)


@router.post("/{issue_id}/assign")
def assign_issue(issue_id: str, project_id: str, payload: AssignIn, user: CurrentUser):
    ctx = access(user, project_id)
    return issue_service.assign(ctx, issue_id, payload.assigned_to)


@router.post("/{issue_id}/status")
def set_status(issue_id: str, project_id: str, payload: StatusIn, user: CurrentUser):
    ctx = access(user, project_id)
    return issue_service.set_status(ctx, issue_id, payload.status)


@router.post("/{issue_id}/resolve")
def resolve_issue(issue_id: str, project_id: str, payload: ResolveIn, user: CurrentUser):
    ctx = access(user, project_id)
    return issue_service.resolve(ctx, issue_id, payload.resolution_notes)
