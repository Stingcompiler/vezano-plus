import type { Metadata } from "next";
import { Suspense } from "react";

import { OperatorLoginClient } from "@/features/platform/operator-login-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "دخول الإدارة · الإدارة" };

/** PLT-01 — دخول الإدارة ومساحة المشغّل (يعود إلى `?next=` بعد الدخول — 0005 §١٦٨). */
export default function PlatformLoginPage() {
  return (
    <Suspense>
      <OperatorLoginClient />
    </Suspense>
  );
}
