import { Suspense } from "react";

import { OperatorLoginClient } from "@/features/platform/operator-login-client";

/** PLT-01 — دخول الإدارة ومساحة المشغّل (يعود إلى `?next=` بعد الدخول — 0005 §١٦٨). */
export default function PlatformLoginPage() {
  return (
    <Suspense>
      <OperatorLoginClient />
    </Suspense>
  );
}
