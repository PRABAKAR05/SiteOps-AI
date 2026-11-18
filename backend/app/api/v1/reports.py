from fastapi import APIRouter, BackgroundTasks, File, Form, Query, Response, UploadFile

from app.api.deps import CurrentUser, Pagination
from app.core.config import settings
from app.core.errors import AppError
from app.schemas.report import RejectIn, ReportCreate, ReportUpdate
from app.services import pdf_service, report_service
from app.services.project_service import access
from app.utils.files import save_bytes

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("")
def list_reports(
    project_id: str,
    user: CurrentUser,
    pg: Pagination,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    submitted_by: str | None = None,
):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return report_service.list_reports(
        ctx, status=status, date_from=date_from, date_to=date_to,
        submitted_by=submitted_by, page_no=page_no, page_size=page_size,
    )


@router.post("", status_code=201)
def create_report(payload: ReportCreate, user: CurrentUser):
    ctx = access(user, payload.project_id)
    return report_service.create_report(ctx, payload)


@router.get("/summary")
def summary(project_id: str, date_from: str, date_to: str, user: CurrentUser):
    ctx = access(user, project_id)
    return report_service.report_summary(ctx, date_from, date_to)


@router.get("/{report_id}")
def get_report(report_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return report_service.get_report(ctx, report_id)


@router.put("/{report_id}")
def update_report(report_id: str, project_id: str, payload: ReportUpdate, user: CurrentUser):
    ctx = access(user, project_id)
    return report_service.update_report(ctx, report_id, payload)


@router.post("/{report_id}/submit")
def submit_report(report_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return report_service.submit_report(ctx, report_id)


@router.post("/{report_id}/approve")
def approve_report(report_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return report_service.approve_report(ctx, report_id)


@router.post("/{report_id}/reject")
def reject_report(report_id: str, project_id: str, payload: RejectIn, user: CurrentUser):
    ctx = access(user, project_id)
    return report_service.reject_report(ctx, report_id, payload.reason)


@router.post("/{report_id}/photos")
def upload_photo(report_id: str, project_id: str, user: CurrentUser, file: UploadFile = File(...)):
    ctx = access(user, project_id)
    content = file.file.read()
    stored = save_bytes(content, file.filename or "photo", str(ctx.project_id), "image", settings.max_image_mb)
    photo = {
        "file_id": stored["file_id"],
        "storage_key": stored["storage_key"],
        "filename": stored["filename"],
        "mime": stored["mime"],
        "size_bytes": stored["size_bytes"],
    }
    return report_service.attach_photo(ctx, report_id, photo)


@router.get("/{report_id}/pdf")
def report_pdf(report_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    report = report_service.get_report(ctx, report_id)
    approver = None
    if report.get("approved_by"):
        from app.database.mongo import get_db
        from bson import ObjectId
        doc = get_db().users.find_one({"_id": ObjectId(report["approved_by"])})
        approver = doc["name"] if doc else None
    pdf = pdf_service.report_pdf(report, ctx.project, report.get("submitted_by_name", ""), approver)
    filename = f"report-{report['report_date']}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
