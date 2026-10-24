import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { N, Row, Strong, WhenCell } from "@/components/ops/ui";
import { call, useCachedGet } from "@/features/ops/net";
import { OPS } from "@/features/ops/texts";
import { useSession } from "@/lib/session";

const T = "NOT-03";
type State = "ready" | "loading" | "empty" | "permission_denied" | "stale" | "offline";

export interface Results {
  sent?: number;
  accepted?: number;
  delivered?: number;
  unconfirmed?: number;
  failed?: number;
  failures?: { code: string; label: string; count: number; action: string }[];
}
export interface CampaignRow {
  id: string;
  name: string;
  message: string;
  channel: string;
  audience_count: number;
  excluded_count: number;
  parts: number;
  cost_messages: number;
  status: string;
  status_label: string;
  scheduled_at: string;
  sent_at: string;
  results: Results;
  created_by_name: string;
  created_at: string;
}
interface Payload {
  campaigns: CampaignRow[];
  quota: { used: number; max: number; remaining: number };
  subscribers: number;
  parties_total: number;
  can_create: boolean;
  can_approve: boolean;
  can_see_billing: boolean;
  as_of: string;
}

export const STATUS_STATE: Record<
  string,
  "ready" | "pending_sync" | "saving" | "success" | "expired" | "partial"
> = {
  draft: "ready",
  pending_approval: "pending_sync",
  scheduled: "pending_sync",
  sending: "saving",
  done: "success",
  cancelled: "expired",
};

export const CAMPAIGNS_CACHE = "ops.campaigns_cache";

/**
 * NOT-03 — قائمة الحملات (نظير `campaigns-client.tsx`): الحصة الشهرية والرقم الصادق «N زبوناً أذنوا» لا
 * «كل دفترك»؛ نتائج الحملة بأربع درجات — «قبِله المزوّد» ليس «قرأه الزبون»؛ مسؤول الحملات يرى الحصة
 * ولا يرى التكلفة ولا فاتورة الباقة.
 */
export function CampaignsScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const load = useCallback(() => call<Payload>(() => api.GET("/api/campaigns", {})), [api]);
  const { p, data, failed, denied, reload, fetching } = useCachedGet<Payload>({
    cacheKey: CAMPAIGNS_CACHE,
    load,
  });

  const state: State = denied
    ? "permission_denied"
    : !p
      ? failed
        ? "offline"
        : "loading"
      : failed && data === null
        ? "stale"
        : p.campaigns.length === 0
          ? "empty"
          : "ready";

  const latest = p?.campaigns.find((x) => x.results && Object.keys(x.results).length > 0) ?? null;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "الإشعارات")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <AppText variant="section">{tx(T, "قائمة الحملات")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "حملات المحل إلى زبائنه. نتائج الحملة — «قبِله المزوّد» ليس «قرأه الزبون».")}
      </AppText>

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الحملات لمن يملك إنشاءها أو اعتمادها")}>
          <AppText variant="secondary">
            {tx(
              T,
              "إنشاء الحملات للمالك ومدير الفرع؛ الاعتماد للمالك وحده («الأدوار والصلاحيات»).",
            )}
            {denied?.role ? ` ${tx(T, "دورك:")} ${denied.role}.` : ""}
          </AppText>
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب الحملات")}>
          <AppText variant="secondary">{tx(T, "مع الحصة الشهرية وهي تُحسب.")}</AppText>
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "جلب الحملات")}>
          <AppText variant="secondary">{OPS.offlineNone}</AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "جلب الحملات")}>
          <AppText variant="secondary">{OPS.offlineCached}</AppText>
        </StateView>
      ) : null}

      {p ? (
        <>
          <GroupedList title={tx(T, "الحصة والمشتركون")}>
            <Row
              title={tx(T, "الحصة المتبقية هذا الشهر")}
              detail={
                <>
                  {tx(T, "من")} <N>{p.quota.max}</N> {tx(T, "رسالة ·")} <N>{p.quota.used}</N>{" "}
                  {tx(T, "مستهلكة")}
                </>
              }
              trailing={<N>{p.quota.remaining}</N>}
            />
            <Row
              title={tx(T, "الرقم الصادق")}
              detail={
                <>
                  {tx(T, "زبوناً أذنوا باستقبال رسائلك — لا")} <N>{p.parties_total}</N>{" "}
                  {tx(T, "زبوناً في دفترك. الفرق بينهما هو الإذن.")}
                </>
              }
              trailing={<N>{p.subscribers}</N>}
              last
            />
          </GroupedList>
          {!p.can_see_billing ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              <Strong>{tx(T, "مسؤول الحملات لا يرى الفوترة")}</Strong>{" "}
              {tx(T, "· يرى الحملات والحصة المتبقية، ولا يرى تكلفتها ولا فاتورة الباقة.")}
            </AppText>
          ) : null}
          {p.can_create ? (
            <Button
              label={tx(T, "حملة جديدة")}
              onPress={() => router.push("/notify/campaigns/new")}
            />
          ) : null}
        </>
      ) : null}

      {state === "empty" && p ? (
        <StateView state="empty" title={tx(T, "لا حملات")}>
          <AppText variant="secondary">{tx(T, "لم تُنشأ حملة بعد.")}</AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "الرقم الصادق")}</Strong> · «<N>{p.subscribers}</N>{" "}
            {tx(T, "زبوناً أذنوا باستقبال رسائلك» — لا «")} <N>{p.parties_total}</N>{" "}
            {tx(T, "زبوناً في دفترك». الفرق بينهما هو الإذن.")}
          </AppText>
        </StateView>
      ) : null}

      {(state === "ready" || state === "stale") && p ? (
        <>
          <GroupedList title={tx(T, "الحملات")}>
            {p.campaigns.map((x, i) => (
              <Row
                key={x.id}
                title={`${tx(T, "حملة «")}${x.name}»`}
                detail={
                  <>
                    {x.sent_at ? (
                      <>
                        {tx(T, "أُرسلت")} <WhenCell iso={x.sent_at} /> {tx(T, "· قناة رسائل نصية")}
                      </>
                    ) : x.scheduled_at ? (
                      <>
                        {tx(T, "مجدولة")} <WhenCell iso={x.scheduled_at} />
                      </>
                    ) : (
                      <>
                        {tx(T, "أُنشئت")} <WhenCell iso={x.created_at} /> · {x.created_by_name}
                      </>
                    )}
                    {"\n"}
                    {tx(T, "الجمهور")} <N>{x.audience_count}</N> · {tx(T, "الرسائل")}{" "}
                    <N>{x.cost_messages}</N>
                  </>
                }
                trailing={
                  <AppText
                    variant="note"
                    style={{ color: c.state[STATUS_STATE[x.status] ?? "ready"].fg }}
                  >
                    {x.status_label}
                  </AppText>
                }
                onPress={() =>
                  router.push({ pathname: "/notify/campaigns/[id]", params: { id: x.id } })
                }
                last={i === p.campaigns.length - 1}
              />
            ))}
          </GroupedList>
          {latest?.results?.failures?.length ? (
            <>
              <AppText variant="bodyStrong">
                {tx(T, "نتائج الحملة — «قبِله المزوّد» ليس «قرأه الزبون»")}
              </AppText>
              <GroupedList>
                <Row
                  title={tx(T, "أُرسلت من عندنا")}
                  detail={tx(T, "غادرت النظام إلى المزوّد")}
                  trailing={<N>{latest.results.sent ?? 0}</N>}
                />
                <Row
                  title={tx(T, "قبِلها المزوّد")}
                  detail={tx(T, "قبول لا يعني تسليماً للهاتف")}
                  trailing={<N>{latest.results.accepted ?? 0}</N>}
                />
                <Row
                  title={tx(T, "أكّد المزوّد تسليمها")}
                  detail={
                    <>
                      {tx(T, "وصلت الجهاز ·")} <N>{latest.results.unconfirmed ?? 0}</N>{" "}
                      {tx(T, "بلا تأكيد بعد")}
                    </>
                  }
                  trailing={<N>{latest.results.delivered ?? 0}</N>}
                />
                <Row
                  title={tx(T, "فشلت نهائياً")}
                  detail={tx(T, "بسبب مذكور لكل واحدة")}
                  trailing={<N>{latest.results.failed ?? 0}</N>}
                  last
                />
              </GroupedList>
              <GroupedList title={tx(T, "سبب الفشل")}>
                {latest.results.failures.map((f, i, arr) => (
                  <Row
                    key={f.code}
                    title={f.label}
                    detail={`${tx(T, "ما يمكن فعله")}: ${f.action}`}
                    trailing={<N>{f.count}</N>}
                    last={i === arr.length - 1}
                  />
                ))}
              </GroupedList>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
