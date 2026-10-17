import type { Metadata } from "next";
import { PlansCatalogClient } from "@/features/platform/plans-catalog-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "الباقات والتسعير · الإدارة" };

/** PLT-16 — الباقات والتسعير (بأمر المالك 2026-09-22). */
export default function PlatformPlansPage() {
  return <PlansCatalogClient />;
}
