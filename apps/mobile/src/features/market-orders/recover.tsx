import { formatMinor, hhmm } from "@sting/app-core";
import { AppText, Button, GroupedList, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  Cells,
  Heading,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
} from "@/components/market-orders/parts";
import { readAttempt, type SubmitAttempt, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useSession } from "@/lib/session";

const T = "ORD-14";
const t = tOf(T);
type State = "ready" | "conflict" | "server_error" | "success";

interface Diff {
  offer_id: string;
  public_name: string;
  server_qty: number | null;
  server_price_minor: string;
  local_qty: number | null;
  local_price_minor: string;
}

interface Probe {
  found: boolean;
  order: OrderRow | null;
  same_payload: boolean | null;
  diff: Diff[];
}

/** ORD-14 — تعارض نسخة أو ردٌّ مفقود (08-D4 server_error · 41-D33 ready/conflict/success): استعلام لا طلب جديد. */
export default function Recover() {
  const router = useRouter();
  const { api } = useSession();
  const { op = "" } = useLocalSearchParams<{ op?: string }>();
  const [attempt, setAttempt] = useState<SubmitAttempt | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probed, setProbed] = useState(false);
  const [busy, setBusy] = useState("");
  const [resent, setResent] = useState<OrderRow | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    void readAttempt(op).then(setAttempt);
  }, [op]);

  const ask = useCallback(async () => {
    if (!op) return;
    setBusy("probe");
    setOffline(false);
    try {
      const r = await safePost<Probe>(() =>
        api.POST("/api/market/orders/probe", {
          body: { op_id: op, lines: attempt?.lines ?? [] } as never,
        }),
      );
      if (r.kind === "offline") {
        setOffline(true);
        return;
      }
      if (r.ok && r.body) setProbe(r.body);
      setProbed(true);
    } finally {
      setBusy("");
    }
  }, [api, op, attempt]);

  const resend = async () => {
    if (!attempt || busy) return;
    setBusy("resend");
    setOffline(false);
    try {
      const r = await safePost<{ order: OrderRow; created: boolean }>(() =>
        api.POST("/api/market/orders", {
          body: {
            op_id: op,
            supplier_tenant_id: attempt.supplier_tenant_id,
            kind: attempt.kind,
            delivery_to: attempt.delivery_to,
            note: attempt.note,
            lines: attempt.lines,
          } as never,
        }),
      );
      if (r.kind === "offline") setOffline(true);
      else if (r.ok && r.body) setResent(r.body.order);
    } finally {
      setBusy("");
    }
  };

  const state: State =
    resent || (probe?.found && probe.same_payload !== false)
      ? "success"
      : probe?.found && probe.same_payload === false
        ? "conflict"
        : op && attempt && !probed
          ? "server_error"
          : "ready";
  const order = resent ?? probe?.order ?? null;
  const checkout = () =>
    router.push({
      pathname: "/market/checkout",
      params: { supplier: attempt?.supplier_tenant_id ?? "" },
    });

  return (
    <Shell
      id={T}
      state={state}
      title={t("رد مفقود بعد الإرسال — استعلام لا طلب جديد")}
      hint={t("إعادة نفس الحمولة تُعاد إلى الطلب نفسه؛ اختلاف الحمولة تعارض يوقف الإرسال.")}
    >
      {offline ? <Note>{MO_TEXTS.needsServer}</Note> : null}

      {state === "server_error" && attempt ? (
        <>
          <Stack>
            <StatusWord tone="server_error" label={t("خطأ خادم")} />
          </Stack>
          <StateView state="server_error" title={t("لا نعرف إن كان الطلب قد وصل")}>
            <Para>
              {t("أُرسل الطلب")} <M>{hhmm(attempt.at)}</M>{" "}
              {t(
                "وانقطع الرد قبل أن يعود. هذا لا يعني فشلاً ولا نجاحاً. زر «إعادة الإرسال» الساذج قد يُنشئ طلبين للمورد نفسه.",
              )}
            </Para>
          </StateView>
          <Heading>{t("ما نفعله بدلاً من ذلك")}</Heading>
          <GroupedList>
            <Row
              title={t("استعلام بمفتاح العملية")}
              sub={t("نسأل الخادم: هل وصلك طلب بهذا المفتاح؟ السؤال لا ينشئ شيئاً.")}
              trailing={<StatusWord tone="success" label={t("آمن")} />}
            />
            <Row
              title={t("إعادة نفس الحمولة بنفس المفتاح")}
              sub={t(
                "إن كان قد وصل، يعيد الخادم الطلب نفسه بدل إنشاء ثانٍ. إن لم يصل، يُنشأ الآن مرة واحدة.",
              )}
              trailing={<StatusWord tone="success" label={t("آمن")} />}
            />
            <Row
              title={t("حمولة مختلفة بنفس المفتاح")}
              sub={t("يُرفض الإرسال ويُعرض الفرق. لا دمج ولا اختيار تلقائي لأحد الإصدارين.")}
              trailing={<StatusWord tone="conflict" label={t("تعارض")} />}
              last
            />
          </GroupedList>
          <Note>
            {t("حالة التعارض.")}{" "}
            {t(
              "لو وجد الخادم طلباً بنفس مفتاح العملية لكن بحمولة مختلفة — كأن تكون كمية عُدِّلت على جهاز آخر بين المحاولتين — فلا إرسال ولا دمج. تُعرض الحمولتان جنباً إلى جنب وتختار أنت أيهما الطلب.",
            )}
          </Note>
          <AppText variant="note" muted>
            <M>{`idem_key: ${op.slice(0, 12)}`}</M>
          </AppText>
          <Stack>
            <Button
              label={t("استعلام عن حالة الإرسال")}
              financial
              loading={busy === "probe"}
              onPress={() => void ask()}
            />
            <Button label={t("عرض الطلب كمسودة")} variant="secondary" onPress={checkout} />
          </Stack>
        </>
      ) : null}

      {state === "ready" ? (
        <StateView state="ready" title={t("استعلام بنفس المعرّف")}>
          <Para>
            {t(
              "يُسأل الخادم عن حالة الطلب بمعرّفه المحفوظ، ويُعرض ما لديه: لم يصل، أو وصل ومؤكَّد، أو وصل ومُلغى.",
            )}
          </Para>
          {op && !attempt ? <Note>{t("لا مسودة محفوظة لهذا المعرّف على هذا الجهاز.")}</Note> : null}
          {probed && probe && !probe.found && attempt ? (
            <>
              <Note>{t("لم يصل — يُنشأ الآن مرة واحدة بالمعرّف نفسه.")}</Note>
              <Button
                label={t("أعد إرسال نفسه")}
                financial
                loading={busy === "resend"}
                onPress={() => void resend()}
              />
            </>
          ) : null}
          {op && attempt ? null : op ? (
            <Button
              label={t("استعلام عن حالة الإرسال")}
              loading={busy === "probe"}
              onPress={() => void ask()}
            />
          ) : null}
          <Button
            label={t("طلباتي")}
            variant="secondary"
            onPress={() => router.push("/market/orders")}
          />
        </StateView>
      ) : null}

      {state === "conflict" && probe?.order ? (
        <StateView state="conflict" title={t("نفس المعرّف بحمولة مختلفة")}>
          <Para>
            {t("الخادم يحمل الطلب")} <M>{probe.order.number_label}</M>{" "}
            {t("بحمولة والجهاز يحمله بأخرى.")}
          </Para>
          <Note>
            {t("لا كتابة فوق")} {t("· التعارض يُحجَز ويُعرض الفرق للمراجعة.")}
          </Note>
          {probe.diff.map((d) => (
            <Row key={d.offer_id} title={d.public_name || d.offer_id} last>
              <Cells
                items={[
                  [
                    t("عند الخادم"),
                    d.server_qty == null ? (
                      "—"
                    ) : (
                      <>
                        <M>{d.server_qty}</M> ×{" "}
                        <M>{d.server_price_minor ? formatMinor(d.server_price_minor) : "—"}</M>
                      </>
                    ),
                  ],
                  [
                    t("على الجهاز"),
                    d.local_qty == null ? (
                      "—"
                    ) : (
                      <>
                        <M>{d.local_qty}</M> ×{" "}
                        <M>{d.local_price_minor ? formatMinor(d.local_price_minor) : "—"}</M>
                      </>
                    ),
                  ],
                ]}
              />
            </Row>
          ))}
          <Stack>
            <Button
              label={t("نسخة الخادم هي الطلب")}
              financial
              onPress={() =>
                router.push({
                  pathname: "/market/orders/[id]",
                  params: { id: probe.order?.id ?? "" },
                })
              }
            />
            <Button
              label={t("نسخة الجهاز — كمسودة جديدة بمعرّف جديد")}
              variant="secondary"
              onPress={checkout}
            />
          </Stack>
        </StateView>
      ) : null}

      {state === "success" && order ? (
        <StateView state="success" title={t("الطلب موجود ومؤكَّد")}>
          <Para>
            {t("طلبٌ واحد لا اثنان، وحالته الحقيقية معروضة مع وقت آخر حدث.")}{" "}
            <M>{order.number_label}</M> · {order.list_status_label} ·{" "}
            <M>{hhmm(order.updated_at)}</M>
          </Para>
          <Button
            label={t("تفاصيل الطلب")}
            onPress={() =>
              router.push({ pathname: "/market/orders/[id]", params: { id: order.id } })
            }
          />
        </StateView>
      ) : null}
    </Shell>
  );
}
