import { useLocalSearchParams } from "expo-router";

import { ReturnScreen } from "@/features/purchasing/return";

export default function PurchaseReturn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReturnScreen returnId={id} />;
}
