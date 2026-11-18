"""Idempotent demo dataset. Only runs when SEED_DEMO_DATA=true and APP_ENV != production."""

from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from bson import ObjectId

from app.core.config import settings
from app.core.security import hash_password
from app.database.mongo import get_db
from app.utils.dates import dec, today_ist, utcnow
from app.utils.files import save_bytes

DEMO_DOMAIN = "@demo.siteops.local"

USERS = [
    ("Asha Menon", "manager", "project_manager"),
    ("Rahul Iyer", "engineer1", "site_engineer"),
    ("Meera Nair", "engineer2", "site_engineer"),
    ("Vikram Rao", "supervisor1", "supervisor"),
    ("Sana Khan", "supervisor2", "supervisor"),
    ("Joseph Thomas", "store", "storekeeper"),
]


def _pdf(lines: list[str], target: Path) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    target.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(target), pagesize=A4)
    y = 800
    for line in lines:
        c.setFont("Helvetica", 10)
        c.drawString(48, y, line[:110])
        y -= 16
        if y < 60:
            c.showPage()
            y = 800
    c.save()


def seed_demo() -> dict:
    db = get_db()
    if db.projects.count_documents({"is_demo": True}) > 0:
        return {"skipped": True, "reason": "demo data already present"}

    now = utcnow()
    password_hash = hash_password(settings.demo_password)
    user_ids: dict[str, ObjectId] = {}
    for name, slug, role in USERS:
        email = f"{slug}{DEMO_DOMAIN}"
        existing = db.users.find_one({"email": email})
        if existing:
            user_ids[slug] = existing["_id"]
            continue
        doc = {
            "name": name,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "phone": None,
            "is_active": True,
            "must_change_password": False,
            "is_demo": True,
            "created_at": now,
            "updated_at": now,
            "last_login_at": None,
        }
        user_ids[slug] = db.users.insert_one(doc).inserted_id

    manager = db.users.find_one({"_id": user_ids["manager"]})

    project_id = db.projects.insert_one({
        "name": "Skyline Auditorium — AV & Electrical Fitout",
        "code": "DEMO-AV1",
        "description": "Demo project: 400-seat auditorium AV, electrical and fire-safety fitout.",
        "client_name": "Skyline Cultural Trust",
        "location": "Bengaluru",
        "project_type": "av",
        "start_date": (today_ist() - timedelta(days=90)).isoformat(),
        "expected_end_date": (today_ist() + timedelta(days=60)).isoformat(),
        "actual_end_date": None,
        "status": "active",
        "manager_id": manager["_id"],
        "progress_percent": 0,
        "delay_flag": True,
        "delay_reason": "Cable tray delivery slipped by one week (demo data).",
        "is_demo": True,
        "created_by": manager["_id"],
        "created_at": now,
        "updated_at": now,
    }).inserted_id

    project2_id = db.projects.insert_one({
        "name": "Metro Depot CCTV Upgrade",
        "code": "DEMO-CCTV2",
        "description": "Demo project: CCTV replacement across two depot buildings.",
        "client_name": "Metro Transit Authority",
        "location": "Chennai",
        "project_type": "cctv",
        "start_date": (today_ist() - timedelta(days=40)).isoformat(),
        "expected_end_date": (today_ist() + timedelta(days=90)).isoformat(),
        "actual_end_date": None,
        "status": "active",
        "manager_id": manager["_id"],
        "progress_percent": 0,
        "delay_flag": False,
        "delay_reason": None,
        "is_demo": True,
        "created_by": manager["_id"],
        "created_at": now,
        "updated_at": now,
    }).inserted_id

    for slug, uid in user_ids.items():
        db.project_members.insert_one({
            "project_id": project_id,
            "user_id": uid,
            "project_role": "project_manager" if slug == "manager" else USERS[[u[1] for u in USERS].index(slug)][2],
            "added_by": manager["_id"],
            "added_at": now,
        })
        if slug in {"manager", "engineer1", "supervisor1", "store"}:
            db.project_members.insert_one({
                "project_id": project2_id,
                "user_id": uid,
                "project_role": db.users.find_one({"_id": uid})["role"],
                "added_by": manager["_id"],
                "added_at": now,
            })

    materials = [
        ("Cat6 cable box", "electrical", "box", 12, 5, "Lumina Electricals Pvt Ltd", 2850),
        ("18W LED downlight", "electrical", "pcs", 40, 10, "Lumina Electricals Pvt Ltd", 640),
        ("HDMI 10m cable", "av", "pcs", 6, 4, "StageCraft AV", 1450),
        ("Fire-rated cable", "fire_safety", "m", 300, 100, "Apex Fire Systems", 210),
        ("Ceiling speaker", "av", "pcs", 8, 6, "StageCraft AV", 3200),
        ("Cable tray 2m", "electrical", "pcs", 18, 20, "Metro Fabricators", 1180),
    ]
    material_ids: dict[str, ObjectId] = {}
    for name, category, unit, opening, reorder, supplier, cost in materials:
        mid = db.materials.insert_one({
            "project_id": project_id,
            "name": name,
            "sku": None,
            "category": category,
            "unit": unit,
            "opening_stock": dec(opening),
            "current_stock": dec(opening),
            "reorder_level": dec(reorder),
            "supplier": supplier,
            "unit_cost_minor": cost * 100,
            "is_active": True,
            "is_demo": True,
            "created_by": manager["_id"],
            "created_at": now - timedelta(days=90),
            "updated_at": now,
        }).inserted_id
        material_ids[name] = mid
        db.inventory_transactions.insert_one({
            "project_id": project_id, "material_id": mid, "type": "opening",
            "quantity": dec(opening), "unit": unit, "stock_before": dec(0), "stock_after": dec(opening),
            "reference_type": "seed", "reference_id": None, "remarks": "Opening stock (demo)",
            "created_by": user_ids["store"], "created_at": now - timedelta(days=90),
        })

    # Consumption history (deterministic) to make forecasts meaningful.
    consumption_plan = [
        ("Cat6 cable box", 2, 28), ("Cat6 cable box", 1, 12),
        ("18W LED downlight", 8, 24), ("18W LED downlight", 6, 9),
        ("Ceiling speaker", 4, 20), ("Fire-rated cable", 60, 18),
        ("HDMI 10m cable", 2, 15), ("Cable tray 2m", 4, 7),
    ]
    for name, qty, days_ago in consumption_plan:
        material = db.materials.find_one({"_id": material_ids[name]})
        before = material["current_stock"].to_decimal()
        after = before - Decimal(str(qty))
        db.materials.update_one({"_id": material["_id"]}, {"$set": {"current_stock": dec(after)}})
        db.inventory_transactions.insert_one({
            "project_id": project_id, "material_id": material["_id"], "type": "consumption",
            "quantity": dec(qty), "unit": material["unit"], "stock_before": dec(before), "stock_after": dec(after),
            "reference_type": "manual", "reference_id": None, "remarks": "Demo consumption",
            "created_by": user_ids["store"], "created_at": now - timedelta(days=days_ago),
        })

    db.materials.update_one({"_id": material_ids["Cat6 cable box"]}, {"$set": {"current_stock": dec(4)}})
    db.materials.update_one({"_id": material_ids["Ceiling speaker"]}, {"$set": {"current_stock": dec(4)}})
    db.materials.update_one({"_id": material_ids["Cable tray 2m"]}, {"$set": {"current_stock": dec(14)}})

    task_plan = [
        ("Pull Cat6 cabling — auditorium ceiling", "electrical", "in_progress", 55, 35, 6, "engineer1"),
        ("Install ceiling speaker grid", "av", "in_progress", 40, 20, 12, "supervisor1"),
        ("Terminate DB and label circuits", "electrical", "blocked", 20, -2, 10, "engineer2"),
        ("Mount CCTV cameras — lobby", "cctv", "not_started", 0, 4, 8, "supervisor2"),
        ("Fire alarm loop testing", "fire_safety", "not_started", 0, 10, 5, "engineer1"),
        ("Commission AV control system", "av", "not_started", 0, 25, 4, "supervisor1"),
        ("Snag walkthrough — phase 1", "civil", "not_started", 0, 40, 3, "manager"),
        ("Cable tray installation", "electrical", "completed", 100, -10, 18, "supervisor2"),
    ]
    task_ids = []
    for title, category, status, progress, due_offset, weight, assignee in task_plan:
        due = today_ist() + timedelta(days=due_offset)
        tid = db.tasks.insert_one({
            "project_id": project_id,
            "title": title,
            "description": "Demo task.",
            "category": category,
            "location": "Auditorium",
            "assigned_to": user_ids[assignee],
            "start_date": (today_ist() - timedelta(days=20)).isoformat(),
            "due_date": due.isoformat(),
            "estimated_days": 5,
            "dependencies": [],
            "weight": weight,
            "progress": progress,
            "status": status,
            "completed_at": now if status == "completed" else None,
            "created_by": manager["_id"],
            "is_demo": True,
            "created_at": now - timedelta(days=30),
            "updated_at": now,
        }).inserted_id
        task_ids.append(tid)

    report_plan = [
        (1, "approved", 18, ["Pulled Cat6 in ceiling grid zones A-B", "Terminated 12 downlights"],
         ["Speaker grid zone C"], None),
        (3, "approved", 16, ["Installed cable tray sections 4-6"], ["DB termination"], "Tray delivery arrived late."),
        (5, "submitted", 22, ["Mounted 8 ceiling speakers", "Pulled fire-rated cable loop 1"], ["Loop 2"], None),
        (7, "submitted", 14, ["Conduit fixes in lobby", "CCTV back-boxes installed"], ["Camera mounting"], None),
        (9, "rejected", 12, ["Prepared DB schedule"], ["Terminations"], "Team reassigned to snag list."),
        (11, "approved", 20, ["Cable tray complete in zones A-C"], ["Speaker installation"], None),
    ]
    for days_ago, status, workers, completed, pending, delays in report_plan:
        report_date = today_ist() - timedelta(days=days_ago)
        db.daily_reports.insert_one({
            "project_id": project_id,
            "report_date": report_date.isoformat(),
            "location": "Auditorium — Level 1",
            "activities": "AV and electrical fitout works as per plan.",
            "work_completed": completed,
            "work_pending": pending,
            "workers_present": {"total": workers, "by_trade": [
                {"trade": "Electricians", "count": max(2, workers - 6)},
                {"trade": "Helpers", "count": 6},
            ]},
            "materials_consumed": [],
            "equipment_used": ["Scaffold tower", "Cable puller"],
            "delays": delays,
            "safety_observations": "Toolbox talk held; harness inspection completed.",
            "notes": "Demo report generated by the seed script.",
            "photos": [],
            "ai_assisted": False,
            "ai_summary": None,
            "status": status,
            "submitted_by": user_ids["engineer1"] if days_ago % 4 else user_ids["supervisor1"],
            "submitted_at": now - timedelta(days=days_ago),
            "approved_by": user_ids["manager"] if status == "approved" else None,
            "approved_at": now - timedelta(days=days_ago - 1) if status == "approved" else None,
            "rejection_reason": "Incomplete pending list — add zone references." if status == "rejected" else None,
            "is_demo": True,
            "created_at": now - timedelta(days=days_ago),
            "updated_at": now - timedelta(days=days_ago),
        })

    issue_plan = [
        ("Ceiling speaker grill damaged", "av", "high", "major", "open", "Two grills arrived dented in zone C."),
        ("DB-2 breaker tripping", "electrical", "critical", "safety", "in_progress", "Breaker trips when auditoium lighting circuit is energised."),
        ("Cable tray short by 6 metres", "material_shortage", "high", "major", "assigned", "Delivery shortfall against PO-2026-013."),
        ("Camera bracket missing", "cctv", "medium", "moderate", "waiting", "Vendor to confirm bracket model."),
        ("Fire alarm loop resistance high", "fire_safety", "critical", "safety", "open", "Loop 2 reads 68 ohms; expected under 50."),
        ("Paint patch on lobby wall", "civil", "low", "minor", "resolved", "Touch-up required behind distribution board."),
        ("Network switch port dead", "networking", "medium", "moderate", "open", "Port 14 on the AV rack switch not linking."),
    ]
    for title, category, priority, severity, status, description in issue_plan:
        db.site_issues.insert_one({
            "project_id": project_id,
            "title": title,
            "description": description,
            "location": "Auditorium",
            "category": category,
            "priority": priority,
            "severity": severity,
            "status": status,
            "photos": [],
            "ai_suggestion": None,
            "reported_by": user_ids["engineer1"],
            "assigned_to": user_ids["engineer2"] if status in {"assigned", "in_progress", "waiting"} else None,
            "resolution_notes": "Touch-up completed." if status == "resolved" else None,
            "resolved_at": now - timedelta(days=1) if status == "resolved" else None,
            "closed_at": None,
            "due_date": (today_ist() + timedelta(days=5)).isoformat(),
            "is_demo": True,
            "created_at": now - timedelta(days=3),
            "updated_at": now,
        })

    po_id = db.purchase_orders.insert_one({
        "project_id": project_id,
        "po_number": "PO-2026-014",
        "vendor": "Lumina Electricals Pvt Ltd",
        "status": "issued",
        "items": [
            {"description": "Cat6 cable box", "quantity": dec(4), "unit": "box", "unit_price_minor": 285000},
            {"description": "18W LED downlight", "quantity": dec(12), "unit": "pcs", "unit_price_minor": 64000},
            {"description": "Cable tray 2m", "quantity": dec(10), "unit": "pcs", "unit_price_minor": 118000},
        ],
        "total_minor": 3128000,
        "issued_at": now - timedelta(days=20),
        "is_demo": True,
        "created_at": now - timedelta(days=25),
    }).inserted_id

    _seed_invoices(db, project_id, po_id, user_ids, manager, now)
    _seed_documents(db, project_id, manager, now)

    db.notifications.insert_one({
        "user_id": user_ids["manager"],
        "project_id": project_id,
        "type": "report_submitted",
        "title": "2 reports await approval",
        "body": "Engineer reports from the last week are waiting for your review.",
        "link": "/reports",
        "read_at": None,
        "created_at": now,
    })

    # Recompute weighted plan progress for the demo project.
    from app.services.task_service import _recompute_progress

    _recompute_progress(project_id)

    return {
        "skipped": False,
        "users": len(user_ids),
        "projects": 2,
        "password_hint": "DEMO_PASSWORD from backend/.env",
    }


def _seed_invoices(db, project_id, po_id, user_ids, manager, now) -> None:
    from app.services import invoice_service
    from app.services.project_service import access

    specs = [
        {
            "filename": "invoice-lumina-0451.pdf",
            "lines": [
                "Lumina Electricals Pvt Ltd",
                "Invoice No: INV-2026-0451",
                "Date: 2026-05-12",
                "PO: PO-2026-014",
                "",
                "Description | Qty | Unit Price | Total",
                "Cat6 cable box | 4 | 2850.00 | 11400.00",
                "18W LED downlight | 12 | 640.00 | 7580.00",
                "",
                "Subtotal: 19080.00",
                "GST: 3434.40",
                "Grand Total: 22514.40",
            ],
            "po": po_id,
        },
        {
            "filename": "invoice-apex-0102.pdf",
            "lines": [
                "Apex Fire Systems",
                "Invoice No: INV-2026-0102",
                "Date: 2026-05-08",
                "",
                "Description | Qty | Unit Price | Total",
                "Fire-rated cable | 100 | 210.00 | 21000.00",
                "",
                "Subtotal: 21000.00",
                "GST: 3780.00",
                "Grand Total: 24780.00",
            ],
            "po": None,
        },
    ]
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="siteops-seed-"))
    ctx = access(manager, str(project_id))
    for spec in specs:
        source = tmp / spec["filename"]
        _pdf(spec["lines"], source)
        stored = save_bytes(source.read_bytes(), spec["filename"], str(project_id), "invoice", 10)
        invoice_id = db.invoices.insert_one({
            "project_id": project_id,
            "vendor": None,
            "invoice_number": None,
            "invoice_date": None,
            "purchase_order_id": spec["po"],
            "file": {k: stored[k] for k in ("file_id", "storage_key", "filename", "mime", "size_bytes", "sha256")},
            "extracted_items": [],
            "ai_extraction": None,
            "stated": {"subtotal_minor": None, "tax_minor": None, "total_minor": None},
            "computed": {"line_totals_minor": [], "subtotal_minor": None, "tax_minor": None, "total_minor": None},
            "discrepancies": [],
            "currency": "INR",
            "verification_status": "uploaded",
            "verification": None,
            "error": None,
            "is_demo": True,
            "uploaded_by": user_ids["store"],
            "created_at": now - timedelta(days=4),
            "updated_at": now,
        }).inserted_id
        try:
            invoice_service.extract_invoice(ctx, str(invoice_id))
        except Exception:
            pass


def _seed_documents(db, project_id, manager, now) -> None:
    from app.services import document_service
    from app.services.project_service import access

    docs = [
        ("AV-Specification.pdf", "specification", [
            "Skyline Auditorium — AV Specification (demo)",
            "",
            "1. Ceiling speakers shall be installed at a maximum height of 3.2 metres",
            "   above finished floor level and aimed toward the seating rake.",
            "2. Cat6 cabling must maintain a minimum bend radius of four times the",
            "   cable diameter and must be terminated with shielded keystone jacks.",
            "3. The auditorium requires 24 ceiling speakers and 16 downlights for",
            "   even coverage across the 400-seat space.",
            "4. Commissioning must be completed within 45 days of cable termination.",
            "5. All AV racks require dedicated 16A circuits and a bonded earth bar.",
        ]),
        ("Site-Safety-Procedure.pdf", "procedure", [
            "Site Safety Procedure (demo)",
            "",
            "Harness anchor points must be inspected every 30 days and logged.",
            "Scaffold towers require handover tags before use on any shift.",
            "Hot work permits are mandatory within 10 metres of cable trays.",
            "Incidents must be reported to the project manager within 24 hours.",
        ]),
    ]
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="siteops-docs-"))
    ctx = access(manager, str(project_id))
    for filename, category, lines in docs:
        source = tmp / filename
        _pdf(lines, source)
        stored = save_bytes(source.read_bytes(), filename, str(project_id), "document", 20)
        doc_id = db.documents.insert_one({
            "project_id": project_id,
            "filename": stored["filename"],
            "storage_key": stored["storage_key"],
            "mime": stored["mime"],
            "size_bytes": stored["size_bytes"],
            "sha256": stored["sha256"],
            "category": category,
            "processing_status": "uploaded",
            "pages": None,
            "chunk_count": None,
            "embedding_provider": None,
            "chroma_collection": f"proj_{project_id}",
            "error": None,
            "is_demo": True,
            "uploaded_by": manager["_id"],
            "created_at": now - timedelta(days=2),
            "updated_at": now,
        }).inserted_id
        document_service.process_document(str(doc_id))
    _ = ctx


if __name__ == "__main__":
    from app.database.mongo import connect

    connect()
    print(seed_demo())
