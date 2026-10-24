import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Ago, Heading, Item, Lead, N, Note, Strong, Word } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-04";
type State = "ready" | "loading" | "empty" | "offline" | "stale" | "permission_denied";

export interface DeviceRow {
  id: string;
  name: string;
  prefix: string;
  branch_id: string;
  branch_name: string;
  status: string;
  connectivity: "connected" | "offline" | "stale" | "silent" | "revoked";
  last_seen_at: string;
  pending: number;
  pending_at: string;
  users: string[];
  registered_at: string;
  sells: boolean;
}
export interface DevicesPayload {
  devices: DeviceRow[];
  counts: { total: number; active: number; pending_total: number };
  device_limit: number | null;
  as_of: string;
}

export const DEVICES_CACHE_META = "org.devices_cache";
const STALE_MS = 10 * 60_000;

const CONN_LABEL = {
  connected: tx(T, "متصل"),
  offline: tx(T, "غير متصل"),
  stale: tx(T, "متقادم"),
  silent: tx(T, "صامت"),
  revoked: tx(T, "مسحوب"),
} as const;

/** «غير مرفوع»: عدد ما لم يُرفع بعد ومعناه — لا وصف «متصل» كاذب. */
function Unsynced({ d }: { d: DeviceRow }) {
  if (!d.sells) return <>{tx(T, "عرض ومتابعة فقط — لا بيع من هذا الجهاز")}</>;
  if (d.pending === 0 && d.connectivity === "connected") return <>{tx(T, "يرفع فوراً")}</>;
  if (d.connectivity === "stale" && d.pending > 0)
    return (
      <>
        {tx(T, "السحب قبل الرفع يفقد")} <N>{d.pending}</N> {tx(T, "عملية.")}
      </>
    );
  if (d.connectivity === "offline")
    return <>{tx(T, "يبيع محلياً الآن على الأرجح — غير متصل لا يعني متوقفاً")}</>;
  if (d.pending > 0)
    return (
      <>
        <N>{d.pending}</N> {tx(T, "عمليات محفوظة محلياً لم تُرفع.")}
      </>
    );
  return <>{tx(T, "لا معلّق")}</>;
}

/**
 * ORG-04 — الأجهزة (نظير `devices-client.tsx`): «آخر اتصال» رقم لا حالة وهمية؛ الجهاز غير المتصل ليس
 * معطّلاً. آخر قائمة ناجحة تُحفظ في `meta` وتُعرض بحالة offline/stale حين تفشل الشبكة أو الخادم.
 */
export function Devices() {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(
    async () => fetched<DevicesPayload>(await api.GET("/api/org/devices", {})),
    [api],
  );
  const {
    p: shown,
    data,
    cached,
    failed,
    down,
    fetching,
    denied,
    reload,
  } = useReport<DevicesPayload>({
    cacheKey: DEVICES_CACHE_META,
    load,
  });

  const loaded = data !== null || failed || denied !== null;
  const asOfOld = shown ? Date.now() - new Date(shown.as_of).getTime() > STALE_MS : false;
  const state: State = denied
    ? "permission_denied"
    : !loaded || (fetching && !data && !cached)
      ? "loading"
      : down
        ? "offline"
        : !data && (failed || asOfOld) && cached
          ? "stale"
          : shown && shown.devices.length === 0
            ? "empty"
            : "ready";

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "الأجهزة")}
      onRefresh={() => void reload()}
      refreshing={fetching}
    >
      <AppText variant="section">{tx(T, "قائمة الأجهزة وتفاصيلها")}</AppText>
      <Note>{tx(T, "الجهاز عهدةٌ عليها عمل.")}</Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب الأجهزة")}>
          <Lead>{tx(T, "مع حالة المزامنة لكل جهاز.")}</Lead>
        </StateView>
      ) : null}
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx("ORG-07", "للمالك فقط")} />
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا أجهزة مسجّلة")}>
          <Lead>{tx(T, "منشأة أُنشئت ولم يُهيّأ عليها جهاز بعد.")}</Lead>
          <Button label={tx(T, "جهّز هذا الجهاز")} onPress={() => router.push("/setup-device")} />
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView
          state="offline"
          title={
            cached
              ? tx(T, "بلا اتصال — القائمة كما كانت عند آخر تحديث")
              : tx(T, "بلا اتصال — لا قائمة مخزَّنة بعد")
          }
        />
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "القائمة قديمة — تعذّر التحديث من الخادم")} />
      ) : null}

      {shown && shown.devices.length > 0 ? (
        <>
          <Heading>
            {tx(T, "الأجهزة —")} <N>{shown.counts.total}</N>
            {shown.device_limit !== null ? (
              <>
                {" "}
                {tx(T, "من حدّ الباقة")} <N>{shown.device_limit}</N>
              </>
            ) : null}
          </Heading>
          <Note>
            {tx(T, "الوقت المعروض بتوقيت المنشأة · آخر تحديث")} <Ago iso={shown.as_of} />
          </Note>
          <View style={{ height: SPACE["2"] }} />
          <GroupedList title={tx(T, "الأجهزة")}>
            {shown.devices.map((d, i) => (
              <Item
                key={d.id}
                title={d.name}
                last={i === shown.devices.length - 1}
                status={
                  <Word
                    tone={
                      d.connectivity === "connected"
                        ? "active"
                        : d.connectivity === "stale"
                          ? "expired"
                          : "disabled"
                    }
                  >
                    {CONN_LABEL[d.connectivity]}
                  </Word>
                }
              >
                <Note>
                  {tx(T, "بادئة")} <N>{d.prefix}</N>
                </Note>
                <AppText variant="secondary">{d.branch_name}</AppText>
                <Note>{d.users.join(" · ") || "—"}</Note>
                <Note>
                  {tx(T, "آخر اتصال ناجح")}: <Ago iso={d.last_seen_at} />
                </Note>
                <Note>
                  {tx(T, "غير مرفوع")}: <Unsynced d={d} />
                </Note>
              </Item>
            ))}
          </GroupedList>
          <Note>
            <Strong>{tx(T, "سحب الجهاز فعل منفصل عن تعطيل مستخدم.")}</Strong>{" "}
            {tx(
              T,
              "ولا نسحب جهازاً له عمليات لم تُرفع قبل أن نعرض عددها ونحذّر: السحب قبل الرفع يعني فقد تلك العمليات، والقرار للمالك بعد أن يراه مكتوباً.",
            )}
          </Note>
          <Note>{tx(T, "الجهاز غير المتصل ليس معطّلاً؛ لعله يبيع محلياً الآن.")}</Note>
        </>
      ) : null}
    </Screen>
  );
}
