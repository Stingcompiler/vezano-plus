import { formatMinor } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { LinkExpired } from "@/components/market-discovery/link-expired";
import {
  Count,
  M,
  Marked,
  Note,
  Row,
  Stack,
  StatusWord,
  Until,
} from "@/components/market-discovery/parts";
import type { OfferCard, SupplierCard } from "@/features/market-discovery/lib";
import { useSession } from "@/lib/session";

const T = "MP-03";
type State = "loading" | "ready" | "permission_denied" | "expired";

interface Supplier extends SupplierCard {
  since: string;
  badge_means: string[];
  badge_not: string[];
  verified_until: string;
  suspended_at: string;
  facts: { confirmed_orders: number; fulfilled: number; partial: number; open_disputes: number };
  offers: OfferCard[];
}

const OFFERS = {
  one: tx(T, "عرض واحد"),
  two: tx(T, "عرضان"),
  few: tx(T, "عروض"),
  many: tx(T, "عرضاً"),
};
/** أسماء الأشهر من نصوص MP-03 نفسها (كما يعرضها الويب بعد «ينشر منذ»). */
const MONTH_WORDS = [
  tx(T, "يناير"),
  tx(T, "فبراير"),
  tx(T, "مارس"),
  tx(T, "أبريل"),
  tx(T, "مايو"),
  tx(T, "يونيو"),
  tx(T, "يوليو"),
  tx(T, "أغسطس"),
  tx(T, "سبتمبر"),
  tx(T, "أكتوبر"),
  tx(T, "نوفمبر"),
  tx(T, "ديسمبر"),
];

/**
 * MP-03 — ملف منشأة منشور (12-D7 + 47-D38 ready · 43-D35 loading/permission_denied/expired). رأس ثم أقسام؛
 * `?list=` رابط قائمة خاصة: غير المخوَّل لا يرى قسماً ولا تلميحاً (permission_denied).
 */
export default function MarketSupplier() {
  const router = useRouter();
  const { api } = useSession();
  const { id, list } = useLocalSearchParams<{ id: string; list?: string }>();
  const [s, setS] = useState<Supplier | null>(null);
  const [gone, setGone] = useState(false);
  const [listDenied, setListDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, response } = await api.GET("/api/public/market/suppliers/{tenant_id}", {
        params: { path: { tenant_id: id } },
      });
      if (response.status === 404) {
        setGone(true);
        return;
      }
      const body = data as unknown as { supplier: Supplier } | undefined;
      if (response.ok && body) setS(body.supplier);
      if (list) {
        const r = await api.GET("/api/market/lists/{list_id}", {
          params: { path: { list_id: list } },
        });
        if (!r.response.ok) setListDenied(true);
      }
    } catch {
      /* بلا اتصال: يبقى «جلب الملف» — الملف العام لا يُخزَّن محلياً */
    }
  }, [api, id, list]);

  useEffect(() => {
    void load();
  }, [load]);

  const state: State = !s
    ? "loading"
    : s.badge === "expired" || s.badge === "suspended"
      ? "expired"
      : listDenied
        ? "permission_denied"
        : "ready";

  const since = s?.since ? MONTH_WORDS[new Date(s.since).getMonth()] : "";

  return (
    <Screen screenId={T} state={gone ? "expired" : state} title={s?.public_name ?? tx(T, "السوق")}>
      {gone ? <LinkExpired /> : null}
      {state === "loading" && !gone ? (
        <StateView state="loading" title={tx(T, "جلب الملف")}>
          <AppText variant="secondary">{tx(T, "الهوية والشارة أولاً ثم العروض.")}</AppText>
        </StateView>
      ) : null}

      {s ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["2"] }}>
            {[s.category_line, s.service_areas[0], s.fulfilment[0]].filter(Boolean).join(" · ")} ·{" "}
            <Count n={s.offers_count} forms={OFFERS} />
            {since ? ` ${tx(T, "· ينشر منذ")} ${since}` : ""}
          </AppText>
          <View style={{ marginBottom: SPACE["3"] }}>
            <StatusWord
              tone={s.badge === "verified" ? "success" : s.badge === "none" ? "stale" : "expired"}
              label={s.badge === "verified" ? tx(T, "هوية متحققة") : s.badge_label}
            />
          </View>
          <Stack>
            <Button
              label={tx(T, "تابع هذا المورد")}
              onPress={() => router.push(`/market/following?follow=${s.tenant_id}`)}
              disabledReason={
                s.badge === "suspended"
                  ? tx(T, "النشر معلَّق — لا متابعة جديدة حتى يُرفع التعليق")
                  : undefined
              }
            />
            <Note>
              {tx(
                T,
                "المتابعة اشتراك B2B باسم منشأتك — تحتاج حساباً وصلاحية. والعروض أعلاه تُرى بلا حساب.",
              )}
            </Note>
            <Button
              label={tx(T, "شارك الرابط أو اطلب تخويلاً")}
              variant="quiet"
              onPress={() => router.push(`/market/share?supplier=${s.tenant_id}`)}
            />
            <Button
              label={tx(T, "بلّغ عن انتحال")}
              variant="quiet"
              onPress={() => router.push(`/market/report?supplier=${s.tenant_id}`)}
            />
            {s.badge === "suspended" ? (
              <Button
                label={tx(T, "ما يُمنع وما يبقى")}
                variant="quiet"
                onPress={() => router.push(`/market/unavailable?supplier=${s.tenant_id}`)}
              />
            ) : null}
          </Stack>

          {state === "expired" ? (
            <StateView state="expired" title={tx(T, "تحقق منتهٍ أو منشأة معلَّقة")}>
              <AppText variant="secondary">{tx(T, "الشارة سقطت أو النشر عُلِّق.")}</AppText>
              <AppText variant="note" muted>
                <AppText variant="bodyStrong">{tx(T, "الشارة بحدودها")}</AppText>{" "}
                {tx(T, "· تسقط الشارة ويبقى الملف:")}{" "}
                {s.badge === "expired" && s.verified_until ? (
                  <>
                    {tx(T, "«التحقق منتهٍ منذ")} <Until dateIso={s.verified_until} />»
                  </>
                ) : (
                  tx(T, "«النشر معلَّق»")
                )}{" "}
                {tx(T, "— لا محو ولا إخفاء صامت. والمعلَّقة يُمنع جديدها ويبقى سابقها للاطلاع.")}
              </AppText>
            </StateView>
          ) : null}

          {s.badge === "verified" || s.badge === "expired" ? (
            <GroupedList title={tx(T, "ماذا تعني «هوية متحققة» وماذا لا تعني")}>
              <View style={{ padding: SPACE["4"] }}>
                <Marked title={tx(T, "تعني")} items={s.badge_means} mark={tx(T, "نعم")} />
                <Marked title={tx(T, "لا تعني")} items={s.badge_not} mark={tx(T, "لا")} />
              </View>
            </GroupedList>
          ) : null}

          <GroupedList title={tx(T, "حقائق قابلة للتحقق — لا تقييم نجوم")}>
            {(
              [
                [tx(T, "طلبات مؤكدة من طرفين"), s.facts.confirmed_orders],
                [tx(T, "نُفِّذت كاملة"), s.facts.fulfilled],
                [tx(T, "نُفِّذت جزئياً"), s.facts.partial],
                [tx(T, "خلافات مفتوحة الآن"), s.facts.open_disputes],
              ] as const
            ).map(([label, n], i) => (
              <Row key={label} title={label} trailing={<M strong>{n}</M>} last={i === 3} />
            ))}
          </GroupedList>
          <Note>{tx(T, "الحقائق أعلاه تُحتسب من طلبات فعلية مؤكدة من طرفين.")}</Note>

          <GroupedList title={tx(T, "العروض المنشورة")}>
            {s.offers.length ? (
              s.offers.map((o, i) => (
                <Row
                  key={o.id}
                  title={o.public_name}
                  sub={
                    <>
                      {o.pack_label}
                      {o.price_minor ? null : (
                        <>
                          {"\n"}
                          {o.price_line} · {o.availability} {tx(T, "— بسعرٍ عند الطلب")}
                        </>
                      )}
                      {o.price_minor && o.confirmed_until ? (
                        <>
                          {"\n"}
                          {tx(T, "· مؤكَّد حتى")} <Until dateIso={o.confirmed_until} />
                        </>
                      ) : null}
                    </>
                  }
                  trailing={o.price_minor ? <M strong>{formatMinor(o.price_minor)}</M> : undefined}
                  onPress={() => router.push(`/market/offers/public/${o.id}`)}
                  last={i === s.offers.length - 1}
                />
              ))
            ) : (
              <Row title={tx(T, "لا عروض عامة منشورة الآن.")} last />
            )}
          </GroupedList>

          <GroupedList title={tx(T, "متابعاتك")}>
            <View style={{ padding: SPACE["4"], gap: SPACE["2"] }}>
              <AppText>{tx(T, "لا تتابع أحداً بعد")}</AppText>
              <Note>
                {tx(
                  T,
                  "المتابعة اشتراك تسويقي: تصلك عروض من تختاره وحده. ليست شرطاً للشراء ولا للوصول إلى سعر — يمكنك الطلب من مورد بلا متابعته. إلغاء المتابعة لاحقاً لا يمحو طلباتك السابقة ولا ذممك.",
                )}
              </Note>
              <Button
                label={tx(T, "استعراض موردي منطقتك")}
                onPress={() => router.push("/market/directory")}
              />
            </View>
          </GroupedList>
        </>
      ) : null}
    </Screen>
  );
}
