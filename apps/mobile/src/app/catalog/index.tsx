import { formatMinor, hhmm } from "@sting/app-core";
import {
  filterLocalItems,
  type LocalGroup,
  type LocalItem,
  readLocalGroups,
  readLocalItems,
} from "@sting/sync-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { M } from "@/components/catalog/parts";
import { CatRow, Line } from "@/components/catalog/row";
import { SelectField } from "@/components/catalog/select-field";
import { CT } from "@/features/catalog/texts";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "CAT-01";
const PAGE = 60;
type State = "ready" | "loading" | "empty" | "offline" | "stale";

/** «كغ · كرتونة = 12» — الوحدة الأساسية ثم الوحدات الإضافية بمعاملها (ميلي ← عدد). */
function UnitsLine({ item }: { item: LocalItem }) {
  return (
    <Line>
      {item.base_unit_name}
      {item.units.map((u) => (
        <AppText key={u.unit_id} variant="secondary" muted>
          {" · "}
          {u.name} = <M>{Number(u.factor_milli) / 1000}</M>
        </AppText>
      ))}
    </Line>
  );
}

/**
 * CAT-01 — قائمة الأصناف والبحث (خطة الجوال M3). المحلي أولاً: النسخة المحلية من sync-core تُعرض فوراً
 * ويُصفّى البحث عليها بلا اتصال، ثم يُطابَق الخادم حين يتوفّر (الكتابة تعيد الطلب لا تنتظره). الفشل
 * الشبكي = «بلا اتصال»، وفشل الخادم مع نسخة محلية = «أسعار قد تكون قديمة». المعطَّل لا يظهر افتراضياً.
 */
export default function CatalogIndex() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const params = useLocalSearchParams<{ q?: string }>();
  const [q, setQ] = useState(typeof params.q === "string" ? params.q : "");
  const [groupId, setGroupId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [source, setSource] = useState<"local" | "server">("local");
  const [localAt, setLocalAt] = useState<string | null>(null);
  const [localDone, setLocalDone] = useState(false);
  const [serverDone, setServerDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [scanning, setScanning] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const sourceRef = useRef<"local" | "server">("local");

  // المحلي أولاً (وعند العودة إلى الشاشة بعد إنشاء صنف)
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const storage = await getStorage();
        const [local, localGroups, cacheAt] = await Promise.all([
          readLocalItems(storage),
          readLocalGroups(storage),
          storage.read((tr) => tr.getMeta("home.cache")).catch(() => null),
        ]);
        if (sourceRef.current === "local") {
          setItems(local);
          setGroups(localGroups);
          setAllTotal(local.length);
        }
        if (cacheAt) setLocalAt((JSON.parse(cacheAt) as { savedAt: string }).savedAt);
        setLocalDone(true);
        setTick((t) => t + 1);
      })();
    }, []),
  );

  // المطابقة مع الخادم — الكتابة تعيد الطلب لا تنتظره
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data, response } = await api.GET("/api/catalog/items", {
            params: { query: { q, group_id: groupId, include_inactive: includeInactive } },
          });
          if (mine !== seq.current) return;
          if (!response.ok || !data) throw new Error("catalog_failed");
          const d = data as unknown as {
            items: LocalItem[];
            all_total: number;
            groups: { id: string; name: string }[];
          };
          setItems(d.items);
          setGroups(
            d.groups.map((g) => ({
              id: g.id,
              name: g.name,
              parent_id: "",
              parent_name: "",
              sort_order: 0,
              note: "",
            })),
          );
          setAllTotal(d.all_total);
          sourceRef.current = "server";
          setSource("server");
          setFailed(false);
          setOffline(false);
        } catch (e) {
          if (mine !== seq.current) return;
          // الفشل الشبكي (fetch يرمي) = بلا اتصال؛ ردّ غير ناجح = الخادم تعذّر
          if (e instanceof Error && e.message === "catalog_failed") setFailed(true);
          else setOffline(true);
        } finally {
          if (mine === seq.current) setServerDone(true);
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [api, q, groupId, includeInactive, tick]);

  const shown =
    source === "server" ? items : filterLocalItems(items, { q, groupId, includeInactive });
  const loading = !localDone || (!serverDone && items.length === 0 && !offline);
  const state: State = offline
    ? "offline"
    : loading
      ? "loading"
      : failed && source === "local"
        ? "stale"
        : shown.length === 0
          ? "empty"
          : "ready";
  const noItemsAtAll = allTotal === 0 && !q.trim();

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "الكتالوج")}
      onRefresh={() => setTick((t) => t + 1)}
    >
      <TextField
        label={tx(T, "بحث")}
        placeholder={tx(T, "اسم الصنف أو الباركود")}
        value={q}
        onChangeText={(v) => {
          setQ(v);
          setLimit(PAGE);
        }}
        returnKeyType="search"
      />
      <View style={{ marginBottom: SPACE["3"] }}>
        <Button label={mtx("scanTitle")} variant="secondary" onPress={() => setScanning(true)} />
      </View>
      <SelectField
        label={tx(T, "المجموعة")}
        value={groupId}
        onChange={setGroupId}
        searchLabel={tx(T, "بحث")}
        options={[
          { value: "", label: tx(T, "كل المجموعات") },
          ...groups.map((g) => ({ value: g.id, label: g.name })),
        ]}
      />
      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "الحالة")}
      </AppText>
      <View
        style={{
          flexDirection: "row-reverse",
          flexWrap: "wrap",
          gap: SPACE["2"],
          marginBottom: SPACE["4"],
        }}
      >
        <Chip
          label={tx(T, "النشط فقط")}
          on={!includeInactive}
          onPress={() => setIncludeInactive(false)}
        />
        <Chip
          label={tx(T, "يشمل المعطَّل")}
          on={includeInactive}
          onPress={() => setIncludeInactive(true)}
        />
      </View>
      <View style={{ flexDirection: "row-reverse", gap: SPACE["2"], marginBottom: SPACE["4"] }}>
        <View style={{ flex: 1 }}>
          <Button label={tx(T, "صنف جديد")} onPress={() => router.push("/catalog/new")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={tx(T, "المجموعات")}
            variant="secondary"
            onPress={() => router.push("/catalog/groups")}
          />
        </View>
      </View>

      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "كتالوج محلي")}>
          <AppText variant="secondary">
            {tx(T, "الكتالوج مخزّن كاملاً على الجهاز، فالبحث والتصفّح يعملان بلا فرق.")}
          </AppText>
          <AppText variant="secondary">
            <AppText variant="secondary" style={{ fontFamily: FONT.bold }}>
              {tx(T, "ما لا يعمل")}
            </AppText>
            {tx(T, ": إنشاء صنف بصورة (الرفع يحتاج شبكة) — يُحفظ بلا صورة وتُرفع لاحقاً.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "أسعار قد تكون قديمة")}>
          <AppText variant="secondary">
            {tx(T, "الكتالوج محلي من")} <M>{localAt ? hhmm(localAt) : "—"}</M>
            {tx(T, "، وقد يكون سعرٌ تغيّر في فرع آخر.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "loading" ? (
        <AppText variant="secondary" muted accessibilityRole="progressbar">
          {tx(T, "جلب الأصناف")}
        </AppText>
      ) : null}

      {state === "empty" ? (
        noItemsAtAll ? (
          <StateView state="empty" title={tx(T, "كتالوج فارغ")}>
            <AppText variant="secondary">{tx(T, "محلٌّ جديد بلا أصناف")}</AppText>
            <Button
              label={tx(T, "ابدأ بأصناف قطاعك")}
              onPress={() => router.push("/catalog/new")}
            />
            <Button
              label={tx(T, "استورد ملفاً")}
              variant="secondary"
              onPress={() => router.push("/catalog/import")}
            />
          </StateView>
        ) : (
          <StateView state="empty" title={tx(T, "بحث بلا تطابق")}>
            <AppText variant="secondary">
              {tx(T, "بحثٌ لم يطابق «")}
              {q}»
            </AppText>
            <Button
              label={tx(T, "أنشئ صنفاً بهذا الاسم")}
              onPress={() => router.push({ pathname: "/catalog/new", params: { name: q } })}
            />
          </StateView>
        )
      ) : null}

      {shown.length > 0 ? (
        <GroupedList title={tx(T, "قائمة الأصناف")}>
          {shown.slice(0, limit).map((i, idx, arr) => (
            <CatRow
              key={i.id}
              title={i.name}
              label={`${tx(T, "فتح")} ${i.name}`}
              lines={
                <>
                  <Line>{i.aliases.length ? i.aliases.join(tx(T, "،") + " ") : "—"}</Line>
                  <Line>
                    {tx(T, "المجموعة")}: {i.group_name || "—"}
                  </Line>
                  <UnitsLine item={i} />
                  {i.barcode ? (
                    <Line>
                      {tx(T, "الباركود")}: <M>{i.barcode}</M>
                    </Line>
                  ) : null}
                </>
              }
              trailing={
                <View style={{ alignItems: "flex-end" }}>
                  <AppText>
                    <M>{formatMinor(i.sale_price_minor)}</M>
                  </AppText>
                  {state === "stale" && i.price_updated_at ? (
                    <AppText variant="note" muted>
                      <M>{hhmm(i.price_updated_at)}</M>
                    </AppText>
                  ) : null}
                  <AppText
                    variant="note"
                    style={{
                      color: i.is_active ? c.state.ready.fg : c.state.permission_denied.fg,
                    }}
                  >
                    {i.is_active ? tx(T, "نشط") : tx(T, "معطَّل")}
                  </AppText>
                </View>
              }
              onPress={() => router.push({ pathname: "/catalog/[id]", params: { id: i.id } })}
              last={idx === arr.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}
      {shown.length > limit ? (
        <Button label={CT.showMore} variant="secondary" onPress={() => setLimit((l) => l + PAGE)} />
      ) : null}

      <AppText variant="note" muted style={{ marginTop: SPACE["3"] }}>
        <M>{allTotal}</M> {tx(T, "صنفاً ·")} <M>{shown.length}</M>{" "}
        {tx(
          T,
          "معروضة · الصنف المعطَّل يبقى في الفواتير والتقارير القديمة ولا يظهر في البحث داخل نقطة البيع",
        )}
      </AppText>
      <View style={{ marginTop: SPACE["3"] }}>
        <Button
          label={tx(T, "استورد ملفاً")}
          variant="quiet"
          onPress={() => router.push("/catalog/import")}
        />
      </View>

      <BarcodeScanner
        open={scanning}
        onScan={(code) => {
          setQ(code);
          setLimit(PAGE);
        }}
        onClose={() => setScanning(false)}
      />
    </Screen>
  );
}
