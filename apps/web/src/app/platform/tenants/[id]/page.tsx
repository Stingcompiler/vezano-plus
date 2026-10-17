import type { Metadata } from "next";

import { TenantDetailClient } from "@/features/platform/tenant-detail-client";

export const metadata: Metadata = { title: "تفاصيل مستأجر · الإدارة" };

/** PLT-02/detail — تفاصيل الاستحقاق. */
export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantDetailClient id={id} />;
}
