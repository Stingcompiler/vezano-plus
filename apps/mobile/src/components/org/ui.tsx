import { agoParts } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, FONT, RADIUS, SPACE, TOUCH, useColors } from "@sting/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type TextStyle, View } from "react-native";

/** رقم/مبلغ/وقت لاتيني بخط mono واتجاه LTR — لا حرف عربي داخله (القاعدة 2). */
export function N({ children, style }: { children: string | number; style?: TextStyle }) {
  return (
    <Text style={[{ fontFamily: FONT.mono, writingDirection: "ltr" }, style]}>
      {String(children)}
    </Text>
  );
}

/** يفصل الأرقام اللاتينية في نصّ عربي إلى mono (نظير `MonoText` في الويب) — لا حرف عربي داخل mono. */
export function Mono({ text }: { text: string }) {
  const parts = text.split(/([0-9][0-9,.:/-]*)/);
  return (
    <>
      {parts.map((p, i) =>
        /^[0-9]/.test(p) ? <N key={i}>{p}</N> : p ? <Text key={i}>{p}</Text> : null,
      )}
    </>
  );
}

/** إبراز كلمة داخل جملة (نظير `<strong>` في الويب). */
export function Strong({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: FONT.bold }}>{children}</Text>;
}

/** فقرة تمهيدية (نظير `acc-lead`). */
export function Lead({ children }: { children: ReactNode }) {
  return <AppText variant="secondary">{children}</AppText>;
}

/** ملاحظة هادئة (نظير `acc-choice__note`). */
export function Note({ children }: { children: ReactNode }) {
  return (
    <AppText variant="note" muted>
      {children}
    </AppText>
  );
}

/** أعداد مجمّعة بفاصلة الآلاف بلاتينية — بلا اعتماد على `toLocaleString`. */
export function group(n: number | string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** وحدة صغرى ← «1,180.00» (منزلتان). */
export function money(minor: string): string {
  const v = BigInt(minor || "0");
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = group((abs / 100n).toString());
  return `${neg ? "−" : ""}${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
}
/** وحدة صغرى ← «1,180» جنيهات كاملة مقرّبة (كالويب `thousands`). */
export function thousands(minor: string): string {
  return group(Math.round(Number(minor) / 100));
}

/** رأس قسم يبدأ كل كتلة. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <AppText variant="bodyStrong" style={{ marginTop: SPACE["2"], marginBottom: SPACE["1"] }}>
      {children}
    </AppText>
  );
}

type Tone = "active" | "disabled" | "expired" | "sent";
const TONE: Record<Tone, "synced" | "offline" | "stale" | "pending_sync"> = {
  active: "synced",
  disabled: "offline",
  expired: "stale",
  sent: "pending_sync",
};

/** كلمة حالة ملوّنة مرة واحدة (نظير `org-badge`): لا شريط جانبي ولا بطاقة ملوّنة. */
export function Word({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = useColors();
  return (
    <AppText variant="note" style={{ color: c.state[TONE[tone]].fg }}>
      {children}
    </AppText>
  );
}

/** صف في قائمة مجمّعة: عنوان وتفاصيل ثم أزرار الصف؛ فاصل شعري بين الصفوف. */
export function Item({
  title,
  status,
  children,
  last = false,
}: {
  title: ReactNode;
  /** كلمة الحالة (تظهر على النهاية) */
  status?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  const c = useColors();
  return (
    <View
      style={{
        paddingHorizontal: SPACE["4"],
        paddingVertical: SPACE["3"],
        gap: SPACE["1"],
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE["3"] }}>
        <View style={{ flex: 1 }}>
          {typeof title === "string" ? <AppText variant="bodyStrong">{title}</AppText> : title}
        </View>
        {status}
      </View>
      {children}
    </View>
  );
}

/** صف أزرار (التفاف على الهاتف الضيّق). */
export function Actions({ children }: { children: ReactNode }) {
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE["2"], marginTop: SPACE["2"] }}
    >
      {children}
    </View>
  );
}

/** صف مفتاح/قيمة مضغوط (بديل قوائم `<dl>`): الاسم على البداية والقيمة على النهاية. */
export function KV({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: SPACE["3"], paddingVertical: SPACE["1"] }}>
      <AppText variant="secondary" muted style={{ minWidth: 88 }}>
        {label}
      </AppText>
      <AppText variant="secondary" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

/** «قبل 40 ثانية» / «قبل 3 ساعات» — الرقم في mono والكلمة خارجه (نظير `Ago` في `features/org/ago.tsx`). */
export function Ago({ iso }: { iso: string }) {
  const K = "shared:features/org/ago.tsx";
  if (!iso) return <Text>{tx(K, "لم يظهر بعد")}</Text>;
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60)
    return (
      <Text>
        {tx(K, "قبل")} <N>{sec}</N> {tx(K, "ثانية")}
      </Text>
    );
  const p = agoParts(iso);
  const word =
    p.unit === "minute"
      ? p.n === 1
        ? tx(K, "دقيقة")
        : p.n === 2
          ? tx(K, "دقيقتين")
          : p.n <= 10
            ? tx(K, "دقائق")
            : tx(K, "دقيقة")
      : p.unit === "hour"
        ? p.n === 1
          ? tx(K, "ساعة")
          : p.n === 2
            ? tx(K, "ساعتين")
            : p.n <= 10
              ? tx(K, "ساعات")
              : tx(K, "ساعة")
        : p.n === 1
          ? tx(K, "يوم")
          : p.n === 2
            ? tx(K, "يومين")
            : p.n <= 10
              ? tx(K, "أيام")
              : tx(K, "يوماً");
  if (p.n === 1 || p.n === 2)
    return (
      <Text>
        {tx(K, "قبل")} {word}
      </Text>
    );
  return (
    <Text>
      {tx(K, "قبل")} <N>{p.n}</N> {word}
    </Text>
  );
}

/** خيار واحد من عدّة (نظير radio في الويب): صف لمس ≥44 بعلامة اختيار نصّية، لا لون وحده. */
export function Choice({
  on,
  disabled = false,
  onPress,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: TOUCH.min,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        paddingVertical: SPACE["2"],
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 20, color: on ? c.brandPrimary : c.inkMuted }}>
        {on ? "●" : "○"}
      </Text>
      <AppText style={{ flex: 1 }}>{children}</AppText>
    </Pressable>
  );
}

/** شريحة بمحتوى غني (رقم mono داخل التسمية) — لمس ≥44 كشريحة `Chip`. */
export function RichChip({
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
        borderRadius: RADIUS.button,
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

/** خانة اختيار (checkbox) بصف لمس ≥44 وعلامة نصّية. */
export function Check({
  on,
  disabled = false,
  onPress,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: TOUCH.min,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE["3"],
        paddingVertical: SPACE["2"],
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 20, color: on ? c.brandPrimary : c.inkMuted }}>
        {on ? "☑" : "☐"}
      </Text>
      <AppText style={{ flex: 1 }}>{children}</AppText>
    </Pressable>
  );
}
