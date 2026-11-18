from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.ai import service as ai_service
from app.core import rate_limit
from app.core.config import settings
from app.core.errors import forbidden
from app.schemas.ai import (
    ChatIn, ClassifyIn, DelayAnalysisIn, ForecastExplainIn, InvoiceAiIn, ProjectSummaryIn, ReportNotesIn,
)
from app.schemas.document import AskIn
from app.services import (
    analytics_service, document_service, inventory_service, invoice_service, report_service,
)
from app.services.project_service import access
from app.database.mongo import get_db
from app.utils.dates import today_ist

router = APIRouter(prefix="/ai", tags=["ai"])


def _limit(user: dict) -> None:
    rate_limit.check(f"ai:{user['_id']}", settings.rate_limit_ai_per_minute, 60)


@router.get("/status")
def ai_status(user: CurrentUser):
    return ai_service.status()


@router.post("/reports/generate")
def generate_report(payload: ReportNotesIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    if ctx.role not in {"project_manager", "site_engineer", "supervisor"}:
        raise forbidden()
    _limit(user)
    return ai_service.structure_report(
        payload.notes, payload.report_date or today_ist(), ctx.project_id, user["_id"]
    )


@router.post("/reports/summary")
def report_period_summary(payload: ProjectSummaryIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    stats = report_service.report_summary(ctx, payload.date_from.isoformat(), payload.date_to.isoformat())
    result = ai_service.summarize_period(
        stats, ctx.project["name"], payload.date_from.isoformat(), payload.date_to.isoformat(),
        ctx.project_id, user["_id"],
    )
    return {"stats": stats, **result}


@router.post("/issues/classify")
def classify_issue(payload: ClassifyIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    return ai_service.classify_issue(payload.title, payload.description, ctx.project_id, user["_id"])


@router.post("/invoices/extract")
def extract_invoice(payload: InvoiceAiIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    return invoice_service.extract_invoice(ctx, payload.invoice_id)


@router.post("/documents/ask")
def ask_documents(payload: ChatIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    return document_service.ask(ctx, payload.message)


@router.post("/chat")
def project_chat(payload: ChatIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    rows = _build_rows(payload.message, str(ctx.project_id))
    return ai_service.project_chat(payload.message, rows, ctx.project_id, user["_id"])


def _build_rows(question: str, project_id: str) -> list[dict]:
    from bson import ObjectId

    db = get_db()
    pid = ObjectId(project_id)
    q = question.lower()
    rows: list[dict] = []

    def add(label: str, detail: str, id_: str) -> None:
        rows.append({"label": label, "detail": detail, "id": id_})

    if any(word in q for word in ("stock", "material", "inventory", "reorder", "consum", "shortage")):
        for m in db.materials.find({"project_id": pid, "is_active": True}).sort("name", 1).limit(25):
            from app.utils.dates import to_decimal
            stock = to_decimal(m["current_stock"])
            reorder = to_decimal(m["reorder_level"])
            add(
                f"Material {m['name']}",
                f"{stock} {m['unit']} in stock, reorder level {reorder} {m['unit']}, supplier {m.get('supplier') or 'not recorded'}",
                str(m["_id"]),
            )

    if any(word in q for word in ("issue", "problem", "defect", "snag", "critical")):
        for issue in db.site_issues.find({"project_id": pid}).sort("created_at", -1).limit(20):
            add(
                f"Issue: {issue['title']}",
                f"status {issue['status']}, priority {issue['priority']}, category {issue['category']}, reported {issue['created_at'].date()}",
                str(issue["_id"]),
            )

    if any(word in q for word in ("task", "overdue", "deadline", "delay", "blocked", "progress")):
        for task in db.tasks.find({"project_id": pid}).sort("due_date", 1).limit(20):
            add(
                f"Task: {task['title']}",
                f"status {task['status']}, progress {task.get('progress', 0)}%, due {task['due_date']}",
                str(task["_id"]),
            )

    if any(word in q for word in ("report", "worker", "activity", "yesterday", "today")):
        for report in db.daily_reports.find({"project_id": pid, "status": {"$ne": "draft"}}).sort("report_date", -1).limit(12):
            workers = (report.get("workers_present") or {}).get("total")
            add(
                f"Daily report {report['report_date']}",
                f"status {report['status']}, workers {workers}, completed items {len(report.get('work_completed') or [])}, delays {report.get('delays') or 'none recorded'}",
                str(report["_id"]),
            )

    if any(word in q for word in ("invoice", "bill", "payment", "vendor")):
        for inv in db.invoices.find({"project_id": pid}).sort("created_at", -1).limit(12):
            add(
                f"Invoice {inv.get('invoice_number') or 'unprocessed'}",
                f"vendor {inv.get('vendor') or 'unknown'}, status {inv['verification_status']}, discrepancies {len(inv.get('discrepancies') or [])}",
                str(inv["_id"]),
            )

    if any(word in q for word in ("document", "spec", "manual", "procedure")):
        for doc in db.documents.find({"project_id": pid}).limit(12):
            add(f"Document {doc['filename']}", f"category {doc['category']}, pages {doc.get('pages')}, status {doc['processing_status']}", str(doc["_id"]))

    if not rows:
        for project_task in db.tasks.find({"project_id": pid}).limit(8):
            add(f"Task: {project_task['title']}", f"status {project_task['status']}, due {project_task['due_date']}", str(project_task["_id"]))
        for report in db.daily_reports.find({"project_id": pid, "status": {"$ne": "draft"}}).sort("report_date", -1).limit(4):
            add(f"Daily report {report['report_date']}", f"status {report['status']}", str(report["_id"]))

    return rows


@router.post("/forecast/explain")
def explain_forecast(payload: ForecastExplainIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    data = inventory_service.forecast(ctx, payload.horizon_days)
    explained = []
    for item in data["items"][:8]:
        result = ai_service.explain_forecast(item, ctx.project_id, user["_id"])
        explained.append({**item, "explanation": result["explanation"], "explanation_source": result["source"]})
    return {"items": explained, "note": data["note"]}


@router.post("/risk/explain")
def explain_risk(payload: DelayAnalysisIn, user: CurrentUser):
    ctx = access(user, payload.project_id)
    _limit(user)
    risk = analytics_service.risk_analysis(ctx)
    narrative = ai_service.explain_risk(risk["factors"], risk["band"], risk["score"], ctx.project_id, user["_id"])
    return {**risk, "narrative": narrative["narrative"], "mitigations": narrative["mitigations"],
            "narrative_source": narrative["source"]}
