import { dayMonth, formatMinor, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { ALIGN_LEFT, AppText, Button, Screen, SPACE, StateView } from "@sting/ui-native";
import * as Print from "expo-print";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { KV, Lead, Mono, N, Note } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-07";
type State = "loading" | "ready" | "permission_denied" | "empty";

export interface ReceiptData {
  id: string;
  number: string;
  tenant_name: string;
  plan_code: string;
  plan_name: string;
  cycle: string;
  cycle_label: string;
  description?: string;
  amount_minor: string;
  currency: string;
  reference: string;
  period_from: string;
  period_to: string;
  issued_at: string;
  issued_by_name: string;
  proof_id: string;
  issuer: { name: string; legal: string; contact: string };
  note: string;
}

function Day({ iso }: { iso: string }) {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  return (
    <>
      <N>{day}</N> {month} <N>{iso.slice(0, 4)}</N>
    </>
  );
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** صفحة الإيصال للطباعة/PDF من نظام التشغيل (نظير `window.print()` في الويب). */
export function receiptHtml(r: ReceiptData): string {
  const row = (k: string, v: string) =>
    `<tr><th style="text-align:right;padding:4px 8px">${esc(k)}</th><td style="padding:4px 8px">${esc(v)}</td></tr>`;
  return `<html dir="rtl"><body style="font-family:sans-serif;padding:24px">
<h2>${esc(tx(T, "إيصال اشتراك"))}</h2><p dir="ltr">${esc(r.number)}</p>
<p>${esc(r.issuer.legal)} · ${esc(r.issuer.contact)}</p>
<table>${row(tx(T, "المنشأة"), r.tenant_name)}${row(tx(T, "الباقة"), `${r.plan_name} · ${r.cycle_label}`)}
${row(tx(T, "الفترة"), `${r.period_from.slice(0, 10)} → ${r.period_to.slice(0, 10)}`)}
${row(tx(T, "رقم التحويل"), r.reference)}${row(tx(T, "اعتمده"), r.issued_by_name)}</table>
<h3>${esc(tx(T, "المبلغ المستلم"))}: <span dir="ltr">${esc(formatMinor(r.amount_minor))} ${esc(r.currency)}</span></h3>
<p>${esc(r.note)}</p></body></html>`;
}

/**
 * ORG-07 (الإيصال) — إيصال اشتراك مرقَّم (نظير `receipt-client.tsx`): للمالك وحده؛ 404 = لا إيصال بهذا
 * المعرّف. «اطبع / احفظ PDF» يفتح طباعة النظام (AirPrint أو خدمة الطباعة) بدل `window.print()`.
 */
export function Receipt({ id }: { id: string }) {
  const router = useRouter();
  const { api } = useSession();
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const f = fetched<{ receipt: ReceiptData }>(
      await api.GET("/api/org/subscription/receipts/{receipt_id}", {
        params: { path: { receipt_id: id } },
      }),
    );
    if (f.status === 404) setMissing(true);
    return f;
  }, [api, id]);
  const { data, denied, failed, reload } = useReport<{ receipt: ReceiptData }>({ load });
  const r = data?.receipt ?? null;

  const state: State = denied ? "permission_denied" : missing ? "empty" : r ? "ready" : "loading";
  const toLog = () => router.push("/org/subscription/renew");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "إيصال الاشتراك")}
      onRefresh={() => void reload()}
    >
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب الإيصال")}>
          <Lead>{tx(T, "الإيصال يُقرأ من الخادم بمرقّمه.")}</Lead>
          {failed ? (
            <Button
              variant="secondary"
              label={tx("ORG-06", "أعد المحاولة")}
              onPress={() => void reload()}
            />
          ) : null}
        </StateView>
      ) : null}
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "للمالك فقط")}>
          <Lead>{tx(T, "إيصالات الاشتراك يراها مالك المنشأة.")}</Lead>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا إيصال بهذا المعرّف")}>
          <Lead>{tx(T, "قد يكون الرابط قديماً — افتح سجل الاشتراك.")}</Lead>
          <Button label={tx(T, "سجل الاشتراك")} onPress={toLog} />
        </StateView>
      ) : null}

      {r ? (
        <>
          <Button
            label={tx(T, "اطبع / احفظ PDF")}
            onPress={() => void Print.printAsync({ html: receiptHtml(r) }).catch(() => undefined)}
          />
          <Button variant="quiet" label={tx(T, "سجل الاشتراك")} onPress={toLog} />
          <View style={{ height: SPACE["3"] }} />
          <AppText variant="title">{tx(T, "إيصال اشتراك")}</AppText>
          <AppText variant="moneyLarge" style={{ textAlign: ALIGN_LEFT }}>
            <N>{r.number}</N>
          </AppText>
          <Note>
            {tx(T, "صدر")} <Day iso={r.issued_at} /> <N>{hhmm(r.issued_at)}</N>
          </Note>
          <Note>
            {r.issuer.legal} · <Mono text={r.issuer.contact} />
          </Note>
          <View style={{ height: SPACE["3"] }} />
          <KV label={tx(T, "المنشأة")}>{r.tenant_name}</KV>
          <KV label={tx(T, "الباقة")}>
            {r.plan_name} · {r.cycle_label}
            {r.description ? (
              <>
                {" "}
                — <Mono text={r.description} />
              </>
            ) : null}
          </KV>
          <KV label={tx(T, "الفترة")}>
            {tx(T, "من")} <Day iso={r.period_from} /> {tx(T, "إلى")} <Day iso={r.period_to} />
          </KV>
          <KV label={tx(T, "رقم التحويل")}>
            <N>{r.reference}</N>
          </KV>
          <KV label={tx(T, "اعتمده")}>{r.issued_by_name}</KV>
          <View style={{ height: SPACE["3"] }} />
          <AppText variant="bodyStrong">{tx(T, "المبلغ المستلم")}</AppText>
          <AppText variant="moneyLarge" style={{ textAlign: ALIGN_LEFT }}>
            <N>{`${formatMinor(r.amount_minor)} ${r.currency}`}</N>
          </AppText>
          <Note>{r.note}</Note>
        </>
      ) : null}
    </Screen>
  );
}
