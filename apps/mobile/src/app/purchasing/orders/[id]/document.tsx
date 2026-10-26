import { useLocalSearchParams } from "expo-router";

import { DocumentScreen } from "@/features/purchasing/document";

export default function OrderDocument() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentScreen orderId={id} />;
}
