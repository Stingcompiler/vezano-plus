import type { Metadata } from "next";
import { AnnouncementsClient } from "@/features/platform/announcements-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "الإعلانات · الإدارة" };

/** PLT-04 — إعلانات المنصة وصيانة. */
export default function PlatformAnnouncementsPage() {
  return <AnnouncementsClient />;
}
