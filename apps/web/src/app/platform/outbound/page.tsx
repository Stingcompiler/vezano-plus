import type { Metadata } from "next";
import { OutboundClient } from "@/features/platform/outbound-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "الإرسال · الإدارة" };

/** PLT-05 — تشغيل الإرسال والإخفاقات. */
export default function PlatformOutboundPage() {
  return <OutboundClient />;
}
