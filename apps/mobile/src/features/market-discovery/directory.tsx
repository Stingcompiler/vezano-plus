import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import {
  AgoNum,
  ChipRow,
  Count,
  M,
  NodeChip,
  Row,
  Stack,
  StatusWord,
} from "@/components/market-discovery/parts";
import {
  countText,
  readArea,
  safeGet,
  type SupplierCard,
  writeArea,
} from "@/features/market-discovery/lib";
import { useSnapGet } from "@/features/market-discovery/use-snap";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "MP-02";
type State = "loading" | "ready" | "empty" | "stale";

interface Facet {
  name: string;
  suppliers: number;
}
interface Directory {
  area: string;
  category: string;
  areas: Facet[];
  categories: Facet[];
  suppliers: SupplierCard[];
  total: number;
  alternatives: { all_areas: number; all_categories: number; everything: number };
  fetched_at: string;
}

const ENTITIES = {
  one: tx(T, "منشأة واحدة"),
  two: tx(T, "منشأتان"),
  few: tx(T, "منشآت"),
  many: tx(T, "منشأة"),
};
const RESULTS = {
  one: tx(T, "نتيجة واحدة"),
  two: tx(T, "نتيجتان"),
  few: tx(T, "نتائج"),
  many: tx(T, "نتيجة"),
};

function Facets({
  label,
  items,
  value,
  onPick,
}: {
  label: string;
  items: Facet[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <View accessibilityLabel={label} style={{ marginBottom: SPACE["1"] }}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["1"] }}>
        {label}
      </AppText>
      <ChipRow>
        <NodeChip on={!value} onPress={() => onPick("")}>
          {tx(T, "الكل")}
        </NodeChip>
        {items.map((i) => (
          <NodeChip key={i.name} on={value === i.name} onPress={() => onPick(i.name)}>
            {i.name} — <M>{i.suppliers}</M>
          </NodeChip>
        ))}
      </ChipRow>
    </View>
  );
}

/** MP-02 — دليل المخازن والمتاجر: تصفية بالخدمة لا بالعنوان الخاص (لا عنوان ولا هاتف في الدليل). */
export default function MarketDirectory() {
  const router = useRouter();
  const { api } = useSession();
  const [area, setArea] = useState<string | null>(null);
  const [category, setCategory] = useState("");

  useEffect(() => {
    void getStorage()
      .then(readArea)
      .then(setArea)
      .catch(() => setArea(""));
  }, []);

  const { shown, snap, net, reload } = useSnapGet<Directory>(
    "market.directory",
    () =>
      safeGet(
        () =>
          api.GET("/api/public/market/directory", {
            params: { query: { area: area ?? "", category } },
          }),
        (d) => d as Directory | undefined,
      ),
    [area, category],
    0,
    area !== null,
  );

  const state: State =
    net === "offline" || (net === "failed" && shown)
      ? "stale"
      : !shown
        ? "loading"
        : shown.total === 0
          ? "empty"
          : "ready";
  const areaName = area ?? "";

  const pickArea = (v: string) => {
    setArea(v);
    void getStorage().then((s) => writeArea(s, v));
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "دليل المخازن والمتاجر — تصفية بالخدمة لا بالعنوان الخاص")}
      onRefresh={() => void reload()}
      refreshing={net === "loading" && !!shown}
    >
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "المشتري يبحث بمن يخدم منطقته وفئته. لا نعرض عنوان منشأة ولا هاتفها في الدليل — ذلك بيانها هي تُفصح عنه في ملفها متى شاءت.",
        )}
      </AppText>
      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "الدليل —")} {shown ? <Count n={shown.total} forms={ENTITIES} /> : "…"}
        {areaName ? ` ${tx(T, "تخدم منطقتك")}` : ""}
      </AppText>
      {state === "stale" ? (
        <View style={{ marginBottom: SPACE["2"] }}>
          <StatusWord tone="stale" label={tx(T, "متقادم")} />
        </View>
      ) : null}
      {shown ? (
        <>
          <Facets label={tx(T, "المنطقة")} items={shown.areas} value={areaName} onPick={pickArea} />
          <Facets
            label={tx(T, "الفئة")}
            items={shown.categories}
            value={category}
            onPick={setCategory}
          />
        </>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب الدليل")}>
          <AppText variant="secondary">
            {tx(T, "بالمنطقة والفئة المختارتين، وعدّاد النتائج يظهر أولاً.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" && snap ? (
        <StateView state="stale" title={tx(T, "متقادم")}>
          <AppText variant="secondary">
            {tx(T, "قائمة الدليل محفوظة على جهازك من قبل")}{" "}
            <AgoNum
              iso={snap.at}
              words={{ minute: tx(T, "دقيقة"), hour: tx(T, "ساعة"), day: tx(T, "يوم") }}
            />
            {tx(
              T,
              ". نعرض الوقت ولا نُظهرها كأنها لحظية، لأن «عروض منشورة» قد تكون أقل الآن. عدد العروض ليس سعراً مؤكَّداً — التأكيد في صفحة العرض وحدها.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && shown ? (
        <StateView state="empty" title={tx(T, "لا منشآت")}>
          <AppText variant="secondary">
            {category && areaName
              ? tx(T, "لا مخازن في هذه الفئة بمنطقتك.")
              : shown.alternatives.everything === 0
                ? tx(T, "لا منشآت منشورة بعد.")
                : tx(T, "لا مخازن في هذه الفئة بمنطقتك.")}
          </AppText>
          <Stack>
            {areaName ? (
              <Button
                label={`${tx(T, "كل المناطق (")}${countText(shown.alternatives.all_areas, RESULTS)})`}
                onPress={() => pickArea("")}
              />
            ) : null}
            {category ? (
              <Button
                label={`${tx(T, "كل الفئات (")}${countText(shown.alternatives.all_categories, RESULTS)})`}
                onPress={() => setCategory("")}
              />
            ) : null}
          </Stack>
        </StateView>
      ) : null}

      {shown && shown.total ? (
        <GroupedList title={tx(T, "الدليل")}>
          {shown.suppliers.map((s, i) => (
            <Row
              key={s.tenant_id}
              title={s.public_name}
              sub={
                <>
                  {s.category_line}
                  {"\n"}
                  {s.categories.join(" · ")}
                  {"\n"}
                  {s.service_areas.join(` ${tx(T, "و")}`)} ·{" "}
                  {s.fulfilment.join(tx(T, "، أو") + " ")}
                  {"\n"}
                  {tx(T, "عروض منشورة")} <M>{s.offers_count}</M>
                </>
              }
              trailing={
                <StatusWord
                  tone={s.badge === "verified" ? "success" : "stale"}
                  label={s.badge_label}
                />
              }
              onPress={() => router.push(`/market/suppliers/${s.tenant_id}`)}
              last={i === shown.suppliers.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}
    </Screen>
  );
}
