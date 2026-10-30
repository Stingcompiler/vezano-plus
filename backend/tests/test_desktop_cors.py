"""CORS لتطبيق الحاسوب: أصلاه وحدهما، على /api وحده، بلا Cookies (0005 §٢٠٧)."""

import pytest
from django.test import Client

MAC = "tauri://localhost"
WIN = "http://tauri.localhost"


@pytest.mark.parametrize("origin", [MAC, WIN])
def test_preflight_from_desktop_is_answered(origin: str) -> None:
    r = Client().options(
        "/api/auth/account/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 204
    assert r["Access-Control-Allow-Origin"] == origin
    assert "POST" in r["Access-Control-Allow-Methods"]
    assert "Authorization" in r["Access-Control-Allow-Headers"]
    assert "Access-Control-Allow-Credentials" not in r


@pytest.mark.django_db
def test_desktop_response_carries_origin() -> None:
    r = Client().post(
        "/api/auth/refresh",
        {"refresh": "x"},
        content_type="application/json",
        headers={"Origin": MAC},
    )
    assert r.status_code == 401
    assert r["Access-Control-Allow-Origin"] == MAC
    assert "Origin" in r["Vary"]


@pytest.mark.django_db
def test_other_origins_get_nothing() -> None:
    r = Client().post(
        "/api/auth/refresh",
        {"refresh": "x"},
        content_type="application/json",
        headers={"Origin": "https://evil.example"},
    )
    assert "Access-Control-Allow-Origin" not in r
    pre = Client().options(
        "/api/auth/refresh",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "Access-Control-Allow-Origin" not in pre


@pytest.mark.django_db
def test_non_api_paths_are_not_opened() -> None:
    r = Client().get("/healthz", headers={"Origin": MAC})
    assert "Access-Control-Allow-Origin" not in r
