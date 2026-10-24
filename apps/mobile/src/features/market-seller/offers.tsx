import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import {
  Lead,
  M,
  NodeChip,
  Note,
  Row,
  Stack,
  StateWord,
  ChipRow,
} from "@/components/market-seller/parts";
import { netState, safeGet, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "MP-10";

export interface Offer {
  id: string;
  item_id: string;
  public_name: string;
  description: string;
  unit_code: string;
  unit_name: string;
  pack_label: string;
  price_minor: string;
  audience: "public" | "private" | "followers";
  audience_label: string;
  min_order_qty: number | null;
  max_order_qty: number | null;
  fulfilment_note: string;
  valid_until: string;
  status: "draft" | "published" | "expired" | "hidden";
  status_label: string;
  meaning: string;
  missing: { key: string; title: string; hint: string }[];
}

interface OfferList {
  offers: Offer[];
  counts: Record<"published" | "draft" | "expired" | "hidden", number>;
  total: number;
  expiring_this_week: number;
  can_edit: boolean;
  can_publish: boolean;
  seller_verified: boolean;
  plan_allows: boolean;
}

const STATUS_STATE: Record<Offer["status"], StateCode> = {
  published: "success",
  draft: "ready",
  expired: "expired",
  hidden: "stale",
};

/** MP-10 — عروض البائع الداخلية: أربع حالات لا حالتان (29-D22 ready/expired · 43-D35 loading · 12-D7 empty). */
export default function OffersScreen() {
  const router = useRouter();
  const { api } = useSession();
  const srv = useServerGet<OfferList>("cache.market.offers", () =>
    safeGet(() => api.GET("/api/market/offers")),
  );
  const [filter, setFilter] = useState<"all" | Offer["status"]>("all");
  const data = srv.shown;
  const offers = (data?.offers ?? []).filter((o) => filter === "all" || o.status === filter);
  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode = !data
    ? (net ?? "loading")
    : data.total === 0
      ? "empty"
      : (net ?? (filter === "expired" ? "expired" : "ready"));

  const chip = (id: typeof filter, label: string, n?: number) => (
    <NodeChip key={id} on={filter === id} onPress={() => setFilter(id)}>
      {label}
      {typeof n === "number" ? (
        <>
          {" — "}
          <M>{n}</M>
        </>
      ) : null}
    </NodeChip>
  );

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "عروض البائع الداخلية")}
      onRefresh={() => void srv.reload()}
    >
      <Lead>{tx(T, "منشور، مسودة، منتهٍ، مخفي. «المخفي» ليس محذوفاً و«المنتهي» ليس مخفياً.")}</Lead>
      <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "عروضي —")} <M>{data?.total ?? 0}</M>
      </AppText>
      {data?.can_edit ? (
        <Stack>
          <Button label={tx(T, "عرض جديد")} onPress={() => router.push("/market/offers/new")} />
        </Stack>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب عروضك")}>
          <AppText variant="secondary">
            {tx(
              T,
              "مع عدد ما تنتهي صلاحيته هذا الأسبوع — وهو سبب فتح الشاشة، والترتيب به لا بتاريخ النشر.",
            )}
          </AppText>
        </StateView>
      ) : null}
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}

      {data ? (
        <>
          {data.expiring_this_week ? (
            <Lead>
              {tx(T, "ينتهي هذا الأسبوع:")} <M>{data.expiring_this_week}</M>{" "}
              {tx(T, "— الترتيب به لا بتاريخ النشر.")}
            </Lead>
          ) : null}
          <ChipRow>
            {chip("all", tx(T, "الكل"), data.total)}
            {chip("published", tx(T, "منشور"), data.counts.published)}
            {chip("draft", tx(T, "مسودة"), data.counts.draft)}
            {chip("expired", tx(T, "منتهٍ"), data.counts.expired)}
            {chip("hidden", tx(T, "مخفي"), data.counts.hidden)}
          </ChipRow>
        </>
      ) : null}

      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا عروض بعد")}>
          <AppText variant="secondary">
            {tx(
              T,
              "النشر اختيار صنف صنف مع جمهوره وسعره وصلاحيته. من ينشر ٦٤٠ صنفاً بضغطة يكشف كلفته وتوفّره لمنافسيه بلا أن يقصد.",
            )}
          </AppText>
          {!data?.seller_verified ? (
            <AppText variant="note" muted>
              {tx(T, "النشر بعد اعتماد دور البائع.")}
            </AppText>
          ) : null}
        </StateView>
      ) : null}

      {data && offers.length ? (
        <GroupedList title={tx(T, "عروضي")}>
          {offers.map((o, i) => (
            <Row
              key={o.id}
              title={o.public_name}
              sub={
                <>
                  {o.pack_label ? `${o.pack_label}\n` : ""}
                  {tx(T, "الجمهور")}: {o.audience_label}
                  {"\n"}
                  {o.meaning}
                </>
              }
              trailing={
                <View style={{ alignItems: "flex-start" }}>
                  <AppText variant="secondary">
                    <M>{o.price_minor ? formatMinor(o.price_minor) : "—"}</M>
                  </AppText>
                  <StateWord state={STATUS_STATE[o.status]} label={o.status_label} />
                </View>
              }
              onPress={() => router.push(`/market/offers/${o.id}`)}
              last={i === offers.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}

      {data && data.total ? (
        <Note>{tx(T, "النشر اختيار صنف صنف مع جمهوره وسعره وصلاحيته.")}</Note>
      ) : null}
    </Screen>
  );
}
