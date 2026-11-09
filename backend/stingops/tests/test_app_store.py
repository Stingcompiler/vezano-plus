"""متجر التطبيقات (0005 §٢١٥): النشر لمدير المنصة، والفهرس العام بلا ملفات، والتنزيل برابط موقَّع
قصير العمر لجلسة تاجر، والبصمة، والتكرار، وآيفون برابط، والسحب، والتدقيق."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client

from core.tests.test_org import _h, ctx  # noqa: F401
from stingops.app_store import LINK_SALT
from stingops.models import OperatorAccessLog
from stingops.tests.test_operator import _operator_headers

pytestmark = pytest.mark.django_db(transaction=True)

API = "/api/platform/apps"


def _apk(content: bytes = b"fixture-apk") -> SimpleUploadedFile:
    return SimpleUploadedFile("vezano-1.0.apk", content)


def test_publish_browse_download_remove(
    ctx: dict[str, Any],  # noqa: F811
    settings: Any,
    tmp_path: Path,
) -> None:
    settings.APP_STORE_ROOT = tmp_path
    c = Client()
    admin = _operator_headers("store-admin", "هدى — تشغيل")
    merchant = _h(ctx["tokens"]["owner"])
    form: dict[str, Any] = {"name": "Vezano", "version": "1.0", "platform": "android"}
    # التاجر لا ينشر، والامتداد الخاطئ والملف الغائب مرفوضان
    assert c.post(API, {**form, "file": _apk()}, headers=merchant).status_code == 403
    bad = c.post(API, {**form, "file": SimpleUploadedFile("x.exe", b"1")}, headers=admin)
    assert bad.status_code == 400 and bad.json()["detail"] == "file_type_invalid"
    assert c.post(API, form, headers=admin).json()["detail"] == "file_required"
    # النشر: البصمة والحجم يُحسبان، والتكرار 409 بلا ملف يتيم
    r = c.post(API, {**form, "file": _apk()}, headers=admin)
    assert r.status_code == 201, r.content
    rel = r.json()["release"]
    assert rel["sha256"] == hashlib.sha256(b"fixture-apk").hexdigest()
    assert rel["size_bytes"] == len(b"fixture-apk")
    assert c.post(API, {**form, "file": _apk()}, headers=admin).status_code == 409
    assert len(list(tmp_path.iterdir())) == 1
    assert OperatorAccessLog.objects.filter(action="app_release_published").count() == 1
    assert c.get(API, headers=admin).json()["releases"][0]["id"] == rel["id"]
    # الفهرس العام بلا ملف ولا رابط، وفهرس التاجر يحتاج جلسته
    pub = c.get("/api/public/apps").json()["releases"]
    public_keys = ("id", "name", "platform", "platform_label", "version", "published_at", "kind")
    assert pub == [
        {**{k: rel[k] for k in public_keys}, "link_url": "", "link_label": "", "link_icon": ""}
    ]
    assert rel["kind"] == "file"
    assert c.get("/api/org/apps").status_code == 401
    assert c.get("/api/org/apps", headers=merchant).json()["releases"][0]["sha256"] == rel["sha256"]
    # التنزيل: رابط موقَّع لجلسة تاجر، يخدم الملف بلا جلسة، ويُرفض المزوَّر والمنتهي
    link_path = f"/api/org/apps/{rel['id']}/link"
    assert c.post(link_path).status_code == 401
    link = c.post(link_path, headers=merchant).json()
    assert link["expires_in"] == 300
    got = c.get(link["url"])
    assert got.status_code == 200 and b"".join(got.streaming_content) == b"fixture-apk"  # type: ignore[attr-defined]
    assert got["Content-Disposition"].startswith("attachment")
    assert c.get(link["url"] + "x").status_code == 404
    stale = signing.dumps({"r": rel["id"], "t": "x"}, salt="other")
    assert c.get(f"/api/apps/download/{stale}").status_code == 404
    assert signing.loads(link["url"].rsplit("/", 1)[1], salt=LINK_SALT)["r"] == rel["id"]
    # آيفون رابط دائماً؛ الرابط https بتسمية وأيقونة من القائمة، ولا رابط تنزيل له (§٢٣٠)
    ios: dict[str, Any] = {"name": "Vezano", "version": "1.0", "platform": "ios"}
    assert c.post(API, ios, headers=admin).json()["detail"] == "link_invalid"
    plain = {**ios, "link_url": "http://apps.apple.com/app/id1", "link_label": "App Store"}
    assert c.post(API, plain, headers=admin).json()["detail"] == "link_invalid"
    no_label = {**ios, "link_url": "https://apps.apple.com/app/id1"}
    assert c.post(API, no_label, headers=admin).json()["detail"] == "link_label_required"
    bad_icon = {**no_label, "link_label": "App Store", "link_icon": "myspace"}
    assert c.post(API, bad_icon, headers=admin).json()["detail"] == "link_icon_invalid"
    ok = c.post(API, {**bad_icon, "link_icon": "app_store"}, headers=admin)
    assert ok.status_code == 201
    ios_rel = ok.json()["release"]
    assert ios_rel["kind"] == "link" and ios_rel["apple_url"] == "https://apps.apple.com/app/id1"
    ios_id = ios_rel["id"]
    assert c.post(f"/api/org/apps/{ios_id}/link", headers=merchant).status_code == 404
    # عميل أقدم يرسل `apple_url` بلا أيقونة: رابط عام بتسميته
    old = {**ios, "version": "0.9", "apple_url": "https://testflight.apple.com/join/x"}
    assert c.post(API, {**old, "link_label": "TestFlight"}, headers=admin).status_code == 201
    # رابط لأندرويد بأيقونة Google Play يظهر للزائر برابطه وتسميته؛ ملف ورابط معاً مرفوض
    play = {
        "name": "Vezano",
        "version": "2.0",
        "platform": "android",
        "link_url": "https://play.google.com/store/apps/details?id=app.vezano",
        "link_label": "حمّل من Google Play",
        "link_icon": "google_play",
    }
    both = c.post(API, {**play, "file": _apk(b"z")}, headers=admin)
    assert both.json()["detail"] == "file_or_link"
    assert c.post(API, play, headers=admin).status_code == 201
    shown = {r["version"]: r for r in c.get("/api/public/apps").json()["releases"]}
    assert shown["2.0"]["link_icon"] == "google_play"
    assert shown["2.0"]["link_label"] == "حمّل من Google Play"
    assert "sha256" not in shown["2.0"]
    # السحب: لمدير المنصة، يحذف الملف ويُدقَّق
    rm = f"/api/platform/apps/{rel['id']}/remove"
    assert c.post(rm, headers=merchant).status_code == 403
    assert c.post(rm, headers=admin).status_code == 200
    assert list(tmp_path.iterdir()) == []
    assert c.get(link["url"]).status_code == 404
    assert OperatorAccessLog.objects.filter(action="app_release_removed").count() == 1


def test_storage_cap_refuses_upload(
    ctx: dict[str, Any],  # noqa: F811
    settings: Any,
    tmp_path: Path,
) -> None:
    """مراجعة 2026-11-08: القرص مشترك مع قواعد البيانات — تجاوز سقف المتجر يُرفض قبل الحفظ."""
    settings.APP_STORE_ROOT = tmp_path
    settings.APP_STORE_TOTAL_MAX_BYTES = 20
    c = Client()
    admin = _operator_headers("store-cap", "هدى — تشغيل")
    form: dict[str, Any] = {"name": "Vezano", "platform": "android"}
    assert (
        c.post(API, {**form, "version": "1", "file": _apk(b"x" * 15)}, headers=admin).status_code
        == 201
    )
    r = c.post(API, {**form, "version": "2", "file": _apk(b"y" * 15)}, headers=admin)
    assert r.status_code == 400 and r.json()["detail"] == "storage_full"
    assert len(list(tmp_path.iterdir())) == 1
    # الرابط يحتاج جلسة تاجر قبل أي بحث عن الإصدار
    assert (
        c.post("/api/org/apps/00000000-0000-0000-0000-000000000000/link", headers=admin).status_code
        == 403
    )
