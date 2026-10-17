import type { Metadata } from "next";
import { DisputesOpsClient } from "@/features/platform/disputes-ops-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "الخلافات · الإدارة" };

/** PLT-08 — متابعة الخلافات. */
export default function PlatformDisputesPage() {
  return <DisputesOpsClient />;
}
