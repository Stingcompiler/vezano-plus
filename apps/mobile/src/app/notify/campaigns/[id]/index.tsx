import { useLocalSearchParams } from "expo-router";

import { CampaignResultsScreen } from "@/features/ops/notify/campaign-results";

/** NOT-06 — `/notify/campaigns/:id`. */
export default function CampaignResults() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CampaignResultsScreen id={id} />;
}
