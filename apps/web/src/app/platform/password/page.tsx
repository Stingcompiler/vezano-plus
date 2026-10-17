import type { Metadata } from "next";
import { OperatorPasswordClient } from "@/features/platform/password-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "تغيير كلمة المرور · الإدارة" };

/** تغيير كلمة مرور المشغّل — إلزامي بعد كلمة مؤقتة وضعها مشغّل آخر (0005 §١٣٨). */
export default function OperatorPasswordPage() {
  return <OperatorPasswordClient />;
}
