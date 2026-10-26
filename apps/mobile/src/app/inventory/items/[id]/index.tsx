import { useLocalSearchParams } from "expo-router";

import { MovementsScreen } from "@/features/inventory/movements";

export default function ItemMovements() {
  const { id, branch, range } = useLocalSearchParams<{
    id: string;
    branch?: string;
    range?: string;
  }>();
  return (
    <MovementsScreen itemId={id} branchId={branch ?? ""} range={range === "all" ? "all" : "30"} />
  );
}
