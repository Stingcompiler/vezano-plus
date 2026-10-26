import { useLocalSearchParams } from "expo-router";

import { OrdersScreen } from "@/features/purchasing/orders";

export default function PurchaseOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrdersScreen selectedId={id} />;
}
