from fastapi import APIRouter, Query, Response

from app.api.deps import CurrentUser
from app.ai import service as ai_service
from app.core.errors import forbidden
from app.database.mongo import get_db
from app.services import analytics_service, inventory_service, issue_service, pdf_service, report_service, task_service
from app.services.project_service import access
from app.utils.dates import today_ist

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _default_range(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    end = today_ist()
    start = end.replace(day=1)
    return (date_from or start.isoformat(), date_to or end.isoformat())


@router.get("/dashboard")
def dashboard(
    user: CurrentUser,
    project_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    start, end = _default_range(date_from, date_to)
    data = analytics_service.dashboard(user, project_id, start, end)
    if data.get("error") == "not found":
        from app.core.errors import not_found

        raise not_found("Project")
    return data


@router.get("/risk")
def risk(project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return analytics_service.risk_analysis(ctx)


@router.get("/inventory")
def inventory_analytics(project_id: str, user: CurrentUser, date_from: str | None = None, date_to: str | None = None):
    ctx = access(user, project_id)
    start, end = _default_range(date_from, date_to)
    return inventory_service_analytics(ctx, start, end)


def inventory_service_analytics(ctx, start, end):
    return analytics_service.inventory_analytics(ctx, start, end)


@router.get("/progress")
def progress(project_id: str, user: CurrentUser, date_from: str | None = None, date_to: str | None = None):
    ctx = access(user, project_id)
    start, end = _default_range(date_from, date_to)
    db = get_db()
    reports = list(db.daily_reports.aggregate([
        {"$match": {"project_id": ctx.project_id, "report_date": {"$gte": start, "$lte": end}, "status": {"$ne": "draft"}}},
        {"$group": {
            "_id": "$report_date",
            "completed": {"$sum": {"$size": {"$ifNull": ["$work_completed", []]}}},
            "pending": {"$sum": {"$size": {"$ifNull": ["$work_pending", []]}}},
            "workers": {"$sum": {"$ifNull": ["$workers_present.total", 0]}},
        }},
        {"$sort": {"_id": 1}},
    ]))
    return {
        "project_id": project_id,
        "range": {"from": start, "to": end},
        "series": [
            {"date": r["_id"], "completed": r["completed"], "pending": r["pending"], "workers": r["workers"]}
            for r in reports
        ],
        "task_summary": task_service.analytics(ctx),
        "issue_summary": issue_service.analytics(ctx),
    }


@router.get("/period")
def period(project_id: str, user: CurrentUser, date_from: str | None = None, date_to: str | None = None):
    ctx = access(user, project_id)
    start, end = _default_range(date_from, date_to)
    reports = report_service.report_summary(ctx, start, end)
    tasks = task_service.analytics(ctx)
    issues = issue_service.analytics(ctx)
    inventory = analytics_service.inventory_analytics(ctx, start, end)
    return {
        "range": {"from": start, "to": end},
        "reports": reports,
        "tasks": tasks,
        "issues": issues,
        "inventory": inventory,
    }


@router.get("/period/pdf")
def period_pdf(project_id: str, user: CurrentUser, date_from: str | None = None, date_to: str | None = None,
               include_summary: bool = True):
    ctx = access(user, project_id)
    if ctx.role != "project_manager":
        raise forbidden("Only a project manager can export period reports.")
    start, end = _default_range(date_from, date_to)
    reports = report_service.report_summary(ctx, start, end)
    tasks = task_service.analytics(ctx)
    issues = issue_service.analytics(ctx)
    inventory = analytics_service.inventory_analytics(ctx, start, end)
    stats = {
        "reports_submitted": reports["reports"],
        "reports_approved": reports["approved"],
        "reports_pending": reports["pending"],
        "worker_days": reports["worker_days"],
        "delays_reported": reports["delays_reported"],
        "tasks_total": tasks["total"],
        "tasks_completed": tasks["completed"],
        "tasks_overdue": tasks["overdue"],
        "issues_open": issues["open"],
        "issues_critical": issues["critical"],
        "materials_low_stock": len(inventory["low_stock"]),
        "inventory_transactions": inventory["transactions"],
    }
    summary = None
    if include_summary:
        summary = ai_service.summarize_period(stats, ctx.project["name"], start, end, ctx.project_id, user["_id"])["summary"]
    pdf = pdf_service.period_pdf(ctx.project, stats, start, end, summary)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="period-{start}-to-{end}.pdf"'},
    )
