import { FONT, SPACE, TOUCH, AppText, useColors } from "@sting/ui-native";
import { Pressable, TextInput, View } from "react-native";

import { INV_TEXTS } from "@/features/inventory/texts";

/**
 * عدّاد الكمية للجوال (نظير `inv-stepper` في الويب): − وحقل mono + ؛ أزرار ≥ 48 للإبهام. الحقل يقبل
 * الأرقام العربية واللاتينية (يحلّلها المستدعي). الإدخال يُسلَّم عند الخروج من الحقل كما في الويب.
 */
export function Stepper({
  value,
  onChangeText,
  onCommit,
  onStep,
  inputLabel,
  minusLabel,
  plusLabel,
  editable = true,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onCommit?: ((t: string) => void) | undefined;
  onStep: (dir: 1 | -1) => void;
  inputLabel: string;
  minusLabel: string;
  plusLabel: string;
  editable?: boolean;
}) {
  const c = useColors();
  const btn = (dir: 1 | -1, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!editable}
      onPress={() => onStep(dir)}
      style={{
        minWidth: TOUCH.financial - 8,
        minHeight: TOUCH.financial - 8,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surfaceCard,
        opacity: editable ? 1 : 0.5,
      }}
    >
      <AppText variant="title">{dir === 1 ? INV_TEXTS.stepUp : INV_TEXTS.stepDown}</AppText>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: SPACE["2"] }}>
      {btn(1, plusLabel)}
      <TextInput
        accessibilityLabel={inputLabel}
        keyboardType="decimal-pad"
        value={value}
        editable={editable}
        onChangeText={onChangeText}
        onEndEditing={(e) => onCommit?.(e.nativeEvent.text)}
        style={{
          flex: 1,
          minHeight: TOUCH.financial - 8,
          textAlign: "center",
          writingDirection: "ltr",
          fontFamily: FONT.monoMedium,
          fontSize: 20,
          color: c.inkStrong,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 12,
          backgroundColor: c.surfaceCard,
        }}
      />
      {btn(-1, minusLabel)}
    </View>
  );
}
