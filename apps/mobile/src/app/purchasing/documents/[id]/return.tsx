import { useLocalSearchParams } from "expo-router";

import { ReturnScreen } from "@/features/purchasing/return";

export default function PurchaseReturnNew() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  // «أرجع للمورد» من الحجر (I-06، 0005 §٢٩٥)
  return <ReturnScreen documentId={id} fromQuarantine={from === "quarantine"} />;
}
