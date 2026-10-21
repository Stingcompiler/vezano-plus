import { formatMinor } from "@sting/app-core";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Count, M, Row, Stack, StatusWord, Until } from "@/components/market-discovery/parts";
import {
  countText,
  type OfferCard,
  readArea,
  safeGet,
  writeArea,
} from "@/features/market-discovery/lib";
import { useSnapGet } from "@/features/market-discovery/use-snap";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "MP-04";
type State = "loading" | "ready" | "empty" | "stale" | "partial";

interface OfferRow extends OfferCard {
  unit_price_minor: string;
  base_unit_name: string;
  fees_decided: boolean;
  fees_label: string;
  min_order_label: string;
  expired: boolean;
  expired_yesterday: boolean;
  ranked: boolean;
}
interface Group {
  label: string;
  count: number;
  rankable: number;
  offers: OfferRow[];
}
interface Result {
  q: string;
  area: string;
  groups: Group[];
  offers_count: number;
  suppliers_count: number;
  multi_unit: boolean;
  all_areas_count: number;
  fetched_at: string;
}

const OFFERS = {
  one: tx(T, "عرض واحد"),
  two: tx(T, "عرضان"),
  few: tx(T, "عروض"),
  many: tx(T, "عرضاً"),
};
const SUPPLIERS = {
  one: tx(T, "مورد واحد"),
  two: tx(T, "موردين"),
  few: tx(T, "موردين"),
  many: tx(T, "مورداً"),
};

/**
 * MP-04 — نتائج بحث المنتجات والمقارنة (43-D35 ready/loading/empty/stale · 08-D4 partial): الترتيب بالوحدة
 * داخل كل مجموعة؛ عند اختلاف الوحدات لا «الأرخص» عبرها (partial).
 */
export default function MarketSearch() {
  const router = useRouter();
  const { api } = useSession();
  const params = useLocalSearchParams<{ q?: string }>();
  const [q, setQ] = useState(params.q ?? "");
  const [area, setArea] = useState<string | null>(null);

  useEffect(() => {
    void getStorage()
      .then(readArea)
      .then(setArea)
      .catch(() => setArea(""));
  }, []);

  const { shown, net } = useSnapGet<Result>(
    "market.search",
    () =>
      safeGet(
        () => api.GET("/api/public/market/search", { params: { query: { q, area: area ?? "" } } }),
        (d) => d as Result | undefined,
      ),
    [q, area],
    150,
    area !== null,
  );

  const state: State =
    net === "offline" || (net === "failed" && shown)
      ? "stale"
      : !shown
        ? "loading"
        : shown.offers_count === 0
          ? "empty"
          : shown.multi_unit
            ? "partial"
            : "ready";
  const areaName = area ?? "";

  const clearArea = () => {
    setArea("");
    void getStorage().then((s) => writeArea(s, ""));
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "نتائج البحث والمقارنة — لا «الأرخص» عند اختلاف الوحدة")}
    >
      <TextField label={tx(T, "ابحث عن صنف أو مورد")} value={q} onChangeText={setQ} />
      {shown ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
          {areaName ? `${areaName} · ` : ""}
          <Count n={shown.offers_count} forms={OFFERS} /> {tx(T, "منشوراً من")}{" "}
          <Count n={shown.suppliers_count} forms={SUPPLIERS} />
        </AppText>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "النتائج تُجمع")}>
          <AppText variant="secondary">
            {tx(
              T,
              "العدّ والمرشّحات أولاً، والعروض تلحق — ولا يُعرض ترتيبٌ قبل اكتمال ما سيُرتَّب.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && shown ? (
        <StateView state="empty" title={tx(T, "لا عروض مطابقة")}>
          <AppText variant="secondary">
            {tx(T, "الصنف غير معروض في منطقتك أو الفئة أضيق من اللازم.")}
          </AppText>
          <Stack>
            {areaName ? (
              <Button
                label={`${tx(T, "كل المناطق (")}${countText(shown.all_areas_count, OFFERS)})`}
                onPress={clearArea}
              />
            ) : null}
            <Button
              label={`${tx(T, "فئة أوسع (")}${countText(shown.all_areas_count, OFFERS)})`}
              onPress={() => setQ("")}
            />
          </Stack>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "نتائج من آخر جلب")}>
          <AppText variant="secondary">{tx(T, "الاتصال تقطّع بعد البحث.")}</AppText>
        </StateView>
      ) : null}
      {state === "partial" && shown ? (
        <StateView state="partial" title={tx(T, "ترتيب موقوف")}>
          <AppText variant="secondary">
            {shown.groups.length === 2
              ? tx(T, "نتائجك بوحدتين مختلفتين، فلا يوجد «الأرخص».")
              : tx(T, "نتائجك بثلاث وحدات مختلفة، فلا يوجد «الأرخص».")}
          </AppText>
          <AppText variant="note" muted>
            {shown.groups.map((g) => g.label).join(` ${tx(T, "و")}`)}{" "}
            {tx(
              T,
              "لا تُقارن برقم واحد، والرسوم غير محسومة في بعض العروض. الترتيب بسعر الوحدة متاح داخل كل مجموعة وحدة على حدة.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "ready" ? (
        <AppText variant="bodyStrong" style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "الترتيب: سعر العبوة الواحدة")}
        </AppText>
      ) : null}

      {shown && shown.offers_count
        ? shown.groups.map((g) => (
            <View key={g.label}>
              <AppText variant="bodyStrong">{g.label}</AppText>
              <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
                <Count n={g.count} forms={OFFERS} /> ·{" "}
                {g.rankable
                  ? shown.multi_unit
                    ? tx(T, "قابلة للترتيب")
                    : tx(T, "الترتيب داخل المجموعة")
                  : tx(T, "خارج الترتيب")}
                {shown.multi_unit && !g.rankable ? ` ${tx(T, "· مجموعة مستقلة")}` : ""}
              </AppText>
              <GroupedList>
                {g.offers.map((o, i) => (
                  <Row
                    key={o.id}
                    dim={o.expired}
                    title={o.seller_name}
                    sub={
                      <>
                        {o.public_name} · {o.pack_label || o.unit_name} · {o.min_order_label}
                        {"\n"}
                        {tx(T, "سعر العبوة")}:{" "}
                        {o.price_minor ? (
                          <>
                            <M>{formatMinor(o.price_minor)}</M> / {o.unit_name || tx(T, "عبوة")}
                          </>
                        ) : (
                          o.price_line
                        )}
                        {"\n"}
                        {tx(T, "الرسوم والتوصيل")}: {o.fees_label} · {o.min_order_label}
                        {"\n"}
                        {tx(T, "تأكيد السعر")}:{" "}
                        {o.expired ? null : (
                          <>
                            {tx(T, "مؤكد خادمياً حتى")}{" "}
                            {o.confirmed_until ? <Until dateIso={o.confirmed_until} /> : "—"}
                          </>
                        )}
                      </>
                    }
                    trailing={
                      <View style={{ alignItems: "flex-end", maxWidth: 150 }}>
                        <AppText variant="note" muted>
                          {tx(T, "سعر الوحدة")}
                        </AppText>
                        {o.unit_price_minor && !o.expired ? (
                          <>
                            <AppText>
                              <M strong>{formatMinor(o.unit_price_minor)}</M> /{o.base_unit_name}
                            </AppText>
                            {!o.fees_decided ? (
                              <StatusWord tone="stale" label={tx(T, "قبل الرسوم")} />
                            ) : null}
                          </>
                        ) : (
                          <AppText>—</AppText>
                        )}
                        {o.expired ? (
                          <StatusWord
                            tone="expired"
                            label={
                              o.expired_yesterday
                                ? tx(T, "انتهى أمس — خارج الترتيب، معروض للسياق")
                                : tx(T, "منتهٍ — خارج الترتيب، معروض للسياق")
                            }
                          />
                        ) : !o.fees_decided ? (
                          <StatusWord tone="stale" label={tx(T, "خارج الترتيب")} />
                        ) : null}
                      </View>
                    }
                    onPress={() => router.push(`/market/offers/public/${o.id}`)}
                    last={i === g.offers.length - 1}
                  />
                ))}
              </GroupedList>
            </View>
          ))
        : null}
      {shown && shown.multi_unit ? (
        <AppText variant="note" muted>
          {tx(
            T,
            "سعر الوحدة للعروض ذات الرسوم غير المحسومة يظهر بعلامة «قبل الرسوم» ولا يدخل الترتيب. تحويل 500غ إلى كغ حساب صريح نعرضه؛ تحويل «كرتونة» إلى «كيس» ليس تحويلاً بل تخمين تغليف ولن نفعله.",
          )}
        </AppText>
      ) : null}
    </Screen>
  );
}
