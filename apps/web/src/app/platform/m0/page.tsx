import type { Metadata } from "next";
import { M0Client } from "@/features/platform/m0-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "لوحة الاكتساب · الإدارة" };

/** PLT-11 — لوحة الاكتساب M0. */
export default function PlatformM0Page() {
  return <M0Client />;
}
