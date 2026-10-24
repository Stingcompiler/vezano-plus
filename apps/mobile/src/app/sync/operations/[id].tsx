import { useLocalSearchParams } from "expo-router";

import { OperationScreen } from "@/features/ops/operation";

/** SYS-02 — `/sync/operations/:id`. */
export default function Operation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OperationScreen operationId={id} />;
}
