"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "./approvals.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

import type { ApprovalItem } from "./use-approval";

type State = "loading" | "ready" | "empty" | "permission_denied" | "offline" | "server_error";

interface Box {
  readonly can_review: boolean;
  readonly scope: "all" | "branch";
  readonly role_name: string;
  readonly branch_name: string;
  readonly items: readonly ApprovalItem[];
}

/** عنوان الطلب: ماذا طُلب ومن طلبه — المبلغ لاتيني في mono. */
function ItemTitle({ item }: { readonly item: ApprovalItem }) {
  const amount = <span className="sting-mono">{formatMinor(item.amount_minor)}</span>;
  if (item.kind === "withdrawal")
    return (
      <>
        طلب سحب {amount} من {item.requested_by_name}
      </>
    );
  if (item.kind === "discount")
    return (
      <>
        خصم فوق السقف {amount} من {item.requested_by_name}
      </>
    );
  return (
    <>
      تجاوز حدّ ائتمان {item.party_name || ""} بـ{amount} من {item.requested_by_name}
    </>
  );
}

/**
 * APR-01 — «طلبات تنتظرك» (S-04؛ 0005 §٢٩٣): طلبات السحب والخصم فوق السقف وتجاوز حدّ الائتمان التي
 * لم يعتمدها مدير حاضر برمزه. المالك يرى كل الفروع، ومدير الفرع فرعه؛ «وافق» أو «ارفض» بسبب، وحدّ
 * المعتمد من المصفوفة يقرّر من يملك القرار. شاشة الكاشير تعرف النتيجة.
 */
export function ApprovalsClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [box, setBox] = useState<Box | null>(null);
  const [failed, setFailed] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decided, setDecided] = useState<ApprovalItem[]>([]);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    try {
      const { data, response } = await api().GET("/api/approvals");
      const body = data as unknown as Box | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setBox(body);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fapprovals");
      return;
    }
    if (online) void load();
  }, [router, online, load]);

  const decide = async (item: ApprovalItem, decision: "accept" | "reject") => {
    const reason = (reasons[item.id] ?? "").trim();
    if (decision === "reject" && !reason) {
      setMissing(item.id);
      return;
    }
    setMissing(null);
    setBusy(item.id);
    try {
      const { data, response } = await api().POST("/api/approvals/{kind}/{request_id}/decide", {
        params: { path: { kind: item.kind, request_id: item.id } },
        body: { decision, reason },
      });
      const body = data as unknown as { item: ApprovalItem } | undefined;
      if (response.ok && body) setDecided((d) => [body.item, ...d]);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const items = box?.items ?? [];
  const state: State = !online
    ? "offline"
    : failed
      ? "server_error"
      : !box
        ? "loading"
        : !box.can_review
          ? "permission_denied"
          : items.length === 0
            ? "empty"
            : "ready";

  return (
    <Frame title="طلبات تنتظرك" nav={<AppNav currentId="home" />} footer={null}>
      <div className="home" data-screen="APR-01" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">طلبات تنتظرك</h2>
            {box?.scope === "branch" && box.branch_name ? (
              <span className="cat-head__hint">{box.branch_name}</span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {state === "offline" ? (
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">الطلبات والقرار فيها على الخادم. تظهر عند الاتصال.</p>
              </Notice>
            ) : null}
            {state === "server_error" ? (
              <Notice
                kind="error"
                title="تعذّر جلب الطلبات"
                action={<Button onClick={() => void load()}>أعد المحاولة</Button>}
              >
                <p className="acc-lead">لم يتغيّر شيء. أعد المحاولة بعد قليل.</p>
              </Notice>
            ) : null}
            {state === "loading" ? <Status state="loading" label="جارٍ جلب الطلبات" /> : null}
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الطلبات للمالك ومدير الفرع">
                <p className="acc-lead">طلبك يصل إليهما ويظهر قرارهما في شاشتك.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا طلبات تنتظرك">
                <p className="acc-lead">كل طلبات السحب والخصم وتجاوز الحدّ قُرّر فيها.</p>
              </Notice>
            ) : null}

            {decided.map((d) => (
              <p key={d.id} className="acc-choice__note" role="status">
                {d.status === "approved" ? "وافقتَ" : "رفضتَ"} · <ItemTitle item={d} />
              </p>
            ))}

            {state === "ready" ? (
              <ul className="apr-list">
                {items.map((item) => (
                  <li key={`${item.kind}:${item.id}`} className="c-card apr-item">
                    <div className="apr-item__head">
                      <h3 className="apr-item__title">
                        <ItemTitle item={item} />
                      </h3>
                      <span className="acc-choice__note">
                        {item.branch_name} ·{" "}
                        <span className="sting-mono">{hhmm(item.requested_at)}</span>
                      </span>
                    </div>
                    <p className="acc-lead">{item.reason}</p>
                    {item.can_decide ? (
                      <>
                        <TextField
                          label="السبب — إلزامي للرفض"
                          value={reasons[item.id] ?? ""}
                          onChange={(e) => setReasons((r) => ({ ...r, [item.id]: e.target.value }))}
                          error={missing === item.id ? "اكتب سبب الرفض." : undefined}
                        />
                        <div className="apr-item__actions">
                          <Button
                            financial
                            onClick={() => void decide(item, "accept")}
                            loading={busy === item.id}
                          >
                            وافق
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => void decide(item, "reject")}
                            disabledReason={busy === item.id ? "جارٍ الحفظ" : undefined}
                          >
                            ارفض
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="acc-choice__note">فوق حدّك — يقرّره المالك.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
