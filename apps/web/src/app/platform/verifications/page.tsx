import type { Metadata } from "next";
import { VerificationsClient } from "@/features/platform/verifications-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "طلبات التحقُّق · الإدارة" };

/** PLT-06 — طلبات تحقق منشآت السوق. */
export default function PlatformVerificationsPage() {
  return <VerificationsClient />;
}
