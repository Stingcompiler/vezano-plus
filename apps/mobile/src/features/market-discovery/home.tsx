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
import { Sheet } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import {
  ChipRow,
  Count,
  M,
  NodeChip,
  Row,
  Stack,
  StatusWord,
  Until,
  AgoNum,
} from "@/components/market-discovery/parts";
import {
  type OfferCard,
  readArea,
  safeGet,
  type SupplierCard,
  writeArea,
} from "@/features/market-discovery/lib";
import { useSnapGet } from "@/features/market-discovery/use-snap";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "MP-01";
type State = "loading" | "ready" | "empty" | "offline" | "stale" | "server_error";

interface Home {
  area: string;
  areas: { name: string; suppliers: number }[];
  q: string;
  suppliers: SupplierCard[];
  offers_by_unit: { unit_name: string; offers: OfferCard[] }[];
  offers_count: number;
  suppliers_count: number;
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
  two: tx(T, "موردان"),
  few: tx(T, "موردين"),
  many: tx(T, "مورداً"),
};

/**
 * MP-01 — رئيسية السوق (47-D38 S-06 ready · 12-D7 empty · 43-D35 loading/offline/stale): موردو منطقتك
 * بعروض منشورة ومؤكَّدة. الخاص يبقى خاصاً. لا لقطة ولا اتصال = «السوق يحتاج اتصالاً» (لا أسعار الآخرين محلياً).
 */
export default function MarketHome() {
  const router = useRouter();
  const { api } = useSession();
  const [area, setArea] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(false);

  useEffect(() => {
    void getStorage()
      .then(readArea)
      .then(setArea)
      .catch(() => setArea(""));
  }, []);

  const { shown, snap, net, reload } = useSnapGet<Home>(
    "market.home",
    () =>
      safeGet(
        () => api.GET("/api/public/market", { params: { query: { area: area ?? "", q } } }),
        (d) => d as Home | undefined,
      ),
    [area, q],
    120,
    area !== null,
  );

  const state: State =
    net === "offline" && !shown
      ? "offline"
      : net === "offline" || (net === "failed" && shown)
        ? "stale"
        : !shown
          ? net === "failed"
            ? "server_error"
            : "loading"
          : shown.suppliers.length === 0
            ? "empty"
            : "ready";
  const areaName = area ?? "";
  const areaLabel = areaName || tx(T, "كل المناطق");

  const chooseArea = (name: string) => {
    setArea(name);
    void getStorage().then((s) => writeArea(s, name));
    setPick(false);
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={`${tx(T, "السوق")}${areaName ? ` — ${areaName}` : ""}`}
      onRefresh={() => void reload()}
      refreshing={net === "loading" && !!shown}
    >
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "موردو منطقتك بعروض منشورة ومؤكَّدة — تطلب بالكمية والسعر المعلَنين، وما تستلمه يدخل دفترك بلا إدخال مكرَّر.",
        )}
      </AppText>
      <View style={{ marginBottom: SPACE["3"] }}>
        <AppText variant="secondary" muted>
          {tx(T, "المنطقة:")} {areaLabel} {tx(T, "· بحثٌ بالاسم أو الصنف")}
        </AppText>
        <Button
          label={tx(T, "بدِّلها")}
          variant="quiet"
          onPress={() => setPick(true)}
          disabledReason={!shown ? tx(T, "السوق يحتاج اتصالاً") : undefined}
        />
      </View>

      <TextField
        label={tx(T, "ابحث عن صنف أو مورد")}
        placeholder={tx(T, "ابحث عن صنف أو مورد")}
        value={q}
        onChangeText={setQ}
        returnKeyType="search"
        onSubmitEditing={() => q && router.push(`/market/search?q=${encodeURIComponent(q)}`)}
      />
      {q ? (
        <Stack>
          <Button
            label={tx(T, "قارن النتائج")}
            onPress={() => router.push(`/market/search?q=${encodeURIComponent(q)}`)}
          />
        </Stack>
      ) : null}

      <GroupedList title={tx(T, "أقسام السوق")}>
        <Row title={tx(T, "المنشآت")} onPress={() => router.push("/market/directory")} />
        <Row title={tx(T, "المنتجات")} onPress={() => router.push("/market/search")} />
        <Row title={tx(T, "طلباتي")} onPress={() => router.push("/market/orders")} />
        <Row title={tx(T, "المتابَعون")} onPress={() => router.push("/market/following")} />
        <Row title={tx(T, "عروضي")} onPress={() => router.push("/market/offers")} />
        <Row
          title={tx(T, "طلبات العملاء")}
          onPress={() => router.push("/market/orders/incoming")}
          last
        />
      </GroupedList>

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "العروض تَرِد")}>
          <AppText variant="secondary">
            {tx(T, "الهيكل والفئات فوراً، والعروض المنشورة تلحق. لا يُعرض إلا المنشور المؤكَّد.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "تعذّر جلب السوق")}>
          <AppText variant="secondary">
            {tx(T, "هذا عطل في الاتصال بالخادم لا غياب موردين. أعد المحاولة بعد لحظات.")}
          </AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={() => void reload()} />
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "السوق يحتاج اتصالاً")}>
          <AppText variant="secondary">
            {tx(T, "بخلاف POS — أسعار الآخرين لا تُخزَّن صادقةً على جهازك.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" && snap ? (
        <StateView state="stale" title={tx(T, "عروض من آخر جلب")}>
          <AppText variant="secondary">
            {tx(T, "الاتصال متقطع والمعروض من الكاش —")} {tx(T, "قبل")}{" "}
            <AgoNum
              iso={snap.at}
              words={{ minute: tx(T, "دقيقة"), hour: tx(T, "ساعة"), day: tx(T, "يوم") }}
            />
            .
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && shown ? (
        <StateView
          state="empty"
          title={
            areaName
              ? `${tx(T, "لا موردين ينشرون في")} ${areaName} ${tx(T, "بعد")}`
              : tx(T, "لا موردين ينشرون في السوق بعد")
          }
        >
          {areaName ? (
            <>
              <AppText variant="secondary">
                {tx(
                  T,
                  "هذه حقيقة عن السوق لا خطأ في بحثك ولا عطل عندنا. السوق يُبنى منطقة منطقة، ومنطقتك لم يصلها مورد ناشر حتى الآن.",
                )}
              </AppText>
              <AppText variant="secondary">
                {tx(
                  T,
                  "لن نعرض لك موردي الخرطوم كأنهم خيار: التوصيل خارج منطقتهم ليس منشوراً، وعرض ما لا يُنفَّذ إهدار لوقتك.",
                )}
              </AppText>
            </>
          ) : (
            <AppText variant="secondary">
              {tx(
                T,
                "هذه حقيقة عن السوق لا خطأ في بحثك ولا عطل عندنا. السوق يُبنى منطقة منطقة، ولم ينشر فيه مورد في أي منطقة حتى الآن.",
              )}
            </AppText>
          )}
          {(
            [
              [
                tx(T, "اطلب من مورد تعرفه أن ينشر"),
                tx(T, "رابط دعوة تُرسله بنفسك. لن ندعو أحداً باسمك ولن ننشئ له ملفاً."),
              ],
              [
                tx(T, "أبلغنا بالمنطقة لنعرف أين نعمل"),
                tx(T, "طلبك يُحتسب في تخطيط التوسّع ولا يُترجم وعداً بموعد."),
              ],
              [
                tx(T, "سجّل مورديك في دفترك المحلي"),
                tx(
                  T,
                  "دفتر الموردين يعمل بلا سوق: ذمم وطلبات ومستندات بينك وبينهم بلا حاجة إلى وجودهم هنا.",
                ),
              ],
            ] as const
          ).map(([h, b], i) => (
            <View key={h}>
              <AppText variant="bodyStrong">
                <M>{i + 1}</M> {h}
              </AppText>
              <AppText variant="note" muted>
                {b}
              </AppText>
            </View>
          ))}
        </StateView>
      ) : null}

      {shown && shown.suppliers.length ? (
        <>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            <Count n={shown.offers_count} forms={OFFERS} /> ·{" "}
            <Count n={shown.suppliers_count} forms={SUPPLIERS} />{" "}
            {tx(T, "· الترتيب داخل كل وحدة على حدة — لا «الأرخص» عبر وحدات مختلفة.")}
          </AppText>
          <GroupedList title={tx(T, "الموردون")}>
            {shown.suppliers.map((s, i) => (
              <Row
                key={s.tenant_id}
                title={s.public_name}
                sub={
                  <>
                    {[s.category_line, s.fulfilment[0]].filter(Boolean).join(" · ")} ·{" "}
                    <Count n={s.offers_count} forms={OFFERS} />
                  </>
                }
                trailing={
                  <StatusWord
                    tone={s.badge === "verified" ? "success" : "stale"}
                    label={s.badge === "verified" ? tx(T, "متحقَّقة") : tx(T, "بلا شارة")}
                  />
                }
                onPress={() => router.push(`/market/suppliers/${s.tenant_id}`)}
                last={i === shown.suppliers.length - 1}
              />
            ))}
          </GroupedList>
          {shown.offers_by_unit.map((g) => (
            <GroupedList key={g.unit_name} title={g.unit_name}>
              {g.offers.map((o, i) => (
                <Row
                  key={o.id}
                  title={o.public_name}
                  sub={
                    <>
                      {[o.pack_label, o.seller_name].filter(Boolean).join(" · ")}
                      {"\n"}
                      {o.price_minor ? (
                        <>
                          <StatusWord tone="success" label={tx(T, "مؤكد")} />
                          {o.confirmed_until ? (
                            <>
                              {" "}
                              {tx(T, "مؤكَّد حتى")} <Until dateIso={o.confirmed_until} />
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>
                          {o.price_line} · {o.availability} {tx(T, "— بسعرٍ عند الطلب")}
                        </>
                      )}
                    </>
                  }
                  trailing={o.price_minor ? <M strong>{formatMinor(o.price_minor)}</M> : undefined}
                  onPress={() => router.push(`/market/offers/public/${o.id}`)}
                  last={i === g.offers.length - 1}
                />
              ))}
            </GroupedList>
          ))}
        </>
      ) : null}

      <Sheet open={pick} title={tx(T, "المنطقة")} onClose={() => setPick(false)}>
        <ChipRow>
          <NodeChip on={!areaName} onPress={() => chooseArea("")}>
            {tx(T, "كل المناطق")}
          </NodeChip>
          {(shown?.areas ?? []).map((a) => (
            <NodeChip key={a.name} on={areaName === a.name} onPress={() => chooseArea(a.name)}>
              {a.name} — <M>{a.suppliers}</M>
            </NodeChip>
          ))}
        </ChipRow>
      </Sheet>
    </Screen>
  );
}
