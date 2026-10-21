import { tx } from "@sting/texts";
import { AppText, Button, Screen, SPACE, StateView } from "@sting/ui-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { type ItemFormState, ItemForm } from "@/components/catalog/item-form";
import type { GroupRef, ItemCard, UnitRow } from "@/features/catalog/lib";
import { useSession } from "@/lib/session";

const T = "CAT-02";

/**
 * CAT-02 — إنشاء صنف وبطاقته (31-D23). أونلاين (§٨.١): الوحدات والمجموعات من الخادم؛ بطاقة صنف قائم
 * تُقرأ من `catalog/items/{id}` وتُعدَّل بالنموذج نفسه. انقطاع الشبكة = «بلا اتصال» مع إعادة المحاولة.
 */
export function ItemPage({
  itemId,
  initialName,
}: {
  itemId?: string | undefined;
  initialName?: string | undefined;
}) {
  const { api } = useSession();
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [card, setCard] = useState<ItemCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [state, setState] = useState<ItemFormState>("ready");

  const load = useCallback(async () => {
    setOffline(false);
    setMissing(false);
    try {
      const [u, g] = await Promise.all([
        api.GET("/api/catalog/units"),
        api.GET("/api/catalog/groups"),
      ]);
      setUnits((u.data as unknown as { units?: UnitRow[] } | undefined)?.units ?? []);
      setGroups(
        ((g.data as unknown as { groups?: GroupRef[] } | undefined)?.groups ?? []).filter(
          (x) => x.id,
        ),
      );
      if (itemId) {
        const { data, response } = await api.GET("/api/catalog/items/{item_id}", {
          params: { path: { item_id: itemId } },
        });
        if (response.ok && data) setCard(data);
        else setMissing(true);
      }
    } catch {
      setOffline(true);
    }
  }, [api, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = itemId ? (card ? card.name : tx(T, "بطاقة الصنف")) : tx(T, "صنف جديد");
  const ready = units !== null && (!itemId || card !== null);
  const screenState = offline ? "offline" : !ready && !missing ? "loading" : state;

  return (
    <Screen screenId={T} state={screenState} title={title}>
      {offline ? (
        <StateView state="offline" title={tx("ACC-01", "بلا اتصال")}>
          <View style={{ gap: SPACE["2"] }}>
            <Button label={tx("ACC-01", "أعد المحاولة")} onPress={() => void load()} />
          </View>
        </StateView>
      ) : missing ? (
        <AppText>{tx(T, "الصنف غير موجود")}</AppText>
      ) : ready ? (
        <ItemForm
          key={card?.id ?? "new"}
          mode={itemId ? "edit" : "create"}
          units={units}
          groups={groups}
          initial={card ?? undefined}
          initialName={initialName}
          onState={setState}
        />
      ) : (
        <AppText variant="secondary" muted accessibilityRole="progressbar">
          {tx(T, "جلب الأصناف")}
        </AppText>
      )}
    </Screen>
  );
}
