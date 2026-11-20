"use client";

import { Button, formatMinor, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { AppNav } from "@/features/home/app-nav";
import type { Card } from "@/features/parties/party-card-client";
import { parseAmount } from "@/features/pos/use-sale";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "success" | "permission_denied";

/**
 * «مقاصة بين الرصيدين» (مراجعة الأطراف 2026-11-20، المرحلة ٣ ب — 0005 §٢٨٥؛ G-12): §٧.١ «المقاصة
 * عملية صريحة معتمدة بحركتين متقابلتين». للطرف ذي الصفتين، للمالك، بسبب، وبما لا يتجاوز أصغر
 * الرصيدين؛ أونلاين لأنها قرار على رصيدين مؤسسيين لا حركة درج.
 */
export function OffsetClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [denied, setDenied] = useState(false);
  const [serverError, setServerError] = useState("");
  const [numbers, setNumbers] = useState<string[]>([]);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}/offset`)}`);
      return;
    }
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}", {
          params: { path: { party_id: partyId } },
        });
        const body = data as unknown as Card | undefined;
        setCard(response.ok && body && body.is_customer && body.is_supplier ? body : null);
      } catch {
        setCard(null);
      }
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (card === null) router.replace(`/parties/${partyId}`);
  }, [card, partyId, router]);

  const due = card ? BigInt(card.balance_minor || "0") : 0n;
  const owed = card ? BigInt(card.supplier_owed_minor || "0") : 0n;
  const max = due < owed ? due : owed;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n) errors["amount"] = "مبلغ موجب";
  else if (amountMinor > max) errors["amount"] = "أكبر من أصغر الرصيدين";
  if (!reason.trim()) errors["reason"] = "يُطلب سبب";
  const invalid = Object.keys(errors).length > 0;
  const take = amountMinor && amountMinor > 0n && amountMinor <= max ? amountMinor : 0n;

  const state: State = denied
    ? "permission_denied"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? "success"
        : (attempted && invalid) || serverError
          ? "validation_error"
          : "ready";

  const commit = async () => {
    if (!card || phase !== "idle") return;
    setAttempted(true);
    setServerError("");
    if (invalid) return;
    setPhase("saving");
    try {
      const { data, error, response } = await api().POST("/api/parties/{party_id}/offset", {
        params: { path: { party_id: partyId } },
        body: { amount_minor: (amountMinor ?? 0n).toString(), reason },
      });
      if (response.status === 403) {
        setDenied(true);
        setPhase("idle");
        return;
      }
      if (!response.ok) {
        const code =
          (error as { errors?: { code?: string }[] } | undefined)?.errors?.[0]?.code ?? "";
        setServerError(code === "exceeds" ? "أكبر من أصغر الرصيدين" : "تعذّر التسجيل");
        setPhase("idle");
        return;
      }
      const body = data as unknown as { numbers: string[] } | undefined;
      setNumbers(body?.numbers ?? []);
      setPhase("saved");
    } catch {
      setServerError("تعذّر التسجيل");
      setPhase("idle");
    }
  };

  return (
    <Frame title="العملاء والذمم" nav={<AppNav currentId="parties" />} footer={null}>
      <div className="pos pos--wide pos--cols" data-screen="PTY-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مقاصة بين الرصيدين{card ? ` — ${card.name}` : ""}</h2>
            <span className="cat-head__hint">
              حركتان متقابلتان بالمبلغ نفسه: سند قبض يخفّض ما عليه، وسند صرف يخفّض ما له علينا. لا
              نقد ولا درج.
            </span>
          </div>
          {card ? (
            <div className="acc-card__body">
              {state === "permission_denied" ? (
                <Notice kind="locked" title="المقاصة للمالك">
                  <p className="acc-lead">قرار على رصيدين معاً، فلا يُتّخذ إلا بصلاحية المالك.</p>
                </Notice>
              ) : null}
              <div className="shift-facts">
                <div>
                  <span className="shift-facts__k">بصفته عميلاً — عليه لنا</span>
                  <span className="shift-facts__v sting-mono">{formatMinor(due.toString())}</span>
                </div>
                <div>
                  <span className="shift-facts__k">بصفته مورداً — له علينا</span>
                  <span className="shift-facts__v sting-mono">{formatMinor(owed.toString())}</span>
                </div>
                <div>
                  <span className="shift-facts__k">الحدّ الأقصى للمقاصة</span>
                  <span className="shift-facts__v sting-mono">{formatMinor(max.toString())}</span>
                </div>
              </div>
              {phase !== "saved" ? (
                <>
                  <TextField
                    label="مبلغ المقاصة"
                    mono
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    error={attempted ? errors["amount"] : undefined}
                    required
                  />
                  <TextField
                    label="السبب"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    error={attempted ? errors["reason"] : undefined}
                    required
                  />
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">عليه بعدها</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor((due - take).toString())}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">له علينا بعدها</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor((owed - take).toString())}
                      </span>
                    </div>
                  </div>
                  {serverError ? (
                    <Notice kind="error" title={serverError}>
                      <p className="acc-lead">لم تُسجَّل أي حركة.</p>
                    </Notice>
                  ) : null}
                  <div className="cat-form__actions">
                    <Button financial onClick={() => void commit()} loading={phase === "saving"}>
                      سجّل المقاصة
                    </Button>
                    <Button variant="quiet" onClick={() => router.push(`/parties/${partyId}`)}>
                      بطاقة الطرف
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Notice kind="success" title="سُجّلت المقاصة">
                    <p className="acc-lead">
                      {numbers.map((n, i) => (
                        <span key={n}>
                          {i > 0 ? " · " : null}
                          <span className="sting-mono">{n}</span>
                        </span>
                      ))}
                    </p>
                    <p className="acc-choice__note">
                      <strong>لا تُصحَّح إحداهما وحدها</strong> · الحركتان قرار واحد مسجَّل باسمك
                      وسببه.
                    </p>
                  </Notice>
                  <div className="cat-form__actions">
                    <Button onClick={() => router.push(`/parties/${partyId}/statement`)}>
                      كشف حساب العميل
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/parties/${partyId}/supplier-statement`)}
                    >
                      كشف حساب المورد
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
