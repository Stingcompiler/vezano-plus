import { useLocalSearchParams } from "expo-router";

import { TransferReceiveScreen } from "@/features/inventory/transfer-receive";

export default function TransferReceive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TransferReceiveScreen transferId={id} />;
}
