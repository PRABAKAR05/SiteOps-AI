import os
import sys
from datetime import timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("MONGODB_DB", "siteops_test")
os.environ.setdefault("SEED_DEMO_DATA", "false")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("STORAGE_DIR", str(BACKEND / "var" / "test-uploads"))
os.environ.setdefault("JWT_SECRET", "test-access-secret-0123456789abcdefghij")
os.environ.setdefault("JWT_REFRESH_SECRET", "test-refresh-secret-0123456789abcdefghij")
os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("AI_ENABLED", "true")
os.environ.setdefault("RATE_LIMIT_LOGIN_PER_15_MIN", "1000")
os.environ.setdefault("RATE_LIMIT_AI_PER_MINUTE", "1000")

import pytest
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.database.mongo import get_db
from app.main import app
from app.utils.dates import dec, today_ist, utcnow

PASSWORD = "TestPass!2026"
DEMO = "@demo.siteops.local"

USERS = [
    ("manager", "Project Manager", "project_manager"),
    ("engineer", "Site Engineer", "site_engineer"),
    ("supervisor", "Supervisor", "supervisor"),
    ("store", "Storekeeper", "storekeeper"),
    ("outsider", "Outsider", "site_engineer"),
]


def _wipe(db) -> None:
    for name in db.list_collection_names():
        if name.startswith("system."):
            continue
        db[name].delete_many({})


def _seed(db) -> dict:
    now = utcnow()
    password_hash = hash_password(PASSWORD)
    ids: dict[str, object] = {}
    for slug, name, role in USERS:
        ids[slug] = db.users.insert_one({
            "name": name,
            "email": f"{slug}{DEMO}",
            "password_hash": password_hash,
            "role": role,
            "phone": None,
            "is_active": True,
            "must_change_password": False,
            "created_at": now,
            "updated_at": now,
            "last_login_at": None,
        }).inserted_id

    project_id = db.projects.insert_one({
        "name": "Test Auditorium Fitout",
        "code": "TEST-AV1",
        "description": "Fixture project",
        "client_name": "Test Client",
        "location": "Bengaluru",
        "project_type": "av",
        "start_date": (today_ist() - timedelta(days=60)).isoformat(),
        "expected_end_date": (today_ist() + timedelta(days=30)).isoformat(),
        "actual_end_date": None,
        "status": "active",
        "manager_id": ids["manager"],
        "progress_percent": 40,
        "delay_flag": False,
        "delay_reason": None,
        "created_by": ids["manager"],
        "created_at": now,
        "updated_at": now,
    }).inserted_id

    project2_id = db.projects.insert_one({
        "name": "Isolated Project",
        "code": "TEST-ISO2",
        "description": "Second project, engineer is not a member",
        "client_name": "Other Client",
        "location": "Chennai",
        "project_type": "cctv",
        "start_date": (today_ist() - timedelta(days=10)).isoformat(),
        "expected_end_date": (today_ist() + timedelta(days=60)).isoformat(),
        "actual_end_date": None,
        "status": "active",
        "manager_id": ids["manager"],
        "progress_percent": 10,
        "delay_flag": False,
        "delay_reason": None,
        "created_by": ids["manager"],
        "created_at": now,
        "updated_at": now,
    }).inserted_id

    for slug in ("manager", "engineer", "supervisor", "store"):
        db.project_members.insert_one({
            "project_id": project_id,
            "user_id": ids[slug],
            "project_role": USERS[[u[0] for u in USERS].index(slug)][2],
            "added_by": ids["manager"],
            "added_at": now,
        })
    db.project_members.insert_one({
        "project_id": project2_id,
        "user_id": ids["manager"],
        "project_role": "project_manager",
        "added_by": ids["manager"],
        "added_at": now,
    })

    material_id = db.materials.insert_one({
        "project_id": project_id,
        "name": "Cat6 cable box",
        "sku": None,
        "category": "electrical",
        "unit": "box",
        "opening_stock": dec(10),
        "current_stock": dec(10),
        "reorder_level": dec(3),
        "supplier": "Test Supplier",
        "unit_cost_minor": 285000,
        "is_active": True,
        "created_by": ids["store"],
        "created_at": now - timedelta(days=30),
        "updated_at": now,
    }).inserted_id
    db.inventory_transactions.insert_one({
        "project_id": project_id, "material_id": material_id, "type": "opening",
        "quantity": dec(10), "unit": "box", "stock_before": dec(0), "stock_after": dec(10),
        "reference_type": "seed", "reference_id": None, "remarks": "Opening",
        "created_by": ids["store"], "created_at": now - timedelta(days=30),
    })

    return {
        "project_id": str(project_id),
        "project2_id": str(project2_id),
        "material_id": str(material_id),
        "ids": {k: str(v) for k, v in ids.items()},
        "now": now,
    }


def _login(client: TestClient, email: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture()
def api():
    from app.core import rate_limit

    rate_limit.reset()
    with TestClient(app) as client:
        db = get_db()
        _wipe(db)
        data = _seed(db)
        headers = {}
        for slug in ("manager", "engineer", "supervisor", "store", "outsider"):
            token = _login(client, f"{slug}{DEMO}")
            headers[slug] = {"Authorization": f"Bearer {token}"}
        data["headers"] = headers
        data["client"] = client
        yield data
        _wipe(db)
