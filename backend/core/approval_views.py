"""«طلبات تنتظرك» (S-04؛ 0005 §٢٩٣): الصندوق، وحالة طلب بعينه لشاشة الكاشير، والقرار."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.limits import FieldError, Rejected
from core import approvals, home
from core.auth.tokens import AuthContext
from core.tenancy import tenant_context


def _viewer(auth: Any) -> home.Viewer:
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _reviewer(v: home.Viewer) -> bool:
    """الصندوق للمالك ولمدير الفرع (د-٤)؛ القرار في كل طلب بحدّ المعتمد (`can_decide`)."""
    return v.can_see_finance


class ApprovalsView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            can_review = _reviewer(v)
            branch_id = None if v.is_owner else (v.branch.id if v.branch else None)
            items = approvals.inbox(v.user, branch_id) if can_review else []
            return Response(
                {
                    "can_review": can_review,
                    "scope": "all" if v.is_owner else "branch",
                    "role_name": v.role_name,
                    "branch_name": v.branch.name if v.branch else "",
                    "items": items,
                }
            )


class ApprovalItemView(APIView):
    """حالة طلب بعينه — شاشة الكاشير تتابعه حتى يُقرَّر فيه."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, kind: str, request_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request.auth)
            rec = approvals.get(kind, request_id)
            # طلب غيرك لا يُقرأ إلا لمن يراجع الطلبات
            if rec is None or (rec.requested_by_user_id != v.user.id and not _reviewer(v)):
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response({"item": approvals.item_payload(kind, rec, v.user)})


class ApprovalDecideView(APIView):
    permission_classes = (IsAuthenticated,)

    class ApprovalDecideSerializer(serializers.Serializer[dict[str, Any]]):
        decision = serializers.ChoiceField(choices=["accept", "reject"])
        reason = serializers.CharField(allow_blank=True, required=False, default="")

    @extend_schema(
        request=ApprovalDecideSerializer,
        responses={200: None, 400: None, 403: None, 404: None, 409: None},
    )
    def post(self, request: Request, kind: str, request_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ApprovalDecideSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(tid):
            v = _viewer(request.auth)
            rec = approvals.get(kind, request_id)
            if rec is None or not _reviewer(v):
                return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            try:
                approvals.decide(
                    kind,
                    rec,
                    actor=v.user,
                    decision=str(s.validated_data["decision"]),
                    reason=str(s.validated_data.get("reason", "")),
                )
            except approvals.ApprovalRejected as e:
                if e.code == "permission_denied" and e.decision is not None:
                    return Response(e.decision.denial(v.role_name), status=403)
                if e.code == "self_approval":
                    return Response({"detail": "self_approval"}, status=403)
                if e.code == "already_decided":
                    return Response(
                        {"detail": "already_decided", "item": approvals.item_payload(kind, rec)},
                        status=409,
                    )
                return Response(
                    Rejected([FieldError(e.field or "decision", e.code)]).as_response(),
                    status=400,
                )
            return Response({"item": approvals.item_payload(kind, rec, v.user)})
