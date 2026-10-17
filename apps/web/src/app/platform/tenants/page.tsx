import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantsClient } from "@/features/platform/tenants-client";

// عنوان تبويب لكل قسم — يُميَّز في التبويبات وسجل المتصفح (فحص 2026-10-17 VP13)
export const metadata: Metadata = { title: "المستأجرون · الإدارة" };

/** PLT-02 — المستأجرون. */
export default function PlatformTenantsPage() {
  return (
    <Suspense fallback={null}>
      <TenantsClient />
    </Suspense>
  );
}
