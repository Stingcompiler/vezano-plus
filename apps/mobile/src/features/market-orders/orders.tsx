import { formatMinor, hhmm } from "@sting/app-core";
import { AppText, Button, Chip, GroupedList, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  Ago,
  ChipRow,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  type ToneName,
} from "@/components/market-orders/parts";
import { readCart, safeGet } from "@/features/market-orders/lib";
import { tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-03";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "loading" | "ready" | "empty" | "stale" | "pending_sync" | "offline";

interface Payload {
  orders: OrderRow[];
  awaiting_count: number;
  hidden_by_filter: number;
  fetched_at: string;
}

interface Item {
  id: string;
  party: string;
  number: string;
  content: string;
  value: string;
  currency: string;
  status: string;
  chip: ToneName;
  step: string;
  updated: string;
  flagged: boolean;
  draft: boolean;
  noReply: boolean;
}

const chipOf = (o: OrderRow): ToneName =>
  o.no_reply
    ? "expired"
    : o.status === "disputed"
      ? "conflict"
      : o.status === "cancelled" || o.status === "rejected"
        ? "expired"
        : o.status === "sent" || o.status === "quoted"
          ? "stale"
          : o.status === "received"
            ? "success"
            : "partial";

const linesWord = (n: number) =>
  n === 1 ? t("بند واحد") : n === 2 ? t("بندان") : `${n} ${t("بنود")}`;

/** ORD-03 — طلبات المشتري (41-D33 loading/empty/stale · 12-D7 ready/pending_sync): الفلتر يُعلن ما يُخفي، ولا «إجمالي كل الطلبات». */
export default function Orders() {
  const router = useRouter();
  const { api } = useSession();
  const [drafts, setDrafts] = useState<Item[]>([]);
  const [filter, setFilter] = useState<"all" | "open">("open");
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState("");

  const doc = useDoc<Payload>(
    "market.orders",
    useCallback(() => safeGet<Payload>(() => api.GET("/api/market/orders")), [api]),
  );

  useEffect(() => {
    void readCart().then((cart) => {
      const bySeller = new Map<string, { name: string; count: number; priced: boolean }>();
      for (const l of cart.lines) {
        const g = bySeller.get(l.seller_tenant_id) ?? {
          name: l.seller_name,
          count: 0,
          priced: true,
        };
        g.count += 1;
        if (!l.price_minor) g.priced = false;
        bySeller.set(l.seller_tenant_id, g);
      }
      setDrafts(
        [...bySeller.entries()].map(([sid, g]) => ({
          id: `draft-${sid}`,
          party: g.name,
          number: "",
          content: g.priced
            ? `${t("مسودة محلية ·")} ${linesWord(g.count)} ${t("· لا رقم طلب")}`
            : t("مسودة محلية بلا سعر محمَّل · لا رقم طلب"),
          value: "",
          currency: "",
          status: t("مسودة"),
          chip: "saved_local",
          step: t("راجع وأرسل من السلة"),
          updated: cart.at,
          flagged: false,
          draft: true,
          noReply: false,
        })),
      );
    });
  }, []);

  const resend = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await api.POST("/api/market/orders/{order_id}/resend", {
        params: { path: { order_id: id } },
        body: {} as never,
      });
      await doc.reload();
    } catch {
      /* بلا اتصال: الإعادة تحتاج الخادم */
    } finally {
      setBusy("");
    }
  };

  const shown = doc.shown;
  const down = doc.net === "offline" || doc.net === "failed";
  const serverRows: Item[] = (shown?.orders ?? []).map((o) => ({
    id: o.id,
    party: o.supplier_name,
    number: o.number_label,
    content: o.content_line,
    value: o.total_minor,
    currency: o.currency,
    status: o.list_status_label,
    chip: chipOf(o),
    step: o.buyer_step,
    updated: o.updated_at,
    flagged: o.flagged,
    draft: false,
    noReply: o.no_reply,
  }));
  const hiddenCount =
    filter === "open" && !showHidden ? serverRows.filter((r) => r.flagged).length : 0;
  const visible = [
    ...drafts,
    ...serverRows.filter((r) => filter === "all" || showHidden || !r.flagged),
  ];
  const state: State =
    !shown && doc.net === "loading"
      ? "loading"
      : !shown && down
        ? drafts.length
          ? "pending_sync"
          : "offline"
        : down && shown
          ? "stale"
          : shown && shown.orders.length === 0 && drafts.length === 0
            ? "empty"
            : drafts.length
              ? "pending_sync"
              : "ready";

  return (
    <Shell
      id={T}
      state={state}
      title={t("السوق")}
      hint={t(
        "طلب محل خلاف أو معلَّق بعد استعادة لا يختفي من القائمة بصمت: يظهر عدده ومكان إظهاره.",
      )}
      onRefresh={() => void doc.reload()}
    >
      <AppText variant="title" style={{ marginBottom: SPACE["3"] }}>
        {t("قوائم الطلبات — الفلتر يُعلن ما يُخفي")}
      </AppText>
      <Stack>
        <Button
          label={t("قائمة الشراء")}
          variant="secondary"
          onPress={() => router.push("/market/orders")}
        />
        <Button
          label={t("قائمة البيع")}
          variant="quiet"
          onPress={() => router.push("/market/orders/incoming")}
        />
      </Stack>
      <ChipRow>
        <Chip label={t("الحالة: قائمة")} on={filter === "open"} onPress={() => setFilter("open")} />
        <Chip label={t("الكل")} on={filter === "all"} onPress={() => setFilter("all")} />
      </ChipRow>
      {hiddenCount ? (
        <>
          <Note>
            {t("الفلتر يُخفي")} <M>{hiddenCount}</M> {t("· فلتر «قائمة» يستثني")}{" "}
            {hiddenCount === 1 ? (
              t("طلب واحد")
            ) : hiddenCount === 2 ? (
              t("طلبان")
            ) : hiddenCount <= 10 ? (
              <>
                <M>{hiddenCount}</M> {t("طلبات")}
              </>
            ) : (
              <>
                <M>{hiddenCount}</M> {t("طلباً")}
              </>
            )}{" "}
            {t("محل خلاف أو معلَّقة بعد استعادة. لن نُخفيها بلا ذكر —")}
          </Note>
          <Button label={t("أظهرها")} variant="quiet" onPress={() => setShowHidden(true)} />
        </>
      ) : null}
      {shown ? (
        <Note>
          {t("طلباتي · ينتظر ردّاً:")} <M>{shown.awaiting_count}</M>
        </Note>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={t("جلب الطلبات")}>
          <Para>{t("مع عدد ما ينتظر ردّاً — أول ما يُبحث عنه.")}</Para>
        </StateView>
      ) : null}
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}
      {state === "empty" ? (
        <StateView state="empty" title={t("لا طلبات")}>
          <Para>{t("منشأةٌ لم تشترِ من السوق بعد.")}</Para>
          <Button label={t("السوق")} financial onPress={() => router.push("/market")} />
        </StateView>
      ) : null}
      {state === "stale" && doc.snap ? (
        <StateView state="stale" title={t("حالات من آخر مطابقة")}>
          <Para>
            <Ago iso={doc.snap.at} />
            {t("، وقد شُحن طلبٌ أو انتهت مهلة عرض.")}
          </Para>
          <Button label={t("حدّث")} onPress={() => void doc.reload()} />
        </StateView>
      ) : null}
      {state === "pending_sync" ? (
        <StateView state="pending_sync" title={t("جزئي")}>
          <Para>
            {t("مسودة محلية بلا رقم طلب — الرقم يعني أن المورد استلم، وهو لم يستلم بعد.")}
          </Para>
        </StateView>
      ) : null}

      {visible.length ? (
        <GroupedList title={t("طلباتي")}>
          {visible.map((r, i) => (
            <Row
              key={r.id}
              title={r.party}
              sub={
                <>
                  {r.number ? (
                    <>
                      <M>{r.number}</M> ·{" "}
                    </>
                  ) : null}
                  {r.content}
                </>
              }
              trailing={
                r.value ? (
                  <AppText variant="secondary">
                    <M>{formatMinor(r.value)}</M> <M>{r.currency}</M>
                  </AppText>
                ) : null
              }
              last={i === visible.length - 1}
              onPress={() =>
                r.draft
                  ? router.push("/market/cart")
                  : router.push({ pathname: "/market/orders/[id]", params: { id: r.id } })
              }
            >
              <StatusWord tone={r.chip} label={r.status} />
              <Note>
                {r.updated ? (
                  <>
                    <Ago iso={r.updated} /> · <M>{hhmm(r.updated)}</M>
                  </>
                ) : null}
                {r.flagged ? ` ${t("· يظهر رغم الفلتر بإعلان")}` : ""}
              </Note>
              <Para>
                {t("الخطوة التي تنتظرك")}: {r.step}
              </Para>
              {r.noReply ? (
                <Button
                  label={t("أعد الإرسال")}
                  variant="secondary"
                  loading={busy === r.id}
                  onPress={() => void resend(r.id)}
                />
              ) : null}
            </Row>
          ))}
        </GroupedList>
      ) : null}
    </Shell>
  );
}
