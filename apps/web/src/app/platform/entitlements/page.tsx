import type { Metadata } from "next";
import { EntitlementsClient } from "@/features/platform/entitlements-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "الاستحقاقات · الإدارة" };

/** PLT-12 — إدارة الاستحقاقات وإعدادات التشغيل. */
export default function PlatformEntitlementsPage() {
  return <EntitlementsClient />;
}
