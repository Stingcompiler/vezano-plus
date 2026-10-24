import { agoParts, countPending, formatMinorShort, hhmm } from "@sting/app-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  Card,
  Chip,
  FONT,
  GroupedList,
  RADIUS,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TOUCH,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { type HomeSummary, openHref, readHomeCache, writeHomeCache } from "@/lib/home";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "HOME-01";
const PERIODS = [
  { value: "today", label: tx(T, "اليوم") },
  { value: "7d", label: tx(T, "آخر 7 أيام") },
  { value: "month", label: tx(T, "هذا الشهر") },
] as const;

/** رقم داخل جملة عربية: خط mono لاتيني بجانب الكلمات لا بدلها. */
/** عدد الفروع بصيغة العدّ العربية كالويب: واحد، اثنان، 3–10 جمعاً، وما فوق تمييزاً. */
function BranchCount({ n }: { n: number }) {
  if (n === 1) return <Text>{mtx("branchesOne")}</Text>;
  if (n === 2) return <Text>{mtx("branchesTwo")}</Text>;
  return (
    <Text>
      <N>{n}</N> {n >= 3 && n <= 10 ? mtx("branchesFew") : mtx("branchesMany")}
    </Text>
  );
}

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

function Row({
  title,
  detail,
  trailing,
  onPress,
  last,
}: {
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["3"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {detail ? (
          <AppText variant="secondary" muted>
            {detail}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.surfaceSunken : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

function greeting(): string {
  return new Date().getHours() < 12 ? tx(T, "صباح الخير") : tx(T, "مساء الخير");
}

/**
 * HOME-01/02 — الرئيسية (خطة الجوال M1؛ 0005 §١٧٥). اسم المحل عنواناً كبيراً، ثم «يحتاج قرارك»، ثم
 * الأرقام صفوفاً لا بطاقات (بطاقة لكل رقم ممنوعة §١٥٩) — كل رقم بمصدره ووقته، والمعلّق من هذا الجهاز
 * ظاهر. سحب للتحديث. بلا اتصال أو حين تتعثّر المطابقة: آخر ملخّص معروف بوقته. الروابط تفتح الشاشة
 * المبنية على الهاتف أو الويب. الموظف: اختصارات عمله ومهامه، والمالي المحجوب لا يُعرض.
 */
export default function Home() {
  const router = useRouter();
  const { api } = useSession();
  const c = useColors();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [period, setPeriod] = useState("today");
  const [branch, setBranch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const storage = await getStorage();
    setPending(await countPending(storage).catch(() => 0));
    const cache = await readHomeCache(storage);
    try {
      const { data, response } = await api.GET("/api/home", {
        params: { query: { period, branch_id: branch } },
      });
      setOffline(false);
      if (response.ok && data) {
        const s = data as unknown as HomeSummary;
        setSummary(s);
        setSavedAt(null);
        setFailed(false);
        await writeHomeCache(storage, s);
        return;
      }
      setFailed(true);
    } catch {
      setOffline(true);
    }
    if (cache) {
      setSummary(cache.summary);
      setSavedAt(cache.savedAt);
    }
  }, [api, branch, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!summary) {
    return (
      <Screen screenId={T} state={offline ? "offline" : "loading"} title={tx(T, "فيزانو بلص")}>
        {offline ? (
          <StateView state="offline" title={tx(T, "بلا اتصال")} />
        ) : (
          <AppText variant="secondary" muted accessibilityRole="progressbar">
            {tx(T, "جارٍ الجمع")}
          </AppText>
        )}
      </Screen>
    );
  }

  const isOwner = summary.kind === "owner";
  const hasNumbers =
    summary.kpis.length > 0 || summary.decisions.length > 0 || summary.attention.length > 0;
  const stale = failed && Boolean(savedAt);
  const ownerState = offline
    ? "offline"
    : pending > 0
      ? "pending_sync"
      : stale
        ? "stale"
        : !hasNumbers
          ? "empty"
          : "ready";
  const employeeState = offline
    ? "offline"
    : summary.quick_actions.length === 0
      ? "permission_denied"
      : stale
        ? "stale"
        : summary.tasks.length === 0 && pending === 0
          ? "empty"
          : "ready";
  const state = isOwner ? ownerState : employeeState;
  const coverage = savedAt ?? summary.coverage_at;
  const go = (href: string) => openHref(href, (p) => router.push(p));

  const banner = offline ? (
    <StateView state="offline" title={tx(T, "بلا اتصال")} />
  ) : isOwner && pending > 0 ? (
    <StateView state="pending_sync" title={tx(T, "عمليات لم تُرفع — على هذا الجهاز")}>
      <AppText variant="secondary">
        <N>{pending}</N> {tx(T, "عمليات معلّقة")}
      </AppText>
    </StateView>
  ) : stale ? (
    <StateView state="stale" title={tx(T, "أرقام قديمة")} />
  ) : null;

  return (
    <Screen
      screenId={isOwner ? "HOME-01" : "HOME-02"}
      state={state}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {/* شارة الحالة تفتح مركز المزامنة (SYS-01) — خطة الجوال §٣ */}
      {banner ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tx("SYS-01", "مركز الاتصال والمزامنة")}
          onPress={() => router.push("/sync")}
        >
          {banner}
        </Pressable>
      ) : null}
      {/* البحث العام (HOME-03) كحقل شريط الويب: لمسة تفتح شاشة البحث بحقلها مركّزاً */}
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={tx("shared:features/home/app-nav.tsx", "ابحث عن صنف أو فاتورة أو عميل")}
        onPress={() => router.push("/search")}
        style={({ pressed }) => ({
          minHeight: TOUCH.row,
          justifyContent: "center",
          borderRadius: RADIUS.button,
          backgroundColor: c.surfaceCard,
          borderWidth: 1,
          borderColor: c.border,
          paddingHorizontal: SPACE["3"],
          marginBottom: SPACE["4"],
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <AppText variant="secondary" muted>
          {tx("shared:features/home/app-nav.tsx", "ابحث عن صنف أو فاتورة أو عميل")}
        </AppText>
      </Pressable>
      {isOwner ? (
        <>
          {/* كبطاقة التحية في الويب: الاسم والدور والفروع ثم الفترة والفرع داخل بطاقة واحدة */}
          <Card>
            <AppText variant="bodyStrong">
              {greeting()} — {summary.tenant_name}
            </AppText>
            <AppText variant="secondary" muted style={{ marginBottom: SPACE["2"] }}>
              {summary.user.display_name} — {summary.user.role_name} {tx(T, "· كل الفروع")}
            </AppText>
            <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
              <BranchCount n={summary.branches.length} /> ·{" "}
              {summary.devices_total === 0
                ? tx(T, "لا جهاز مسجّل بعد")
                : summary.branches_synced
                  ? tx(T, "كلها زامنت")
                  : tx(T, "بعضها لم يزامن")}
            </AppText>

            {/* الفترة والفرع: شرائح لمس لا قوائم منسدلة */}
            <View accessibilityLabel={tx(T, "الفترة")} style={chips}>
              {PERIODS.map((p) => (
                <Chip
                  key={p.value}
                  on={period === p.value}
                  label={p.label}
                  onPress={() => setPeriod(p.value)}
                />
              ))}
            </View>
            {summary.branches.length > 1 ? (
              <View accessibilityLabel={tx(T, "الفرع")} style={chips}>
                <Chip on={branch === ""} label={tx(T, "كل الفروع")} onPress={() => setBranch("")} />
                {summary.branches.map((b) => (
                  <Chip
                    key={b.id}
                    on={branch === b.id}
                    label={b.name}
                    onPress={() => setBranch(b.id)}
                  />
                ))}
              </View>
            ) : null}
          </Card>

          {state === "empty" ? (
            <StateView state="empty" title={tx(T, "يومٌ لم يبدأ")}>
              <AppText variant="secondary">{tx(T, "لم يبدأ البيع بعد")}</AppText>
              <Button label={tx(T, "افتح وردية")} onPress={() => go("/shifts/open")} />
            </StateView>
          ) : (
            <>
              {summary.decisions.length > 0 ? (
                <GroupedList
                  tone="offline"
                  title={`${tx(T, "يحتاج قرارك —")} ${summary.decisions_count}`}
                >
                  {summary.decisions.map((d, i) => (
                    <Row
                      key={d.id}
                      title={d.title}
                      detail={d.detail}
                      onPress={() => go(d.href)}
                      trailing={
                        <AppText
                          variant="secondary"
                          // كالويب: الفعل بلون العلامة عريضاً، والخطورة على النقطة لا على الفعل
                          style={{ color: c.brandStrong, fontFamily: FONT.bold }}
                        >
                          {d.action}
                        </AppText>
                      }
                      last={i === summary.decisions.length - 1}
                    />
                  ))}
                </GroupedList>
              ) : null}
              {summary.kpis.length > 0 ? (
                <GroupedList>
                  {summary.kpis.map((k, i) => {
                    const ago = agoParts(k.as_of);
                    return (
                      <Row
                        key={k.key}
                        title={k.label}
                        onPress={() => go(k.href)}
                        detail={
                          <>
                            {k.scope} · {tx(T, "محدّث قبل")} <N>{ago.n}</N>{" "}
                            {ago.unit === "minute"
                              ? tx(T, "دقيقة")
                              : ago.unit === "hour"
                                ? tx(T, "ساعة")
                                : tx(T, "يوم")}
                            {k.note ? ` · ${k.note}` : ""}
                            {pending > 0 && k.includes_pending ? ` · ${tx(T, "يشمل معلّقاً")}` : ""}
                          </>
                        }
                        trailing={
                          k.value.kind === "money" ? (
                            <View
                              style={{
                                flexDirection: ROW_RTL,
                                alignItems: "baseline",
                                gap: 4,
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: FONT.monoSemiBold,
                                  fontSize: 20,
                                  color: c.inkStrong,
                                }}
                              >
                                {formatMinorShort(k.value.amount_minor, k.value.exponent)}
                              </Text>
                              <AppText variant="note" muted>
                                {tx(T, "ج.س")}
                              </AppText>
                            </View>
                          ) : (
                            <Text
                              style={{
                                fontFamily: FONT.monoSemiBold,
                                fontSize: 20,
                                color: c.inkStrong,
                              }}
                            >
                              {String(k.value.n)}
                            </Text>
                          )
                        }
                        last={i === summary.kpis.length - 1}
                      />
                    );
                  })}
                </GroupedList>
              ) : null}
              {summary.attention.length > 0 ? (
                <GroupedList title={tx(T, "يحتاج انتباهك")}>
                  {summary.attention.map((a, i) => (
                    <Row
                      key={a.id}
                      title={
                        <>
                          {a.title_count !== undefined && a.title_count !== null ? (
                            <>
                              <N>{a.title_count}</N>{" "}
                            </>
                          ) : null}
                          {a.title}
                          {a.minutes !== undefined && a.minutes !== null ? (
                            <>
                              {" "}
                              <N>{a.minutes}</N> {tx(T, "دقيقة")}
                            </>
                          ) : null}
                        </>
                      }
                      detail={a.detail}
                      onPress={() => go(a.href)}
                      trailing={<AppText variant="secondary">{a.action}</AppText>}
                      last={i === summary.attention.length - 1}
                    />
                  ))}
                </GroupedList>
              ) : null}
              {summary.margin_locked ? (
                <StateView state="phase_locked" title={tx(T, "الهامش وصافي الربح غير محسوبين بعد")}>
                  <AppText variant="secondary">
                    {tx(
                      T,
                      "لا نعرض رقم ربح مبنياً على تخمين: يحتاج قرارك في كيفية احتساب تكلفة الوحدة المباعة",
                    )}
                    {summary.kpis.length > 0 ? tx(T, "، والإيراد والذمم أعلاه مستقلان عنه") : ""}.
                  </AppText>
                  <Button
                    label={tx(T, "حدّد طريقة حساب التكلفة")}
                    variant="secondary"
                    onPress={() => go("/purchasing/cost-margin")}
                  />
                </StateView>
              ) : null}
            </>
          )}
          <AppText variant="note" muted>
            {tx(T, "كل الأرقام حتى تغطية الخادم")} <N>{hhmm(coverage)}</N>
            {pending > 0 ? tx(T, "، وتشمل عمليات هذا الجهاز المعلقة") : ""}
            {tx(T, ". أجهزة الفروع الأخرى قد تحمل عمليات لم تصل بعد.")}
          </AppText>
        </>
      ) : (
        <>
          <AppText variant="bodyStrong">
            {greeting()}
            {tx(T, "،")} {summary.user.display_name}
          </AppText>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
            {summary.user.role_name} · {summary.user.branch_name}
            {summary.user.device_name ? ` · ${summary.user.device_name}` : ""}
          </AppText>
          {summary.shift ? (
            <AppText variant="secondary" style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "وردية مفتوحة منذ")} <N>{hhmm(summary.shift.open_since)}</N>
            </AppText>
          ) : null}
          {summary.quick_actions.length > 0 ? (
            <View style={{ gap: SPACE["2"], marginBottom: SPACE["4"] }}>
              {summary.quick_actions.includes("sale") ? (
                <Button
                  label={state === "empty" ? tx(T, "افتح نقطة البيع") : tx(T, "بيع جديد")}
                  financial
                  onPress={() => router.push("/pos")}
                />
              ) : null}
              {summary.quick_actions.includes("payment") ? (
                <Button
                  label={tx(T, "تسجيل سداد")}
                  variant="secondary"
                  onPress={() => go("/parties/payment")}
                />
              ) : null}
              {summary.quick_actions.includes("return") ? (
                <Button
                  label={tx(T, "مرتجع")}
                  variant="secondary"
                  onPress={() => go("/pos/return")}
                />
              ) : null}
            </View>
          ) : null}
          <GroupedList title={tx(T, "مهامك اليوم")}>
            {state === "empty" ? (
              <Row
                title={tx(T, "لا مهام اليوم")}
                detail={tx(T, "الوردية مفتوحة ولا شيء ينتظره.")}
                last
              />
            ) : null}
            {pending > 0 ? (
              <Row
                title={
                  <>
                    <N>{pending}</N> {tx(T, "عمليات معلقة تنتظر عودة الاتصال")}
                  </>
                }
              />
            ) : null}
            {summary.tasks.map((t, i) => (
              <Row
                key={t.id}
                title={t.title}
                onPress={() => go(t.href)}
                trailing={<AppText variant="secondary">{tx(T, "افتح")}</AppText>}
                last={i === summary.tasks.length - 1}
              />
            ))}
          </GroupedList>
          {!summary.can_see_finance ? (
            <StateView state="permission_denied" title={tx(T, "خارج صلاحيتك")}>
              <AppText variant="secondary">
                {tx(T, "التقارير المالية وأرصدة كل العملاء والتكلفة والهامش لا تظهر لدور")}{" "}
                {summary.user.role_name}
                {tx(T, ". هذا ليس عطلاً — اطلب التوسيع من المالك إن احتجته.")}
              </AppText>
            </StateView>
          ) : null}
          {stale && savedAt ? (
            <AppText variant="note" muted>
              {tx(T, "الأرقام من آخر مطابقة")} <N>{hhmm(savedAt)}</N>
            </AppText>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const chips = {
  flexDirection: ROW_RTL,
  flexWrap: "wrap",
  gap: SPACE["2"],
  marginBottom: SPACE["2"],
} as const;
