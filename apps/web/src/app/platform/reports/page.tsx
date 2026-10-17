import type { Metadata } from "next";
import { ReportsClient } from "@/features/platform/reports-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "البلاغات · الإدارة" };

/** PLT-07 — مراجعة بلاغ وتعليق نشر واعتراض. */
export default function PlatformReportsPage() {
  return <ReportsClient />;
}
