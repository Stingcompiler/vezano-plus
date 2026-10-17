import type { Metadata } from "next";
import { OperatorsClient } from "@/features/platform/operators-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "المشغّلون · الإدارة" };

/** PLT-15 — حسابات المشغّلين (بأمر المالك 2026-09-22). */
export default function PlatformOperatorsPage() {
  return <OperatorsClient />;
}
