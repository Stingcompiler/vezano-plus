"""0005 §٢١٦ — اشتراك متصفح المشغّل في الإشعارات الفورية: الحالة بلا سرّ، والاشتراك والإلغاء لكل
مشغّل (مديراً كان أو دعماً — كلٌّ يشترك بمتصفحه هو)."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.push_views import SubscribeSerializer
from stingops import operator_push
from stingops.views import _operator


class OperatorPushStatusView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(operator_push.status(auth.user))


class OperatorPushSubscribeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SubscribeSerializer, responses={200: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        s = SubscribeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        return Response(
            operator_push.subscribe(
                auth.user,
                endpoint=str(d["endpoint"]),
                p256dh=str(d["p256dh"]),
                auth=str(d["auth"]),
                user_agent=request.headers.get("User-Agent", ""),
            )
        )


class OperatorPushUnsubscribeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={200: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = _operator(request)
        if auth is None:
            return Response({"detail": "operator_required"}, status=status.HTTP_403_FORBIDDEN)
        body = request.data if isinstance(request.data, dict) else {}
        return Response(
            operator_push.unsubscribe(auth.user, endpoint=str(body.get("endpoint", "")))
        )
