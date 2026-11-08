"""0005 §٢١٩ — إشارة الزيارة العامة وتقرير PLT-19."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.public_views import client_ip
from stingops import analytics
from stingops.views import _operator


class _AnyJSON(JSONParser):
    """`navigator.sendBeacon` يرسل نصاً بلا نوع JSON في بعض المتصفحات — يُقرأ JSON على أي حال."""

    media_type = "*/*"


class PublicBeaconView(APIView):
    """زيارة صفحة عامة. 204 دائماً — الرفض (آلي، سقف) لا يُعلَن لمن يرسل."""

    permission_classes = (AllowAny,)
    authentication_classes = ()
    parser_classes = (_AnyJSON,)

    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        body: dict[str, Any] = request.data if isinstance(request.data, dict) else {}
        analytics.record(
            ip=client_ip(request),
            ua=str(request.META.get("HTTP_USER_AGENT", ""))[:400],
            page_url=str(body.get("url") or "")[:500],
            referrer=str(body.get("referrer") or "")[:500],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class OperatorAnalyticsView(APIView):
    """PLT-19: التقرير لكل مشغّل (قراءة فقط)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("days", int, enum=list(analytics.RANGES))],
        responses={200: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        if _operator(request) is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        try:
            days = int(request.query_params.get("days", "7"))
        except ValueError:
            days = 7
        return Response(analytics.report(days))
