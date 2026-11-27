import { tx } from "@sting/texts";
import { AppText } from "@sting/ui-native";
import { useEffect, useState } from "react";

import { useSession } from "@/lib/session";

const K = "shared:features/approvals/use-approval.tsx";

export type ApprovalKind = "withdrawal" | "discount" | "credit";

/** طلب كما يعيده الخادم — نظير `apps/web/src/features/approvals/use-approval.tsx`. */
export interface ApprovalItem {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly status: string;
  readonly amount_minor: string;
  readonly reason: string;
  readonly requested_by_name: string;
  readonly requested_at: string;
  readonly branch_name: string;
  readonly decided_by_user_id: string;
  readonly decided_by_name: string;
  readonly decision_reason: string;
  readonly can_decide?: boolean | undefined;
  readonly party_name?: string | undefined;
}

const POLL_MS = 10_000;

/** شاشة الكاشير تعرف نتيجة طلبها (S-04؛ 0005 §٢٩٣) — تسأل الخادم حتى يُقرَّر فيه. */
export function useApprovalStatus(kind: ApprovalKind, id: string | null): ApprovalItem | null {
  const { api } = useSession();
  const [item, setItem] = useState<ApprovalItem | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const { data, response } = await api.GET("/api/approvals/{kind}/{request_id}", {
          params: { path: { kind, request_id: id } },
        });
        const body = data as unknown as { item: ApprovalItem } | undefined;
        if (!alive) return;
        if (response.ok && body) {
          setItem(body.item);
          if (body.item.status !== "pending") return;
        }
      } catch {
        /* بلا اتصال: نعيد المحاولة */
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, kind, id]);
  return item;
}

export function ApprovalOutcome({ item }: { readonly item: ApprovalItem | null }) {
  if (!item || item.status === "pending")
    return <AppText variant="note">{tx(K, "الطلب في «طلبات تنتظرك». يظهر القرار هنا.")}</AppText>;
  if (item.status === "approved")
    return (
      <AppText variant="note">
        {tx(K, "وافق")} {item.decided_by_name}.
      </AppText>
    );
  return (
    <AppText variant="note">
      {tx(K, "رفض")} {item.decided_by_name}
      {item.decision_reason ? `: ${item.decision_reason}` : ""}
    </AppText>
  );
}
