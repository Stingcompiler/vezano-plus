import { agoParts } from "@sting/app-core";
import { AppText, FONT, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { pluralForm, untilParts } from "@/features/market-discovery/lib";

/** رقم لاتيني بخط mono معزول الاتجاه — لا حرف عربي داخله (القاعدة 2). */
export function M({ children, strong = false }: { children: string | number; strong?: boolean }) {
  return (
    <Text style={{ fontFamily: strong ? FONT.monoSemiBold : FONT.mono, writingDirection: "ltr" }}>
      {String(children)}
    </Text>
  );
}

export type StatusTone = "success" | "stale" | "expired" | "synced";

/** حالة تُعرض مرة واحدة ككلمة ملوّنة (لا شريط ولا دائرة) — القاعدة 5. */
export function StatusWord({ tone, label }: { tone: StatusTone; label: string }) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[tone].fg }}>
      {label}
    </AppText>
  );
}

/** عدد بصيغته العربية: واحد/اثنان نصّاً، وإلا الرقم mono ثم المعدود. */
export function Count({
  n,
  forms,
}: {
  n: number;
  forms: { one: string; two: string; few: string; many: string };
}) {
  const f = pluralForm(n);
  if (f === "one" || f === "two") return <>{forms[f]}</>;
  return (
    <>
      <M>{n}</M> {forms[f]}
    </>
  );
}

/** «22 دقيقة» من وقت لقطة — الرقم mono والوحدة نص. */
export function AgoNum({
  iso,
  words,
}: {
  iso: string;
  words: { minute: string; hour: string; day: string };
}) {
  const p = agoParts(iso);
  return (
    <>
      <M>{p.n}</M> {words[p.unit]}
    </>
  );
}

/** صف قائمة بعنوان ووصف من عقد React وقيمة على النهاية؛ الصف كله هدف لمس ≥ 52. */
export function Row({
  title,
  sub,
  trailing,
  onPress,
  last = false,
  dim = false,
}: {
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  last?: boolean;
  dim?: boolean;
}) {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: sub ? 64 : TOUCH.row,
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["2"],
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        opacity: dim ? 0.65 : 1,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <AppText>{title}</AppText>
        {sub ? (
          <AppText variant="secondary" muted>
            {sub}
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

/** قائمتا «نعم/لا» (تعني/لا تعني، يتوقف/يبقى…) مكدّستان على الهاتف بدل عمودين. */
export function Marked({
  title,
  items,
  mark,
}: {
  title: string;
  items: readonly string[];
  mark: string;
}) {
  const c = useColors();
  return (
    <View style={{ marginBottom: SPACE["3"] }}>
      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
        {title}
      </AppText>
      {items.map((t) => (
        <View key={t} style={{ flexDirection: "row", gap: SPACE["2"], paddingVertical: 2 }}>
          <AppText variant="note" style={{ color: c.inkMuted, minWidth: 28 }}>
            {mark}
          </AppText>
          <AppText variant="secondary" style={{ flex: 1 }}>
            {t}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** نصّ ملاحظة ثانوية بتباعد موحّد. */
export function Note({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <AppText
      variant={strong ? "bodyStrong" : "note"}
      muted={!strong}
      style={{ marginBottom: SPACE["2"] }}
    >
      {children}
    </AppText>
  );
}

/** عنوان قسم داخل الشاشة. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <AppText variant="title" accessibilityRole="header" style={{ marginBottom: SPACE["2"] }}>
      {children}
    </AppText>
  );
}

/** أزرار عمودية بتباعد موحّد. */
export function Stack({ children }: { children: ReactNode }) {
  return <View style={{ gap: SPACE["3"], marginBottom: SPACE["4"] }}>{children}</View>;
}

/** صف شرائح مقطعية من اليمين (فلتر/منطقة/فئة). */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        gap: SPACE["2"],
        marginBottom: SPACE["3"],
      }}
    >
      {children}
    </View>
  );
}

/** تسمية فوق قيمة (قائمة الحقائق في تفاصيل العرض). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ paddingVertical: SPACE["2"] }}>
      <AppText variant="note" muted>
        {label}
      </AppText>
      <AppText>{children}</AppText>
    </View>
  );
}

/** «09 سبتمبر» — اليوم mono والشهر نص. */
export function Until({ dateIso }: { dateIso: string }) {
  const { day, month } = untilParts(dateIso);
  return (
    <>
      <M>{day}</M> {month}
    </>
  );
}

/** شريحة لمس ≥44 بمحتوى عقدة (اسم عربي + عدد mono). */
export function NodeChip({
  on,
  onPress,
  children,
}: {
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        minHeight: TOUCH.min,
        paddingHorizontal: SPACE["3"],
        borderRadius: 12,
        borderWidth: 1,
        borderColor: on ? c.brandPrimary : c.border,
        backgroundColor: on ? c.brandTint : c.surfaceCard,
        justifyContent: "center",
      }}
    >
      <AppText variant="secondary" style={{ color: on ? c.brandStrong : c.inkStrong }}>
        {children}
      </AppText>
    </Pressable>
  );
}

/** ملاحظة إعلامية محايدة (Notice kind="info" في الويب): بطاقة مسطّحة بعنوان ونص، بلا لون حالة. */
export function InfoBox({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: c.surfaceCard,
        borderRadius: 12,
        padding: SPACE["4"],
        gap: SPACE["2"],
        marginBottom: SPACE["4"],
      }}
    >
      <AppText variant="bodyStrong">{title}</AppText>
      {children}
    </View>
  );
}
