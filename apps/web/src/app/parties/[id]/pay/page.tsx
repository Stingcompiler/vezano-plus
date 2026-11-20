import { SupplierPaymentClient } from "@/features/parties/supplier-payment-client";

/** «دفع لمورد» — سند صرف (PTY-06 بجهة المورد؛ مراجعة الأطراف، المرحلة ٣ — 0005 §٢٨٤). */
export default async function SupplierPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierPaymentClient partyId={id} />;
}
