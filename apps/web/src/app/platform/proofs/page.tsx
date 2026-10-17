import type { Metadata } from "next";
import { ProofsClient } from "@/features/platform/proofs-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "مراجعة الدفع · الإدارة" };

/** PLT-03 — مراجعة دفع اشتراك. */
export default function PlatformProofsPage() {
  return <ProofsClient />;
}
