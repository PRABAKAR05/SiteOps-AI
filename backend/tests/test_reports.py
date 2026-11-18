from datetime import timedelta

from app.utils.dates import today_ist


def _create(client, headers, project_id, status="draft", **overrides):
    payload = {
        "project_id": project_id,
        "report_date": today_ist().isoformat(),
        "location": "Auditorium Level 1",
        "activities": "Pulled Cat6 cabling in zones A and B.",
        "work_completed": ["Pulled 12 Cat6 runs", "Terminated 8 downlights"],
        "work_pending": ["Speaker grid zone C"],
        "workers_present": {"total": 14, "by_trade": [{"trade": "Electricians", "count": 8}, {"trade": "Helpers", "count": 6}]},
        "status": status,
    }
    payload.update(overrides)
    return client.post("/api/v1/reports", headers=headers, json=payload)


def test_report_workflow_submit_approve(api):
    client, headers = api["client"], api["headers"]
    created = _create(client, headers["engineer"], api["project_id"])
    assert created.status_code == 201, created.text
    report = created.json()
    assert report["status"] == "draft"
    assert report["workers_present"]["total"] == 14

    submitted = client.post(f"/api/v1/reports/{report['id']}/submit",
                            params={"project_id": api["project_id"]}, headers=headers["engineer"])
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "submitted"

    approved = client.post(f"/api/v1/reports/{report['id']}/approve",
                           params={"project_id": api["project_id"]}, headers=headers["manager"])
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["approved_by"] == api["ids"]["manager"]

    again = client.post(f"/api/v1/reports/{report['id']}/approve",
                        params={"project_id": api["project_id"]}, headers=headers["manager"])
    assert again.status_code == 409


def test_rejection_requires_reason_and_notifies_author(api):
    client, headers = api["client"], api["headers"]
    report = _create(client, headers["engineer"], api["project_id"], status="submitted").json()
    bad = client.post(f"/api/v1/reports/{report['id']}/reject", params={"project_id": api["project_id"]},
                      headers=headers["manager"], json={"reason": "x"})
    assert bad.status_code == 422
    good = client.post(f"/api/v1/reports/{report['id']}/reject", params={"project_id": api["project_id"]},
                       headers=headers["manager"], json={"reason": "Pending list needs zone references."})
    assert good.status_code == 200
    assert good.json()["status"] == "rejected"
    assert good.json()["rejection_reason"].startswith("Pending list")
    notes = client.get("/api/v1/notifications", headers=headers["engineer"]).json()
    assert any(n["type"] == "report_rejected" for n in notes["items"])


def test_draft_is_private_to_author(api):
    client, headers = api["client"], api["headers"]
    report = _create(client, headers["engineer"], api["project_id"]).json()
    listing = client.get("/api/v1/reports", params={"project_id": api["project_id"]},
                         headers=headers["supervisor"]).json()
    assert all(item["id"] != report["id"] for item in listing["items"])
    response = client.get(f"/api/v1/reports/{report['id']}", params={"project_id": api["project_id"]},
                          headers=headers["supervisor"])
    assert response.status_code == 404
    own = client.get(f"/api/v1/reports/{report['id']}", params={"project_id": api["project_id"]},
                     headers=headers["engineer"])
    assert own.status_code == 200


def test_submitted_report_cannot_be_edited(api):
    client, headers = api["client"], api["headers"]
    report = _create(client, headers["engineer"], api["project_id"], status="submitted").json()
    response = client.put(f"/api/v1/reports/{report['id']}", params={"project_id": api["project_id"]},
                          headers=headers["engineer"], json={"activities": "Changed"})
    assert response.status_code == 409


def test_future_report_date_and_bad_worker_totals_are_rejected(api):
    client, headers = api["client"], api["headers"]
    future = _create(client, headers["engineer"], api["project_id"],
                     report_date=(today_ist() + timedelta(days=1)).isoformat())
    assert future.status_code == 422
    mismatch = _create(client, headers["engineer"], api["project_id"],
                       workers_present={"total": 9, "by_trade": [{"trade": "Electricians", "count": 8}]})
    assert mismatch.status_code == 422


def test_report_pdf_downloads(api):
    client, headers = api["client"], api["headers"]
    report = _create(client, headers["engineer"], api["project_id"], status="submitted").json()
    response = client.get(f"/api/v1/reports/{report['id']}/pdf", params={"project_id": api["project_id"]},
                          headers=headers["manager"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert len(response.content) > 1000
