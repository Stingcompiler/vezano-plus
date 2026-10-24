import { lineTotalMinor } from "@sting/domain";
import { formatMinorShort, formatQty } from "@sting/app-core";
import { type CatalogRow, checkQty, unitRowsOf } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  Keypad,
  ROW_RTL,
  Sheet,
  SPACE,
  ThemedText as Text,
  useColors,
} from "@sting/ui-native";
import { useState } from "react";
import { View } from "react-native";

const T = "POS-02";
const WEIGHT_ERROR =
  "الوزن يقبل ثلاث منازل عشرية كحد أقصى. اكتب 0.123 أو 0.124 — لن نقرّب نيابة عنك في معاملة مالية.";

/**
 * POS-02 — اختيار وحدة أو وزن (خطة الجوال M2): ورقة سفلية بلوحة أرقام كبيرة. التحويل مُعلن («= 12 كغ»)
 * وقيمة السطر محسوبة أمام المستخدم قبل التأكيد. الوزن ثلاث منازل كحد أقصى — لا تقريب نيابةً عنه؛ الزر
 * معطّل بسببه حتى تصحيح الكمية (disabledReason مرئي لا زر صامت).
 */
export function UnitSheet({
  row: initial,
  initialQtyMilli,
  onConfirm,
  onClose,
}: {
  row: CatalogRow;
  initialQtyMilli?: string | undefined;
  onConfirm: (row: CatalogRow, qtyMilli: string) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const units = unitRowsOf(initial.item);
  const [row, setRow] = useState<CatalogRow>(initial);
  const [text, setText] = useState(() =>
    initialQtyMilli ? formatQty(initialQtyMilli, initial.decimalPlaces) : "",
  );
  const check = text.trim() ? checkQty(text, row.decimalPlaces) : null;
  const error =
    check && !check.ok
      ? check.reason === "too_many_decimals"
        ? row.decimalPlaces === 3
          ? WEIGHT_ERROR
          : `${tx(T, "هذه الوحدة تقبل")} ${row.decimalPlaces} ${tx(T, "منازل على الأكثر")}`
        : tx(T, "اكتب كمية موجبة — مثل 2 أو 0.5")
      : undefined;
  const value =
    check?.ok === true
      ? formatMinorShort(lineTotalMinor(BigInt(check.qtyMilli), BigInt(row.unitPriceMinor)))
      : null;

  return (
    <Sheet open title={`${initial.item.name} ${tx(T, "— اختيار الوحدة")}`} onClose={onClose}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الوحدة المختارة تُثبَّت على سطر البيع ولا تتأثر بتغيير المعامل لاحقاً")}
      </AppText>
      <View style={{ flexDirection: ROW_RTL, flexWrap: "wrap", gap: SPACE["2"] }}>
        {units.map((u) => (
          <Chip
            key={u.key}
            on={u.key === row.key}
            label={`${u.unitCode} · ${formatMinorShort(u.unitPriceMinor)}`}
            onPress={() => setRow(u)}
          />
        ))}
      </View>
      <AppText variant="secondary" muted style={{ marginTop: SPACE["3"] }}>
        {tx(T, "الكمية بال")}
        {row.unitName}
      </AppText>
      <Text
        accessibilityLabel={`${tx(T, "الكمية بال")}${row.unitName}`}
        style={{
          fontFamily: FONT.monoSemiBold,
          fontSize: 32,
          textAlign: "center",
          writingDirection: "ltr",
          marginVertical: SPACE["2"],
        }}
      >
        {text || "0"}
      </Text>
      {error ? (
        <AppText variant="note" style={{ color: c.danger, marginBottom: SPACE["2"] }}>
          {error}
        </AppText>
      ) : null}
      <Keypad value={text} onChange={setText} decimals={row.decimalPlaces > 0} />
      <View style={{ marginTop: SPACE["3"], gap: SPACE["2"] }}>
        <AppText variant="secondary">
          {tx(T, "القيمة")}:{" "}
          {value && check?.ok ? (
            <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
              {formatQty(check.qtyMilli, row.decimalPlaces)} ×{" "}
              {formatMinorShort(row.unitPriceMinor)} = {value}
            </Text>
          ) : (
            tx(T, "— لا تُحسب قبل تصحيح الكمية")
          )}
        </AppText>
        <Button
          label={tx(T, "تأكيد الإضافة")}
          financial
          onPress={() => check?.ok && onConfirm(row, check.qtyMilli)}
          disabledReason={check?.ok ? undefined : tx(T, "الزر معطّل حتى تصحيح الكمية")}
        />
      </View>
    </Sheet>
  );
}
