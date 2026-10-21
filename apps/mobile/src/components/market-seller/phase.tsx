import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { Note, Row } from "@/components/market-seller/parts";
import { phaseScreen } from "@/features/market-seller/phase-screens";

const K = "shared:features/phase/phase-screen-client.tsx";

/**
 * شاشة M3/M4 بحالة `phase_locked` وحدها (§١٤.٦): المحتوى مرئي ومعطَّل خلف الوسم، والبديل الحاضر معلَن.
 * كما في `PhaseScreenClient` بالويب — النص حرفي، ولا مفتاح هنا.
 */
export function PhaseScreen({ id }: { id: string }) {
  const router = useRouter();
  const s = phaseScreen(id);
  if (!s) return null;
  const grow = s.kind === "M4";
  const stage = grow ? tx(K, "مرحلة النموّ") : tx(K, "مرحلة الربط");
  return (
    <Screen screenId={id} state="phase_locked" title={s.title}>
      {s.hint ? (
        <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
          {s.hint}
        </AppText>
      ) : null}
      <StateView
        state="phase_locked"
        title={grow ? tx(K, "مرحلة النموّ لم تُفتح بعد") : tx(K, "مرحلة الربط لم تُفتح بعد")}
      />
      <View style={{ marginBottom: SPACE["4"] }}>
        <Button
          label={`${tx(K, "يُفتح مع")} ${stage} ${tx(K, "— لا مفتاح هنا")}`}
          variant="secondary"
          onPress={() => undefined}
          disabledReason={s.lock}
        />
      </View>
      <Note strong>{tx(K, "مثال")}</Note>
      {s.sample.map((block) => (
        <GroupedList key={block.heading} title={block.heading}>
          {block.lines.map((t, i) => (
            <Row key={t} title={`· ${t}`} dim last={i === block.lines.length - 1} />
          ))}
        </GroupedList>
      ))}
      {s.alternative ? (
        <>
          <Note>
            <AppText variant="bodyStrong">{tx(K, "البديل الحاضر")}</AppText> · {s.alternative.note}
          </Note>
          <Button
            label={s.alternative.label}
            onPress={() => router.push(s.alternative?.href ?? "/")}
          />
        </>
      ) : null}
    </Screen>
  );
}
