import { formatMinorShort, hhmm } from "@sting/app-core";
import {
  cartTotals,
  discardHeldCart,
  type HeldCart,
  readHeldCarts,
  resumeHeldCart,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  ThemedText as Text,
} from "@sting/ui-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { getStorage } from "@/lib/storage";

const T = "POS-13";

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * POS-13 — المعلّقات على هذا الجهاز (S-03؛ 0005 §٢٩٣) — نظير الويب: «استئناف» يعيد السلة كما عُلّقت
 * بخصمها وعميلها، و«حذف المعلّقة» بتأكيد. على الجهاز وحده بلا مزامنة.
 */
export default function Held() {
  const router = useRouter();
  const [held, setHeld] = useState<HeldCart[] | null>(null);
  const [cartBusy, setCartBusy] = useState(false);
  const [confirm, setConfirm] = useState<HeldCart | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => setHeld(await readHeldCarts(await getStorage())))();
    }, []),
  );

  const resume = async (h: HeldCart) => {
    const storage = await getStorage();
    const out = await resumeHeldCart(storage, h.id);
    if (out.ok) {
      router.back();
      return;
    }
    if (out.reason === "cart_not_empty") setCartBusy(true);
    setHeld(await readHeldCarts(storage));
  };

  const discard = async () => {
    if (!confirm) return;
    const storage = await getStorage();
    await discardHeldCart(storage, confirm.id);
    setConfirm(null);
    setHeld(await readHeldCarts(storage));
  };

  const state = held === null ? "loading" : held.length === 0 ? "empty" : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "المعلّقات")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "على هذا الجهاز وحده")}
      </AppText>
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا فواتير معلّقة على هذا الجهاز.")}>
          <Button label={tx(T, "نقطة البيع")} onPress={() => router.back()} />
        </StateView>
      ) : null}
      {cartBusy ? (
        <StateView state="validation_error" title={tx(T, "السلة ليست فارغة")}>
          <AppText variant="secondary">{tx(T, "علّق السلة الحالية أو ألغها، ثم استأنف.")}</AppText>
        </StateView>
      ) : null}
      {confirm ? (
        <StateView state="validation_error" title={tx(T, "حذف المعلّقة")}>
          <AppText variant="secondary">{tx(T, "تُحذف من هذا الجهاز ولا تعود.")}</AppText>
          <Button label={tx(T, "حذف المعلّقة")} variant="danger" onPress={() => void discard()} />
          <Button label={tx(T, "تراجع")} variant="quiet" onPress={() => setConfirm(null)} />
        </StateView>
      ) : null}
      {(held ?? []).map((h) => {
        const t = cartTotals(h.lines, h.discount);
        return (
          <View key={h.id} style={{ marginBottom: SPACE["3"] }}>
            <GroupedList>
              <ListRow
                title={h.label || h.customer?.name || tx(T, "فاتورة معلّقة")}
                subtitle={`${tx(T, "عُلّقت")} ${hhmm(h.held_at)} ${tx(T, "· الأسطر")} ${t.lineCount}`}
                trailing={<N>{formatMinorShort(t.totalMinor.toString())}</N>}
                last
              />
            </GroupedList>
            <View style={{ gap: SPACE["2"], marginTop: SPACE["2"] }}>
              <Button label={tx(T, "استئناف")} onPress={() => void resume(h)} />
              <Button
                label={tx(T, "حذف المعلّقة")}
                variant="secondary"
                onPress={() => setConfirm(h)}
              />
            </View>
          </View>
        );
      })}
    </Screen>
  );
}
