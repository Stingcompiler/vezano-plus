import { useLocalSearchParams } from "expo-router";

import { TransfersScreen } from "@/features/inventory/transfers";

export default function Transfers() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <TransfersScreen selectedId={id ?? ""} />;
}
