from datetime import timedelta

from app.utils.dates import today_ist


def test_engineer_cannot_create_project(api):
    response = api["client"].post("/api/v1/projects", headers=api["headers"]["engineer"], json={
        "name": "Unauthorized project",
        "code": "NOPE-1",
        "client_name": "Someone",
        "location": "Pune",
        "project_type": "av",
        "start_date": today_ist().isoformat(),
        "expected_end_date": (today_ist() + timedelta(days=30)).isoformat(),
    })
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN_ROLE"


def test_non_member_gets_404_not_403(api):
    response = api["client"].get(f"/api/v1/projects/{api['project_id']}", headers=api["headers"]["outsider"])
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PROJECT_NOT_FOUND"


def test_engineer_cannot_read_other_project(api):
    response = api["client"].get(f"/api/v1/projects/{api['project2_id']}", headers=api["headers"]["engineer"])
    assert response.status_code == 404


def test_engineer_cannot_read_other_project_data(api):
    response = api["client"].get(
        "/api/v1/inventory/materials", params={"project_id": api["project2_id"]}, headers=api["headers"]["engineer"]
    )
    assert response.status_code == 404


def test_storekeeper_cannot_approve_report(api):
    created = api["client"].post("/api/v1/reports", headers=api["headers"]["engineer"], json={
        "project_id": api["project_id"],
        "report_date": today_ist().isoformat(),
        "location": "Level 1",
        "activities": "Cable pulling",
        "status": "submitted",
    })
    assert created.status_code == 201, created.text
    report_id = created.json()["id"]
    response = api["client"].post(
        f"/api/v1/reports/{report_id}/approve", params={"project_id": api["project_id"]},
        headers=api["headers"]["store"],
    )
    assert response.status_code == 403


def test_storekeeper_cannot_create_report(api):
    response = api["client"].post("/api/v1/reports", headers=api["headers"]["store"], json={
        "project_id": api["project_id"],
        "report_date": today_ist().isoformat(),
        "location": "Level 1",
        "activities": "Should be rejected",
    })
    assert response.status_code == 403


def test_supervisor_cannot_upload_invoice(api):
    response = api["client"].post(
        "/api/v1/invoices/upload",
        headers=api["headers"]["supervisor"],
        data={"project_id": api["project_id"]},
        files={"file": ("invoice.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert response.status_code == 403
