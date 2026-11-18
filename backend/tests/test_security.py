from pathlib import Path

from app.core.errors import AppError
from app.utils.files import sanitize_filename, save_bytes

TMP = Path(__file__).resolve().parent / "_tmp"


def test_unsupported_file_type_is_rejected(api):
    response = api["client"].post(
        "/api/v1/documents",
        headers=api["headers"]["engineer"],
        data={"project_id": api["project_id"]},
        files={"file": ("malware.exe", b"MZ\x90\x00not-a-document", "application/octet-stream")},
    )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_extension_spoofing_is_rejected(api):
    response = api["client"].post(
        "/api/v1/documents",
        headers=api["headers"]["engineer"],
        data={"project_id": api["project_id"]},
        files={"file": ("invoice.pdf", b"MZ\x90\x00executable-content", "application/pdf")},
    )
    assert response.status_code == 415


def test_oversized_upload_is_rejected(api, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "max_document_mb", 0)
    response = api["client"].post(
        "/api/v1/documents",
        headers=api["headers"]["engineer"],
        data={"project_id": api["project_id"]},
        files={"file": ("spec.pdf", b"%PDF-1.4 small", "application/pdf")},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_filename_traversal_is_sanitized():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("..\\..\\windows\\system32\\cmd.exe") == "cmd.exe"
    assert "/" not in sanitize_filename("a/b/c.pdf")


def test_save_bytes_rejects_empty_and_writes_inside_storage():
    with __import__("pytest").raises(AppError):
        save_bytes(b"", "empty.pdf", "0" * 24, "document", 5)
    stored = save_bytes(b"%PDF-1.4 test", "../evil.pdf", "0" * 24, "document", 5)
    assert stored["storage_key"].startswith("0" * 24 + "/")
    assert ".." not in stored["storage_key"]


def test_invalid_ids_return_404_not_500(api):
    response = api["client"].get("/api/v1/projects/not-an-object-id", headers=api["headers"]["manager"])
    assert response.status_code == 404
    response = api["client"].get("/api/v1/reports/not-an-object-id",
                                 params={"project_id": api["project_id"]}, headers=api["headers"]["manager"])
    assert response.status_code == 404


def test_ai_kill_switch(api, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "ai_enabled", False)
    response = api["client"].post("/api/v1/ai/issues/classify", headers=api["headers"]["engineer"], json={
        "project_id": api["project_id"], "title": "Camera offline",
        "description": "Camera 4 is not working since this morning.",
    })
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_DISABLED"
    status_body = api["client"].get("/api/v1/ai/status", headers=api["headers"]["engineer"]).json()
    assert status_body["mode"] == "disabled"


def test_registration_rejects_duplicates_and_hashes_password(api):
    client = api["client"]
    duplicate = client.post("/api/v1/auth/register", json={
        "name": "Duplicate", "email": "engineer@demo.siteops.local", "password": "AnotherPass!1",
        "role": "site_engineer",
    })
    assert duplicate.status_code == 409
    created = client.post("/api/v1/auth/register", json={
        "name": "New Person", "email": "new.person@demo.siteops.local", "password": "AnotherPass!1",
        "role": "supervisor",
    })
    assert created.status_code == 201
    from app.database.mongo import get_db

    doc = get_db().users.find_one({"email": "new.person@demo.siteops.local"})
    assert doc["password_hash"].startswith("$argon2")
    assert "AnotherPass!1" not in doc["password_hash"]


def test_upload_requires_authentication(api):
    response = api["client"].post("/api/v1/documents", data={"project_id": api["project_id"]},
                                  files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")})
    assert response.status_code == 401
