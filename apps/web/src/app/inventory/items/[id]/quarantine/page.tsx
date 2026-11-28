import { QuarantineClient } from "@/features/inventory/quarantine-client";

/** INV-13 — الحجر وأفعاله الثلاثة (I-06، 0005 §٢٩٥؛ بلا إطار مرسوم). */
export default async function QuarantinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuarantineClient itemId={id} />;
}
