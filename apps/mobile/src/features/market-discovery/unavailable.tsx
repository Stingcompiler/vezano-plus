import { formatMinor } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { InfoBox, M, Note, Row, Stack, StatusWord } from "@/components/market-discovery/parts";
import { CART_KEY, type CartLine, readSnap } from "@/features/market-discovery/lib";
import type { OfferDetail } from "@/features/market-discovery/offer";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "MP-14";
type State = "ready" | "expired" | "permission_denied";

interface SupplierStatus {
  tenant_id: string;
  public_name: string;
  suspended: boolean;
  suspended_line: string;
  badge: string;
  badge_label: string;
  blocked: { title: string; detail: string }[];
  kept: { title: string; detail: string }[];
}

const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

function Lists({
  title,
  items,
  mark,
}: {
  title: string;
  items: { title: string; detail: string }[];
  mark: string;
}) {
  return (
    <View style={{ marginBottom: SPACE["3"] }}>
      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
        {title}
      </AppText>
      {items.map((b) => (
        <AppText key={b.title} variant="secondary" style={{ paddingVertical: 2 }}>
          {mark} <AppText variant="bodyStrong">{b.title}</AppText> — {b.detail}
        </AppText>
      ))}
    </View>
  );
}

/**
 * MP-14 — عرض منتهٍ أو منشأة معلَّقة (29-D22 expired/permission_denied · 43-D35 ready): منع الجديد دون محو
 * السابق (ACC-135). التعليق أوسع من انتهاء العرض؛ والرقم المنتهي «آخر سعر معروف» لا سعر. أسطر السلة محلية.
 */
export default function MarketUnavailable() {
  const router = useRouter();
  const { api } = useSession();
  const { supplier = "", offer: offerId = "" } = useLocalSearchParams<{
    supplier?: string;
    offer?: string;
  }>();
  const [s, setS] = useState<SupplierStatus | null>(null);
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const cart = (await readSnap<CartLine[]>(storage, CART_KEY))?.data ?? [];
      setLines(supplier ? cart.filter((l) => l.seller_tenant_id === supplier) : cart);
      try {
        if (supplier) {
          const { data, response } = await api.GET(
            "/api/public/market/suppliers/{tenant_id}/status",
            { params: { path: { tenant_id: supplier } } },
          );
          const body = data;
          if (response.ok && body) setS(body.supplier);
        }
        if (offerId) {
          const { data, response } = await api.GET("/api/market/offers/public/{offer_id}", {
            params: { path: { offer_id: offerId } },
          });
          const body = data as unknown as { offer: OfferDetail } | undefined;
          if (response.ok && body) setOffer(body.offer);
        }
      } catch {
        /* بلا اتصال: أسطر السلة المحلية تبقى معروضة */
      }
      setLoaded(true);
    })();
  }, [api, supplier, offerId]);

  const state: State = s?.suspended ? "permission_denied" : offer?.expired ? "expired" : "ready";
  const cartLine = lines.find((l) => l.offer_id === offerId) ?? null;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "عرض منتهٍ أو منشأة معلّقة — منع الجديد دون محو السابق")}
    >
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "تعليق البائع يمنع طلباً جديداً ويُبقي الطلبات القائمة والتصدير. الرقم المنتهي يُعرض كـ«آخر سعر معروف» لا كسعر.",
        )}
      </AppText>

      {state === "permission_denied" && s ? (
        <>
          <View style={{ marginBottom: SPACE["2"] }}>
            <StatusWord tone="expired" label={tx(T, "معلّق")} />
          </View>
          <StateView state="permission_denied" title={tx(T, "نشر هذه المنشأة معلَّق حالياً")}>
            <AppText variant="secondary">
              {s.public_name} · {s.suspended_line}
            </AppText>
          </StateView>
          <Lists title={tx(T, "يُمنع")} items={s.blocked} mark={tx(T, "لا")} />
          <Lists title={tx(T, "يبقى")} items={s.kept} mark={tx(T, "نعم")} />
          <Stack>
            <Button
              label={tx(T, "طلب جديد — موقوف")}
              variant="secondary"
              onPress={() => undefined}
              disabledReason={tx(T, "النشر معلَّق — لا طلب جديد من هذه المنشأة حتى يُرفع التعليق")}
            />
            <Button
              label={tx(T, "ملف المنشأة")}
              onPress={() => router.push(`/market/suppliers/${s.tenant_id}`)}
            />
          </Stack>
        </>
      ) : null}

      {state === "expired" && offer ? (
        <>
          <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "عرض منتهٍ في سلّة مشترٍ")}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "آخر سعر معروف — لا يصلح للتأكيد")}
          </AppText>
          <AppText variant="largeTitle">
            <M strong>{formatMinor(cartLine?.price_minor || offer.price_minor)}</M>{" "}
            <M>{offer.currency}</M>
          </AppText>
          <Note>
            {tx(T, "انتهت الصلاحية")} <M>{offer.valid_until ? dm(offer.valid_until) : "—"}</M>
            {" · "}
            {offer.public_name} — {offer.pack_label || offer.unit_name} · {offer.seller_name}
          </Note>
          <Note>{tx(T, "لا نحذف السطر من السلّة ولا نحدّث سعره تلقائياً.")}</Note>
          <Stack>
            <Button
              label={tx(T, "طلب تأكيد سعر جديد")}
              financial
              onPress={() => router.push(`/market/suppliers/${offer.seller_tenant_id}`)}
            />
            <Button
              label={tx(T, "تفاصيل العرض")}
              variant="secondary"
              onPress={() => router.push(`/market/offers/public/${offer.id}`)}
            />
          </Stack>
        </>
      ) : null}

      {state === "ready" ? (
        <>
          <InfoBox title={tx(T, "المنتهي عند ناشره")}>
            <AppText variant="secondary">
              {tx(
                T,
                "العرض المنتهي يبقى في قائمة البائع بوسمه وزرّ تجديده — وعند المشتري يسقط من النتائج ولا يُعرض سعراً.",
              )}
            </AppText>
            <AppText variant="note" muted>
              <AppText variant="bodyStrong">{tx(T, "المعلَّقة أوسع")}</AppText>{" "}
              {tx(T, "· تعليق المنشأة يمنع الجديد كله ويبقي السابق للاطلاع والتصدير — لا محو.")}
            </AppText>
          </InfoBox>
          {s ? (
            <Note>
              {s.public_name} · {s.badge_label} {tx(T, "— النشر قائم ولا مانع من طلب جديد.")}
            </Note>
          ) : null}
          {loaded && lines.length ? (
            <GroupedList title={tx(T, "أسطر سلّتك")}>
              {lines.map((l, i) => (
                <Row
                  key={l.offer_id}
                  title={l.public_name}
                  sub={
                    <>
                      {l.pack_label || l.unit_name} · {l.seller_name}
                      {"\n"}
                      <M>{formatMinor(l.price_minor)}</M> <M>{l.currency}</M>{" "}
                      {tx(T, "· مؤكَّد حتى")} <M>{l.valid_until ? dm(l.valid_until) : "—"}</M>
                    </>
                  }
                  onPress={() => router.push(`/market/offers/public/${l.offer_id}`)}
                  last={i === lines.length - 1}
                />
              ))}
            </GroupedList>
          ) : loaded ? (
            <Note>{tx(T, "لا أسطر في سلّتك بعد.")}</Note>
          ) : null}
          <Stack>
            <Button
              label={tx(T, "عروضي المنتهية — تجديد التأكيد")}
              variant="secondary"
              onPress={() => router.push("/market/renewals")}
            />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}
