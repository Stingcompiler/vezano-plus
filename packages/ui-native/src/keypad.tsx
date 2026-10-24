import { Pressable, View } from "react-native";

import { AppText } from "./text";
import { FONT, RADIUS, SPACE, useColors } from "./theme";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "⌫"],
] as const;

/**
 * لوحة أرقام مالية كبيرة (لمس 56pt) للمبالغ والخصم والمستلَم — الأرقام لاتينية mono. تعيد النص
 * المُدخَل كاملاً؛ التحقق منه على الشاشة (`parseAmount`). `decimals=false` يخفي النقطة.
 */
export function Keypad({
  value,
  onChange,
  decimals = true,
}: {
  value: string;
  onChange: (next: string) => void;
  decimals?: boolean;
}) {
  const c = useColors();
  const press = (k: string) => {
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === ".") {
      if (!decimals || value.includes(".")) return;
      return onChange(value === "" ? "0." : `${value}.`);
    }
    if (value === "0") return onChange(k);
    onChange(`${value}${k}`);
  };
  return (
    <View style={{ gap: SPACE["2"] }} accessibilityRole="keyboardkey">
      {ROWS.map((row) => (
        <View key={row.join("")} style={{ flexDirection: "row", gap: SPACE["2"] }}>
          {row.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={k === "⌫" ? "حذف" : k}
              disabled={k === "." && !decimals}
              onPress={() => press(k)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 56,
                borderRadius: RADIUS.button,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: pressed ? c.brandTint : c.surfaceCard,
                alignItems: "center",
                justifyContent: "center",
                opacity: k === "." && !decimals ? 0.3 : 1,
              })}
            >
              <AppText
                style={{ fontFamily: FONT.monoMedium, fontSize: 22, writingDirection: "ltr" }}
              >
                {k}
              </AppText>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
