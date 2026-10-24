import { useLocalSearchParams } from "expo-router";

import { DocumentScreen } from "@/features/purchasing/document";

export default function PurchaseDocument() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentScreen documentId={id} />;
}
