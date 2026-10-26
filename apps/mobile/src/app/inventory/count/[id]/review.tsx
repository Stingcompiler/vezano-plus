import { useLocalSearchParams } from "expo-router";

import { ReviewScreen } from "@/features/inventory/review";

export default function CountReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReviewScreen sessionId={id} />;
}
