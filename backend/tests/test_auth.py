def test_login_returns_access_token_and_httponly_refresh_cookie(api):
    client = api["client"]
    response = client.post("/api/v1/auth/login", json={"email": "engineer@demo.siteops.local", "password": "TestPass!2026"})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["role"] == "site_engineer"
    assert "password_hash" not in body["user"]
    cookie = response.headers.get("set-cookie", "")
    assert "siteops_refresh=" in cookie
    assert "HttpOnly" in cookie
    assert "Path=/api/v1/auth" in cookie


def test_wrong_password_is_rejected(api):
    response = api["client"].post("/api/v1/auth/login",
                                  json={"email": "engineer@demo.siteops.local", "password": "wrong-password"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_me_requires_token_and_tampered_token_fails(api):
    client = api["client"]
    assert client.get("/api/v1/auth/me").status_code == 401
    token = api["headers"]["engineer"]["Authorization"].split(" ")[1]
    tampered = token[:-2] + ("aa" if token[-2:] != "aa" else "bb")
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tampered}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_refresh_rotates_and_old_token_is_revoked(api):
    client = api["client"]
    login = client.post("/api/v1/auth/login", json={"email": "engineer@demo.siteops.local", "password": "TestPass!2026"})
    old_refresh = client.cookies.get("siteops_refresh")
    refreshed = client.post("/api/v1/auth/refresh", cookies={"siteops_refresh": old_refresh})
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]
    # Old refresh token must be single-use.
    reuse = client.post("/api/v1/auth/refresh", cookies={"siteops_refresh": old_refresh})
    assert reuse.status_code == 401


def test_logout_revokes_refresh(api):
    client = api["client"]
    client.post("/api/v1/auth/login", json={"email": "engineer@demo.siteops.local", "password": "TestPass!2026"})
    refresh = client.cookies.get("siteops_refresh")
    assert client.post("/api/v1/auth/logout").status_code == 204
    response = client.post("/api/v1/auth/refresh", cookies={"siteops_refresh": refresh})
    assert response.status_code == 401


def test_request_id_header_and_error_envelope(api):
    response = api["client"].get("/api/v1/auth/me")
    assert response.headers["X-Request-ID"]
    body = response.json()
    assert set(body.keys()) == {"error", "request_id"}
    assert set(body["error"].keys()) == {"code", "message", "details"}
