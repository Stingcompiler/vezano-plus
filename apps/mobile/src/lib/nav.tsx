import { useColors } from "@sting/ui-native";
import { Redirect, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "@/lib/session";

type Router = ReturnType<typeof useRouter>;
type Href = Parameters<Router["replace"]>[0];

/**
 * انتقال يمحو ما قبله (0005 §٢٠٢): بعد الدخول أو فتح القفل أو الخروج لا رجوع إلى الشاشة السابقة —
 * كان «عودة» من لوحة التحكم يرجع إلى الترحيب والدخول وجلستك صالحة.
 */
export function resetTo(router: Router, href: Href): void {
  // canDismiss يغيب عن بعض بدائل الاختبار القديمة — فحصه أولاً لا يغيّر سلوك التطبيق
  if (router.canDismiss?.()) router.dismissAll();
  router.replace(href);
}

/**
 * شاشات ما قبل الدخول (الترحيب، الدخول، التسجيل): بجلسة صالحة تُعيدك إلى لوحة التحكم، والمقفل إلى
 * القفل — كالويب حين تفتح `/login` وأنت داخل.
 */
export function SignedInRedirect() {
  const { state } = useSession();
  if (state.status === "active") return <Redirect href="/" />;
  if (state.status === "locked") return <Redirect href="/lock" />;
  return null;
}

/**
 * القفل يسري على كل شاشة لا على التبويبات وحدها (مراجعة 2026-11-10 ع-١٣). قفل الخمول يغيّر حالة
 * الجلسة إلى `locked` أينما كان المستخدم، والتحويل إلى شاشة القفل كان في تخطيط التبويبات فقط —
 * فمن قُفل وهو في شاشة من المكدّس (فاتورة، كشف حساب، رابط عميق) بقيت شاشته مفتوحة ببياناتها.
 * هنا في الجذر: غطاء يحجب الشاشة فوراً، ثم انتقال يمحو ما قبله إلى القفل.
 */
export function LockGuard() {
  const { state } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const c = useColors();
  const mustLock = state.status === "locked" && segments[0] !== "lock";
  useEffect(() => {
    if (mustLock) resetTo(router, "/lock");
  }, [mustLock, router]);
  if (!mustLock) return null;
  return (
    <View
      testID="lock-cover"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: c.surfacePage }]}
    />
  );
}
