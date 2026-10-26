import { formatMinor, hhmm } from "@sting/app-core";
import { AppText, Button, GroupedList, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import {
  Cells,
  DM,
  Heading,
  M,
  Note,
  Para,
  Row,
  type Stage,
  Shell,
  Stack,
  StatusWord,
  Timeline,
  When,
} from "@/components/market-orders/parts";
import { dm, safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { Detail } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-05";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State =
  "loading" | "ready" | "partial" | "conflict" | "permission_denied" | "stale" | "offline";

/** ORD-05 — تفاصيل الطلب وسجل الإصدارات (41-D33 ready/loading/conflict/permission_denied · 10-D6 partial): سلّم الكميات، والاتفاق هو المقبول لا الأحدث. */
export default function OrderDetail() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [busy, setBusy] = useState(false);
  const doc = useDoc<Detail>(
    `market.order.${id}`,
    useCallback(
      () =>
        safeGet<Detail>(() =>
          api.GET("/api/market/orders/{order_id}", { params: { path: { order_id: id } } }),
        ),
      [api, id],
    ),
  );
  const d = doc.shown;
  const go = (path: string) => router.push(`/market/orders/${id}/${path}`);

  const accept = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await safePost<Detail>(() =>
        api.POST("/api/market/orders/{order_id}/accept", {
          params: { path: { order_id: id } },
          body: { version: n } as never,
        }),
      );
      if (r.kind === "done" && r.ok && r.body) doc.replace(r.body);
    } finally {
      setBusy(false);
    }
  };

  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = doc.notFound
    ? "permission_denied"
    : !d
      ? down
        ? "offline"
        : "loading"
      : doc.fromCache
        ? "stale"
        : d.conflict
          ? "conflict"
          : d.partial
            ? "partial"
            : "ready";
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;
  const agreed = d?.versions.find((v) => v.is_agreement) ?? null;
  const latest = d ? (d.versions.filter((v) => !v.draft).at(-1) ?? null) : null;
  const stages: Stage[] = d
    ? [
        { id: "sent", label: t("أُرسل"), state: "done", atLabel: hhmm(d.order.sent_at) },
        {
          id: "quoted",
          label: t("عرض المورد"),
          state: d.versions.some((v) => v.kind !== "request" && !v.draft)
            ? "done"
            : d.order.status === "sent"
              ? "current"
              : "upcoming",
        },
        {
          id: "agreed",
          label: t("اتفاق مثبَّت"),
          state: d.agreed_version ? "done" : d.order.status === "quoted" ? "current" : "upcoming",
          detail: d.agreed_version ? (
            <>
              {t("الإصدار")} <M>{d.agreed_version}</M>
            </>
          ) : undefined,
        },
        {
          id: "delivery",
          label: t("شحن واستلام"),
          state: d.partial
            ? "partial"
            : d.order.status === "received"
              ? "done"
              : d.agreed_version
                ? "current"
                : "upcoming",
        },
      ]
    : [];

  return (
    <Shell
      id="ORD-05"
      state={state}
      title={t("تفاصيل الطلب وسجل الإصدارات — سلّم الكميات")}
      cached={doc.fromCache}
      onRefresh={() => void doc.reload()}
    >
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={t("الرابط لم يعد صالحاً")}>
          <Para>{t("لا طلب بهذا الرابط، أو لم يعد ضمن ما يُعرض لك.")}</Para>
          <Button label={t("طلباتي")} onPress={() => router.push("/market/orders")} />
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={t("بناء الخط الزمني")}>
          <Para>
            {t("الخط يُبنى من أحداث الطرفين مرتَّبةً، ولا تُعرض حالة الطلب قبل اكتمال السلسلة.")}
          </Para>
        </StateView>
      ) : null}
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {d ? (
        <>
          <Stack>
            <StatusWord tone="synced" label={d.order.kind_label} />
            <StatusWord
              tone={
                d.conflict
                  ? "conflict"
                  : d.partial
                    ? "partial"
                    : d.order.status === "received"
                      ? "success"
                      : "stale"
              }
              label={d.partial ? t("مستلم جزئياً") : d.order.list_status_label}
            />
          </Stack>
          <AppText variant="title">
            <M>{d.order.number_label}</M> —{" "}
            {d.side === "buyer" ? d.order.supplier_name : d.order.buyer_name}
          </AppText>
          <Para>
            {agreed ? (
              <>
                {t("الاتفاق: الإصدار")} <M>{agreed.number}</M> {t("· مقبول")}{" "}
                <DM iso={agreed.accepted_at} />
              </>
            ) : (
              t("لا اتفاق مثبَّت بعد — الطلب التزامُ شراء لا دين")
            )}
          </Para>
          <Timeline label={t("مسار الطلب")} stages={stages} />

          {state === "conflict" && agreed && latest ? (
            <StateView state="conflict" title={t("إصداران متوازيان")}>
              <Para>
                {t("المورد أرسل الإصدار")} <M>{latest.number}</M>{" "}
                {t("بينما كان المشتري يقبل الإصدار")} <M>{agreed.number}</M>.
              </Para>
              <Note>
                {t("الاتفاق هو المشار إليه في القبول")} · {t("الإصدار")} <M>{agreed.number}</M>{" "}
                {t("لا الأحدث. والإصدار")} <M>{latest.number}</M>{" "}
                {t("يُعرض اقتراحاً يحتاج قبولاً جديداً.")}
              </Note>
              {latest.lines.map((ln) => {
                const a = agreed.lines.find((x) => x.offer_id === ln.offer_id);
                return (
                  <Row key={ln.offer_id} title={ln.public_name} last>
                    <Cells
                      items={[
                        [
                          `${t("الإصدار")} ${agreed.number} ${t("— الاتفاق")}`,
                          a ? (
                            <>
                              <M>{a.qty_confirmed ?? 0}</M> ×{" "}
                              <M>{a.price_minor ? formatMinor(a.price_minor) : "—"}</M>
                            </>
                          ) : (
                            "—"
                          ),
                        ],
                        [
                          `${t("الإصدار")} ${latest.number} ${t("— اقتراح")}`,
                          <>
                            <M>{ln.qty_confirmed ?? 0}</M> ×{" "}
                            <M>{ln.price_minor ? formatMinor(ln.price_minor) : "—"}</M>
                          </>,
                        ],
                      ]}
                    />
                    {a && a.price_minor !== ln.price_minor ? (
                      <Note>
                        {t("الفرق")}{" "}
                        <M>
                          {formatMinor(
                            String(Number(ln.price_minor || 0) - Number(a.price_minor || 0)),
                          )}
                        </M>
                      </Note>
                    ) : null}
                  </Row>
                );
              })}
              {d.side === "buyer" ? (
                <Stack>
                  <Button
                    label={`${t("اقبل الإصدار")} ${latest.number}`}
                    financial
                    loading={busy}
                    onPress={() => void accept(latest.number)}
                    disabledReason={lock}
                  />
                  <Button label={t("قارن")} variant="secondary" onPress={() => go("compare")} />
                </Stack>
              ) : null}
            </StateView>
          ) : null}

          {state === "partial" ? (
            <StateView state="partial" title={t("منفَّذ جزئياً")}>
              <Para>
                {t("انتهاء الكتالوج بعد قبول العرض لا يمس الاتفاق. الإلغاء يخص غير المسلَّم وحده.")}
              </Para>
              <Note>
                {t("إلغاء المتبقي — ماذا يُلغى بالضبط: يحتاج سبباً مكتوباً يظهر لطرفي الطلب.")}
              </Note>
            </StateView>
          ) : null}

          <Heading>{t("سلّم الكميات")}</Heading>
          <GroupedList>
            {d.ladder.map((r, i) => (
              <Row
                key={r.offer_id}
                title={r.public_name}
                sub={r.pack_label || r.unit_name}
                dim={r.gap > 0}
                last={i === d.ladder.length - 1}
              >
                <Cells
                  items={[
                    [t("مطلوب"), <M key="a">{r.requested}</M>],
                    [t("مؤكَّد"), <M key="b">{r.confirmed ?? "—"}</M>],
                    [t("مشحون"), <M key="c">{r.shipped}</M>],
                    [t("مستلم"), <M key="d">{r.received}</M>],
                    [t("فارق"), <M key="e">{r.gap}</M>],
                  ]}
                />
                <Note>
                  {t("وضع السطر")}: {r.status}
                </Note>
              </Row>
            ))}
          </GroupedList>
          <Note>{d.ladder_rule}</Note>
          <GroupedList>
            <Row
              title={t("قيمة المستلم — تُقيَّد")}
              trailing={<M>{formatMinor(d.received_value_minor)}</M>}
            />
            <Row
              title={t("قيمة الفارق — محجوزة")}
              trailing={<M>{formatMinor(d.gap_value_minor)}</M>}
              last
            />
          </GroupedList>

          <Heading>{t("سجل الإصدارات — النسخة المقبولة مثبَّتة لا مرجع متحرّك")}</Heading>
          <GroupedList>
            {d.versions.map((v, i) => (
              <Row
                key={v.id}
                title={
                  <>
                    {t("الإصدار")} <M>{v.number}</M> · {v.kind_label}
                    {v.draft ? ` ${t("· مسودة عندك")}` : ""}
                  </>
                }
                sub={
                  <>
                    {v.sent_at ? <DM iso={v.sent_at} /> : t("لم تُرسل")} · {v.summary}
                    {v.valid_until ? (
                      <>
                        {" "}
                        {t("· صالح حتى")} <M>{dm(v.valid_until)}</M>
                      </>
                    ) : null}
                  </>
                }
                dim={!v.is_agreement && v.kind === "revision"}
                last={i === d.versions.length - 1}
                trailing={
                  v.is_agreement ? (
                    <StatusWord tone="success" label={t("هذه نسخة الاتفاق المثبَّتة")} />
                  ) : v.kind === "revision" ? (
                    <StatusWord tone="stale" label={t("لا يُلزم أحداً: الأحدث ليس الاتفاق")} />
                  ) : null
                }
              />
            ))}
          </GroupedList>

          <GroupedList title={t("الخط الزمني")}>
            {d.events.map((e, i) => (
              <Row
                key={e.id}
                title={e.title}
                sub={
                  <>
                    <When iso={e.at} />
                    {e.detail ? ` · ${e.detail}` : ""}
                  </>
                }
                last={i === d.events.length - 1}
              >
                {e.ref_label ? <Note>{e.ref_label}</Note> : null}
              </Row>
            ))}
          </GroupedList>

          <Stack>
            {d.side === "supplier" &&
            (d.order.status === "sent" ||
              d.order.status === "quoted" ||
              d.order.status === "accepted") ? (
              <Button
                label={d.agreed_version ? t("أرسل تعديلاً (إصدار جديد)") : t("أعِدّ عرض سعر")}
                financial
                onPress={() => go("quote")}
                disabledReason={lock}
              />
            ) : null}
            {d.side === "supplier" &&
            d.agreed_version &&
            (d.order.status === "accepted" || d.order.status === "preparing") ? (
              <Button
                label={t("جهّز شحنة")}
                variant="secondary"
                onPress={() => go("ship")}
                disabledReason={lock}
              />
            ) : null}
            {d.side === "buyer" && (d.order.status === "quoted" || d.conflict) ? (
              <Button
                label={t("قارن العرض واقبله أو ارفضه")}
                financial
                onPress={() => go("compare")}
                disabledReason={lock}
              />
            ) : null}
            {d.agreed_version ? (
              <Button label={t("الشحنات")} variant="quiet" onPress={() => go("ship")} />
            ) : null}
            {d.side === "buyer" && d.ladder.some((r) => r.shipped > r.received) ? (
              <Button
                label={t("استلم وافحص الكميات")}
                financial
                onPress={() => go("receive")}
                disabledReason={lock}
              />
            ) : null}
            {d.side === "buyer" && d.agreed_version && !d.order.remaining_cancelled ? (
              <Button
                label={t("إلغاء المتبقّي")}
                variant="quiet"
                onPress={() => go("cancel-remaining")}
              />
            ) : null}
            {d.side === "buyer" && d.ladder.some((r) => r.received > 0) ? (
              <Button label={t("طلب مرتجع")} variant="quiet" onPress={() => go("return")} />
            ) : null}
            {d.agreed_version && d.ladder.some((r) => r.received > 0) ? (
              <Button label={t("إثبات الدفع")} variant="quiet" onPress={() => go("payment")} />
            ) : null}
            {d.order.reconciling || d.order.restore_point ? (
              <Button
                label={t("المصالحة بعد الاستعادة")}
                variant="secondary"
                onPress={() => go("restore")}
              />
            ) : null}
            {d.open_disputes?.length || d.order.status === "disputed" ? (
              <Button
                label={`${t("الخلاف")} ${d.open_disputes?.join(" · ") ?? ""}`.trim()}
                variant="secondary"
                onPress={() => go("disputes")}
              />
            ) : null}
          </Stack>
        </>
      ) : null}
    </Shell>
  );
}
