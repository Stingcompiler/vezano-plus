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
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { N, Row, Strong, WhenCell } from "@/components/ops/ui";
import { call } from "@/features/ops/net";
import { Ago } from "@/lib/ago";
import { useSession } from "@/lib/session";

const T = "NOT-06";
type State = "ready" | "empty" | "partial" | "server_error" | "success" | "loading";

interface Failure {
  code: string;
  label: string;
  count: number;
  action: string;
  retryable: boolean;
}
interface Results {
  sent: number;
  accepted: number;
  delivered: number;
  unconfirmed: number;
  awaiting: number;
  failed: number;
  failed_permanent: number;
  failed_temporary: number;
  opted_out: number;
  queued: number;
  cancelled: number;
  refunded_messages?: number;
  failures: Failure[];
  provider_silent: boolean;
  read: null;
}
interface Campaign {
  id: string;
  name: string;
  message: string;
  audience_count: number;
  parts: number;
  cost_messages: number;
  status: string;
  status_label: string;
  scheduled_at: string;
  sent_at: string;
  results: Partial<Results>;
  overdue: boolean;
  can_approve: boolean;
  can_cancel: boolean;
  cancelled_at: string;
  quota: { used: number; max: number; remaining: number };
}

/**
 * NOT-06 — نتائج حملة وإلغاؤها (نظير `campaign-results-client.tsx`): ما وصل فعلاً؛ «قرأها» لا يُعرض لأن
 * المزوّد لا يُثبته؛ «لم تصل نتائج بعد» ≠ «لم تصل لأحد»؛ المزوّد الصامت يُقال كما هو ولا نُعيد الإرسال؛
 * الإلغاء يُفصّل ما أُرسل ولا يُستردّ؛ العابرة غير المحسومة لا تُحتسب نجاحاً ولا فشلاً.
 */
export function CampaignResultsScreen({ id }: { id: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [camp, setCamp] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    const r = await call<{ campaign: Campaign }>(() =>
      api.GET("/api/campaigns/{campaign_id}", { params: { path: { campaign_id: id } } }),
    );
    if (r.ok && r.data) setCamp(r.data.campaign);
  }, [api, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "cancel" | "retry") => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await call<{ campaign: Campaign }>(() =>
        api.POST("/api/campaigns/{campaign_id}/{action}", {
          params: { path: { campaign_id: id, action } },
          body: {} as never,
        }),
      );
      if (r.ok && r.data) setCamp(r.data.campaign);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  const r: Partial<Results> = camp?.results ?? {};
  const sent = r.sent ?? 0;
  const failed = r.failed ?? 0;
  const unconfirmed = r.unconfirmed ?? 0;
  const delivered = r.delivered ?? 0;
  const accepted = r.accepted ?? 0;
  const inFlight = camp ? camp.status === "sending" : false;
  const started = camp
    ? ["sending", "done", "cancelled"].includes(camp.status) && sent + failed > 0
    : false;
  const state: State = !camp
    ? "loading"
    : camp.status === "cancelled"
      ? "success"
      : r.provider_silent
        ? "server_error"
        : !started
          ? "empty"
          : (r.failed_temporary ?? 0) > 0 || unconfirmed > 0 || inFlight
            ? "partial"
            : "ready";
  const failures = (r.failures ?? []).filter((f) => f.count > 0 || f.code !== "opted_out");
  const temp = (r.failures ?? []).find((f) => f.code === "provider_temp");
  const kindOf = (f: Failure) =>
    f.code === "invalid_number"
      ? tx(T, "دائم — لا يُعاد الإرسال تلقائياً")
      : f.code === "provider_temp"
        ? tx(T, "عابر — إعادة المحاولة متاحة بصلاحية")
        : tx(T, "يُحترم فوراً");

  return (
    <Screen screenId={T} state={state} title={tx(T, "الإشعارات")}>
      <AppText variant="section">{tx(T, "نتائج حملة وإلغاؤها")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "ما وصل فعلاً.")}
      </AppText>

      {camp ? (
        <View style={{ marginBottom: SPACE["3"], gap: SPACE["1"] }}>
          <AppText variant="title">{camp.name}</AppText>
          <AppText variant="secondary" muted>
            {camp.sent_at ? (
              <>
                {tx(T, "أُرسلت")} <WhenCell iso={camp.sent_at} /> · <N>{camp.audience_count}</N>{" "}
                {tx(T, "مستلماً")}
              </>
            ) : camp.scheduled_at ? (
              <>
                {tx(T, "مجدولة")} <WhenCell iso={camp.scheduled_at} />
              </>
            ) : (
              camp.status_label
            )}
          </AppText>
          <AppText
            variant="note"
            style={{
              color:
                camp.status === "cancelled"
                  ? c.state.expired.fg
                  : state === "partial"
                    ? c.state.partial.fg
                    : state === "server_error"
                      ? c.state.server_error.fg
                      : camp.status === "done"
                        ? c.state.success.fg
                        : c.state.pending_sync.fg,
            }}
          >
            {state === "partial"
              ? tx(T, "اكتملت جزئياً")
              : camp.status === "cancelled"
                ? tx(T, "أُلغيت")
                : camp.status_label}
          </AppText>
          {camp.status === "draft" || camp.status === "pending_approval" ? (
            <Button
              label={tx(T, "معاينة واعتماد وجدولة")}
              onPress={() =>
                router.push({
                  pathname: "/notify/campaigns/[id]/approve",
                  params: { id: camp.id },
                })
              }
            />
          ) : null}
        </View>
      ) : null}

      {state === "empty" && camp ? (
        <StateView state="empty" title={tx(T, "لا نتائج بعد")}>
          <AppText variant="secondary">
            {camp.sent_at ? (
              <>
                {tx(T, "أُرسلت")} <Ago iso={camp.sent_at} /> {tx(T, "ولم يردّ المزوّد بشيء.")}
              </>
            ) : camp.scheduled_at ? (
              tx(T, "لم تُرسل بعد — مجدولة.")
            ) : (
              tx(T, "لم تُرسل بعد — مسودة تنتظر الاعتماد.")
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "المزوّد لا يردّ")}>
          <AppText variant="secondary">{tx(T, "الحملة أُرسلت وحالة التسليم مجهولة.")}</AppText>
          <AppText variant="secondary">
            {tx(T, "أُرسلت")} <N>{sent}</N>{" "}
            {tx(
              T,
              "· حالة التسليم غير معروفة — المزوّد لا يستجيب. ولا نُعيد الإرسال: قد تصل مرتين.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "success" && camp ? (
        <StateView state="success" title={tx(T, "أُلغيت الحملة")}>
          {sent === 0 ? (
            <AppText variant="secondary">
              {tx(T, "أُلغيت قبل موعدها.")} <N>{r.cancelled ?? 0}</N> {tx(T, "لم تُرسل ·")}{" "}
              <N>{r.refunded_messages ?? 0}</N> {tx(T, "رسالة عادت إلى حصتك.")}
            </AppText>
          ) : (
            <AppText variant="secondary">
              <Strong>{tx(T, "ما أُرسل لا يُستردّ")}</Strong> · <N>{sent}</N>{" "}
              {tx(T, "أُرسلت ولا تُستردّ ·")} <N>{r.cancelled ?? 0}</N> {tx(T, "أُلغيت.")}
            </AppText>
          )}
        </StateView>
      ) : null}
      {state === "partial" && camp ? (
        <StateView state="partial" title={tx(T, "جزئي")}>
          <AppText variant="secondary">
            <Strong>
              {tx(T, "الإخفاقات —")} <N>{failed}</N> {tx(T, "رسالة")}
            </Strong>
            {unconfirmed > 0 ? (
              <>
                {" "}
                {tx(T, "· انقطع عامل الجدولة. الرسائل الـ")}
                <N>{unconfirmed}</N>{" "}
                {tx(
                  T,
                  "العابرة لم تُحسم نتيجتها لدى المزوّد — تُعرض «غير مؤكدة» ولا تُحتسب نجاحاً ولا فشلاً نهائياً.",
                )}
              </>
            ) : null}
          </AppText>
          {temp && (temp.count > 0 || unconfirmed > 0) && camp.can_approve ? (
            <Button
              variant="secondary"
              label={`${tx(T, "إعادة محاولة الـ")}${temp.count + unconfirmed} ${tx(T, "العابرة")}`}
              loading={busy}
              onPress={() => void act("retry")}
            />
          ) : null}
        </StateView>
      ) : null}

      {camp && started ? (
        <>
          <GroupedList>
            <Row
              title={tx(T, "أُرسلت للمزوّد")}
              detail={tx(T, "كل الجمهور المؤهل")}
              trailing={<N>{sent}</N>}
            />
            <Row
              title={tx(T, "قبِلها المزوّد")}
              detail={tx(T, "قبول ليس تسليماً")}
              trailing={<N>{accepted}</N>}
            />
            <Row
              title={tx(T, "أكّد المزوّد تسليمها")}
              detail={
                <>
                  {tx(T, "وصلت الجهاز ·")} <N>{unconfirmed}</N> {tx(T, "بلا تأكيد بعد")}
                </>
              }
              trailing={<N>{delivered}</N>}
            />
            <Row
              title={tx(T, "فشلت")}
              detail={
                <>
                  <N>{r.failed_permanent ?? 0}</N> {tx(T, "دائم ·")}{" "}
                  <N>{r.failed_temporary ?? 0}</N> {tx(T, "عابر")}
                </>
              }
              trailing={<N>{failed}</N>}
            />
            <Row
              title={tx(T, "غير محسومة")}
              detail={tx(T, "انقطع عامل الجدولة")}
              trailing={<N>{unconfirmed}</N>}
            />
            <Row
              title={tx(T, "قُرئت")}
              detail={tx(T, "القراءة غير مقيسة ولن تُعرض.")}
              trailing={<AppText variant="note">{tx(T, "غير معروف")}</AppText>}
              last
            />
          </GroupedList>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            <Strong>{tx(T, "لا قراءة مفترضة")}</Strong>{" "}
            {tx(
              T,
              "· المزوّد يخبرنا أنه قبِل الرسالة، وأحياناً أنه سلّمها. لا يخبرنا أن أحداً قرأها.",
            )}
          </AppText>
          {failures.length ? (
            <GroupedList title={tx(T, "الإخفاقات")}>
              {failures.map((f, i) => (
                <Row
                  key={f.code}
                  title={f.label}
                  detail={`${tx(T, "النوع")}: ${kindOf(f)}\n${tx(T, "ما يمكن فعله")}: ${f.action}`}
                  trailing={<N>{f.count}</N>}
                  last={i === failures.length - 1}
                />
              ))}
            </GroupedList>
          ) : null}
        </>
      ) : null}

      {camp && camp.can_cancel && camp.status !== "cancelled" ? (
        <View style={{ gap: SPACE["3"] }}>
          <AppText variant="note" muted>
            {tx(T, "الإيقاف لا يسترد ما أُرسل ولا يعيد رصيده.")}
            {sent > 0 ? (
              <>
                {" "}
                <N>{sent}</N> {tx(T, "أُرسلت ولا تُستردّ.")}
              </>
            ) : null}
          </AppText>
          {confirmCancel ? (
            <>
              <Button
                label={tx(T, "أكّد الإيقاف")}
                loading={busy}
                onPress={() => void act("cancel")}
              />
              <Button
                variant="secondary"
                label={tx(T, "رجوع")}
                onPress={() => setConfirmCancel(false)}
              />
            </>
          ) : (
            <Button
              variant="secondary"
              label={inFlight ? tx(T, "إيقاف ما تبقّى") : tx(T, "إلغاء الحملة")}
              onPress={() => setConfirmCancel(true)}
            />
          )}
        </View>
      ) : null}
    </Screen>
  );
}
