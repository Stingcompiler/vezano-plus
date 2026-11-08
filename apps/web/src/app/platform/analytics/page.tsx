import type { Metadata } from "next";
import { AnalyticsClient } from "@/features/platform/analytics-client";

export const metadata: Metadata = { title: "تحليلات الزوار · الإدارة" };

/** PLT-19 — تحليلات زوار الموقع العام (0005 §٢١٩). */
export default function PlatformAnalyticsPage() {
  return <AnalyticsClient />;
}
