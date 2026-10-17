import type { Metadata } from "next";
import { HealthClient } from "@/features/platform/health-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "الصحة · الإدارة" };

/** PLT-09 — صحة المزامنة والخادم. */
export default function PlatformHealthPage() {
  return <HealthClient />;
}
