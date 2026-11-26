"""نقاط نهاية الورديات: الوردية الحالية للفرع (SHIFT-01/02)، وردية بعينها، طلب سحب (SHIFT-03)،
ومراجعة الفروق والعمليات المتأخرة (SHIFT-05)."""

from __future__ import annotations

import uuid
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.limits import PRICE_MAX_MINOR, FieldError, Rejected, check_integer
from core import home, permissions
from core.auth.tokens import AuthContext
from core.models import Branch
from core.shift import expected_cash_minor
from core.tenancy import tenant_context
from sales.services import caps_payload
from shifts import services
from shifts.models import Shift


def _tenant(auth: Any) -> uuid.UUID | None:
    return auth.tenant_id if isinstance(auth, AuthContext) else None


def _viewer(request: Request) -> home.Viewer:
    auth = request.auth
    assert isinstance(auth, AuthContext)
    return home.viewer_for(auth.user, auth.device)


#: السحب يُخرج النقد من دورة المحل إلى خارجها — للمالك وحده (SHIFT-03 permission_denied)
def _can_withdraw(v: home.Viewer) -> bool:
    return v.is_owner


#: التسوية إقرار مالي بقبول الفارق — بخلية «إغلاق وردية بعجز» (`close_short`) في المصفوفة: الدور
#: يُسوّي عجزاً حتى حدّه في فرعه، والمالك بلا حدّ (0005 §٢٩٢). «لا» = يراجع ولا يُسوّي.
def _can_settle(v: home.Viewer) -> bool:
    return permissions.can(v, "close_short").allowed


def settle_decision(
    v: home.Viewer, variance: int | None, branch_id: uuid.UUID
) -> permissions.Decision:
    """قرار تسوية وردية بعينها: العجز (لا الزيادة) يُقاس بحدّ الدور؛ وردية بلا عدّ فارقها مجهول
    فلا يسوّيها إلا من لا حدّ له."""
    shortage = max(0, -variance) if variance is not None else None
    d = permissions.can(v, "close_short", shortage, branch_id=branch_id)
    if d.allowed and shortage is None and d.limit_minor is not None:
        return permissions.Decision(
            d.key, False, "over_limit", value=d.value, limit_minor=d.limit_minor, period=d.period
        )
    return d


class CurrentShiftView(APIView):
    """الوردية المفتوحة للفرع: من جهاز الجلسة أو `branch_id`."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OpenApiParameter("branch_id", str, OpenApiParameter.QUERY, required=False)],
        responses={200: None, 400: None, 403: None},
    )
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        auth = request.auth
        if tid is None or not isinstance(auth, AuthContext):
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        raw = str(request.query_params.get("branch_id", "")) or (
            str(auth.device.branch_id) if auth.device is not None else ""
        )
        try:
            branch_id = uuid.UUID(raw)
        except ValueError:
            return Response({"detail": "branch_required"}, status=status.HTTP_400_BAD_REQUEST)
        with tenant_context(tid):
            branch = Branch.objects.filter(id=branch_id).first()
            return Response(
                {
                    "branch_id": str(branch_id),
                    "branch_name": branch.name if branch else "",
                    "branch_code": branch.code if branch else "",
                    "device_name": auth.device.name if auth.device is not None else "",
                    "user_name": auth.user.display_name,
                    "role_name": _viewer(request).role_name,
                    "can_withdraw": _can_withdraw(_viewer(request)),
                    # خلايا الدور من المصفوفة (0005 §٢٩٢) — تُخزَّن على الجهاز فتقرّر الشاشات بلا اتصال
                    "permissions": permissions.rules_payload(_viewer(request)),
                    "owner_name": services.owner_name(),
                    "role_code": _viewer(request).role_code,
                    # سقوف الخصم بحسب الدور (POS-03؛ G-09 مؤقتاً) — تُخزَّن على الجهاز للعمل بلا اتصال
                    "discount_caps": caps_payload(
                        _viewer(request).role_code,
                        _viewer(request).is_owner,
                        _viewer(request).user.id,
                    ),
                    **services.current_for_branch(branch_id),
                }
            )


class ShiftView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None, 404: None})
    def get(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            return Response(services.shift_payload(shift))


class MovementRequestView(APIView):
    """«اطلب من المالك»: طلب سحب بالمبلغ والسبب (SHIFT-03 permission_denied)."""

    permission_classes = (IsAuthenticated,)

    class RequestSerializer(serializers.Serializer[dict[str, Any]]):
        kind = serializers.ChoiceField(choices=["withdrawal"])
        amount_minor = serializers.CharField()
        reason = serializers.CharField(allow_blank=False, trim_whitespace=False)

    @extend_schema(
        request=RequestSerializer, responses={201: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.RequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with tenant_context(tid):
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            errs = check_integer("amount_minor", str(d["amount_minor"]), 1, PRICE_MAX_MINOR)
            if errs:
                return Response(Rejected(errs).as_response(), status=status.HTTP_400_BAD_REQUEST)
            v = _viewer(request)
            req = services.request_movement(
                shift,
                kind=str(d["kind"]),
                amount_minor=int(d["amount_minor"]),
                reason=str(d["reason"]),
                requested_by=v.user,
            )
            return Response(
                {
                    "id": str(req.id),
                    "shift_id": str(shift.id),
                    "kind": req.kind,
                    "amount_minor": str(req.amount_minor),
                    "reason": req.reason,
                    "status": req.status,
                    "requested_by_name": req.requested_by_name,
                    "owner_name": services.owner_name(),
                },
                status=201,
            )


def admin_close_decision(
    v: home.Viewer, shift: Shift, counted_minor: int | None
) -> permissions.Decision:
    """الإقفال الإداري (S-05؛ د-٥): بحدّ «إغلاق وردية بعجز» في فرع الوردية — العجز المعدود (لا
    الزيادة) يُقاس بالحدّ، وما فوقه للمالك وحده (المالك بلا حدّ). بلا مبلغ = هل يحقّ له أصلاً."""
    shortage = None
    if counted_minor is not None:
        expected = expected_cash_minor(services.cash_totals(shift))
        shortage = max(0, expected - counted_minor)
    return permissions.can(v, "close_short", shortage, branch_id=shift.branch_id)


class ShiftAdminCloseView(APIView):
    """«إقفال إداري بعدّ حاضر» لوردية مفتوحة (مهجورة غالباً): المعدود وسببه باسم من عدّ."""

    permission_classes = (IsAuthenticated,)

    class AdminCloseSerializer(serializers.Serializer[dict[str, Any]]):
        counted_cash_minor = serializers.CharField()
        reason = serializers.CharField(allow_blank=True, required=False, default="")

    @extend_schema(
        request=AdminCloseSerializer, responses={200: None, 400: None, 403: None, 404: None}
    )
    def post(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.AdminCloseSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(tid):
            v = _viewer(request)
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            raw = str(s.validated_data["counted_cash_minor"])
            errs = check_integer("counted_cash_minor", raw, 0, PRICE_MAX_MINOR)
            if errs:
                return Response(Rejected(errs).as_response(), status=status.HTTP_400_BAD_REQUEST)
            counted = int(raw)
            decision = admin_close_decision(v, shift, counted)
            if not decision:
                return Response(decision.denial(v.role_name), status=status.HTTP_403_FORBIDDEN)
            try:
                services.admin_close(
                    shift,
                    actor=v.user,
                    counted_minor=counted,
                    reason=str(s.validated_data.get("reason", "")),
                )
            except services.AdminCloseRejected as e:
                if e.code == "shift_closed":
                    return Response({"detail": "shift_closed"}, status=status.HTTP_400_BAD_REQUEST)
                return Response(
                    Rejected([FieldError(e.field, e.code)]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            row = services.review_row(shift)
            variance = int(row["variance_minor"]) if row["variance_minor"] else None
            settle = settle_decision(v, variance, shift.branch_id).allowed
            return Response({"row": {**row, "can_settle": settle}})


class ShiftReviewView(APIView):
    """SHIFT-05: سجل ورديات الأسبوع بفوارقها والمتأخر عنها. المالك يرى كل الفروع؛ غيره يرى فرعه
    («مدير الفرع يرى فرعه») ولا يُسوّي."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={200: None, 403: None})
    def get(self, request: Request) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        with tenant_context(tid):
            v = _viewer(request)
            scope_branch = None if v.is_owner else (v.branch.id if v.branch else None)
            if not v.is_owner and scope_branch is None:
                return Response({"detail": "branch_required"}, status=status.HTTP_403_FORBIDDEN)
            rows = services.review_rows(scope_branch)
            for r in rows:
                variance = int(r["variance_minor"]) if r["variance_minor"] else None
                r["can_settle"] = settle_decision(v, variance, uuid.UUID(r["branch_id"])).allowed
                if r["state"] == "open":
                    # الإقفال الإداري: هل يحقّ له أصلاً، وحدّه للعجز (None = بلا حدّ) — 0005 §٢٩٣
                    d = permissions.can(v, "close_short", branch_id=uuid.UUID(r["branch_id"]))
                    r["can_admin_close"] = d.allowed
                    r["close_limit_minor"] = (
                        "" if d.limit_minor is None or not d.allowed else str(d.limit_minor)
                    )
            return Response(
                {
                    "scope": "all" if v.is_owner else "branch",
                    "can_settle": _can_settle(v),
                    "role_name": v.role_name,
                    "user_name": v.user.display_name,
                    "branch_name": v.branch.name if v.branch else "",
                    "window_days": services.REVIEW_WINDOW.days,
                    "shifts": rows,
                }
            )


class ShiftReviewActionView(APIView):
    """«إقرار المراجعة»: تسوية بقيمة الفارق باسم المالك وسببه، وتُقرّ معها الحركات المتأخرة."""

    permission_classes = (IsAuthenticated,)

    class ReviewSerializer(serializers.Serializer[dict[str, Any]]):
        reason = serializers.CharField(allow_blank=True, required=False, default="")

    @extend_schema(request=ReviewSerializer, responses={201: None, 400: None, 403: None, 404: None})
    def post(self, request: Request, shift_id: uuid.UUID) -> Response:
        tid = _tenant(request.auth)
        if tid is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = self.ReviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with tenant_context(tid):
            v = _viewer(request)
            if not _can_settle(v):
                return Response({"detail": "owner_required"}, status=status.HTTP_403_FORBIDDEN)
            shift = Shift.objects.filter(id=shift_id).select_related("branch").first()
            if shift is None:
                return Response({"detail": "shift_not_found"}, status=status.HTTP_404_NOT_FOUND)
            decision = settle_decision(v, services._variance(shift), shift.branch_id)
            if not decision:
                return Response(decision.denial(v.role_name), status=status.HTTP_403_FORBIDDEN)
            if shift.state != "closed":
                return Response({"detail": "shift_open"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                adj = services.record_review(
                    shift, approver=v.user, reason=str(s.validated_data.get("reason", ""))
                )
            except services.ReviewRejected:
                return Response(
                    Rejected([FieldError("reason", "required")]).as_response(),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    "id": str(adj.id),
                    "shift_id": str(shift.id),
                    "signed_amount_minor": str(adj.signed_amount_minor),
                    "approved_by_name": adj.approved_by_name,
                    "reason": adj.reason,
                    "late_item_ids": adj.late_item_ids,
                    "occurred_at": services._iso(adj.occurred_at),
                    "row": {**services.review_row(shift), "can_settle": decision.allowed},
                },
                status=201,
            )
