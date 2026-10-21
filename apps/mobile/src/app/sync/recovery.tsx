import { useLocalSearchParams } from "expo-router";

import { RecoveryScreen } from "@/features/ops/recovery";

/** SYS-07 — `/sync/recovery` (و`?id=` جهاز). */
export default function Recovery() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <RecoveryScreen selectedId={id ?? ""} />;
}
