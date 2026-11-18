from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, Pagination
from app.schemas.project import MemberAdd, ProjectCreate, ProjectUpdate
from app.services import project_service

router = APIRouter(tags=["projects"])


@router.get("/projects")
def list_projects(user: CurrentUser, pg: Pagination, status: str | None = None, q: str | None = None):
    page_no, page_size = pg
    return project_service.list_for_user(user, status=status, q=q, page_no=page_no, page_size=page_size)


@router.post("/projects", status_code=201)
def create_project(payload: ProjectCreate, user: CurrentUser):
    return project_service.create(user, payload)


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: CurrentUser):
    return project_service.get(user, project_id)


@router.put("/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdate, user: CurrentUser):
    ctx = project_service.access(user, project_id)
    return project_service.update(ctx, payload)


@router.get("/projects/{project_id}/members")
def list_members(project_id: str, user: CurrentUser):
    return {"items": project_service.members(project_service.access(user, project_id))}


@router.post("/projects/{project_id}/members", status_code=201)
def add_member(project_id: str, payload: MemberAdd, user: CurrentUser):
    ctx = project_service.access(user, project_id)
    return project_service.add_member(ctx, payload)


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: str, user_id: str, user: CurrentUser):
    ctx = project_service.access(user, project_id)
    project_service.remove_member(ctx, user_id)


@router.get("/projects/{project_id}/summary")
def project_summary(project_id: str, user: CurrentUser):
    ctx = project_service.access(user, project_id)
    return project_service.summary(ctx)
