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
    # الفهرس العام بلا ملف ولا رابط، وفهرس التاجر يحتاج جلسته
    pub = c.get("/api/public/apps").json()["releases"]
    assert pub == [
        {k: rel[k] for k in ("id", "name", "platform", "platform_label", "version", "published_at")}
    ]
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
    # آيفون: رابط Apple فقط، ولا رابط تنزيل له
    ios: dict[str, Any] = {"name": "Vezano", "version": "1.0", "platform": "ios"}
    assert c.post(API, ios, headers=admin).json()["detail"] == "apple_url_invalid"
    ios_bad = {**ios, "apple_url": "https://evil.example/app"}
    assert c.post(API, ios_bad, headers=admin).json()["detail"] == "apple_url_invalid"
    ok = c.post(API, {**ios, "apple_url": "https://apps.apple.com/app/id123456"}, headers=admin)
    assert ok.status_code == 201
    ios_id = ok.json()["release"]["id"]
    assert c.post(f"/api/org/apps/{ios_id}/link", headers=merchant).status_code == 404
    # السحب: لمدير المنصة، يحذف الملف ويُدقَّق
    rm = f"/api/platform/apps/{rel['id']}/remove"
    assert c.post(rm, headers=merchant).status_code == 403
    assert c.post(rm, headers=admin).status_code == 200
    assert list(tmp_path.iterdir()) == []
    assert c.get(link["url"]).status_code == 404
    assert OperatorAccessLog.objects.filter(action="app_release_removed").count() == 1
