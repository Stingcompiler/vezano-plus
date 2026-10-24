import { useLocalSearchParams } from "expo-router";

import { Receipt } from "@/features/org/receipt";

/** ORG-07 (الإيصال) — `/org/subscription/receipts/[id]`. */
export default function OrgReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Receipt id={String(id ?? "")} />;
}
