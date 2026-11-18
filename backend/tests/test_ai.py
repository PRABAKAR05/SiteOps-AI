import pytest

from app.ai.client import groq
from app.core.errors import AppError


def test_ai_status_is_honest_about_mode(api):
    data = api["client"].get("/api/v1/ai/status", headers=api["headers"]["engineer"]).json()
    assert data["mode"] in {"local", "groq", "disabled"}
    assert data["provider"] in {"local-rules", "groq"}
    if data["mode"] == "local":
        assert data["model"] is None


def test_report_generation_uses_only_stated_numbers(api):
    notes = ("12 workers on site. Pulled Cat6 in zones A and B. Speaker grid pending in zone C. "
             "Cable tray delivery delayed by two days. Safety toolbox talk completed.")
    response = api["client"].post("/api/v1/ai/reports/generate", headers=api["headers"]["engineer"], json={
        "project_id": api["project_id"], "notes": notes,
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["method"] in {"rules", "llm"}
    proposal = body["proposal"]
    assert proposal["workers_present"]["total"] == 12
    for line in proposal["work_completed"] + proposal["work_pending"]:
        for token in ("99", "1000", "42"):
            assert token not in line
    assert body["ai_assisted"] is (body["method"] == "llm")


def test_issue_classification_respects_enums(api):
    response = api["client"].post("/api/v1/ai/issues/classify", headers=api["headers"]["engineer"], json={
        "project_id": api["project_id"],
        "title": "Smoke detector loop fault",
        "description": "Fire alarm panel reports a smoke detector loop fault in zone B.",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["category"] in {
        "electrical", "cctv", "fire_safety", "av", "acoustic", "networking", "bms", "civil",
        "material_shortage", "equipment_failure", "other",
    }
    assert body["priority"] in {"low", "medium", "high", "critical"}
    assert body["severity"] in {"minor", "moderate", "major", "safety"}
    assert body["method"] in {"rules", "llm"}


def test_project_chat_is_grounded_in_records(api):
    response = api["client"].post("/api/v1/ai/chat", headers=api["headers"]["manager"], json={
        "project_id": api["project_id"], "message": "What materials are low on stock?",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["grounded"] is True
    assert "Material" in body["answer"]
    assert body["used_ids"]


def test_ai_failure_returns_typed_error(api, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "groq_api_key", "configured-but-unreachable")

    def boom(**kwargs):
        raise AppError("AI_UNAVAILABLE", "The AI provider timed out.", 503)

    monkeypatch.setattr(groq, "complete_json", boom)
    response = api["client"].post("/api/v1/ai/issues/classify", headers=api["headers"]["engineer"], json={
        "project_id": api["project_id"],
        "title": "Camera offline",
        "description": "Camera 4 is not working since this morning.",
    })
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_UNAVAILABLE"


def test_unconfigured_client_raises_not_configured(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "groq_api_key", "")
    with pytest.raises(AppError) as exc:
        groq.complete_json(system="x", user="y", feature="test")
    assert exc.value.code == "AI_NOT_CONFIGURED"
