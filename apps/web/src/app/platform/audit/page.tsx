import type { Metadata } from "next";
import { AuditClient } from "@/features/platform/audit-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "سجل التدقيق · الإدارة" };

/** فحص 2026-10-17 VP13 — سجل تدقيق المشغّلين. */
export default function PlatformAuditPage() {
  return <AuditClient />;
}
