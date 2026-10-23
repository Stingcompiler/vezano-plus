import { createContext, type ReactNode, useContext } from "react";
import { Text, type TextProps, type TextStyle } from "react-native";

import { ALIGN_RIGHT, TYPE, useColors } from "./theme";

type Variant = keyof typeof TYPE;

/** داخل نصّ؟ النص المتداخل يرث لون أبيه، والقائم وحده يأخذ لون السمة. */
const InText = createContext(false);

/** نص عربي من اليمين بسلّم الخط؛ اللون الافتراضي حبر الواجهة. */
export function AppText({
  variant = "body",
  muted = false,
  style,
  children,
  ...rest
}: TextProps & { variant?: Variant; muted?: boolean; children?: ReactNode }) {
  const c = useColors();
  const base: TextStyle = {
    ...TYPE[variant],
    color: muted ? c.inkMuted : c.inkStrong,
    textAlign: ALIGN_RIGHT,
    writingDirection: "rtl",
  };
  return (
    <InText.Provider value>
      <Text style={[base, style]} {...rest}>
        {children}
      </Text>
    </InText.Provider>
  );
}

/**
 * بديل `Text` من react-native يعرف السمة: `Text` الخام بلا لون يُرسم أسود، فيختفي في الوضع الداكن (رقم
 * الدرج «80» في فتح الوردية). القائم وحده يأخذ حبر الواجهة، والمتداخل في نصّ يرث لون أبيه كما هو.
 */
export function ThemedText({ style, ...rest }: TextProps) {
  const nested = useContext(InText);
  const c = useColors();
  return (
    <InText.Provider value>
      <Text style={[nested ? null : { color: c.inkStrong }, style]} {...rest} />
    </InText.Provider>
  );
}
