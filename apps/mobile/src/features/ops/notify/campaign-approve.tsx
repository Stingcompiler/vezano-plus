import { dayMonth, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { ChipGroup, N, Strong } from "@/components/ops/ui";
import { call } from "@/features/ops/net";
import { type Blocker } from "@/features/ops/notify/campaign-new";
import { useSession } from "@/lib/session";

const T = "NOT-05";
type State = "ready" | "validation_error" | "saving" | "expired" | "success";

export interface Campaign {
  id: string;
  name: string;
  message: string;
  audience_count: number;
  excluded_count: number;
  parts: number;
  cost_messages: number;
  status: string;
  status_label: string;
  scheduled_at: string;
  sent_at: string;
  overdue: boolean;
  can_approve: boolean;
  can_cancel: boolean;
  approved_by_name: string;
  approved_at: string;
  shop_name: string;
  quota: { used: number; max: number; remaining: number };
}
interface Verify {
  audience: { eligible: number; excluded_opt_out: number };
  parts: number;
  cost_messages: number;
  quota: { used: number; max: number; remaining: number };
  blockers: Blocker[];
  campaign: Campaign;
}

function when(iso: string): { rel: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const { day: dd, month } = dayMonth(iso);
  return {
    rel:
      diff === 0
        ? tx(T, "اليوم")
        : diff === 1
          ? tx(T, "غداً")
          : diff === -1
            ? tx(T, "أمس")
            : `${dd} ${month}`,
    time: hhmm(d.toISOString()),
  };
}

/** `YYYY-MM-DD` + `HH:MM` محليّان → ISO؛ فارغ إن لم يكتملا أو لم يصحّا. */
export const localIso = (date: string, time: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return "";
  const d = new Date(`${date}T${time.padStart(5, "0")}:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * NOT-05 — معاينة واعتماد وجدولة (نظير `campaign-approve-client.tsx`): آخر باب قبل الإرسال — الرسالة كما
 * ستصل الزبون ومعها العدد والوقت والحصة بعد الإرسال؛ إعادة التحقق خادمياً قبل كل محاولة؛ الجدولة تُسجَّل
 * ولا تُرسل؛ حملة مضى وقتها لا تُرسل متأخرة تلقائياً — نسأل؛ الإلغاء ظاهر حتى لحظة الإرسال. منتقي التاريخ
 * والوقت: شريحتا اليوم/غداً وحقلا تاريخ ووقت (لا وحدة منتقٍ أصلي مضمَّنة بعد).
 */
export function CampaignApproveScreen({ id }: { id: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [camp, setCamp] = useState<Campaign | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [nightOk, setNightOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [blocked, setBlocked] = useState<Blocker[] | null>(null);

  const load = useCallback(async () => {
    const r = await call<{ campaign: Campaign }>(() =>
      api.GET("/api/campaigns/{campaign_id}", { params: { path: { campaign_id: id } } }),
    );
    if (r.ok && r.data) setCamp(r.data.campaign);
  }, [api, id]);

  const reverify = useCallback(async () => {
    const r = await call<Verify>(() =>
      api.POST("/api/campaigns/{campaign_id}/{action}", {
        params: { path: { campaign_id: id, action: "verify" } },
        body: { scheduled_at: localIso(date, time), night_confirmed: nightOk } as never,
      }),
    );
    if (r.ok && r.data) {
      setVerify(r.data);
      setCamp(r.data.campaign);
    }
  }, [api, id, date, time, nightOk]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => void reverify(), 200);
    return () => clearTimeout(t);
  }, [reverify]);

  const act = async (action: "approve" | "cancel", body: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true);
    setAttempted(true);
    setBlocked(null);
    try {
      const r = await call<{ campaign: Campaign }>(() =>
        api.POST("/api/campaigns/{campaign_id}/{action}", {
          params: { path: { campaign_id: id, action } },
          body: body as never,
        }),
      );
      if (r.status === 400) {
        const e = r.error as { detail?: string; extra?: { blockers?: Blocker[] } } | undefined;
        if (e?.detail === "blocked") setBlocked(e.extra?.blockers ?? []);
        return;
      }
      if (r.ok && r.data) setCamp(r.data.campaign);
    } finally {
      setBusy(false);
    }
  };

  const approved = camp ? ["scheduled", "sending", "done"].includes(camp.status) : false;
  const state: State = busy
    ? "saving"
    : blocked
      ? "validation_error"
      : camp?.overdue
        ? "expired"
        : approved && attempted
          ? "success"
          : approved && camp?.status !== "scheduled"
            ? "success"
            : "ready";
  const v = verify;
  const sched = camp?.scheduled_at ? when(camp.scheduled_at) : null;
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));

  return (
    <Screen screenId={T} state={state} title={tx(T, "الإشعارات")}>
      <AppText variant="section">{tx(T, "معاينة واعتماد وجدولة")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "آخر باب قبل الإرسال.")}
      </AppText>

      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "جارٍ الجدولة")}>
          <AppText variant="secondary">{tx(T, "الجدولة تُسجَّل ولا تُرسل.")}</AppText>
        </StateView>
      ) : null}

      {state === "expired" && camp && sched ? (
        <StateView state="expired" title={tx(T, "مضى وقت الإرسال")}>
          <AppText variant="secondary">
            {tx(T, "حملة مجدولة")}{" "}
            {sched.rel === tx(T, "أمس") ? tx(T, "لأمس") : `${tx(T, "لـ")}${sched.rel}`}{" "}
            <N>{sched.time}</N> {tx(T, "والنظام كان متوقفاً.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "لا إرسال متأخر تلقائياً")}</Strong>{" "}
            {tx(T, "· نسأل: أرسل الآن أم أعد الجدولة أم ألغِ.")}
          </AppText>
          <Button
            label={tx(T, "أرسل الآن")}
            onPress={() => void act("approve", { send_now: true })}
          />
          <Button variant="secondary" label={tx(T, "أعد الجدولة")} onPress={() => setDate("")} />
          <Button variant="quiet" label={tx(T, "ألغِ")} onPress={() => void act("cancel")} />
        </StateView>
      ) : null}

      {state === "validation_error" && blocked ? (
        <StateView state="validation_error" title={tx(T, "لا يمكن الجدولة بعد")}>
          <AppText variant="secondary">
            {blocked.length === 3
              ? tx(T, "ثلاثة نواقص تمنع الإرسال.")
              : blocked.length === 2
                ? tx(T, "نقصان يمنعان الإرسال.")
                : tx(T, "نقص واحد يمنع الإرسال.")}{" "}
            {tx(T, "كلٌّ منها مذكور بسببه وبما يلزم لحلّه.")}
          </AppText>
          {blocked.map((b) => (
            <View key={b.code} style={{ gap: SPACE["1"] }}>
              <AppText variant="note">
                <Strong>{b.title}</Strong> · {b.detail}
              </AppText>
              {b.confirmable ? (
                <Button
                  variant="secondary"
                  label={tx(T, "أؤكّد الإرسال الليلي")}
                  onPress={() => {
                    setNightOk(true);
                    setBlocked(null);
                  }}
                />
              ) : null}
            </View>
          ))}
          <AppText variant="note" muted>
            {tx(T, "جدولة — غير متاحة")}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" && camp ? (
        <StateView state="success" title={tx(T, "اعتُمدت")}>
          <AppText variant="secondary">
            {camp.status === "scheduled" && sched ? (
              <>
                {tx(T, "مجدولة")} <N>{sched.time}</N> {sched.rel}
              </>
            ) : camp.status === "sending" ? (
              tx(T, "قيد الإرسال")
            ) : (
              tx(T, "أُرسلت")
            )}
            {camp.approved_at ? (
              <>
                {" "}
                {tx(T, "· اعتمدها")} {camp.approved_by_name} {tx(T, "في")}{" "}
                <N>{hhmm(camp.approved_at)}</N>
              </>
            ) : null}
            {tx(T, "، وأين تُتابَع نتائجها — في «نتائج الحملة».")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "الإلغاء متاح")}</Strong> {tx(T, "· حتى لحظة الإرسال.")}
          </AppText>
          <Button
            variant="secondary"
            label={tx(T, "نتائج الحملة")}
            onPress={() =>
              router.push({ pathname: "/notify/campaigns/[id]", params: { id: camp.id } })
            }
          />
          {camp.can_cancel ? (
            <Button
              variant="quiet"
              label={tx(T, "إلغاء الحملة")}
              onPress={() => void act("cancel")}
            />
          ) : null}
        </StateView>
      ) : null}

      {camp ? (
        <>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "كما ستصل الزبون")}
          </AppText>
          <View
            accessibilityLabel={tx(T, "معاينة على الهاتف")}
            style={{
              backgroundColor: c.surfaceSunken,
              borderRadius: 16,
              padding: SPACE["3"],
              gap: SPACE["1"],
              marginBottom: SPACE["3"],
            }}
          >
            <AppText variant="note" muted>
              {camp.shop_name}
            </AppText>
            <AppText>{camp.message}</AppText>
          </View>
          <AppText variant="secondary" style={{ marginBottom: SPACE["1"] }}>
            {tx(T, "ستصل")} <N>{v?.audience.eligible ?? camp.audience_count}</N>{" "}
            {tx(T, "زبوناً · تبقى")}{" "}
            <N>
              {Math.max(
                0,
                (v?.quota.remaining ?? camp.quota.remaining) -
                  (approved ? 0 : (v?.cost_messages ?? camp.cost_messages)),
              )}
            </N>{" "}
            {tx(T, "من حصتك")}
          </AppText>
          <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
            <N>{v?.cost_messages ?? camp.cost_messages}</N> {tx(T, "رسالة (")}
            <N>{v?.parts ?? camp.parts}</N> {tx(T, "لكل مستلم) ·")}{" "}
            <N>{v?.audience.excluded_opt_out ?? camp.excluded_count}</N> {tx(T, "مستبعد")}
          </AppText>

          {!approved || camp.status === "scheduled" ? (
            <>
              <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
                {tx(T, "الجدولة")}
              </AppText>
              <ChipGroup>
                <Chip
                  label={tx(T, "اليوم")}
                  on={date === today}
                  onPress={() => {
                    setDate(today);
                    setNightOk(false);
                  }}
                />
                <Chip
                  label={tx(T, "غداً")}
                  on={date === tomorrow}
                  onPress={() => {
                    setDate(tomorrow);
                    setNightOk(false);
                  }}
                />
              </ChipGroup>
              <TextField
                label={tx(T, "تاريخ الإرسال")}
                value={date}
                placeholder="2026-10-21"
                onChangeText={(v) => {
                  setDate(v);
                  setNightOk(false);
                }}
                keyboardType="numbers-and-punctuation"
                mono
              />
              <TextField
                label={tx(T, "وقت الإرسال")}
                value={time}
                placeholder="08:00"
                onChangeText={(v) => {
                  setTime(v);
                  setNightOk(false);
                }}
                keyboardType="numbers-and-punctuation"
                mono
              />
              {v?.blockers.length ? (
                <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
                  {tx(T, "قبل الجدولة:")} {v.blockers.map((b) => b.title).join(" · ")}
                </AppText>
              ) : null}
              {camp.can_approve ? (
                <View style={{ gap: SPACE["3"] }}>
                  <Button
                    financial
                    label={tx(T, "اعتمد وجدول")}
                    loading={busy}
                    onPress={() =>
                      void act("approve", {
                        scheduled_at: localIso(date, time),
                        night_confirmed: nightOk,
                      })
                    }
                    disabledReason={!localIso(date, time) ? tx(T, "اختر تاريخ الإرسال") : undefined}
                  />
                  <Button
                    variant="secondary"
                    label={tx(T, "اعتمد وأرسل الآن")}
                    loading={busy}
                    onPress={() => void act("approve", { send_now: true })}
                  />
                  {camp.can_cancel && approved ? (
                    <Button
                      variant="quiet"
                      label={tx(T, "إلغاء الحملة")}
                      onPress={() => void act("cancel")}
                    />
                  ) : null}
                </View>
              ) : (
                <AppText variant="note" muted>
                  {tx(T, "الاعتماد والجدولة صلاحية منفصلة — للمالك.")}
                </AppText>
              )}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
