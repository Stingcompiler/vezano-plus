import { useLocalSearchParams } from "expo-router";

import { DamageScreen } from "@/features/inventory/damage";

export default function Damage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DamageScreen itemId={id} />;
}
