import type { Metadata } from "next";
import { DemoRequestsClient } from "@/features/platform/demo-requests-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "طلبات الجولة · الإدارة" };

/** PLT-14 — طلبات الجولة (بأمر المالك 2026-09-21). */
export default function PlatformDemoRequestsPage() {
  return <DemoRequestsClient />;
}
