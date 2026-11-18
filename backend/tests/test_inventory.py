from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.main import app


def _material(client, headers, project_id, material_id):
    return client.get(f"/api/v1/inventory/materials/{material_id}", params={"project_id": project_id},
                      headers=headers)


def test_receipt_and_consumption_update_stock_and_ledger(api):
    client, headers = api["client"], api["headers"]
    receipt = client.post("/api/v1/inventory/transactions", headers=headers["store"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "receipt",
        "quantity": 5, "remarks": "PO delivery",
    })
    assert receipt.status_code == 201, receipt.text
    assert receipt.json()["transaction"]["stock_before"] == "10"
    assert receipt.json()["transaction"]["stock_after"] == "15"
    assert receipt.json()["material"]["current_stock"] == "15"

    consume = client.post("/api/v1/inventory/transactions", headers=headers["engineer"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "consumption",
        "quantity": 2.5,
    })
    assert consume.status_code == 201
    assert consume.json()["material"]["current_stock"] == "12.5"

    reconcile = client.get("/api/v1/inventory/reconcile", params={"project_id": api["project_id"]},
                           headers=headers["manager"]).json()
    assert reconcile["items"][0]["consistent"] is True


def test_insufficient_stock_is_rejected_without_side_effects(api):
    client, headers = api["client"], api["headers"]
    response = client.post("/api/v1/inventory/transactions", headers=headers["engineer"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "consumption",
        "quantity": 11,
    })
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INSUFFICIENT_STOCK"
    material = _material(client, headers["engineer"], api["project_id"], api["material_id"]).json()
    assert material["current_stock"] == "10"


def test_supervisor_cannot_receive_but_can_consume(api):
    client, headers = api["client"], api["headers"]
    receipt = client.post("/api/v1/inventory/transactions", headers=headers["supervisor"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "receipt", "quantity": 1,
    })
    assert receipt.status_code == 403
    consume = client.post("/api/v1/inventory/transactions", headers=headers["supervisor"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "consumption", "quantity": 1,
    })
    assert consume.status_code == 201


def test_adjustment_requires_direction(api):
    client, headers = api["client"], api["headers"]
    response = client.post("/api/v1/inventory/transactions", headers=headers["store"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "adjustment", "quantity": 2,
    })
    assert response.status_code == 422
    ok = client.post("/api/v1/inventory/transactions", headers=headers["store"], json={
        "project_id": api["project_id"], "material_id": api["material_id"], "type": "adjustment",
        "quantity": 2, "direction": "decrease", "remarks": "Damaged in storage",
    })
    assert ok.status_code == 201
    assert ok.json()["material"]["current_stock"] == "8"


def test_ledger_entries_are_immutable_via_api(api):
    client, headers = api["client"], api["headers"]
    txn = client.get("/api/v1/inventory/transactions", params={"project_id": api["project_id"]},
                     headers=headers["store"]).json()["items"][0]
    assert client.put(f"/api/v1/inventory/transactions/{txn['id']}", headers=headers["store"], json={}).status_code in (404, 405)
    assert client.delete(f"/api/v1/inventory/transactions/{txn['id']}", headers=headers["store"]).status_code in (404, 405)


def test_concurrent_consumption_never_oversells(api):
    """50 parallel requests, stock 10: exactly 10 must succeed."""
    token = api["headers"]["engineer"]["Authorization"]
    project_id = api["project_id"]
    material_id = api["material_id"]

    def attempt(_):
        thread_client = TestClient(app)
        return thread_client.post(
            "/api/v1/inventory/transactions",
            headers={"Authorization": token},
            json={"project_id": project_id, "material_id": material_id, "type": "consumption", "quantity": 1},
        ).status_code

    with ThreadPoolExecutor(max_workers=10) as pool:
        codes = list(pool.map(attempt, range(50)))

    assert codes.count(201) == 10, codes
    assert codes.count(409) == 40, codes

    material = _material(api["client"], api["headers"]["manager"], project_id, material_id).json()
    assert material["current_stock"] == "0"
    reconcile = api["client"].get("/api/v1/inventory/reconcile", params={"project_id": project_id},
                                  headers=api["headers"]["manager"]).json()
    assert reconcile["items"][0]["consistent"] is True
    assert reconcile["items"][0]["current_stock"] == "0"


def test_forecast_is_labeled_and_uses_history(api):
    client, headers = api["client"], api["headers"]
    data = client.get("/api/v1/inventory/forecast", params={"project_id": api["project_id"], "horizon_days": 14},
                      headers=headers["store"]).json()
    item = data["items"][0]
    assert item["method"] in {"moving_average_90d", "rule_based"}
    assert "not validated predictions" in data["note"]
    assert "reason" in item and "limitations" in item
