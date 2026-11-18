from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from app.api.deps import CurrentUser, Pagination
from app.schemas.document import AskIn
from app.services import document_service
from app.services.project_service import access

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("")
def list_documents(
    project_id: str,
    user: CurrentUser,
    pg: Pagination,
    status: str | None = None,
    category: str | None = None,
):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return document_service.list_documents(ctx, status=status, category=category, page_no=page_no, page_size=page_size)


@router.post("", status_code=201)
def upload_document(
    background: BackgroundTasks,
    user: CurrentUser,
    project_id: str = Form(...),
    category: str = Form("other"),
    file: UploadFile = File(...),
):
    ctx = access(user, project_id)
    content = file.file.read()
    doc = document_service.upload(ctx, content, file.filename or "document.pdf", category)
    background.add_task(document_service.process_document, doc["id"])
    return doc


@router.post("/ask")
def ask_all_documents(payload: AskIn, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return document_service.ask(ctx, payload.question)


@router.get("/{document_id}")
def get_document(document_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return document_service.get_document(ctx, document_id)


@router.get("/{document_id}/text")
def document_text(document_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return document_service.document_text(ctx, document_id)


@router.post("/{document_id}/ask")
def ask_document(document_id: str, payload: AskIn, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return document_service.ask(ctx, payload.question, document_id=document_id)


@router.post("/{document_id}/retry")
def retry_document(document_id: str, project_id: str, background: BackgroundTasks, user: CurrentUser):
    ctx = access(user, project_id)
    doc = document_service.retry(ctx, document_id)
    background.add_task(document_service.process_document, document_id)
    return doc


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    document_service.delete_document(ctx, document_id)
