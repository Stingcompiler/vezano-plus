import { Pressable } from "react-native";

import { AppText } from "./text";
import { RADIUS, SPACE, TOUCH, useColors } from "./theme";

/** مكوّن #8 (`Segmented`/`Chips`): شريحة لمس ≥44pt للفلتر والمدى والوسيلة — لا قوائم منسدلة. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
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
        {label}
      </AppText>
    </Pressable>
  );
}
