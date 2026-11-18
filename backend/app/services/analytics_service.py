from datetime import timedelta
from decimal import Decimal

from bson import ObjectId

from app.database.mongo import get_db
from app.services.project_service import ProjectContext
from app.utils.dates import fmt_qty, ist_day_range, today_ist, to_decimal, utcnow

OPEN = ["open", "assigned", "in_progress", "waiting"]
ACTIVE_TASKS = ["not_started", "in_progress", "blocked"]


def _authorized_ids(user: dict) -> list[ObjectId]:
    return [m["project_id"] for m in get_db().project_members.find({"user_id": user["_id"]})]


def dashboard(user: dict, project_id: str | None, date_from: str, date_to: str) -> dict:
    db = get_db()
    ids = _authorized_ids(user)
    scope = [ObjectId(project_id)] if project_id else ids
    if project_id and ObjectId(project_id) not in ids:
        return {"error": "not found"}
    date_start, date_end_exclusive = ist_day_range(date_from, date_to)
    date_range = {"$gte": date_start, "$lt": date_end_exclusive}

    project_query = {"_id": {"$in": ids}}
    kpis = {
        "projects_total": db.projects.count_documents(project_query),
        "projects_active": db.projects.count_documents({**project_query, "status": "active"}),
        "projects_completed": db.projects.count_documents({**project_query, "status": "completed"}),
        "projects_delayed": db.projects.count_documents({**project_query, "delay_flag": True}),
        "issues_open": db.site_issues.count_documents({"project_id": {"$in": scope}, "status": {"$in": OPEN}}),
        "issues_critical": db.site_issues.count_documents(
            {"project_id": {"$in": scope}, "priority": "critical", "status": {"$in": OPEN}}
        ),
        "materials_total": db.materials.count_documents({"project_id": {"$in": scope}, "is_active": True}),
        "materials_low_stock": db.materials.count_documents(
            {"project_id": {"$in": scope}, "is_active": True, "$expr": {"$lte": ["$current_stock", "$reorder_level"]}}
        ),
        "reports_pending_approval": db.daily_reports.count_documents(
            {"project_id": {"$in": scope}, "status": "submitted"}
        ),
        "tasks_overdue": db.tasks.count_documents({
            "project_id": {"$in": scope}, "status": {"$in": ACTIVE_TASKS},
            "due_date": {"$lt": today_ist().isoformat()},
        }),
    }

    progress = list(db.daily_reports.aggregate([
        {"$match": {"project_id": {"$in": scope}, "report_date": {"$gte": date_from, "$lte": date_to},
                    "status": {"$ne": "draft"}}},
        {"$group": {
            "_id": "$report_date",
            "reports": {"$sum": 1},
            "workers": {"$sum": {"$ifNull": ["$workers_present.total", 0]}},
            "completed_items": {"$sum": {"$size": {"$ifNull": ["$work_completed", []]}}},
        }},
        {"$sort": {"_id": 1}},
    ]))

    issue_status = list(db.site_issues.aggregate([
        {"$match": {"project_id": {"$in": scope}}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]))

    usage = list(db.inventory_transactions.aggregate([
        {"$match": {"project_id": {"$in": scope}, "type": "consumption", "created_at": date_range}},
        {"$group": {"_id": "$material_id", "consumed": {"$sum": "$quantity"}}},
        {"$sort": {"consumed": -1}},
        {"$limit": 8},
    ]))
    usage_items = []
    for row in usage:
        material = db.materials.find_one({"_id": row["_id"]}, {"name": 1, "unit": 1})
        usage_items.append({
            "material": material["name"] if material else "Unknown",
            "unit": material["unit"] if material else "",
            "consumed": fmt_qty(row["consumed"]),
        })

    task_completion = list(db.tasks.aggregate([
        {"$match": {"project_id": {"$in": scope}}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]))

    recent = []
    for doc in db.daily_reports.find({"project_id": {"$in": scope}, "status": {"$ne": "draft"}}).sort("created_at", -1).limit(5):
        author = db.users.find_one({"_id": doc["submitted_by"]}, {"name": 1})
        project = db.projects.find_one({"_id": doc["project_id"]}, {"name": 1})
        recent.append({
            "id": str(doc["_id"]),
            "report_date": doc["report_date"],
            "project_name": project["name"] if project else "",
            "submitted_by_name": author["name"] if author else "Unknown",
            "status": doc["status"],
            "workers": (doc.get("workers_present") or {}).get("total"),
        })

    horizon = (today_ist() + timedelta(days=10)).isoformat()
    deadlines = []
    for task in db.tasks.find({
        "project_id": {"$in": scope}, "status": {"$in": ACTIVE_TASKS},
        "due_date": {"$gte": today_ist().isoformat(), "$lte": horizon},
    }).sort("due_date", 1).limit(6):
        project = db.projects.find_one({"_id": task["project_id"]}, {"name": 1})
        deadlines.append({
            "id": str(task["_id"]),
            "title": task["title"],
            "due_date": task["due_date"],
            "project_name": project["name"] if project else "",
            "progress": task.get("progress", 0),
        })

    return {
        "kpis": kpis,
        "charts": {
            "progress": [{"date": p["_id"], "reports": p["reports"], "workers": p["workers"],
                          "completed_items": p["completed_items"]} for p in progress],
            "issue_status": [{"status": r["_id"], "count": r["count"]} for r in issue_status],
            "inventory_usage": usage_items,
            "task_completion": [{"status": r["_id"], "count": r["count"]} for r in task_completion],
        },
        "recent_reports": recent,
        "upcoming_deadlines": deadlines,
        "range": {"from": date_from, "to": date_to},
    }


def inventory_analytics(ctx: ProjectContext, date_from: str, date_to: str) -> dict:
    db = get_db()
    date_start, date_end_exclusive = ist_day_range(date_from, date_to)
    range_filter = {"$gte": date_start, "$lt": date_end_exclusive}
    rows = list(db.inventory_transactions.aggregate([
        {"$match": {"project_id": ctx.project_id, "created_at": range_filter}},
        {"$group": {"_id": {"type": "$type", "material": "$material_id"}, "quantity": {"$sum": "$quantity"}}},
    ]))
    names = {str(m["_id"]): m for m in db.materials.find({"project_id": ctx.project_id}, {"name": 1, "unit": 1})}
    series = []
    for row in rows:
        material = names.get(str(row["_id"]["material"]))
        series.append({
            "type": row["_id"]["type"],
            "material": material["name"] if material else "Unknown",
            "unit": material["unit"] if material else "",
            "quantity": fmt_qty(row["quantity"]),
        })
    low = []
    for material in db.materials.find({
        "project_id": ctx.project_id, "is_active": True,
        "$expr": {"$lte": ["$current_stock", "$reorder_level"]},
    }):
        low.append({
            "id": str(material["_id"]),
            "name": material["name"],
            "current_stock": fmt_qty(material["current_stock"]),
            "reorder_level": fmt_qty(material["reorder_level"]),
            "unit": material["unit"],
        })
    return {"series": series, "low_stock": low,
            "transactions": db.inventory_transactions.count_documents({"project_id": ctx.project_id})}


def risk_analysis(ctx: ProjectContext) -> dict:
    db = get_db()
    pid = ctx.project_id
    project = ctx.project
    today = today_ist()

    start = project["start_date"]
    end = project["expected_end_date"]
    from datetime import date
    start_d = date.fromisoformat(start)
    end_d = date.fromisoformat(end)
    total_days = max(1, (end_d - start_d).days)
    elapsed = max(0, (today - start_d).days)
    expected = min(100, max(0, round(elapsed / total_days * 100)))
    actual = int(project.get("progress_percent", 0))
    slippage = min(1.0, max(0.0, (expected - actual) / 30))

    open_tasks = db.tasks.count_documents({"project_id": pid, "status": {"$in": ACTIVE_TASKS}})
    overdue = db.tasks.count_documents({
        "project_id": pid, "status": {"$in": ACTIVE_TASKS}, "due_date": {"$lt": today.isoformat()},
    })
    overdue_ratio = min(1.0, overdue / open_tasks) if open_tasks else 0.0

    critical_open = db.site_issues.count_documents({"project_id": pid, "priority": "critical", "status": {"$in": OPEN}})
    high_open = db.site_issues.count_documents({"project_id": pid, "priority": "high", "status": {"$in": OPEN}})
    issue_ratio = min(1.0, (critical_open * 1.0 + high_open * 0.4) / max(5, open_tasks))

    blocked = db.tasks.count_documents({"project_id": pid, "status": "blocked"})
    blocked_ratio = min(1.0, blocked / open_tasks) if open_tasks else 0.0

    materials = db.materials.count_documents({"project_id": pid, "is_active": True})
    low = db.materials.count_documents({
        "project_id": pid, "is_active": True, "$expr": {"$lte": ["$current_stock", "$reorder_level"]},
    })
    material_ratio = min(1.0, low / materials) if materials else 0.0

    since = (utcnow() - timedelta(days=14))
    recent_reports = db.daily_reports.count_documents({"project_id": pid, "created_at": {"$gte": since}})
    delay_reports = db.daily_reports.count_documents({
        "project_id": pid, "created_at": {"$gte": since}, "delays": {"$nin": [None, ""]},
    })
    delay_ratio = min(1.0, delay_reports / recent_reports) if recent_reports else 0.0

    factors = [
        {"name": "schedule_slippage", "weight": 30, "value": round(slippage, 3),
         "evidence": f"Plan expects ~{expected}% progress; actual is {actual}%."},
        {"name": "overdue_tasks", "weight": 20, "value": round(overdue_ratio, 3),
         "evidence": f"{overdue} of {open_tasks} open tasks are past due."},
        {"name": "critical_issues", "weight": 15, "value": round(issue_ratio, 3),
         "evidence": f"{critical_open} critical and {high_open} high-priority issues are open."},
        {"name": "blocked_dependencies", "weight": 15, "value": round(blocked_ratio, 3),
         "evidence": f"{blocked} tasks are blocked."},
        {"name": "material_risk", "weight": 10, "value": round(material_ratio, 3),
         "evidence": f"{low} of {materials} materials are at or below reorder level."},
        {"name": "reported_delays", "weight": 10, "value": round(delay_ratio, 3),
         "evidence": f"{delay_reports} of {recent_reports} recent reports mentioned delays."},
    ]
    score = int(round(sum(f["weight"] * f["value"] for f in factors)))
    band = "low" if score < 25 else "medium" if score < 50 else "high" if score < 70 else "critical"
    affected = []
    for task in db.tasks.find({
        "project_id": pid, "$or": [
            {"status": "blocked"},
            {"status": {"$in": ACTIVE_TASKS}, "due_date": {"$lt": today.isoformat()}},
        ],
    }).limit(8):
        affected.append({"id": str(task["_id"]), "title": task["title"],
                         "due_date": task["due_date"], "status": task["status"]})
    return {
        "score": score,
        "band": band,
        "method": "weighted_rules_v1",
        "factors": factors,
        "expected_progress": expected,
        "actual_progress": actual,
        "affected_tasks": affected,
        "disclaimer": "Rule-based heuristic, not a statistically validated prediction.",
    }
