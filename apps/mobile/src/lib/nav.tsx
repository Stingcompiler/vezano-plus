import { Redirect, type useRouter } from "expo-router";

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
