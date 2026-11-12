import type { Metadata } from "next";
import { FeedbackClient } from "@/features/platform/feedback-client";

export const metadata: Metadata = { title: "الملاحظات · الإدارة" };

/** PLT-21 — ملاحظات التجار: الحالة والردّ (0005 §٢٦٤). */
export default function PlatformFeedbackPage() {
  return <FeedbackClient />;
}
