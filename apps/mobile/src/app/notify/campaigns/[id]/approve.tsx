import { useLocalSearchParams } from "expo-router";

import { CampaignApproveScreen } from "@/features/ops/notify/campaign-approve";

/** NOT-05 — `/notify/campaigns/:id/approve`. */
export default function CampaignApprove() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CampaignApproveScreen id={id} />;
}
