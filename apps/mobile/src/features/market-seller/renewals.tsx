import { formatMinor, hhmm } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView } from "@sting/ui-native";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { Lead, M, Note, Row, StateWord } from "@/components/market-seller/parts";
import { dm, netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import type { Offer } from "@/features/market-seller/offers";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "MP-13";

interface RenewOffer extends Offer {
  number: number;
  confirmed_at: string;
  days_left: number | null;
}
interface Rule {
  action: string;
  effect: string;
  verdict: string;
}
interface Payload {
  offers: RenewOffer[];
  can_renew: boolean;
  renew_hours: number;
  rules: Rule[];
}

const verdictState = (v: string): StateCode =>
  v === "يجدّد" ? "success" : v === "يُلغي التأكيد" ? "validation_error" : "stale";

/** MP-13 — تجديد تأكيد سعر وتوفر (43-D35 ready/saving/permission_denied/success · 10-D6 expired). */
export default function RenewalsScreen() {
  const { api } = useSession();
  const { o: focusParam = "" } = useLocalSearchParams<{ o?: string }>();
  const [focus, setFocus] = useState(focusParam);
  const srv = useServerGet<Payload>("cache.market.renewals", () =>
    safeGet(() => api.GET("/api/market/renewals")),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [renewed, setRenewed] = useState<RenewOffer | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  const renew = async (o: RenewOffer) => {
    if (saving) return;
    setSaving(o.id);
    setOfflineTry(false);
    try {
      const r = await send<{ offer?: Offer }>(() =>
        api.POST("/api/market/offers/{offer_id}/renew", {
          params: { path: { offer_id: o.id } },
          body: {} as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.offer) {
        setRenewed({ ...o, ...r.body.offer });
        await srv.reload();
      }
    } finally {
      setSaving(null);
    }
  };

  const focused = data?.offers.find((o) => o.id === focus) ?? null;
  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode = renewed
    ? "success"
    : saving
      ? "saving"
      : data && !data.can_renew
        ? "permission_denied"
        : focused && focused.status === "expired"
          ? "expired"
          : (net ?? "ready");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "تجديد التأكيد والمتابعة — فعلان لا يُنجزان تلقائياً")}
      onRefresh={() => void srv.reload()}
    >
      <Lead>
        {tx(
          T,
          "ما ينتهي وما انتهى: قائمة عروضك بصلاحياتها، والأقرب انتهاءً أولاً — والتجديد فعل صريح لكل عرض: «ما زال السعر قائماً؟».",
        )}
      </Lead>

      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "success" && renewed ? (
        <StateView state="success" title={tx(T, "جُدِّد التأكيد")}>
          <AppText variant="secondary">
            {tx(T, "صلاحية جديدة بتاريخها، والعرض يعود إلى نتائج البحث إن كان سقط.")}{" "}
            {renewed.public_name} {tx(T, "— سارٍ حتى")}{" "}
            <M>{renewed.valid_until ? dm(renewed.valid_until) : ""}</M>.
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الماضي ثابت")}</AppText>{" "}
            {tx(
              T,
              "· التجديد بسعرٍ جديد لا يمسّ طلباً قُبل على السعر القديم — نسخة الاتفاق محفوظة هناك.",
            )}
          </AppText>
          <Button label={tx(T, "حسناً")} variant="secondary" onPress={() => setRenewed(null)} />
        </StateView>
      ) : null}

      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "جارٍ التجديد")}>
          <AppText variant="secondary">
            {tx(T, "التأكيد يُرفع للخادم — التجديد المحلي لا معنى له: صدقه في وصوله.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "التجديد إقرار سعري")}>
          <AppText variant="secondary">
            {tx(T, "محرّر الوصف لا يجدّد الأسعار — التجديد بصلاحية من يلتزم بالسعر.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "expired" && focused && data ? (
        <StateView state="expired" title={tx(T, "تعديل عرض قائم — ما يجدّد التأكيد وما لا يجدّده")}>
          <AppText variant="secondary">
            {tx(T, "العرض")} <M>{focused.number}</M> {tx(T, "· تأكيده الخادمي انتهى")}{" "}
            <M>{focused.confirmed_at ? hhmm(focused.confirmed_at) : dm(focused.valid_until)}</M>
          </AppText>
          <AppText variant="secondary">
            <AppText variant="bodyStrong">{tx(T, "لماذا لا نجدّد تلقائياً عند أي تعديل؟")}</AppText>{" "}
            {tx(
              T,
              "لأن تصحيح خطأ إملائي في الوصف سيصبح حينها إعلاناً بأن السعر ساري اليوم، والمشتري يبني عليه طلباً. التجديد فعل صريح بزر وختم وقت.",
            )}
          </AppText>
          {data.rules.map((r) => (
            <View key={r.action}>
              <AppText variant="bodyStrong">{r.action}</AppText>
              <AppText variant="note" muted>
                {r.effect}
              </AppText>
              <StateWord state={verdictState(r.verdict)} label={r.verdict} />
            </View>
          ))}
          <Button
            label={`${tx(T, "تجديد تأكيد السعر والتوفر —")} ${data.renew_hours} ${tx(T, "ساعة")}`}
            financial
            loading={saving === focused.id}
            onPress={() => void renew(focused)}
          />
        </StateView>
      ) : null}

      <Note>
        <AppText variant="bodyStrong">{tx(T, "الوصف لا يجدّد")}</AppText>{" "}
        {tx(T, "· تعديل وصفٍ أو صورة لا يجدّد تأكيد السعر. التجديد إقرارٌ سعري له زرّه.")}
      </Note>

      {data && data.offers.length ? (
        <GroupedList title={tx(T, "العرض")}>
          {data.offers.map((o, i) => (
            <View key={o.id}>
              <Row
                title={`${o.public_name}${o.pack_label ? ` — ${o.pack_label}` : ""}`}
                sub={
                  <>
                    {o.price_minor ? (
                      <>
                        <M>{formatMinor(o.price_minor)}</M> ·{" "}
                      </>
                    ) : null}
                    {o.status === "expired" ? (
                      <>
                        {tx(T, "انتهى")} <M>{dm(o.valid_until)}</M>
                      </>
                    ) : (
                      <>
                        {tx(T, "سارٍ حتى")} <M>{dm(o.valid_until)}</M>
                        {typeof o.days_left === "number" ? (
                          <>
                            {" · "}
                            <M>{o.days_left}</M> {tx(T, "أيام")}
                          </>
                        ) : null}
                      </>
                    )}
                  </>
                }
                trailing={
                  <StateWord
                    state={o.status === "expired" ? "expired" : "success"}
                    label={o.status_label}
                  />
                }
                onPress={() => setFocus(o.id)}
                last={!data.can_renew && i === data.offers.length - 1}
              />
              {data.can_renew ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                  <Button
                    label={tx(T, "تجديد التأكيد")}
                    variant="secondary"
                    loading={saving === o.id}
                    onPress={() => void renew(o)}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </GroupedList>
      ) : null}
      {data && !data.offers.length ? <Note>{tx(T, "لا عروض منشورة أو منتهية بعد.")}</Note> : null}
    </Screen>
  );
}
