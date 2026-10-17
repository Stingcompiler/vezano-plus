import type { Metadata } from "next";
import { BackupsClient } from "@/features/platform/backups-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "النسخ · الإدارة" };

/** PLT-10 — نسخ خادمية وتجربة استعادة. */
export default function PlatformBackupsPage() {
  return <BackupsClient />;
}
