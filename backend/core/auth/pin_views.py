"""رمز PIN للمستخدم نفسه (0005 §١٧٣).

كان القفل المحلي (ACC-07) بلا طريق لضبط PIN خارج البذر — فكل حساب حقيقي يرى «لا رمز PIN محفوظ على
هذا الجهاز». المستخدم يضبط رمزه بنفسه بعد تأكيد كلمة مروره؛ لا يُحفظ نصياً (متحقق PBKDF2 كالبذر)،
والأجهزة تنزّله مع متحققات فرعها في أول اتصال (§٩.٣).
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.hashers import check_password
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth.pin import InvalidPin, set_user_pin
from core.auth.tokens import AuthContext
from core.models import Account
from core.tenancy import platform_context, tenant_context

#: طول PIN الحالي — كما تعلنه الأجهزة (`pin_length` في متحققات الجهاز)
PIN_LENGTH = 6


class OwnPinSerializer(serializers.Serializer[dict[str, Any]]):
    pin = serializers.CharField(max_length=12)
    password = serializers.CharField(max_length=200)


class OwnPinView(APIView):
    """`POST {pin, password}` → 204. كلمة المرور الخاطئة 403 `password_invalid`، والرمز غير الصالح
    400 `pin_invalid` (أرقام بطول `PIN_LENGTH`)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=OwnPinSerializer, responses={204: None, 400: None, 403: None})
    def post(self, request: Request) -> Response:
        auth = request.auth
        if not isinstance(auth, AuthContext) or auth.tenant_id is None:
            return Response({"detail": "tenant_session_required"}, status=status.HTTP_403_FORBIDDEN)
        s = OwnPinSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        with platform_context():
            account = (
                Account.unscoped.filter(id=auth.user.account_id).first()
                if auth.user.account_id
                else None
            )
        if account is None or not check_password(s.validated_data["password"], account.password):
            return Response({"detail": "password_invalid"}, status=status.HTTP_403_FORBIDDEN)
        try:
            with tenant_context(auth.tenant_id):
                set_user_pin(auth.user, s.validated_data["pin"], required_length=PIN_LENGTH)
        except InvalidPin:
            return Response(
                {"detail": "pin_invalid", "extra": {"length": PIN_LENGTH}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
