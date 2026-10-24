import { useLocalSearchParams } from "expo-router";

import { TransferNewScreen } from "@/features/inventory/transfer-new";

export default function TransferNew() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <TransferNewScreen viewId={id ?? ""} />;
}
