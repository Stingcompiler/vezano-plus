import { hhmm } from "@sting/app-core";
import { AppText, Button, GroupedList, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";

import {
  ChipRow,
  M,
  Note,
  NodeChip,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  type ToneName,
} from "@/components/market-orders/parts";
import { dm, safeGet } from "@/features/market-orders/lib";
import { tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-04";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "ready" | "loading" | "empty" | "expired" | "stale" | "offline";
type Chip = "all" | "awaiting" | "near" | "no_reply";

interface Payload {
  orders: OrderRow[];
  counts: { all: number; awaiting: number; near: number; no_reply: number };
  ending_today: number;
  fetched_at: string;
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const agoDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

function Deadline({ o }: { o: OrderRow }) {
  if (o.no_reply) {
    const d = agoDays(o.deadline_at);
    return (
      <>
        {t("انقضت")}{" "}
        {d === 0 ? (
          <>
            {t("اليوم")} <M>{hhmm(o.deadline_at)}</M>
          </>
        ) : d === 1 ? (
          t("قبل يوم")
        ) : d === 2 ? (
          t("قبل يومين")
        ) : (
          <>
            {t("قبل")} <M>{d}</M> {d <= 10 ? t("أيام") : t("يوماً")}
          </>
        )}
      </>
    );
  }
  if (o.status === "quoted")
    return (
      <>
        {t("رُدّ عليه")} <M>{dm(o.updated_at)}</M>
      </>
    );
  if (o.status !== "sent") return <>—</>;
  if (isToday(o.deadline_at))
    return (
      <>
        {t("تنقضي اليوم")} <M>{hhmm(o.deadline_at)}</M>
      </>
    );
  return (
    <>
      {t("متبقٍّ")} <M>{o.remaining_hours}</M> {t("من")} <M>{o.response_hours}</M> {t("ساعة")}
    </>
  );
}

/** ORD-04 — طلبات المورد (27-D20 ready/expired · 41-D33 loading · 12-D7 empty): المهلة تنقضي، وعدم الرد حالة لا فراغ. */
export default function Incoming() {
  const router = useRouter();
  const { api } = useSession();
  const [chip, setChip] = useState<Chip>("all");
  const doc = useDoc<Payload>(
    "market.orders.incoming",
    useCallback(() => safeGet<Payload>(() => api.GET("/api/market/orders/incoming")), [api]),
  );
  const data = doc.shown;

  const rows = (data?.orders ?? []).filter((o) =>
    chip === "all"
      ? true
      : chip === "awaiting"
        ? o.status === "sent" && !o.no_reply
        : chip === "near"
          ? o.near_deadline
          : o.no_reply,
  );
  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = !data
    ? down
      ? "offline"
      : "loading"
    : doc.fromCache
      ? "stale"
      : data.orders.length === 0
        ? "empty"
        : data.counts.no_reply
          ? "expired"
          : "ready";

  const statusOf = (o: OrderRow): { tone: ToneName; label: string } =>
    o.no_reply
      ? { tone: "expired", label: t("لم يُرد عليه") }
      : o.near_deadline
        ? { tone: "stale", label: t("مهلة قاربت") }
        : o.status === "quoted"
          ? { tone: "success", label: t("رُدّ عليه") }
          : o.status === "sent"
            ? { tone: "partial", label: t("بانتظار ردّك") }
            : { tone: "partial", label: o.status_label };

  return (
    <Shell
      id={T}
      state={state}
      title={t("السوق")}
      hint={t(
        "كل طلب بمهلة رد ظاهرة. انقضاء المهلة يُوسم «لم يُرد عليه» صراحةً عند الطرفين، ولا يُقرأ قبولاً ولا رفضاً.",
      )}
      cached={doc.fromCache}
      onRefresh={() => void doc.reload()}
    >
      <AppText variant="title" style={{ marginBottom: SPACE["3"] }}>
        {t("طلبات المورد — المهلة تنقضي، وعدم الرد حالة لا فراغ")}
      </AppText>

      {state === "loading" ? (
        <StateView state="loading" title={t("جلب الطلبات الواردة")}>
          <Para>{t("مع عدد المهل التي تنتهي اليوم، والترتيب بالمهلة لا بتاريخ الورود.")}</Para>
        </StateView>
      ) : null}
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}
      {state === "empty" ? (
        <StateView state="empty" title={t("لا طلبات بيع بعد")}>
          <Para>
            {t(
              "قائمة البيع تعرض ما يصلك من مشترين. تبقى فارغة حتى تُفعّل دور البائع وتنشر أول عرض.",
            )}
          </Para>
          <Note>{t("الفراغ هنا ليس عطلاً: أنت مشترٍ ولم تصبح بائعاً بعد.")}</Note>
          <Stack>
            <Button
              label={t("تهيئة البائع")}
              variant="secondary"
              onPress={() => router.push("/market/seller")}
            />
            <Button
              label={t("قائمة الشراء")}
              variant="quiet"
              onPress={() => router.push("/market/orders")}
            />
          </Stack>
        </StateView>
      ) : null}

      {data && data.orders.length ? (
        <>
          {data.counts.no_reply ? (
            <StateView state="expired" title={t("مهلة منقضية")}>
              <Para>
                {data.counts.no_reply === 1 ? (
                  t("طلب")
                ) : (
                  <>
                    <M>{data.counts.no_reply}</M> {t("طلبات")}
                  </>
                )}{" "}
                {t(
                  "انقضت مهلته بلا رد. لا نحوّله إلى «مرفوض» — الرفض قرار، وعدم الرد ليس قراراً. المشتري يرى «لم يُرد عليه» مع خيار إعادة الإرسال أو التوجّه لمورد آخر، والمورد يرى الطلب في أرشيف مستقلّ لا في المهملات.",
                )}
              </Para>
            </StateView>
          ) : null}
          <AppText variant="bodyStrong">
            {t("الطلبات الواردة —")} <M>{data.counts.all}</M>
          </AppText>
          <Note>
            {t("تنتهي اليوم:")} <M>{data.ending_today}</M> {t("· الأقرب انقضاءً في الأعلى")}
          </Note>
          <ChipRow>
            {(
              [
                ["all", t("الكل"), data.counts.all],
                ["awaiting", t("بانتظار ردّي"), data.counts.awaiting],
                ["near", t("مهلة قاربت"), data.counts.near],
                ["no_reply", t("لم يُرد عليه"), data.counts.no_reply],
              ] as const
            ).map(([k, label, n]) => (
              <NodeChip key={k} on={chip === k} onPress={() => setChip(k)}>
                {label} — <M>{n}</M>
              </NodeChip>
            ))}
          </ChipRow>
          <GroupedList title={t("الطلبات الواردة")}>
            {rows.map((o, i) => {
              const st = statusOf(o);
              return (
                <Row
                  key={o.id}
                  title={o.buyer_name}
                  sub={
                    <>
                      <M>{o.number_label}</M> · {o.kind_label}
                    </>
                  }
                  last={i === rows.length - 1}
                  onPress={() =>
                    router.push({ pathname: "/market/orders/[id]", params: { id: o.id } })
                  }
                >
                  <Para>
                    {o.kind === "quote" ? `${t("طلب سعر —")} ${o.content_line}` : o.content_line}
                  </Para>
                  <Note>
                    {t("المهلة")}: <Deadline o={o} />
                  </Note>
                  <StatusWord tone={st.tone} label={st.label} />
                  <Note>{o.supplier_step}</Note>
                </Row>
              );
            })}
          </GroupedList>
        </>
      ) : null}
    </Shell>
  );
}
