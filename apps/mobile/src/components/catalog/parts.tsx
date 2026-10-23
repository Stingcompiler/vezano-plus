import { AppText, FONT, ThemedText as Text } from "@sting/ui-native";
import { Fragment, type ComponentProps, type ReactNode } from "react";

import type { Part } from "@/features/catalog/lib";

/** رقم أو معرّف: خط mono واتجاه LTR، لا حروف عربية بداخله (القاعدة 2). */
export function M({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/** سطر نص عربي تتخلّله أرقام: السلاسل عادية و`{ n }` بخط mono. */
export function Parts({
  parts,
  ...rest
}: { parts: readonly Part[] } & Omit<ComponentProps<typeof AppText>, "children">) {
  return (
    <AppText {...rest}>
      {parts.map((p, i) =>
        typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <M key={i}>{p.n}</M>,
      )}
    </AppText>
  );
}
