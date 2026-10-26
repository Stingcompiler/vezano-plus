import { useLocalSearchParams } from "expo-router";

import { ReturnScreen } from "@/features/purchasing/return";

export default function PurchaseReturnNew() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReturnScreen documentId={id} />;
}
