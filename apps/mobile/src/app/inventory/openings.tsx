import { useLocalSearchParams } from "expo-router";

import { OpeningsScreen } from "@/features/inventory/openings";

export default function Openings() {
  const { item } = useLocalSearchParams<{ item?: string }>();
  return <OpeningsScreen preselect={item} />;
}
