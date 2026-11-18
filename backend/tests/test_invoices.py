from pathlib import Path

from tests.helpers import make_pdf

TMP = Path(__file__).resolve().parent / "_tmp"


def _upload(client, headers, project_id, filename, lines):
    path = make_pdf(TMP / filename, lines)
    return client.post(
        "/api/v1/invoices/upload",
        headers=headers,
        data={"project_id": project_id},
        files={"file": (filename, path.read_bytes(), "application/pdf")},
    )


def test_invoice_extraction_recomputes_totals(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload(client, headers["store"], api["project_id"], "inv-clean.pdf", [
        "Lumina Electricals Pvt Ltd",
        "Invoice No: INV-TEST-001",
        "Date: 2026-05-12",
        "Description | Qty | Unit Price | Total",
        "Cat6 cable box | 4 | 2850.00 | 11400.00",
        "Subtotal: 11400.00",
        "GST: 2052.00",
        "Total: 13452.00",
    ])
    assert uploaded.status_code == 201, uploaded.text
    invoice_id = uploaded.json()["id"]

    extracted = client.post(f"/api/v1/invoices/{invoice_id}/extract",
                            params={"project_id": api["project_id"]}, headers=headers["store"])
    assert extracted.status_code == 200, extracted.text
    body = extracted.json()
    assert body["computed"]["subtotal_minor"] == 1140000
    assert body["stated"]["subtotal_minor"] == 1140000
    assert body["computed"]["total_minor"] == 1140000
    assert body["extracted_items"][0]["quantity"] == "4"
    assert body["verification_status"] in {"extracted", "needs_review"}
    assert body["ai_extraction"]["method"] in {"rules", "llm"}


def test_invoice_mismatch_is_flagged_for_review(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload(client, headers["store"], api["project_id"], "inv-bad.pdf", [
        "Apex Fire Systems",
        "Invoice No: INV-TEST-002",
        "Date: 2026-05-08",
        "Description | Qty | Unit Price | Total",
        "Fire-rated cable | 4 | 800.00 | 3000.00",
        "Subtotal: 3000.00",
        "Total: 3000.00",
    ])
    invoice_id = uploaded.json()["id"]
    extracted = client.post(f"/api/v1/invoices/{invoice_id}/extract",
                            params={"project_id": api["project_id"]}, headers=headers["store"]).json()
    codes = {d["code"] for d in extracted["discrepancies"]}
    assert "LINE_TOTAL_MISMATCH" in codes
    assert extracted["verification_status"] == "needs_review"


def test_verification_is_human_recorded_and_immutable(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload(client, headers["store"], api["project_id"], "inv-verify.pdf", [
        "Metro Fabricators",
        "Invoice No: INV-TEST-003",
        "Date: 2026-05-09",
        "Description | Qty | Unit Price | Total",
        "Cable tray 2m | 2 | 1180.00 | 2360.00",
        "Subtotal: 2360.00",
        "Total: 2360.00",
    ])
    invoice_id = uploaded.json()["id"]
    client.post(f"/api/v1/invoices/{invoice_id}/extract", params={"project_id": api["project_id"]},
                headers=headers["store"])
    verified = client.post(f"/api/v1/invoices/{invoice_id}/verify", params={"project_id": api["project_id"]},
                           headers=headers["store"], json={"decision": "verified", "notes": "Checked against delivery."})
    assert verified.status_code == 200
    assert verified.json()["verification_status"] == "verified"
    assert verified.json()["verification"]["by"] == api["ids"]["store"]
    assert "field_snapshot" in verified.json()["verification"]
    again = client.post(f"/api/v1/invoices/{invoice_id}/verify", params={"project_id": api["project_id"]},
                        headers=headers["store"], json={"decision": "rejected"})
    assert again.status_code == 409


def test_invoice_file_is_project_scoped(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload(client, headers["store"], api["project_id"], "inv-file.pdf", [
        "Vendor Ltd", "Invoice No: INV-TEST-004", "Total: 100.00",
    ])
    invoice_id = uploaded.json()["id"]
    ok = client.get(f"/api/v1/invoices/{invoice_id}/file", params={"project_id": api["project_id"]},
                    headers=headers["manager"])
    assert ok.status_code == 200
    assert ok.content.startswith(b"%PDF")
    denied = client.get(f"/api/v1/invoices/{invoice_id}/file", params={"project_id": api["project2_id"]},
                        headers=headers["engineer"])
    assert denied.status_code == 404
