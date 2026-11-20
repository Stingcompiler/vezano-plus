import { OffsetClient } from "@/features/parties/offset-client";

/** «مقاصة بين الرصيدين» (مراجعة الأطراف، المرحلة ٣ ب — 0005 §٢٨٥). */
export default async function OffsetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OffsetClient partyId={id} />;
}
