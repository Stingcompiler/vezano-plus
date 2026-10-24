import { useLocalSearchParams } from "expo-router";

import { Revoke } from "@/features/org/revoke";

/** ORG-05 — `/org/users/[id]/revoke`. */
export default function OrgRevoke() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Revoke userId={String(id ?? "")} />;
}
