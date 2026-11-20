import { SupplierStatementClient } from "@/features/parties/supplier-statement-client";

/** «كشف حساب المورد» (PTY-05 بجهة المورد؛ مراجعة الأطراف، المرحلة ٣ — 0005 §٢٨٤). */
export default async function SupplierStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SupplierStatementClient partyId={id} />;
}
