"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";

export type ApprovalKind = "withdrawal" | "discount" | "credit";

/** طلب كما يعيده الخادم — `GET /api/approvals` و`GET /api/approvals/{kind}/{id}`. */
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
  readonly decided_at: string;
  readonly decision_reason: string;
  readonly approved_via: string;
  readonly can_decide?: boolean | undefined;
  readonly mode?: string | undefined;
  readonly value?: string | undefined;
  readonly party_name?: string | undefined;
  readonly credit_limit_minor?: string | undefined;
}

/** كل كم تسأل شاشة الكاشير عن طلبها حتى يُقرَّر فيه. */
const POLL_MS = 10_000;

/**
 * شاشة الكاشير تعرف نتيجة طلبها (S-04؛ 0005 §٢٩٣): تسأل الخادم عند الاتصال حتى يُقرَّر فيه ثم تتوقف.
 * بلا اتصال يبقى «بانتظار القرار».
 */
export function useApprovalStatus(kind: ApprovalKind, id: string | null): ApprovalItem | null {
  const online = useOnline();
  const [item, setItem] = useState<ApprovalItem | null>(null);
  useEffect(() => {
    if (!id || !online) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const { data, response } = await api().GET("/api/approvals/{kind}/{request_id}", {
          params: { path: { kind, request_id: id } },
        });
        const body = data as unknown as { item: ApprovalItem } | undefined;
        if (!alive) return;
        if (response.ok && body) {
          setItem(body.item);
          if (body.item.status !== "pending") return;
        }
      } catch {
        /* بلا اتصال فعلي: نعيد المحاولة */
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [kind, id, online]);
  return item;
}

/** «وافق {الاسم}.» / «رفض {الاسم}: {السبب}» / «بانتظار القرار» — حالة الطلب كما تعرضها شاشة الكاشير. */
export function ApprovalOutcome({ item }: { readonly item: ApprovalItem | null }) {
  if (!item || item.status === "pending")
    return (
      <p className="acc-lead" role="status">
        الطلب في «طلبات تنتظرك». يظهر القرار هنا.
      </p>
    );
  if (item.status === "approved")
    return (
      <p className="acc-lead" role="status">
        وافق {item.decided_by_name}.
      </p>
    );
  return (
    <p className="acc-lead" role="status">
      رفض {item.decided_by_name}
      {item.decision_reason ? <>: {item.decision_reason}</> : null}
    </p>
  );
}
