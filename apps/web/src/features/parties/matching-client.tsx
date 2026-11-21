"use client";

import { Button, formatMinor, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State =
  | "ready"
  | "loading"
  | "empty"
  | "offline"
  | "server_error"
  | "saving"
  | "validation_error"
  | "permission_denied";

export interface Transfer {
  id: string;
  receipt_number: string;
  kind: string;
  party_id: string;
  party_name: string;
  amount_minor: string;
  reference: string;
  business_date: string;
  occurred_at: string;
  user_name: string;
  branch_name: string;
}

interface Payload {
  rows: Transfer[];
  totals: { count: number; receipts_minor: string };
  computed_at: string;
}

/** «لم يصل» يُعكس بمستند تصحيح (PTY-09) بسبب يكتبه المالك — يقترح النص ويُعدَّل. */
const NOT_ARRIVED = "لم يصل التحويل إلى الحساب";

/**
 * PTY-10 — «تحويلات تنتظر المطابقة» (مراجعة الأطراف 2026-11-20، المرحلة ٤ — 0005 §٢٨٦؛ G-04): كل
 * سند قبض أو ردّ بتحويل بنكي لم يُطابَق. «مطابق» يُسقط الدين (ACC-133)، و«لم يصل» يعكس السند بسبب
 * فيبقى الدين ويخرج من القائمة. للمالك؛ أونلاين لأن القرار على الخادم.
 */
export function MatchingClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");
  const [reason, setReason] = useState(NOT_ARRIVED);
  const [attempted, setAttempted] = useState(false);
  const [done, setDone] = useState<{ number: string; matched: boolean } | null>(null);
  const [actionError, setActionError] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data: d, response } = await api().GET("/api/parties/receipts/unmatched");
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      const body = d as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fparties%2Freceipts%2Fmatching");
      return;
    }
    if (online) void load();
  }, [load, online, router]);

  const match = async (t: Transfer) => {
    if (busy) return;
    setBusy(t.id);
    setActionError("");
    try {
      const { response } = await api().POST("/api/parties/receipts/{receipt_id}/match", {
        params: { path: { receipt_id: t.id } },
      });
      if (response.status === 403) setDenied(true);
      else if (!response.ok) setActionError("تعذّر التسجيل");
      else setDone({ number: t.receipt_number, matched: true });
      await load();
    } catch {
      setActionError("تعذّر التسجيل");
    } finally {
      setBusy("");
    }
  };

  const notArrived = async (t: Transfer) => {
    if (busy) return;
    setAttempted(true);
    if (!reason.trim()) return;
    setBusy(t.id);
    setActionError("");
    try {
      const { response } = await api().POST("/api/parties/receipts/{receipt_id}/correct", {
        params: { path: { receipt_id: t.id } },
        body: { kind: "reverse", reason, new_method: "", new_reference: "", new_amount_minor: "" },
      });
      if (response.status === 403) setDenied(true);
      else if (!response.ok) setActionError("تعذّر التسجيل");
      else {
        setDone({ number: t.receipt_number, matched: false });
        setOpen("");
        setAttempted(false);
        setReason(NOT_ARRIVED);
      }
      await load();
    } catch {
      setActionError("تعذّر التسجيل");
    } finally {
      setBusy("");
    }
  };

  const state: State = denied
    ? "permission_denied"
    : !online
      ? "offline"
      : busy
        ? "saving"
        : failed && !data
          ? "server_error"
          : !data
            ? "loading"
            : attempted && open && !reason.trim()
              ? "validation_error"
              : data.rows.length === 0
                ? "empty"
                : "ready";
  const now = new Date();

  return (
    <Frame title="العملاء والذمم" nav={<AppNav currentId="parties" />} footer={null}>
      <div className="pos pos--wide" data-screen="PTY-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تحويلات تنتظر المطابقة</h2>
            <span className="cat-head__hint">
              طابِق كل تحويل مع كشف البنك. دين العميل لا ينقص قبل «مطابق».
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="المطابقة للمالك">
                <p className="acc-lead">تأكيد وصول المال من كشف البنك قرار المالك.</p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Notice kind="warning" title="المطابقة تحتاج اتصالاً">
                <p className="acc-lead">القائمة والقرار على الخادم. لا شيء يضيع من التحويلات.</p>
              </Notice>
            ) : null}
            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر التحميل">
                <div className="cat-form__actions">
                  <Button onClick={() => void load()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="جارٍ التحميل">
                <p className="acc-lead">التحويلات المسجَّلة التي لم تُطابَق بعد.</p>
              </Notice>
            ) : null}
            {done ? (
              <Notice kind="success" title={done.matched ? "طوبق — نقص الدين" : "سُجّل أنه لم يصل"}>
                <p className="acc-lead">
                  <span className="sting-mono">{done.number}</span>
                  {done.matched ? null : " · عُكس السند ويبقى الدين كما هو."}
                </p>
              </Notice>
            ) : null}
            {actionError ? (
              <Notice kind="error" title={actionError}>
                <p className="acc-lead">لم يتغيّر شيء.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا تحويلات تنتظر المطابقة">
                <p className="acc-lead">كل تحويل مسجَّل طوبق أو عُكس.</p>
              </Notice>
            ) : null}

            {data && data.rows.length > 0 && state !== "permission_denied" ? (
              <>
                <p className="acc-choice__note">
                  <span className="sting-mono">{data.totals.count}</span> سنداً · سداد ينتظر{" "}
                  <span className="sting-mono">{formatMinor(data.totals.receipts_minor)}</span>
                </p>
                <ul className="pty-match c-stagger">
                  {data.rows.map((t, i) => (
                    <li
                      key={t.id}
                      className="c-card pty-match__item"
                      style={{ "--i": i } as CSSProperties}
                    >
                      <div className="pty-match__head">
                        <button
                          type="button"
                          className="pty-match__party"
                          onClick={() => router.push(`/parties/${t.party_id}/statement`)}
                        >
                          {t.party_name}
                        </button>
                        <span className="pty-match__amount sting-mono">
                          {formatMinor(t.amount_minor)}
                        </span>
                      </div>
                      <p className="acc-choice__note">
                        {t.kind === "receipt" ? "سداد بتحويل" : "ردّ مبلغ بتحويل"} · المرجع{" "}
                        <span className="sting-mono">{t.reference}</span> · السند{" "}
                        <span className="sting-mono">{t.receipt_number}</span>
                      </p>
                      <p className="acc-choice__note">
                        <DayLabel iso={t.occurred_at} now={now} />{" "}
                        <span className="sting-mono">{hhmm(t.occurred_at)}</span>
                        {t.user_name ? ` · سجّله ${t.user_name}` : ""}
                        {t.branch_name ? ` · ${t.branch_name}` : ""}
                      </p>
                      {open === t.id ? (
                        <div className="pty-match__confirm">
                          <TextField
                            label="السبب"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            error={attempted && !reason.trim() ? "يُطلب سبب" : undefined}
                            required
                          />
                          <p className="acc-choice__note">
                            يُعكس السند بمستند تصحيح ويبقى الدين كما هو.
                          </p>
                          <div className="cat-form__actions">
                            <Button
                              variant="secondary"
                              loading={busy === t.id}
                              onClick={() => void notArrived(t)}
                            >
                              سجّل أنه لم يصل
                            </Button>
                            <Button
                              variant="quiet"
                              onClick={() => {
                                setOpen("");
                                setAttempted(false);
                              }}
                            >
                              تراجع
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="cat-form__actions">
                          <Button financial loading={busy === t.id} onClick={() => void match(t)}>
                            مطابق
                          </Button>
                          <Button
                            variant="quiet"
                            onClick={() => {
                              setOpen(t.id);
                              setReason(NOT_ARRIVED);
                              setAttempted(false);
                            }}
                          >
                            لم يصل
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
