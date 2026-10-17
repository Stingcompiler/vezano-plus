import type { Metadata } from "next";
import { OverviewClient } from "@/features/platform/overview-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "النظرة العامة · الإدارة" };

/** PLT-00 — لوحة النظرة العامة للمشغّل (بأمر المالك 2026-09-21). */
export default function PlatformOverviewPage() {
  return <OverviewClient />;
}
