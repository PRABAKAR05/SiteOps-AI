from pathlib import Path

from tests.helpers import make_pdf

TMP = Path(__file__).resolve().parent / "_tmp"

SPEC_TEXT = [
    "Skyline Auditorium AV Specification",
    "",
    "Ceiling speakers shall be installed at a maximum height of 3.2 metres.",
    "The auditorium requires 24 ceiling speakers and 16 downlights.",
    "Cat6 cabling must maintain a minimum bend radius of four times the cable diameter.",
    "Commissioning must be completed within 45 days of cable termination.",
]


def _upload_document(client, headers, project_id, filename, lines):
    path = make_pdf(TMP / filename, lines)
    return client.post(
        "/api/v1/documents",
        headers=headers,
        data={"project_id": project_id, "category": "specification"},
        files={"file": (filename, path.read_bytes(), "application/pdf")},
    )


def test_document_upload_processes_and_answers_with_citations(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload_document(client, headers["engineer"], api["project_id"], "spec.pdf", SPEC_TEXT)
    assert uploaded.status_code == 201, uploaded.text
    document_id = uploaded.json()["id"]

    fetched = client.get(f"/api/v1/documents/{document_id}", params={"project_id": api["project_id"]},
                         headers=headers["engineer"])
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["processing_status"] == "ready", body.get("error")
    assert body["pages"] >= 1
    assert body["chunk_count"] >= 1
    assert body["embedding_provider"]

    answer = client.post(f"/api/v1/documents/{document_id}/ask", params={"project_id": api["project_id"]},
                         headers=headers["engineer"],
                         json={"question": "How many ceiling speakers are required?"})
    assert answer.status_code == 200, answer.text
    payload = answer.json()
    assert payload["grounded"] is True
    assert payload["citations"], payload
    assert payload["citations"][0]["filename"] == "spec.pdf"
    assert "24" in payload["citations"][0]["excerpt"]


def test_ask_across_project_documents(api):
    client, headers = api["client"], api["headers"]
    _upload_document(client, headers["engineer"], api["project_id"], "spec2.pdf", SPEC_TEXT)
    response = client.post("/api/v1/documents/ask", params={"project_id": api["project_id"]},
                           headers=headers["manager"],
                           json={"question": "What is the minimum bend radius for Cat6?"})
    assert response.status_code == 200
    assert response.json()["grounded"] is True


def test_out_of_scope_question_is_not_answered(api):
    client, headers = api["client"], api["headers"]
    _upload_document(client, headers["engineer"], api["project_id"], "spec3.pdf", SPEC_TEXT)
    response = client.post("/api/v1/documents/ask", params={"project_id": api["project_id"]},
                           headers=headers["manager"],
                           json={"question": "What is the canteen lunch menu?"})
    assert response.status_code == 200
    body = response.json()
    assert body["grounded"] is False
    assert body["citations"] == []


def test_documents_are_project_scoped(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload_document(client, headers["engineer"], api["project_id"], "spec4.pdf", SPEC_TEXT)
    document_id = uploaded.json()["id"]
    cross = client.get(f"/api/v1/documents/{document_id}", params={"project_id": api["project2_id"]},
                       headers=headers["engineer"])
    assert cross.status_code == 404
    other_project_ask = client.post("/api/v1/documents/ask", params={"project_id": api["project2_id"]},
                                    headers=headers["manager"], json={"question": "How many speakers?"})
    assert other_project_ask.status_code == 200
    assert other_project_ask.json()["grounded"] is False


def test_document_delete_permissions(api):
    client, headers = api["client"], api["headers"]
    uploaded = _upload_document(client, headers["engineer"], api["project_id"], "spec5.pdf", SPEC_TEXT)
    document_id = uploaded.json()["id"]
    denied = client.delete(f"/api/v1/documents/{document_id}", params={"project_id": api["project_id"]},
                           headers=headers["supervisor"])
    assert denied.status_code == 403
    allowed = client.delete(f"/api/v1/documents/{document_id}", params={"project_id": api["project_id"]},
                            headers=headers["manager"])
    assert allowed.status_code == 204
