import { formatMinor } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { M, Row, Stack, StatusWord, Until } from "@/components/market-discovery/parts";
import {
  CART_KEY,
  type CartLine,
  type OfferCard,
  readSnap,
  writeSnap,
} from "@/features/market-discovery/lib";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "MP-05";
type State = "ready" | "empty" | "expired" | "permission_denied" | "stale";

interface Tier {
  min: number;
  max: number | null;
  price_minor: string;
  unit_price_minor: string;
  label: string;
}
export interface OfferDetail extends OfferCard {
  seller_badge: "verified" | "expired" | "suspended" | "none";
  seller_badge_label: string;
  description: string;
  unit_price_minor: string;
  base_unit_name: string;
  fees_decided: boolean;
  fees_label: string;
  audience: "public" | "private" | "followers";
  audience_label: string;
  currency: string;
  buyer_currency: string;
  currency_mismatch: boolean;
  confirmed_at: string;
  days_since_confirmed: number | null;
  valid_until: string;
  expired: boolean;
  withdrawn: boolean;
  tiers: Tier[];
  others: OfferCard[];
}

const CURRENCY_NAME: Record<string, string> = {
  SDG: tx(T, "الجنيه السوداني"),
  EGP: tx(T, "الجنيه المصري"),
  SAR: tx(T, "الريال السعودي"),
  USD: tx(T, "الدولار الأمريكي"),
};
const currencyName = (code: string) => CURRENCY_NAME[code] ?? code;

function DaysAgo({ n }: { n: number }) {
  if (n === 0) return <>{tx(T, "اليوم")}</>;
  if (n === 1) return <>{tx(T, "قبل يوم")}</>;
  if (n === 2) return <>{tx(T, "قبل يومين")}</>;
  return (
    <>
      {tx(T, "قبل")} <M>{n}</M> {n <= 10 ? tx(T, "أيام") : tx(T, "يوماً")}
    </>
  );
}

/**
 * MP-05 — تفاصيل عرض (43-D35 ready/empty/permission_denied/stale · 08-D4 expired): حيث يقرَّر الشراء. السعر
 * والوحدة بارزان و«أضف إلى السلة» مثبّت أسفل. الإضافة تجلب تأكيداً خادمياً قبل التثبيت (ACC-143): المعروض من
 * الكاش لا يُلزم أحداً؛ والمنتهي يُسقط السعر إلى «آخر سعر معروف» ويمنع الإضافة.
 */
export default function MarketOffer() {
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapKey = `market.offer.${id}`;
  const [o, setO] = useState<OfferDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [added, setAdded] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async (): Promise<OfferDetail | null> => {
    setFailed(false);
    setOffline(false);
    try {
      const { data, response } = await api.GET("/api/market/offers/public/{offer_id}", {
        params: { path: { offer_id: id } },
      });
      if (response.status === 404) {
        setDenied(true);
        return null;
      }
      const body = data as unknown as { offer: OfferDetail } | undefined;
      if (response.ok && body) {
        setO(body.offer);
        void getStorage().then((s) => writeSnap(s, snapKey, body.offer));
        return body.offer;
      }
      setFailed(true);
    } catch {
      setOffline(true);
    }
    return null;
  }, [api, id, snapKey]);

  useEffect(() => {
    void (async () => {
      const snap = await getStorage()
        .then((s) => readSnap<OfferDetail>(s, snapKey))
        .catch(() => null);
      if (snap) setO((cur) => cur ?? snap.data);
      await load();
    })();
  }, [load, snapKey]);

  const addToCart = async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      const fresh = await load();
      if (!fresh || fresh.expired || fresh.withdrawn || fresh.currency_mismatch) return;
      const storage = await getStorage();
      const lines = (await readSnap<CartLine[]>(storage, CART_KEY))?.data ?? [];
      const line: CartLine = {
        offer_id: fresh.id,
        seller_tenant_id: fresh.seller_tenant_id,
        seller_name: fresh.seller_name,
        public_name: fresh.public_name,
        pack_label: fresh.pack_label,
        unit_name: fresh.unit_name,
        price_minor: fresh.price_minor,
        currency: fresh.currency,
        confirmed_at: fresh.confirmed_at,
        valid_until: fresh.valid_until,
        qty: fresh.min_order_qty ?? 1,
        min_order_qty: fresh.min_order_qty,
        fees_label: fresh.fees_label,
      };
      await writeSnap(storage, CART_KEY, [...lines.filter((l) => l.offer_id !== fresh.id), line]);
      setAdded(true);
    } finally {
      setVerifying(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : o?.withdrawn
      ? "empty"
      : o?.expired
        ? "expired"
        : (offline || failed) && o
          ? "stale"
          : "ready";
  const blocked = o ? o.expired || o.currency_mismatch : false;
  const showBody = o && state !== "empty" && state !== "permission_denied";

  return (
    <View style={{ flex: 1, backgroundColor: c.surfacePage }}>
      <Screen screenId={T} state={state} title={tx(T, "تفاصيل عرض")}>
        <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
          {tx(
            T,
            "السعر بشروطه كاملة: السعر وصلاحيته المؤكَّدة، والحد الأدنى، والوحدة بتحويلها، والجمهور، وتاريخ آخر تأكيد من الناشر.",
          )}
        </AppText>

        {state === "permission_denied" ? (
          <StateView state="permission_denied" title={tx(T, "لم يعد هذا العرض متاحاً")}>
            <AppText variant="secondary">
              {tx(T, "لا عرض بهذا الرابط، أو لم يعد ضمن ما يُعرض لك.")}
            </AppText>
            <Button label={tx(T, "ابحث في السوق")} onPress={() => router.push("/market/search")} />
          </StateView>
        ) : null}

        {state === "empty" && o ? (
          <>
            <StateView state="empty" title={tx(T, "لم يعد هذا العرض متاحاً")}>
              <AppText variant="secondary">
                {tx(T, "الناشر أخفاه أو حذفه بعد أن وصل الرابط.")}
              </AppText>
            </StateView>
            <GroupedList title={`${tx(T, "عروض الناشر القائمة —")} ${o.seller_name}`}>
              {o.others.length ? (
                o.others.map((x, i) => (
                  <Row
                    key={x.id}
                    title={x.public_name}
                    sub={x.pack_label}
                    trailing={
                      x.price_minor ? <M strong>{formatMinor(x.price_minor)}</M> : undefined
                    }
                    onPress={() => router.push(`/market/offers/public/${x.id}`)}
                    last={i === o.others.length - 1}
                  />
                ))
              ) : (
                <Row title={tx(T, "لا عروض عامة قائمة للناشر الآن.")} last />
              )}
            </GroupedList>
            <Button
              label={tx(T, "ملف الناشر")}
              onPress={() => router.push(`/market/suppliers/${o.seller_tenant_id}`)}
            />
          </>
        ) : null}

        {showBody ? (
          <>
            <View style={{ flexDirection: ROW_RTL, gap: SPACE["3"], flexWrap: "wrap" }}>
              {state === "expired" ? (
                <StatusWord tone="expired" label={tx(T, "منتهي الصلاحية")} />
              ) : state === "stale" ? (
                <StatusWord tone="stale" label={tx(T, "من الكاش — يحتاج تأكيداً")} />
              ) : (
                <StatusWord tone="success" label={tx(T, "مؤكَّد خادمياً")} />
              )}
              <StatusWord tone="synced" label={o.audience_label} />
            </View>
            <AppText variant="title" style={{ marginTop: SPACE["2"] }}>
              {o.public_name} — {o.pack_label || o.unit_name}
            </AppText>
            <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
              {o.seller_name} ·{" "}
              {o.seller_badge === "verified"
                ? tx(T, "شارة تحقق هوية فقط، لا ضمان جودة")
                : o.seller_badge === "none"
                  ? tx(T, "بلا شارة تحقق")
                  : o.seller_badge_label}
            </AppText>
            <Button
              label={o.seller_name}
              variant="quiet"
              onPress={() => router.push(`/market/suppliers/${o.seller_tenant_id}`)}
            />

            {state === "expired" ? (
              <StateView state="expired" title={tx(T, "انتهت صلاحية السعر")}>
                <AppText variant="secondary">{tx(T, "هذا السعر لم يعد مؤكداً")}</AppText>
                <AppText variant="note" muted>
                  {tx(T, "صلاحية العرض انتهت")}{" "}
                  {o.valid_until ? <Until dateIso={o.valid_until} /> : "—"}
                  {tx(T, ". الرقم أدناه")}{" "}
                  <AppText variant="bodyStrong">{tx(T, "آخر سعر معروف")}</AppText>{" "}
                  {tx(T, "ولا يصلح لتأكيد طلب.")}
                </AppText>
              </StateView>
            ) : null}
            {state === "stale" ? (
              <StateView state="stale" title={tx(T, "صلاحية تحتاج تأكيداً")}>
                <AppText variant="secondary">
                  {tx(T, "المعروض من الكاش وصلاحيته على الحدّ.")}
                </AppText>
              </StateView>
            ) : null}

            <View style={{ marginVertical: SPACE["3"] }}>
              <AppText variant="note" muted>
                {state === "expired" ? tx(T, "آخر سعر معروف للعبوة") : tx(T, "سعر العبوة")}
              </AppText>
              <AppText variant="largeTitle">
                {o.price_minor ? (
                  <>
                    <M strong>{formatMinor(o.price_minor)}</M> <M>{o.currency}</M>
                  </>
                ) : (
                  o.price_line
                )}
              </AppText>
              <AppText variant="secondary" muted>
                {o.unit_price_minor ? (
                  <>
                    <M>{formatMinor(o.unit_price_minor)}</M> <M>{o.currency}</M> {tx(T, "لكل")}{" "}
                    {o.base_unit_name} · {o.fees_decided ? o.fees_label : tx(T, "قبل رسوم التوصيل")}
                  </>
                ) : (
                  o.availability
                )}
              </AppText>
            </View>
            {o.buyer_currency ? (
              <View style={{ marginBottom: SPACE["3"] }}>
                <AppText variant="note" muted>
                  {tx(T, "عملة حسابك")}
                </AppText>
                <AppText>
                  <M strong>{o.buyer_currency}</M>
                </AppText>
                <AppText
                  variant="note"
                  style={{ color: o.currency_mismatch ? c.state.stale.fg : c.inkMuted }}
                >
                  {o.currency_mismatch
                    ? `${tx(T, "العرض ب")}${currencyName(o.currency)}${tx(T, ". لا نحوّل ضمناً.")}`
                    : tx(T, "عملة العرض هي عملة حسابك.")}
                </AppText>
              </View>
            ) : null}

            <GroupedList>
              <Row
                title={tx(T, "الحد الأدنى للطلب")}
                trailing={
                  o.min_order_qty != null ? (
                    <AppText>
                      <M>{o.min_order_qty}</M> {o.unit_name}
                    </AppText>
                  ) : (
                    <AppText>{tx(T, "بلا حدّ أدنى")}</AppText>
                  )
                }
              />
              <Row
                title={tx(T, "الوحدة وتحويلها")}
                sub={
                  <>
                    {o.pack_label || o.unit_name}
                    {o.base_unit_name && o.base_unit_name !== o.unit_name
                      ? ` ${tx(T, "— سعر الوحدة يُحسب على")} ${o.base_unit_name}`
                      : ""}
                  </>
                }
              />
              <Row title={tx(T, "الرسوم والتوصيل")} sub={o.fees_label} />
              <Row title={tx(T, "الجمهور")} sub={o.audience_label} />
              <Row title={tx(T, "التوفر")} sub={o.availability} />
              <Row
                title={tx(T, "آخر تأكيد من الناشر")}
                sub={
                  o.confirmed_at && o.days_since_confirmed != null ? (
                    <>
                      {tx(T, "أكّده الناشر")} <DaysAgo n={o.days_since_confirmed} />
                      {o.valid_until && !o.expired ? (
                        <>
                          {" "}
                          {tx(T, "· يسري حتى")} <Until dateIso={o.valid_until} />
                        </>
                      ) : null}
                    </>
                  ) : (
                    tx(T, "بلا تأكيد قائم — ينتظر تجديداً من الناشر")
                  )
                }
                last={!o.description}
              />
              {o.description ? <Row title={tx(T, "الوصف")} sub={o.description} last /> : null}
            </GroupedList>

            {o.tiers.length ? (
              <GroupedList title={tx(T, "شرائحك في القائمة الخاصة")}>
                {o.tiers.map((t, i) => (
                  <Row
                    key={t.label}
                    title={`${tx(T, "الشريحة")}: ${t.label}`}
                    sub={
                      <>
                        {tx(T, "سعر العبوة")} <M>{formatMinor(t.price_minor)}</M>
                        {t.unit_price_minor ? (
                          <>
                            {" · "}
                            {tx(T, "سعر الوحدة")} <M>{formatMinor(t.unit_price_minor)}</M> /
                            {o.base_unit_name}
                          </>
                        ) : null}
                      </>
                    }
                    last={i === o.tiers.length - 1}
                  />
                ))}
              </GroupedList>
            ) : null}

            {blocked ? (
              <StateView state="expired" title={tx(T, "ممتنع")}>
                <AppText variant="secondary">
                  {o.expired && o.currency_mismatch
                    ? tx(T, "التأكيد موقوف لسببين مستقلين.")
                    : o.expired
                      ? tx(T, "التأكيد موقوف: السعر منتهٍ.")
                      : tx(T, "التأكيد موقوف: عملة العرض تختلف عن عملة حسابك.")}
                </AppText>
                <AppText variant="note" muted>
                  {o.expired && o.currency_mismatch
                    ? `${tx(T, "السعر منتهٍ، وعملة العرض تختلف عن عملة حسابك.")} `
                    : ""}
                  {o.currency_mismatch
                    ? tx(
                        T,
                        "لن نطبّق سعر صرف من عندنا لأن أي رقم نختاره سيصبح التزاماً مالياً بينك وبين المورد لم يتفق عليه أحد. اطلب تأكيداً جديداً يشمل العملة.",
                      )
                    : tx(T, "الناشر وحده يجدّد التأكيد بختم خادمي — لا سعر جديد بتأكيد قديم.")}
                </AppText>
              </StateView>
            ) : null}

            <Stack>
              <Button
                label={tx(T, "شارك الرابط")}
                variant="quiet"
                onPress={() => router.push(`/market/share?offer=${o.id}`)}
              />
              <Button
                label={tx(T, "بلّغ عن هذا العرض")}
                variant="quiet"
                onPress={() => router.push(`/market/report?offer=${o.id}`)}
              />
              {o.expired ? (
                <Button
                  label={tx(T, "ما يُمنع وما يبقى")}
                  variant="quiet"
                  onPress={() =>
                    router.push(`/market/unavailable?supplier=${o.seller_tenant_id}&offer=${o.id}`)
                  }
                />
              ) : null}
            </Stack>
          </>
        ) : null}
      </Screen>

      {showBody && o ? (
        <View
          style={{
            padding: SPACE["4"],
            paddingBottom: SPACE["4"] + insets.bottom,
            gap: SPACE["2"],
            backgroundColor: c.surfaceCard,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          {blocked ? (
            <>
              <Button
                label={
                  o.currency_mismatch
                    ? tx(T, "طلب تأكيد سعر وعملة من المورد")
                    : tx(T, "طلب تأكيد سعر من المورد")
                }
                financial
                onPress={() => router.push(`/market/suppliers/${o.seller_tenant_id}`)}
              />
              <Button
                label={tx(T, "إضافة إلى السلة — غير متاح")}
                variant="secondary"
                onPress={() => undefined}
                disabledReason={
                  o.expired
                    ? tx(T, "السعر منتهٍ ولا يصلح لتأكيد طلب")
                    : tx(T, "عملة العرض تختلف عن عملة حسابك")
                }
              />
            </>
          ) : added ? (
            <>
              <StatusWord tone="success" label={tx(T, "أُضيف إلى السلة بعد تأكيد خادمي")} />
              <Button
                label={tx(T, "السلة")}
                financial
                onPress={() => router.push("/market/cart")}
              />
            </>
          ) : (
            <Button
              label={tx(T, "إضافة إلى السلة")}
              financial
              loading={verifying}
              onPress={() => void addToCart()}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}
