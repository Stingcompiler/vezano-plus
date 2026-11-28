import { useLocalSearchParams } from "expo-router";

import { ReceiptScreen } from "@/features/inventory/receipts";

export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReceiptScreen receiptId={id} />;
}
