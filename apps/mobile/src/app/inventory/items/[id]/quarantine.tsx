import { useLocalSearchParams } from "expo-router";

import { QuarantineScreen } from "@/features/inventory/quarantine";

export default function Quarantine() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <QuarantineScreen itemId={id} />;
}
