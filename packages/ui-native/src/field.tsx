import { useState } from "react";
import { Pressable, TextInput, type TextInputProps, View } from "react-native";

import { AppText } from "./text";
import { FONT, RADIUS, ROW_RTL, SPACE, TOUCH, useColors } from "./theme";

/**
 * C-FIELD للجوال: تسمية ظاهرة فوق الحقل (لا placeholder بديلاً عنها)، ارتفاع 52 نقطة، والخطأ نصّ
 * تحته بلون الخطر. كلمة المرور بزرّ «إظهار الحروف» كالويب (0005 §١٤٠). لوحة المفاتيح من `keyboardType`
 * والملء التلقائي من `autoComplete`/`textContentType` — يمرّان كما هما إلى `TextInput`.
 */
export function TextField({
  label,
  error,
  hint,
  secure = false,
  required = false,
  mono = false,
  style,
  ...input
}: Omit<TextInputProps, "secureTextEntry"> & {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  secure?: boolean;
  required?: boolean;
  /** أرقام ومعرّفات: IBM Plex Mono واتجاه LTR (قاعدة الأرقام اللاتينية). */
  mono?: boolean;
}) {
  const c = useColors();
  const [reveal, setReveal] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: SPACE["1"], marginBottom: SPACE["3"] }}>
      <AppText variant="bodyStrong" importantForAccessibility="no">
        {label}
        {required ? " *" : ""}
      </AppText>
      <View
        style={{
          flexDirection: ROW_RTL,
          alignItems: "center",
          minHeight: TOUCH.row,
          borderWidth: 1,
          borderColor: error ? c.danger : focused ? c.brandPrimary : c.border,
          borderRadius: RADIUS.button,
          backgroundColor: c.surfaceCard,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.inkFaint}
          secureTextEntry={secure && !reveal}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              minHeight: TOUCH.row,
              paddingHorizontal: SPACE["3"],
              color: c.inkStrong,
              fontSize: 17,
              fontFamily: mono ? FONT.mono : FONT.regular,
              textAlign: mono ? "left" : "right",
              writingDirection: mono ? "ltr" : "rtl",
            },
            style,
          ]}
          {...input}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            // الاسم نفسه في `@sting/ui-web` («الحروف» لا «كلمة المرور» كي لا يطابق تسمية الحقل)
            accessibilityLabel={reveal ? "إخفاء الحروف" : "إظهار الحروف"}
            onPress={() => setReveal((r) => !r)}
            style={{
              minWidth: TOUCH.min,
              minHeight: TOUCH.min,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <EyeGlyph color={c.inkMuted} crossed={reveal} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="note" style={{ color: c.danger }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="note" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** أيقونة العين كما في حقل كلمة المرور في الويب، مرسومة بعناصر RN بلا مكتبة أيقونات. */
function EyeGlyph({ color, crossed }: { color: string; crossed: boolean }) {
  return (
    <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 22,
          height: 14,
          borderRadius: 11,
          borderWidth: 1.8,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      {crossed ? (
        <View
          style={{
            position: "absolute",
            width: 26,
            height: 1.8,
            backgroundColor: color,
            transform: [{ rotate: "-35deg" }],
          }}
        />
      ) : null}
    </View>
  );
}
