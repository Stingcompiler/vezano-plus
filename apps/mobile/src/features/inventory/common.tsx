import { formatQty } from "@sting/app-core";
import type { LocalItem } from "@sting/sync-core";
import {
  AppText,
  Chip,
  FONT,
  GroupedList,
  ROW_RTL,
  SPACE,
  ThemedText as Text,
} from "@sting/ui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import type { Dp, UnitOption } from "./units";

/** رقم لاتيني بخط mono معزول الاتجاه (القاعدة 2) — لا حرف عربي داخله. */
export function M({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/** صف شرائح بداية-يمين كالويب. */
export function Wrap({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: ROW_RTL,
        flexWrap: "wrap",
        gap: SPACE["2"],
        marginBottom: SPACE["3"],
      }}
    >
      {children}
    </View>
  );
}

/** ملاحظة ثانوية تحت كتلة. */
export function Note({ children, strong }: { children: ReactNode; strong?: string }) {
  return (
    <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
      {strong ? (
        <AppText variant="note" style={{ fontFamily: FONT.bold }}>
          {strong}
        </AppText>
      ) : null}
      {children}
    </AppText>
  );
}

/** «+3» / «−2»: الإشارة داخل mono لأنها غير عربية. */
export function Delta({ milli, dp }: { milli: bigint; dp: Dp }) {
  return <M>{`${milli > 0n ? "+" : ""}${formatQty(milli, dp)}`}</M>;
}

/** الأصناف النشطة فقط. */
export const activeOnly = (items: readonly LocalItem[]) =>
  items.filter((i) => i.is_active !== false);

export type Phase = "idle" | "saving" | "saved";
export type PushResult = "none" | "synced" | "pending" | "failed";

/** نتيجة `pushPending` كما في الويب: التطبيق/الخمول = مزامَن، retry = تعثّر، وغيره معلّق. */
export function pushKind(out: { kind: string }): PushResult {
  return out.kind === "applied" || out.kind === "idle"
    ? "synced"
    : out.kind === "retry"
      ? "failed"
      : "pending";
}

/** «13/09 14:22» بأرقام لاتينية. */
export function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** كتلة مجمّعة بحشوة للحقول (سطر إدخال واحد) — بلا شريط جانبي ولا بطاقة ملوّنة. */
export function Block({ title, children }: { title?: string | undefined; children: ReactNode }) {
  return (
    <GroupedList {...(title ? { title } : {})}>
      <View style={{ padding: SPACE["4"], gap: SPACE["1"] }}>{children}</View>
    </GroupedList>
  );
}

/** شرائح الوحدة المُدخلة — تظهر حين يكون للصنف أكثر من وحدة. */
export function UnitChips({
  options,
  value,
  labelOf,
  onChange,
}: {
  options: readonly UnitOption[];
  value: string;
  labelOf: (u: UnitOption) => string;
  onChange: (key: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <Wrap>
      {options.map((u) => (
        <Chip key={u.key} label={labelOf(u)} on={u.key === value} onPress={() => onChange(u.key)} />
      ))}
    </Wrap>
  );
}
