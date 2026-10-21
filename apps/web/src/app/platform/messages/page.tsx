import type { Metadata } from "next";
import { MessagesClient } from "@/features/platform/messages-client";

export const metadata: Metadata = { title: "الرسائل · الإدارة" };

/** PLT-16 — رسائل الدعم الواردة من المنشآت (0005 §١٩٠). */
export default function PlatformMessagesPage() {
  return <MessagesClient />;
}
