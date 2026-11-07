"""متجر التطبيقات (0005 §٢١٥): ينشر مدير المنصة إصدارات أندرويد وويندوز وماك (ملفات تثبيت) وآيفون
(رابط App Store أو TestFlight)، ويتصفّحها الزائر، وينزّلها التاجر بجلسته.

- الملف في تخزين خاص (`APP_STORE_ROOT`) لا يخدمه الويب. التنزيل رابط موقَّع قصير العمر يصدره
  الخادم لجلسة تاجر، فيتنزّل الملف بمدير تنزيلات المتصفح (لا يُحمَّل 512 ميبيبايت في ذاكرة الصفحة).
- لكل ملف بصمة SHA-256 تُحسب عند الرفع وتظهر للتاجر.
- النشر والسحب لمدير المنصة وحده (`roles.check_request`)، ويُسجَّلان في `OperatorAccessLog`.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from django.conf import settings
from django.core import signing
from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, transaction
from django.http import FileResponse, Http404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth.tokens import AuthContext
from stingops.models import AppRelease, OperatorAccessLog
from stingops.views import _operator

#: الامتدادات المقبولة لكل نظام (آيفون رابط لا ملف)
FORMATS: dict[str, frozenset[str]] = {
    "android": frozenset({".apk"}),
    "windows": frozenset({".exe", ".msi"}),
    "macos": frozenset({".dmg", ".pkg"}),
}
APPLE_HOSTS = frozenset({"apps.apple.com", "testflight.apple.com"})
LINK_SALT = "stingops.app_store.download"
LINK_MAX_AGE = 300  # ثوانٍ: يكفي لبدء التنزيل، ولا يصلح رابطاً يُتداول


def _storage() -> FileSystemStorage:
    return FileSystemStorage(location=settings.APP_STORE_ROOT)


class ReleaseInput(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=100)
    version = serializers.CharField(max_length=40)
    platform = serializers.ChoiceField(choices=AppRelease.Platform.choices)
    file = serializers.FileField(required=False, max_length=255)
    apple_url = serializers.URLField(required=False, max_length=500)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        platform = attrs["platform"]
        upload: UploadedFile[bytes] | None = attrs.get("file")
        url = str(attrs.get("apple_url") or "")
        if platform == AppRelease.Platform.IOS:
            parsed = urlsplit(url)
            if (
                upload is not None
                or parsed.scheme != "https"
                or parsed.netloc not in APPLE_HOSTS
                or parsed.path in {"", "/"}
            ):
                raise serializers.ValidationError("apple_url_invalid")
            return attrs
        if url or upload is None:
            raise serializers.ValidationError("file_required")
        if Path(upload.name or "").suffix.lower() not in FORMATS[platform]:
            raise serializers.ValidationError("file_type_invalid")
        if (upload.size or 0) > settings.APP_STORE_MAX_BYTES:
            raise serializers.ValidationError("file_too_large")
        return attrs


def _row(r: AppRelease, *, merchant: bool) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(r.id),
        "name": r.name,
        "platform": r.platform,
        "platform_label": r.get_platform_display(),
        "version": r.version,
        "published_at": r.published_at.isoformat().replace("+00:00", "Z"),
    }
    if merchant:
        out |= {
            "filename": r.filename,
            "size_bytes": r.size_bytes,
            "sha256": r.sha256,
            "apple_url": r.apple_url,
        }
    return out


def catalog(*, merchant: bool) -> list[dict[str, Any]]:
    return [_row(r, merchant=merchant) for r in AppRelease.objects.all()]


def _require_merchant(request: Request) -> AuthContext:
    auth = request.auth
    if not isinstance(auth, AuthContext) or auth.tenant_id is None:
        raise PermissionDenied("tenant_session_required")
    return auth


class PublicAppsView(APIView):
    """فهرس عام: الاسم والنظام والإصدار فقط — لا ملف ولا رابط تنزيل بلا جلسة تاجر."""

    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        return Response({"releases": catalog(merchant=False)})


class MerchantAppsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        _require_merchant(request)
        return Response({"releases": catalog(merchant=True)})


class MerchantDownloadLinkView(APIView):
    """رابط تنزيل موقَّع لخمس دقائق: يُطلب بجلسة التاجر، ويفتحه المتصفح تنزيلاً عادياً."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 404: None})
    def post(self, request: Request, release_id: UUID) -> Response:
        auth = _require_merchant(request)
        r = AppRelease.objects.filter(pk=release_id).exclude(storage_key="").first()
        if r is None:
            return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        token = signing.dumps({"r": str(r.id), "t": str(auth.tenant_id)}, salt=LINK_SALT)
        return Response(
            {"url": f"/api/apps/download/{token}", "expires_in": LINK_MAX_AGE},
        )


class SignedDownloadView(APIView):
    """يخدم الملف لرابط موقَّع ساري؛ بلا جلسة لأن المتصفح يفتحه مباشرة."""

    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(responses={200: None, 404: None})
    def get(self, request: Request, token: str) -> FileResponse:
        try:
            data = signing.loads(token, salt=LINK_SALT, max_age=LINK_MAX_AGE)
        except signing.BadSignature:
            raise Http404 from None
        r = AppRelease.objects.filter(pk=data.get("r")).exclude(storage_key="").first()
        if r is None:
            raise Http404
        try:
            fh = _storage().open(r.storage_key)
        except FileNotFoundError:
            raise Http404 from None
        response = FileResponse(
            fh, as_attachment=True, filename=r.filename, content_type="application/octet-stream"
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


def _save_upload(upload: UploadedFile[bytes]) -> tuple[str, str, int]:
    """يحفظ الملف باسم عشوائي ويحسب بصمته وحجمه في المرور نفسه."""
    digest = hashlib.sha256()
    size = 0
    for chunk in upload.chunks():
        digest.update(chunk)
        size += len(chunk)
    upload.seek(0)
    key = _storage().save(uuid4().hex, upload)
    return key, digest.hexdigest(), size


class OperatorAppsView(APIView):
    """PLT · متجر التطبيقات: القراءة لكل مشغّل، والنشر لمدير المنصة."""

    parser_classes = (MultiPartParser,)
    permission_classes = (IsAuthenticated,)

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        super().initial(request, *args, **kwargs)
        if not _operator(request):
            raise PermissionDenied("operator_required")

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        return Response({"releases": catalog(merchant=True)})

    @extend_schema(request=None, responses={201: None, 400: None, 409: None})
    def post(self, request: Request) -> Response:
        form = ReleaseInput(data=request.data)
        if not form.is_valid():
            errs = form.errors.get("non_field_errors") or next(iter(form.errors.values()))
            return Response({"detail": str(errs[0])}, status=status.HTTP_400_BAD_REQUEST)
        data = dict(form.validated_data)
        upload: UploadedFile[bytes] | None = data.pop("file", None)
        if AppRelease.objects.filter(
            name=data["name"], platform=data["platform"], version=data["version"]
        ).exists():
            return Response({"detail": "release_exists"}, status=status.HTTP_409_CONFLICT)
        key, sha, size = _save_upload(upload) if upload is not None else ("", "", 0)
        auth = request.auth
        assert isinstance(auth, AuthContext)
        try:
            with transaction.atomic():
                release = AppRelease.objects.create(
                    **data,
                    storage_key=key,
                    filename=Path(upload.name or "").name if upload is not None else "",
                    sha256=sha,
                    size_bytes=size,
                    published_by_name=auth.user.display_name,
                )
                OperatorAccessLog.objects.create(
                    operator=auth.user,
                    action="app_release_published",
                    detail=f"{release.name} {release.platform} {release.version}"[:300],
                )
        except IntegrityError:
            if key:
                _storage().delete(key)
            return Response({"detail": "release_exists"}, status=status.HTTP_409_CONFLICT)
        except Exception:
            if key:
                _storage().delete(key)
            raise
        return Response({"release": _row(release, merchant=True)}, status=status.HTTP_201_CREATED)


class OperatorAppDeleteView(APIView):
    """سحب إصدار: يختفي من الفهرس ويُحذف ملفه. لمدير المنصة وحده."""

    permission_classes = (IsAuthenticated,)

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        super().initial(request, *args, **kwargs)
        if not _operator(request):
            raise PermissionDenied("operator_required")

    @extend_schema(request=None, responses={200: None, 404: None})
    def post(self, request: Request, release_id: UUID) -> Response:
        auth = request.auth
        assert isinstance(auth, AuthContext)
        r = AppRelease.objects.filter(pk=release_id).first()
        if r is None:
            return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        key = r.storage_key
        with transaction.atomic():
            OperatorAccessLog.objects.create(
                operator=auth.user,
                action="app_release_removed",
                detail=f"{r.name} {r.platform} {r.version}"[:300],
            )
            r.delete()
        if key:
            _storage().delete(key)
        return Response({"releases": catalog(merchant=True)})
