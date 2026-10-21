import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch, View } from "react-native";

import { N, Row, Strong } from "@/components/ops/ui";
import { call, detailOf } from "@/features/ops/net";
import { useSession } from "@/lib/session";

const T = "NOT-04";
type State = "ready" | "empty" | "validation_error" | "permission_denied";

interface Segment {
  key: string;
  label: string;
  hint: string;
  count: number;
  selected: boolean;
  warning: boolean;
  available: boolean;
}
export interface Blocker {
  code: string;
  title: string;
  detail: string;
  need?: number;
  remaining?: number;
  confirmable?: boolean;
}
export interface Preview {
  shop_name: string;
  audience: {
    segments: Segment[];
    blocked: { key: string; label: string; hint: string };
    eligible: number;
    consented: number;
    excluded_opt_out: number;
    excluded_no_phone: number;
    duplicates: number;
    with_debt_in_audience: number;
  };
  chars: number;
  parts: number;
  cost_messages: number;
  quota: { used: number; max: number; remaining: number };
  blockers: Blocker[];
}

/** عدد الأجزاء كنص الويب: واحدة / اثنتان / N رسائل. */
function PartsText({ parts }: { parts: number }) {
  if (parts === 1) return <>{tx(T, "رسالة نصية واحدة")}</>;
  if (parts === 2) return <>{tx(T, "رسالتان نصيتان")}</>;
  return (
    <>
      <N>{parts}</N> {tx(T, "رسائل نصية")}
    </>
  );
}

export function BlockersNotice({
  list,
}: {
  list: readonly { code: string; title: string; detail: string }[];
}) {
  return (
    <StateView state="validation_error" title={tx(T, "لا يمكن الجدولة بعد")}>
      <AppText variant="secondary">
        {list.length === 3
          ? tx(T, "ثلاثة نواقص تمنع الإرسال.")
          : list.length === 2
            ? tx(T, "نقصان يمنعان الإرسال.")
            : tx(T, "نقص واحد يمنع الإرسال.")}{" "}
        {tx(T, "كلٌّ منها مذكور بسببه وبما يلزم لحلّه.")}
      </AppText>
      {list.map((b) => (
        <AppText key={b.code} variant="note">
          <Strong>{b.title}</Strong> · {b.detail}
        </AppText>
      ))}
      <AppText variant="note" muted>
        {tx(T, "جدولة — غير متاحة")}
      </AppText>
    </StateView>
  );
}

/**
 * NOT-04 — إنشاء حملة واختيار الجمهور (نظير `campaign-new-client.tsx`): الجمهور من دفترك وحده؛ العدد
 * يتغير مع كل شرط ويُحصى خادمياً بعد إزالة التكرار ومن رفض التسويق؛ الرسالة تحمل اسم المحل إلزاماً؛
 * الموانع بأسبابها؛ الاعتماد والجدولة في NOT-05 بصلاحية منفصلة. خطوات: الجمهور ← النص ← المعاينة.
 */
export function CampaignNewScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [segments, setSegments] = useState<string[]>(["subscribed"]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [denied, setDenied] = useState<"role" | "tenant" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const seededName = useRef(false);

  const refresh = useCallback(async () => {
    const r = await call<Preview>(() =>
      api.POST("/api/campaigns/preview", {
        body: { message, audience: { segments } } as never,
      }),
    );
    if (r.offline) return; // بلا اتصال: تبقى المعاينة الأخيرة
    if (r.status === 403) return setDenied("role");
    if (r.status === 400) {
      if (detailOf(r.error) === "audience_out_of_tenant") setDenied("tenant");
      return;
    }
    if (!r.ok || !r.data) return;
    const body = r.data;
    setDenied(null);
    setPreview(body);
    // نُلزم بالاسم: يُدرج تلقائياً ويمكن تحريره لا حذفه
    if (!seededName.current && body.shop_name) {
      seededName.current = true;
      setMessage((m) => (m.trim() ? m : `— ${body.shop_name}`));
    }
  }, [api, message, segments]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const toggle = (key: string) => {
    setTouched(true);
    setSaved(null);
    setSegments((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  };

  const save = async (thenApprove = false) => {
    if (saving || !preview) return;
    setSaving(true);
    setTouched(true);
    try {
      const r = await call<{ campaign: { id: string } }>(() =>
        api.POST("/api/campaigns", {
          body: { name, message, audience: { segments } } as never,
        }),
      );
      if (r.status === 403) return setDenied("role");
      if (r.status === 400) {
        if (detailOf(r.error) === "audience_out_of_tenant") setDenied("tenant");
        return;
      }
      if (r.ok && r.data) {
        setSaved(r.data.campaign.id);
        if (thenApprove)
          router.push({
            pathname: "/notify/campaigns/[id]/approve",
            params: { id: r.data.campaign.id },
          });
      }
    } finally {
      setSaving(false);
    }
  };

  const blockers = preview?.blockers ?? [];
  const identityMissing = blockers.some((b) => b.code === "sender_identity_missing");
  const state: State = denied
    ? "permission_denied"
    : preview && preview.audience.eligible === 0 && touched
      ? "empty"
      : touched && identityMissing
        ? "validation_error"
        : "ready";
  const seg = (k: string) => preview?.audience.segments.find((s) => s.key === k);

  return (
    <Screen screenId={T} state={state} title={tx(T, "الإشعارات")}>
      <AppText variant="section">{tx(T, "إنشاء حملة واختيار الجمهور")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "زبائن محلك أو متابعوك في السوق — لا جمهور مستأجر آخر بأي حال.")}
      </AppText>

      {state === "permission_denied" ? (
        denied === "tenant" ? (
          <StateView state="permission_denied" title={tx(T, "جمهور خارج منشأتك")}>
            <AppText variant="secondary">
              {tx(T, "محاولة اختيار شريحة تشمل زبائن منشأة أخرى على نفس الجهاز.")}
            </AppText>
            <AppText variant="secondary">{tx(T, "الجمهور محصور بزبائن منشأتك")}</AppText>
          </StateView>
        ) : (
          <StateView state="permission_denied" title={tx(T, "إنشاء الحملة صلاحية")}>
            <AppText variant="secondary">
              {tx(
                T,
                "إنشاء الحملات للمالك ومدير الفرع («الأدوار والصلاحيات»). أنت تنشئ الحملة، والاعتماد والجدولة يحتاجان صلاحية منفصلة في «اعتماد الحملة».",
              )}
            </AppText>
          </StateView>
        )
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "رسالة بلا هوية المرسل")}>
          <AppText variant="secondary">
            {tx(T, "نصٌّ لا يذكر اسم المحل. الزبون يتلقّى رسالة من رقم لا يعرفه.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "نُلزم بالاسم")}</Strong>{" "}
            {tx(
              T,
              "· وهو يُدرج تلقائياً ويمكن تحريره لا حذفه. رسالةٌ مجهولة المصدر تُبلَّغ كإزعاج فيُحظر المحل.",
            )}
          </AppText>
          {preview ? (
            <Button
              variant="secondary"
              label={tx(T, "أدرج اسم المحل")}
              onPress={() => setMessage((m) => `${m.trim()} — ${preview.shop_name}`)}
            />
          ) : null}
        </StateView>
      ) : null}
      {state === "empty" && preview ? (
        <StateView state="empty" title={tx(T, "لا جمهور مطابق")}>
          <AppText variant="secondary">
            {tx(T, "المرشّح (")}
            {segments.map((k) => seg(k)?.label ?? k).join(` ${tx(T, "و")}`) || tx(T, "بلا شريحة")}
            {tx(T, ") لا يطابق أحداً.")}
          </AppText>
          <AppText variant="secondary">
            {preview.audience.segments
              .filter((s) => s.selected)
              .map((s) => (
                <AppText key={s.key} variant="secondary">
                  <N>{s.count}</N> {s.label} ·{" "}
                </AppText>
              ))}
            <N>{preview.audience.consented}</N> {tx(T, "منهم أذن.")}
          </AppText>
        </StateView>
      ) : null}

      {state !== "permission_denied" ? (
        <>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "الجمهور")}
          </AppText>
          <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
            <Strong>{tx(T, "اختيار الجمهور")}</Strong>{" "}
            {tx(
              T,
              "· العدد يتغير أمامك مع كل شرط. الجمهور يُبنى من دفترك: من اشترى، من عليه ذمة، من يتابع صفحتك في السوق. لا شراء قوائم ولا جمهور مستأجر آخر.",
            )}
          </AppText>
          <AppText variant="note" style={{ marginBottom: SPACE["1"] }}>
            <Strong>{tx(T, "حدود صريحة")}</Strong>
          </AppText>
          {preview ? (
            <GroupedList>
              {preview.audience.segments.map((s) => (
                <View
                  key={s.key}
                  style={{
                    minHeight: TOUCH.row,
                    paddingHorizontal: SPACE["4"],
                    paddingVertical: SPACE["2"],
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACE["3"],
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <AppText>
                      {s.label} — <N>{s.count}</N>
                      {s.key === "subscribed" ? ` ${tx(T, "مشتركاً عبر رابط المحل أو QR")}` : ""}
                      {s.key === "market_followers" ? ` ${tx(T, "منشأة تتابع عروضك — B2B")}` : ""}
                    </AppText>
                    <AppText variant="note" muted>
                      {s.hint}
                    </AppText>
                  </View>
                  <Switch
                    accessibilityLabel={s.label}
                    value={segments.includes(s.key)}
                    disabled={!s.available}
                    onValueChange={() => toggle(s.key)}
                    trackColor={{ true: c.brandPrimary, false: c.border }}
                  />
                </View>
              ))}
              <View
                style={{
                  minHeight: TOUCH.row,
                  paddingHorizontal: SPACE["4"],
                  paddingVertical: SPACE["2"],
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACE["3"],
                }}
              >
                <View style={{ flex: 1 }}>
                  <AppText>
                    {preview.audience.blocked.label} — <Strong>{tx(T, "محجوب")}</Strong>
                  </AppText>
                  <AppText variant="note" muted>
                    {preview.audience.blocked.hint}{" "}
                    {tx(T, "غير متاح إطلاقاً — جمهور كل منشأة معزول ولا يُشترى ولا يُستعار")}
                  </AppText>
                </View>
                <Switch
                  accessibilityLabel={preview.audience.blocked.label}
                  value={false}
                  disabled
                />
              </View>
            </GroupedList>
          ) : (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "يُحسب الجمهور خادمياً…")}
            </AppText>
          )}

          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "حملة جديدة")}
          </AppText>
          <TextField
            label={tx(T, "اسم الحملة — داخلي")}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setSaved(null);
            }}
            required
          />
          <TextField
            label={tx(T, "نص الرسالة")}
            value={message}
            onChangeText={(v) => {
              setMessage(v);
              setTouched(true);
              setSaved(null);
            }}
            multiline
            numberOfLines={4}
            style={{ minHeight: 110, textAlignVertical: "top" }}
          />
          {preview ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
              <N>{preview.chars}</N> {tx(T, "حرفاً =")} <PartsText parts={preview.parts} />{" "}
              {tx(T, "لكل مستلم")}
            </AppText>
          ) : null}
          <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "مثال: سكر أبيض كرتونة 12 كغ بـ1,150 ج.س حتى نهاية الأسبوع — بقالة النيل")}
          </AppText>

          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "حجم الإرسال")}
          </AppText>
          {preview ? (
            <>
              <GroupedList>
                <Row
                  title={tx(T, "مشتركون مؤهلون")}
                  detail={tx(T, "الجمهور بعد إزالة التكرار ومن رفض التسويق")}
                  trailing={<N>{preview.audience.eligible}</N>}
                />
                <Row
                  title={tx(T, "ألغوا الاشتراك — مستبعدون")}
                  detail={
                    <>
                      <N>{preview.audience.excluded_opt_out}</N>{" "}
                      {tx(
                        T,
                        "رقماً استُبعد لأن أصحابها أوقفوا الرسائل التسويقية. لا يمكن تجاوز ذلك من داخل الشاشة، والاستبعاد يظهر بالعدد لا بالأسماء.",
                      )}
                    </>
                  }
                  trailing={<N>{preview.audience.excluded_opt_out}</N>}
                />
                <Row
                  title={tx(T, "حصتك المتبقية هذا الشهر")}
                  detail={
                    <>
                      {tx(T, "الحاجة")} <N>{preview.cost_messages}</N> {tx(T, "رسالة من رصيدك لا")}{" "}
                      <N>{preview.audience.eligible}</N>
                    </>
                  }
                  trailing={<N>{preview.quota.remaining}</N>}
                  last
                />
              </GroupedList>
              {preview.audience.with_debt_in_audience > 0 ? (
                <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
                  <N>{preview.audience.with_debt_in_audience}</N>{" "}
                  {tx(T, "عليهم ذمم مستحقة — رسالة تسويقية لمدين قد تُفهم مطالبةً — تحذير لا منع.")}
                </AppText>
              ) : null}
              <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
                {tx(T, "المعاينة")}
              </AppText>
              <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
                {tx(T, "المعاينة تعرض الرسالة كما ستصل حرفياً:")} <N>{preview.chars}</N>{" "}
                {tx(T, "حرفاً =")}{" "}
                {preview.parts === 2 ? (
                  tx(T, "رسالتان نصيتان")
                ) : (
                  <>
                    <N>{preview.parts}</N> {tx(T, "رسائل نصية")}
                  </>
                )}
                {tx(T, "، والتكلفة المعروضة")} <N>{preview.cost_messages}</N>{" "}
                {tx(T, "رسالة من رصيدك لا")} <N>{preview.audience.eligible}</N>.
              </AppText>
              <View
                style={{
                  backgroundColor: c.surfaceSunken,
                  borderRadius: 12,
                  padding: SPACE["3"],
                  marginBottom: SPACE["3"],
                }}
              >
                <AppText>{message || "—"}</AppText>
              </View>
              {blockers.length ? <BlockersNotice list={blockers} /> : null}
              <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
                <Strong>{tx(T, "ما لا نعد به.")}</Strong>{" "}
                {tx(
                  T,
                  "قبول المزوّد للرسالة ليس تسليماً، والتسليم ليس قراءة. نتائج الحملة تعرض «مقبول من المزوّد» و«فشل» فقط، ولا نسجّل «تم الاطلاع» بلا دليل.",
                )}
              </AppText>
            </>
          ) : (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "يُحسب الجمهور خادمياً…")}
            </AppText>
          )}

          <View style={{ gap: SPACE["3"] }}>
            <Button
              label={tx(T, "حفظ كمسودة")}
              onPress={() => void save()}
              loading={saving}
              disabledReason={!name.trim() ? tx(T, "اسم الحملة مطلوب") : undefined}
            />
            <Button
              variant="secondary"
              label={tx(T, "حفظ ومعاينة قبل الاعتماد")}
              onPress={() => void save(true)}
              disabledReason={
                !name.trim()
                  ? tx(T, "اسم الحملة مطلوب")
                  : blockers.length
                    ? tx(T, "لا يمكن الجدولة بعد")
                    : undefined
              }
            />
          </View>
          {saved ? (
            <View style={{ marginTop: SPACE["3"], gap: SPACE["1"] }}>
              <AppText variant="note" muted>
                {tx(
                  T,
                  "حُفظت كمسودة. أنت تنشئ الحملة، والاعتماد والجدولة يحتاجان صلاحية منفصلة في",
                )}
              </AppText>
              <Button
                variant="quiet"
                label={tx(T, "اعتماد الحملة")}
                onPress={() => router.push("/notify/campaigns")}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
