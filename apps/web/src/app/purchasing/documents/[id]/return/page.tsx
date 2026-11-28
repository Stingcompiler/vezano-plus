import { ReturnClient } from "@/features/purchasing/return-client";

/** PUR-04 — مرتجع المشتريات على مستند (32-D24 ready/validation_error/partial/success). */
export default async function PurchaseReturnNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  // «أرجع للمورد» من الحجر (I-06، 0005 §٢٩٥)
  return <ReturnClient documentId={id} fromQuarantine={from === "quarantine"} />;
}
