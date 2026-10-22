import type { ReactNode } from "react";
import { Text, type TextProps, type TextStyle } from "react-native";

import { ALIGN_RIGHT, TYPE, useColors } from "./theme";

type Variant = keyof typeof TYPE;

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
    <Text style={[base, style]} {...rest}>
      {children}
    </Text>
  );
}
