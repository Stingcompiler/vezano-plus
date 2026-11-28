import { ReceiptClient } from "@/features/inventory/receipts-client";

/** INV-11 — استلام مسجَّل و«حوّل إلى مستند شراء» (I-02، 0005 §٢٩٥؛ بلا إطار مرسوم). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptClient receiptId={id} />;
}
