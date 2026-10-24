import { formatMinor } from "@sting/app-core";
import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  Cells,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  Units,
} from "@/components/market-orders/parts";
import { safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-10";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State =
  "ready" | "validation_error" | "partial" | "permission_denied" | "success" | "stale" | "offline";

interface CLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  confirmed: number;
  shipped: number;
  received: number;
  in_transit: number;
  cancellable: number;
  already_cancelled: number;
  price_minor: string;
}

interface Breakdown {
  lines: CLine[];
  cancellable_total: number;
  received_total: number;
  in_transit_total: number;
  received_value_minor: string;
  shipment_refs: string[];
  full_cancel_available: boolean;
  already_cancelled: boolean;
  cancel_reason: string;
  order: OrderRow;
  can_cancel: boolean;
}

/** «كرتونة واحدة» / «كرتونتان» / «5 كرتونة» — صيغة ORD-10 (نص صرف لتسميات الأزرار). */
const unitsText = (n: number, unit: string) =>
  n === 1
    ? `${unit} ${t("واحدة")}`
    : n === 2
      ? `${unit.replace(/ة$/, t("ت"))}${t("ان")}`
      : `${n} ${unit}`;

/** ORD-10 — إلغاء المتبقّي (27-D20 partial/permission_denied/success · 10-D6 validation_error · 41-D33 ready): لا محو لما سُلّم أو سُجّل مالياً. */
export default function CancelRemaining() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDoc<Breakdown>(
    `market.order.${id}.cancel`,
    useCallback(
      () =>
        safeGet<Breakdown>(() =>
          api.GET("/api/market/orders/{order_id}/cancel-remaining", {
            params: { path: { order_id: id } },
          }),
        ),
      [api, id],
    ),
  );
  const d = doc.shown;
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Breakdown | null>(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);

  const post = (body: Record<string, unknown>) =>
    safePost<Breakdown>(() =>
      api.POST("/api/market/orders/{order_id}/cancel-remaining", {
        params: { path: { order_id: id } },
        body: body as never,
      }),
    );

  const confirm = async () => {
    setAttempted(true);
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      const r = await post({ reason });
      if (r.kind === "done" && r.ok && r.body) setDone(r.body);
    } finally {
      setBusy(false);
    }
  };

  const requestFromOwner = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post({ request: true });
      if (r.kind === "done" && r.ok) setRequested(true);
    } finally {
      setBusy(false);
    }
  };

  const unit = d?.lines[0]?.unit_name ?? t("وحدة");
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;
  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = done
    ? "success"
    : !d && down
      ? "offline"
      : doc.fromCache
        ? "stale"
        : d && !d.can_cancel
          ? "permission_denied"
          : attempted && !reason.trim()
            ? "validation_error"
            : confirming
              ? "partial"
              : "ready";
  const toDetail = () => router.push(`/market/orders/${id}`);

  return (
    <Shell
      id={T}
      state={state}
      title={t("إلغاء المتبقّي — لا محو لما سُلّم أو سُجّل مالياً")}
      hint={t(
        "الإلغاء يطال غير المسلَّم فقط. ما استُلم يبقى في المخزون وفي الذمّة، والطلب يُقفل بحالة «مكتمل جزئياً وأُلغي متبقّيه» لا «ملغى».",
      )}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "success" && done ? (
        <StateView state="success" title={t("الحالة النهائية دقيقة")}>
          <Para>
            {t("الطلب صار «")}
            {done.order.status === "cancelled" ? t("ملغى") : t("مكتمل جزئياً — أُلغي المتبقّي")}».
            {done.order.status !== "cancelled"
              ? ` ${t("لا نسمّيه «ملغى» فذلك يمحو من التاريخ شحنات وصلت فعلاً ومبلغاً قائماً على الذمّة.")}`
              : ` ${t("لم يُشحن شيء ولم يُستلم شيء.")}`}
          </Para>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
      {state === "permission_denied" && d ? (
        <StateView state="permission_denied" title={t("أمين المخزن يحاول الإلغاء")}>
          <Para>
            {t(
              "إلغاء المتبقّي التزام تجاري تجاه مورد، فهو صلاحية من يملك حدّاً مالياً لا من يستلم البضاعة.",
            )}
          </Para>
          <Note>
            {t("قيمة المتبقّي:")}{" "}
            <M>
              {formatMinor(
                String(d.lines.reduce((a, l) => a + l.cancellable * Number(l.price_minor), 0)),
              )}
            </M>{" "}
            · <Units n={d.cancellable_total} unit={unit} />
          </Note>
          {requested ? (
            <StatusWord tone="success" label={t("أُرسل الطلب إلى المالك")} />
          ) : (
            <Button
              label={t("طلب إلغاء من المالك")}
              financial
              loading={busy}
              onPress={() => void requestFromOwner()}
            />
          )}
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={t("إلغاء المتبقي — ماذا يُلغى بالضبط")}>
          <Para>
            {t(
              "الإلغاء يحتاج سبباً مكتوباً يظهر لطرفي الطلب. «لم يُسلَّم في الموعد» ليس تهمة بل بند في سجل الاتفاق.",
            )}
          </Para>
        </StateView>
      ) : null}
      {state === "ready" && d ? (
        <StateView state="ready" title={t("ما يُلغى وما لا يُلغى")}>
          <Para>
            {t(
              "تُعرض الكميات الثلاث قبل التأكيد: المستلم يبقى، والمشحون في الطريق يحتاج قراراً، والمتبقّي غير المشحون يُلغى.",
            )}
          </Para>
          <Note>
            {t("لا محو لما وقع")}{" "}
            {t("· المسلَّم والمسجَّل مالياً لا يُمسّ. الإلغاء يُقفل الباقي ولا يُعيد التاريخ.")}
          </Note>
          <Note>
            {t("المشحون ليس متبقّياً")}{" "}
            {t("· بضاعةٌ خرجت من مخزن المورد لا تُلغى بضغطة مشترٍ. تُستلم أو تُرتجع بمستند.")}
          </Note>
        </StateView>
      ) : null}

      {d && !done && d.can_cancel ? (
        <>
          {state === "partial" ? (
            <Stack>
              <StatusWord tone="expired" label={t("إجراء لا رجعة فيه")} />
            </Stack>
          ) : null}
          <AppText variant="title">
            {t("إلغاء متبقّي الطلب")} <M>{d.order.number_label}</M>
          </AppText>
          <Note>{t("اقرأ ما سيُلغى وما سيبقى قبل التأكيد.")}</Note>
          <GroupedList title={t("الصنف")}>
            {d.lines.map((l, i) => (
              <Row
                key={l.offer_id}
                title={`${l.public_name}${l.pack_label ? ` — ${l.pack_label}` : ""}`}
                last={i === d.lines.length - 1}
              >
                <Cells
                  items={[
                    [t("يبقى — مستلَم"), <M key="a">{l.received}</M>],
                    [t("في الطريق"), <M key="b">{l.in_transit}</M>],
                    [t("يُلغى — متبقٍّ"), <M key="c">{l.cancellable}</M>],
                  ]}
                />
              </Row>
            ))}
          </GroupedList>
          <AppText variant="bodyStrong">{t("يُلغى")}</AppText>
          <Note>
            <M>{d.cancellable_total}</M> {unit}{" "}
            {t("· المؤكد غير المشحون. يخرج من الطلب ولا يُحتسب عليك ولا على المورد.")}
          </Note>
          <AppText variant="bodyStrong">{t("لا يُلغى — سُلِّم")}</AppText>
          <Note>
            <M>{d.received_total}</M>{" "}
            {t("وحدة · مستلم ومسجَّل في مخزونك وذمتك. الإلغاء لا يسترد بضاعة بحوزتك.")}
          </Note>
          <AppText variant="bodyStrong">{t("لا يُلغى — محل خلاف")}</AppText>
          <Note>
            <M>{d.in_transit_total}</M> {unit}{" "}
            {t("· الفارق محل خلاف يُحسم في مساره. الإلغاء لا يُنهي خلافاً قائماً.")}
          </Note>
          <Note>
            {t("لن يُمسّ:")} <M>{d.received_total}</M> {unit}{" "}
            {t("مستلَمة دخلت المخزون، ومستندات الاستلام")}{" "}
            <M>{d.shipment_refs.join("/").replace(/SH-/g, (m, i: number) => (i === 0 ? m : ""))}</M>
            {t("، ومبلغ")} <M>{formatMinor(d.received_value_minor)}</M> <M>{d.order.currency}</M>{" "}
            {t("المسجَّل على الذمّة. الإلغاء ليس تسوية مالية.")}
          </Note>
          <TextField
            label={t("سبب الإلغاء — مطلوب ويراه المورد")}
            value={reason}
            onChangeText={setReason}
            error={attempted && !reason.trim() ? t("السبب مطلوب") : undefined}
          />
          {confirming ? (
            <Note>
              {t("سبب الإلغاء — مطلوب ويراه المورد:")} {reason}
            </Note>
          ) : null}
          <Stack>
            {confirming ? (
              <>
                <Button
                  label={`${t("إلغاء المتبقّي —")} ${unitsText(d.cancellable_total, unit)}`}
                  financial
                  loading={busy}
                  onPress={() => void confirm()}
                  disabledReason={
                    lock ?? (d.cancellable_total ? undefined : t("لا متبقّي غير مشحون"))
                  }
                />
                <Button
                  label={t("رجوع")}
                  variant="secondary"
                  onPress={() => setConfirming(false)}
                />
              </>
            ) : (
              <>
                <Button
                  label={`${t("إلغاء")} ${unitsText(d.cancellable_total, unit)} ${t("غير المشحونة")}`}
                  financial
                  onPress={() => {
                    setAttempted(true);
                    if (reason.trim()) setConfirming(true);
                  }}
                  disabledReason={
                    lock ??
                    (d.already_cancelled
                      ? t("أُلغي المتبقّي من قبل")
                      : d.cancellable_total
                        ? undefined
                        : t("لا متبقّي غير مشحون"))
                  }
                />
                <Button
                  label={`${t("إلغاء الطلب كاملاً")}${d.full_cancel_available ? "" : ` ${t("— غير متاح")}`}`}
                  variant="secondary"
                  onPress={() => {
                    setAttempted(true);
                    if (reason.trim()) setConfirming(true);
                  }}
                  disabledReason={
                    lock ??
                    (d.full_cancel_available
                      ? undefined
                      : t("شُحن أو استُلم جزء من الطلب — لا محو لما وقع"))
                  }
                />
              </>
            )}
          </Stack>
        </>
      ) : null}
    </Shell>
  );
}
