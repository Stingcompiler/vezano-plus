import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { itemMatches, type LocalItem, readLocalItems } from "@sting/sync-core";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { M } from "@/components/catalog/parts";
import { CatRow, Line } from "@/components/catalog/row";
import { SelectField } from "@/components/catalog/select-field";
import { readCache, writeCache } from "@/features/catalog/lib";
import { CT } from "@/features/catalog/texts";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "CAT-06";
const CACHE = "cache.catalog.groups";
type State = "ready" | "empty" | "validation_error" | "success" | "offline" | "loading";

interface GroupRow {
  readonly id: string;
  readonly name: string;
  readonly parent_name: string;
  readonly items: number;
  readonly aliases: readonly string[];
  readonly note: string;
}
interface Overview {
  readonly groups: readonly GroupRow[];
  readonly group_count: number;
  readonly total_items: number;
}
interface Taken {
  readonly alias: string;
  readonly owner_item_id: string;
  readonly owner_item_name: string;
}

/** عدد بصيغته العربية الصحيحة (نظير `Count` في الويب): الرقم mono والصيغة نص. */
function Count({
  n,
  forms,
}: {
  n: number;
  forms: { one: string; two: string; few: string; many: string };
}) {
  if (n === 1) return <>{forms.one}</>;
  if (n === 2) return <>{forms.two}</>;
  return (
    <>
      <M>{n}</M> {n >= 3 && n <= 10 ? forms.few : forms.many}
    </>
  );
}
const GROUPS = { one: CT.groupsOne, two: CT.groupsTwo, few: CT.groupsFew, many: CT.groupsMany };
const ITEMS = { one: CT.itemsOne, two: CT.itemsTwo, few: CT.itemsFew, many: CT.itemsMany };

/**
 * CAT-06 — مجموعات الأصناف والأسماء البديلة. المجموعة تصنيف للعرض والتقرير لا تحمل سعراً؛ الاسم البديل مفتاح
 * بحث يفتح صنفاً واحداً — إن كان مأخوذاً نُسمّي الصنف المالك ونفتح بطاقته؛ والنجاح يُثبت بالتجربة. الخادمي:
 * آخر ردّ صالح يُحفظ ويُعرض بلا اتصال، والأصناف تُقرأ من النسخة المحلية عند الانقطاع. (إعادة الترتيب
 * بالسحب غير مبنية: الويب لا يملكها ولا نقطة خادم لها.)
 */
export default function GroupsScreen() {
  const router = useRouter();
  const { api } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [groupName, setGroupName] = useState("");
  const [taken, setTaken] = useState<Taken | null>(null);
  const [added, setAdded] = useState<{ aliases: string[]; item: string } | null>(null);
  const [tryQ, setTryQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    const storage = await getStorage();
    try {
      const [g, it] = await Promise.all([
        api.GET("/api/catalog/groups"),
        api.GET("/api/catalog/items", { params: { query: { include_inactive: false } } }),
      ]);
      if (g.data) {
        setData(g.data);
        void writeCache(storage, CACHE, g.data);
      }
      if (it.data) setItems((it.data as unknown as { items: LocalItem[] }).items);
      setOffline(false);
    } catch {
      setOffline(true);
      const cached = await readCache<Overview>(storage, CACHE);
      if (cached) setData((cur) => cur ?? cached);
      const local = await readLocalItems(storage);
      setItems((cur) => (cur.length ? cur : local.filter((i) => i.is_active)));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const addAliases = async () => {
    const aliases = aliasText
      .split(/[،,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!itemId || aliases.length === 0 || busy) return;
    setBusy(true);
    setTaken(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/catalog/items/{item_id}/aliases", {
        params: { path: { item_id: itemId } },
        body: { aliases },
      });
      if (response.status === 409 && error) {
        setTaken(error);
        return;
      }
      if (response.ok && d) {
        const item = items.find((i) => i.id === itemId);
        setAdded({ aliases, item: item?.name ?? "" });
        setAliasText("");
        await load();
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || busy) return;
    setBusy(true);
    try {
      const { response } = await api.POST("/api/catalog/groups", {
        body: { name: groupName.trim() },
      });
      if (response.ok) {
        setGroupName("");
        await load();
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = taken
    ? "validation_error"
    : added
      ? "success"
      : offline
        ? "offline"
        : !data
          ? "loading"
          : data.group_count === 0
            ? "empty"
            : "ready";
  const tried = tryQ.trim() ? items.filter((i) => itemMatches(i, tryQ)).slice(0, 5) : [];
  // اقتراح مجموعات شائعة يُبنى من أسماء الأصناف الموجودة فعلاً (أول كلمة متكرّرة)
  const suggestions = [...new Set(items.map((i) => i.name.split(" ")[0] ?? ""))]
    .filter((w) => w.length > 2 && items.filter((i) => i.name.startsWith(w)).length > 1)
    .slice(0, 4);
  const noAliasReason = itemId ? tx(T, "أسماء بديلة") : tx(T, "الصنف");

  return (
    <Screen screenId={T} state={state} title={tx(T, "المجموعات")}>
      <AppText variant="bodyStrong">
        {tx(T, "المجموعات —")} <Count n={data?.group_count ?? 0} forms={GROUPS} /> ·{" "}
        <Count n={data?.total_items ?? 0} forms={ITEMS} />
      </AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الترتيب يغيّر العرض في نقطة البيع فقط")}
      </AppText>

      {offline ? (
        <StateView state="offline" title={tx("ACC-01", "بلا اتصال")}>
          <Button label={tx("ACC-01", "أعد المحاولة")} onPress={() => void load()} />
        </StateView>
      ) : null}

      {state === "empty" && data ? (
        <StateView state="empty" title={tx(T, "لا مجموعات بعد")}>
          <AppText variant="secondary">
            {tx(T, "كتالوج فيه")} <M>{data.total_items}</M>{" "}
            {tx(T, "صنفاً وصفر مجموعة. هذه ليست حالة عطب: البيع يعمل والبحث يعمل والجرد يعمل.")}
          </AppText>
          <AppText variant="secondary">
            {tx(
              T,
              "ما الذي ستكسبه: عرضٌ أسرع للكاشير، وتقرير مبيعات بالفئة بدل قائمة أصناف طويلة.",
            )}
          </AppText>
          <TextField label={tx(T, "المجموعة")} value={groupName} onChangeText={setGroupName} />
          {suggestions.map((s) => (
            <Button key={s} label={s} variant="secondary" onPress={() => setGroupName(s)} />
          ))}
          <Button
            label={tx(T, "مجموعة جديدة")}
            onPress={() => void createGroup()}
            loading={busy}
            disabledReason={groupName.trim() ? undefined : tx(T, "المجموعة")}
          />
        </StateView>
      ) : data ? (
        <GroupedList title={tx(T, "المجموعات")}>
          {data.groups.map((g, i) => (
            <CatRow
              key={g.id || "ungrouped"}
              title={g.name}
              lines={
                <>
                  <Line>{g.parent_name ? `${tx(T, "ضمن:")} ${g.parent_name}` : "—"}</Line>
                  {g.aliases.length ? (
                    <Line>
                      {tx(T, "أسماء بديلة مسجّلة")}: {g.aliases.join("، ")}
                    </Line>
                  ) : null}
                  {g.note || !g.id ? (
                    <Line>
                      {g.note ||
                        tx(
                          T,
                          "الأصناف تعمل وتُباع بلا مجموعة. المجموعة راحةٌ في العرض والتقرير، لا شرطُ صحّة.",
                        )}
                    </Line>
                  ) : null}
                </>
              }
              trailing={
                <AppText variant="secondary">
                  <M>{g.items}</M> {tx(T, "أصناف")}
                </AppText>
              }
              last={i === data.groups.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}

      {state === "validation_error" && taken ? (
        <StateView state="validation_error" title={tx(T, "الاسم البديل مأخوذ")}>
          <AppText variant="secondary">
            «{taken.alias}
            {tx(T, "» مسجّل على «")}
            {taken.owner_item_name}».
          </AppText>
          <Button
            label={taken.owner_item_name}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: "/catalog/[id]", params: { id: taken.owner_item_id } })
            }
          />
          <AppText variant="secondary">
            {tx(T, "انقل الاسم من الصنف الآخر، أو اكتب اسماً يميّز")}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" && added ? (
        <StateView
          state="success"
          title={added.aliases.length === 2 ? tx(T, "أُضيف اسمان بديلان") : tx(T, "أُضيف اسم بديل")}
        >
          <AppText variant="secondary">
            {tx(T, "سُجّل")} {added.aliases.map((a) => `«${a}»`).join(` ${tx(T, "و")}`)}{" "}
            {tx(T, "على «")}
            {added.item}
            {tx(T, "». الأثر فوري في بحث نقطة البيع وفي البحث العام معاً.")}
          </AppText>
          <AppText variant="secondary">
            {tx(T, "اسم الصنف على الفاتورة يبقى «")}
            {added.item}».
          </AppText>
          <TextField label={tx(T, "جرّبه الآن")} value={tryQ} onChangeText={setTryQ} />
          {tried.map((i) => (
            <AppText key={i.id}>{i.name}</AppText>
          ))}
        </StateView>
      ) : null}

      <View style={{ marginTop: SPACE["3"] }}>
        <SelectField
          label={tx(T, "الصنف")}
          value={itemId}
          onChange={setItemId}
          searchLabel={tx("CAT-01", "بحث")}
          options={[
            { value: "", label: "" },
            ...items.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />
        <TextField
          label={tx(T, "أسماء بديلة")}
          value={aliasText}
          onChangeText={setAliasText}
          hint={tx(T, "افصل بينها بفاصلة")}
        />
        <Button
          label={tx(T, "تسجيل اسم بديل")}
          onPress={() => void addAliases()}
          loading={busy}
          disabledReason={itemId && aliasText.trim() ? undefined : noAliasReason}
        />
      </View>

      {state !== "empty" ? (
        <View style={{ marginTop: SPACE["4"] }}>
          <TextField label={tx(T, "مجموعة جديدة")} value={groupName} onChangeText={setGroupName} />
          <Button
            label={tx(T, "مجموعة جديدة")}
            variant="secondary"
            onPress={() => void createGroup()}
            loading={busy}
            disabledReason={groupName.trim() ? undefined : tx(T, "المجموعة")}
          />
        </View>
      ) : null}
    </Screen>
  );
}
