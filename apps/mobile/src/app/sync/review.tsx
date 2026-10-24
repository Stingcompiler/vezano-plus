import { useLocalSearchParams } from "expo-router";

import { ReviewScreen } from "@/features/ops/review";

/** SYS-03 — `/sync/review` (و`?id=` بند محجوز، و`?op=` عملية). */
export default function Review() {
  const { id, op } = useLocalSearchParams<{ id?: string; op?: string }>();
  return <ReviewScreen selectedId={id ?? ""} operationId={op ?? ""} />;
}
