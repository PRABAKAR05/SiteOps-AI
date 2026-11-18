"""Live API smoke test against a running server. Usage: python scripts/smoke.py"""

import json
import os
import sys

import httpx

BASE = os.environ.get("SITE0PS_BASE", "http://127.0.0.1:8000/api/v1")
EMAIL = os.environ.get("DEMO_EMAIL", "manager@demo.siteops.local")
PASSWORD = os.environ.get("DEMO_PASSWORD", "DemoPass!2026")


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=60)
    r = client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    print("login", r.status_code)
    if r.status_code != 200:
        print(r.text)
        return 1
    token = r.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"

    projects = client.get("/projects").json()
    print("projects", projects["total"])
    pid = next(p["id"] for p in projects["items"] if p["code"] == "DEMO-AV1")

    dashboard = client.get("/analytics/dashboard", params={"project_id": pid})
    print("dashboard", dashboard.status_code, json.dumps(dashboard.json().get("kpis"), default=str))

    reports = client.get("/reports", params={"project_id": pid}).json()
    print("reports", reports["total"], [i["status"] for i in reports["items"][:4]])

    ai = client.post("/ai/reports/generate", json={
        "project_id": pid,
        "notes": "12 workers on site. Pulled Cat6 in zones A and B. Speaker grid pending in zone C. "
                 "Cable tray delivery delayed by two days. Safety toolbox talk completed.",
    })
    print("ai report", ai.status_code, ai.json().get("method"), len(ai.json().get("proposal", {}).get("work_completed", [])))

    materials = client.get("/inventory/materials", params={"project_id": pid}).json()
    print("materials", materials["total"])
    alerts = client.get("/inventory/alerts", params={"project_id": pid}).json()
    print("low stock alerts", len(alerts["items"]))

    ask = client.post("/documents/ask", params={"project_id": pid},
                      json={"question": "How many ceiling speakers are required?"})
    print("doc ask", ask.status_code, ask.json().get("grounded"), len(ask.json().get("citations", [])))
    print("  answer:", ask.json().get("answer", "")[:140].replace("\n", " "))

    invoices = client.get("/invoices", params={"project_id": pid}).json()
    print("invoices", invoices["total"], [(i.get("invoice_number"), i["verification_status"]) for i in invoices["items"]])

    issues = client.get("/issues", params={"project_id": pid}).json()
    print("issues", issues["total"])

    tasks = client.get("/tasks", params={"project_id": pid}).json()
    print("tasks", tasks["total"])

    risk = client.get("/analytics/risk", params={"project_id": pid}).json()
    print("risk", risk["score"], risk["band"])

    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
