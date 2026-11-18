from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import CurrentUser, Pagination
from app.core.config import settings
from app.core.errors import AppError
from app.schemas.invoice import VerifyIn
from app.services import invoice_service
from app.services.project_service import access
from app.utils.files import resolve_storage_path

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.get("")
def list_invoices(project_id: str, user: CurrentUser, pg: Pagination, status: str | None = None, q: str | None = None):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return invoice_service.list_invoices(ctx, status=status, q=q, page_no=page_no, page_size=page_size)


@router.post("/upload", status_code=201)
def upload_invoice(
    user: CurrentUser,
    project_id: str = Form(...),
    purchase_order_id: str | None = Form(default=None),
    file: UploadFile = File(...),
):
    ctx = access(user, project_id)
    content = file.file.read()
    if len(content) > settings.max_invoice_mb * 1024 * 1024:
        raise AppError("FILE_TOO_LARGE", f"Invoice exceeds the {settings.max_invoice_mb} MB limit.", 413)
    return invoice_service.upload(ctx, content, file.filename or "invoice.pdf", purchase_order_id)


@router.get("/{invoice_id}")
def get_invoice(invoice_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return invoice_service.get_invoice(ctx, invoice_id)


@router.post("/{invoice_id}/extract")
def extract(invoice_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return invoice_service.extract_invoice(ctx, invoice_id)


@router.post("/{invoice_id}/verify")
def verify(invoice_id: str, project_id: str, payload: VerifyIn, user: CurrentUser):
    ctx = access(user, project_id)
    return invoice_service.verify(ctx, invoice_id, payload.decision, payload.notes, payload.corrected_fields)


@router.get("/{invoice_id}/file")
def download_file(invoice_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    invoice = invoice_service.get_invoice(ctx, invoice_id)
    path = resolve_storage_path(invoice["file"]["storage_key"])
    return FileResponse(path, media_type=invoice["file"]["mime"], filename=invoice["file"]["filename"])
