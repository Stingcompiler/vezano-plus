import { useLocalSearchParams } from "expo-router";

import { InboxScreen } from "@/features/ops/notify/inbox";

/** NOT-01 (تفاصيل) — `/notify/inbox/:id`. */
export default function InboxDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InboxScreen id={id} />;
}
