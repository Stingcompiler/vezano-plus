import type { Metadata } from "next";
import { NoticesClient } from "@/features/platform/notices-client";

export const metadata: Metadata = { title: "الإشعارات · الإدارة" };

/** PLT-15 — إشعارات فريق المنصة (0005 §١٩٠). */
export default function PlatformNoticesPage() {
  return <NoticesClient />;
}
