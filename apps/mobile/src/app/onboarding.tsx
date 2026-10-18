import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { openHref } from "@/lib/home";
import { useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";

const T = "ACC-10";
type State = "ready" | "empty" | "partial" | "offline" | "success";

interface Onboarding {
  readonly tenant_name: string;
  readonly currency_name: string;
  readonly branches: number;
  readonly dismissed: boolean;
  readonly steps: Record<string, Record<string, unknown>>;
}

interface Step {
  readonly key: string;
  readonly title: string;
  readonly detail: React.ReactNode;
  readonly action: string;
  readonly href: string;
  readonly mark: "done" | "partial" | number;
  /** يحتاج الخادم (34-D26 offline): البيانات والشعار والدعوة. */
  readonly needsServer: boolean;
}

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * ACC-10 — معالج بدء الاستخدام على الهاتف (خطة الجوال M1؛ 0005 §١٧٦). الخطوات والحالات من الويب
 * (`onboarding-client.tsx`): كلها تخطٍّ، التقدّم يُعرض ولا يُلاحَق، والصرف النهائي يُحفظ خادمياً فلا يعود
 * على أي جهاز. الخطوات صفوف بعلامتها (✓ أو ! أو رقمها)؛ ما لم يُبنَ على الهاتف يُفتح على الويب — ومنه
 * رفع الشعار حتى يُضاف منتقي الصور الأصلي.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { api } = useSession();
  const c = useColors();
  const [data, setData] = useState<Onboarding | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d, response } = await api.GET("/api/tenants/onboarding");
      setOffline(false);
      if (response.ok && d) setData(d);
    } catch {
      setOffline(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const finish = async () => {
    setBusy(true);
    try {
      const { data: d, response } = await api.PATCH("/api/tenants/onboarding", {
        body: { dismissed: true },
      });
      if (response.ok && d) setData(d);
      if (response.ok) setCompleted(true);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const go = (href: string) => openHref(href, (p) => router.push(p));

  const s = data?.steps ?? {};
  const items = s.items ?? {};
  const imported = Number(items.imported ?? 0);
  const rejected = Number(items.rejected ?? 0);
  const sales = Number(items.sales ?? 0);
  const balances = Number(s.balances?.count ?? 0);
  const invites = Number(s.invite?.sent ?? 0);
  const steps: Step[] = data
    ? [
        {
          key: "org",
          title: tx(T, "بيانات المنشأة والعملة"),
          detail: (
            <>
              {data.tenant_name} · {data.currency_name} ·{" "}
              {data.branches === 1 ? (
                tx(T, "فرع واحد")
              ) : (
                <>
                  <N>{data.branches}</N> {tx(T, "فروع")}
                </>
              )}
            </>
          ),
          action: tx(T, "تعديل"),
          href: "/org/settings",
          mark: "done",
          needsServer: true,
        },
        {
          key: "items",
          title: rejected > 0 ? tx(T, "استيراد الأصناف — جزئي") : tx(T, "استيراد الأصناف"),
          detail:
            imported > 0 || rejected > 0 ? (
              <>
                <N>{imported}</N> {tx(T, "صنفاً دخلت ·")} <N>{rejected}</N>{" "}
                {tx(T, "سطراً مرفوضاً ينتظر التصحيح")}
              </>
            ) : sales === 0 ? (
              tx(T, "نقترح أصنافك بعد أول أسبوع بيع")
            ) : (
              tx(T, "لم تبدأ")
            ),
          action: rejected > 0 ? tx(T, "تصحيح المرفوض") : tx(T, "ابدأ"),
          href: "/catalog/import",
          mark: rejected > 0 ? "partial" : imported > 0 ? "done" : 2,
          needsServer: false,
        },
        {
          key: "balances",
          title: tx(T, "أرصدة العملاء الافتتاحية"),
          detail:
            balances > 0 ? <N>{balances}</N> : tx(T, "لم تبدأ — يمكن إضافتها عند أول بيع آجل"),
          action: tx(T, "ابدأ"),
          href: "/parties/opening",
          mark: balances > 0 ? "done" : 3,
          needsServer: false,
        },
        {
          key: "printer",
          title: tx(T, "ربط الطابعة وتجربة إيصال"),
          detail: s.printer?.linked ? tx(T, "تم") : tx(T, "لم تبدأ — البيع يعمل بلا طابعة"),
          action: tx(T, "ابدأ"),
          href: "/settings/printer",
          mark: s.printer?.linked ? "done" : 4,
          needsServer: false,
        },
        {
          key: "logo",
          title: tx(T, "شعار"),
          detail: s.logo?.present ? tx(T, "تم") : tx(T, "لم تبدأ"),
          action: tx(T, "ابدأ"),
          href: "/onboarding",
          mark: s.logo?.present ? "done" : 5,
          needsServer: true,
        },
        {
          key: "invite",
          title: tx(T, "دعوة موظف"),
          detail: invites > 0 ? <N>{invites}</N> : tx(T, "لم تبدأ"),
          action: tx(T, "ابدأ"),
          href: "/org/team",
          mark: invites > 0 ? "done" : 6,
          needsServer: true,
        },
      ]
    : [];
  const doneCount = steps.filter((x) => x.mark === "done").length;
  const startedBeyondOrg = steps.some((x) => x.mark === "partial") || doneCount > 1;

  const state: State =
    completed || data?.dismissed
      ? "success"
      : offline
        ? "offline"
        : !data
          ? "ready"
          : startedBeyondOrg
            ? "partial"
            : sales === 0 && imported === 0
              ? "empty"
              : "ready";

  if (state === "success") {
    return (
      <Screen screenId={T} state={state} title={tx(T, "اكتمل المعالج")}>
        <StateView state="success" title={tx(T, "اكتمل المعالج")}>
          <AppText variant="secondary">
            {tx(
              T,
              "المعالج لم يعد يظهر. وما تُخطّيه يبقى متاحاً في الإعدادات بمكانه المعروف لا مخبوءاً.",
            )}
          </AppText>
        </StateView>
        <Button
          label={tx(T, "افتح وردية وابدأ البيع")}
          financial
          onPress={() => go("/shifts/open")}
        />
      </Screen>
    );
  }

  const mark = (m: Step["mark"]) => (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: m === "done" ? c.brandPrimary : m === "partial" ? c.warn : c.border,
      }}
    >
      <Text
        style={{
          fontFamily: FONT.mono,
          color: m === "done" ? c.brandPrimary : m === "partial" ? c.warn : c.inkMuted,
        }}
      >
        {m === "done" ? "✓" : m === "partial" ? "!" : String(m)}
      </Text>
    </View>
  );

  return (
    <Screen
      screenId={T}
      state={state}
      title={`${tx(T, "تجهيز")} ${data?.tenant_name ?? ""}`.trim()}
      onRefresh={() => void load()}
    >
      {steps.length ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={tx(T, "تقدّم تجهيز المنشأة")}
          accessibilityValue={{ min: 0, max: steps.length, now: doneCount }}
          style={{ marginBottom: SPACE["4"], gap: SPACE["2"] }}
        >
          <AppText variant="secondary" muted>
            <N>{doneCount}</N> {tx(T, "من")} <N>{steps.length}</N> {tx(T, "· تستطيع البيع الآن")}
          </AppText>
          <View
            style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}
          >
            <View
              style={{
                width: `${(doneCount / steps.length) * 100}%`,
                height: 6,
                backgroundColor: c.brandPrimary,
              }}
            />
          </View>
        </View>
      ) : null}

      <View style={{ marginBottom: SPACE["4"] }}>
        <Button label={tx(T, "ابدأ البيع")} financial onPress={() => go("/shifts/open")} />
      </View>

      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "المعالج بلا اتصال")}>
          <AppText variant="secondary">
            {tx(
              T,
              "المحليّتان تعملان الآن، والأخريان موسومتان «تحتاج اتصالاً» ومحفوظتان لتُنفَّذا تلقائياً عند عودة الشبكة.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {steps.length ? (
        <GroupedList>
          {steps.map((st, i) => (
            <Pressable
              key={st.key}
              accessibilityRole="button"
              accessibilityLabel={`${st.title} — ${st.action}`}
              onPress={() => (st.key === "logo" ? void openOnWeb("/onboarding") : go(st.href))}
              style={({ pressed }) => ({
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACE["3"],
                paddingHorizontal: SPACE["4"],
                paddingVertical: SPACE["3"],
                borderBottomWidth: i === steps.length - 1 ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: c.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {mark(st.mark)}
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong">{st.title}</AppText>
                <AppText variant="note" muted>
                  {st.detail}
                </AppText>
                {st.needsServer && offline ? (
                  <AppText variant="note" style={{ color: c.state.offline.fg }}>
                    {tx(T, "تحتاج اتصالاً")}
                  </AppText>
                ) : null}
              </View>
              <AppText
                variant="secondary"
                style={{ color: st.mark === "partial" ? c.warn : c.brandPrimary }}
              >
                {st.action}
              </AppText>
            </Pressable>
          ))}
        </GroupedList>
      ) : null}

      {state === "partial" && rejected > 0 ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
          {tx(T, "لا تُشترط الخطوات الأربع لبدء البيع. الاستيراد نصفه منتهٍ —")} <N>{imported}</N>{" "}
          {tx(T, "صنفاً دخلت و")}
          <N>{rejected}</N> {tx(T, "رُفضت، ويمكنك تصحيحها لاحقاً دون إعادة البقية.")}
        </AppText>
      ) : null}

      <Button
        label={tx(T, "اكتمل المعالج")}
        variant="quiet"
        loading={busy}
        disabledReason={offline ? tx(T, "تحتاج اتصالاً") : undefined}
        onPress={() => void finish()}
      />
    </Screen>
  );
}
