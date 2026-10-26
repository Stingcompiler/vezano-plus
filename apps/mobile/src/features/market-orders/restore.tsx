import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  Heading,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  When,
} from "@/components/market-orders/parts";
import { safeGet, safePost } from "@/features/market-orders/lib";
import { MO_TEXTS, tOf } from "@/features/market-orders/texts";
import type { OrderRow } from "@/features/market-orders/types";
import { useDoc } from "@/features/market-orders/use-doc";
import { useSession } from "@/lib/session";

const T = "ORD-15";
const t = tOf(T);
const t1 = tOf("ORD-01");
type State = "conflict" | "stale" | "permission_denied" | "success" | "offline";

interface Ev {
  id: string;
  kind: string;
  side: string;
  title: string;
  detail: string;
  ref_label: string;
  at: string;
  needs_decision: boolean;
  decision: string;
  decision_reason: string;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  restore_point: string;
  reconciling: boolean;
  can_review: boolean;
  pending: Ev[];
  decided: Ev[];
  confirmed: Ev[];
  blocked_transfers: { title: string; ref: string; detail: string }[];
}

const CountWord = ({ n, gen = false }: { n: number; gen?: boolean }) =>
  n === 1 ? (
    <>{t("حدث واحد")}</>
  ) : n === 2 ? (
    <>{gen ? t("حدثين") : t("حدثان")}</>
  ) : (
    <>
      <M>{n}</M> {t("أحداث")}
    </>
  );

const countText = (n: number) =>
  n === 1 ? t("حدث واحد") : n === 2 ? t("حدثان") : `${n} ${t("أحداث")}`;

/** ORD-15 — استعادة طلب بعد فقد خادمي (10-D6 conflict · 41-D33 stale/permission_denied/success): نُعلن الجهل ولا قيد صامت. */
export default function Restore() {
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDoc<Payload>(
    `market.order.${id}.restore`,
    useCallback(
      () =>
        safeGet<Payload>(() =>
          api.GET("/api/market/orders/{order_id}/restore", { params: { path: { order_id: id } } }),
        ),
      [api, id],
    ),
  );
  const p = doc.shown;
  const [started, setStarted] = useState(false);
  const [denied, setDenied] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (doc.notFound) router.replace(`/market/orders/${id}`);
  }, [doc.notFound, router, id]);

  const decide = async (e: Ev, decision: "reapply" | "void") => {
    if (busy) return;
    setBusy(e.id);
    try {
      const r = await safePost<Payload>(() =>
        api.POST("/api/market/orders/{order_id}/restore/events/{event_id}", {
          params: { path: { order_id: id, event_id: e.id } },
          body: { decision, reason: reasons[e.id] ?? "" } as never,
        }),
      );
      if (r.kind === "done" && r.status === 403) {
        setDenied(true);
        return;
      }
      if (r.kind === "done" && r.ok && r.body) doc.replace(r.body);
    } finally {
      setBusy("");
    }
  };

  const begin = () => {
    if (!p?.can_review) {
      setDenied(true);
      return;
    }
    setStarted(true);
  };

  const down = doc.net === "offline" || doc.net === "failed";
  const state: State = denied
    ? "permission_denied"
    : !p && down
      ? "offline"
      : p && p.restore_point && !p.reconciling
        ? "success"
        : p && p.reconciling && (started || p.decided.length)
          ? "conflict"
          : "stale";
  const lock = doc.fromCache ? MO_TEXTS.needsServer : undefined;
  const toDetail = () => router.push(`/market/orders/${id}`);

  return (
    <Shell
      id={T}
      state={state}
      title={t("استعادة طلب بعد فقد خادمي")}
      hint={t(
        "الاستعادة توقف التحويلات المتأثرة وتطلب مراجعة موثقة. الاستعادة لا تُنشئ قيداً ولا تُلغيه — كل فرق يبقى بنداً معلَناً حتى يُقرَّر.",
      )}
      cached={doc.fromCache}
    >
      {state === "offline" ? <StateView state="offline" title={t1("بلا اتصال")} /> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={t("المراجعة للمالك")}>
          <Para>{t("مشغّل الخدمة يرى ويشخّص، ولا يعدّل دفاتر الأطراف ولا يُقرّ كميةً.")}</Para>
          <Note>
            {t("حدٌّ ثابت")}{" "}
            {t("· إشراف المنصة لا يمسّ دفتر مستأجر. القرار في طلبٍ بين منشأتين لهما لا لنا.")}
          </Note>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}

      {state === "stale" && p ? (
        <StateView state="stale" title={t("حالةٌ من قبل الفقد")}>
          <Para>
            {t("الخادم استُعيد إلى نسخة أقدم، وحالة الطلب المعروضة تسبق آخر ما جرى.")}
            {p.restore_point ? (
              <>
                {" "}
                {t("«ما بعد")} <When iso={p.restore_point} /> {t("غير معروف — قيد المصالحة».")}
              </>
            ) : null}
          </Para>
          <Note>
            {t("التنفيذ يتوقف")} {t("· لا شحن ولا استلام على هذا الطلب حتى تنتهي المصالحة.")}
          </Note>
          {p.restore_point ? (
            <Button
              label={`${t("ابدأ المراجعة —")} ${countText(p.pending.length)} ${t("بعد النسخة")}`}
              financial
              onPress={begin}
              disabledReason={lock}
            />
          ) : (
            <Note>{t("لا استعادة على هذا الطلب.")}</Note>
          )}
        </StateView>
      ) : null}

      {state === "conflict" && p ? (
        <>
          <Stack>
            <StatusWord tone="conflict" label={t("تعارض")} />
          </Stack>
          <AppText variant="title">
            {t("استُعيد الطلب")} <M>{p.order.number_label}</M> {t("إلى نسخة")}{" "}
            <When iso={p.restore_point} />
          </AppText>
          <Note>
            {t("الاستعادة أعادت الطلب إلى ما قبل")}{" "}
            <CountWord n={p.pending.length + p.decided.length} gen />{" "}
            {t("سُجِّلا بعد النسخة. الأحداث لم يُمحَ ذكرها وهي بانتظار مراجعتك.")}
          </Note>
          <Heading>
            {p.pending.length === 2 ? (
              t("حدثان بعد النسخة — يحتاجان قراراً واحداً واحداً")
            ) : (
              <>
                <CountWord n={p.pending.length} /> {t("بعد النسخة — يحتاج قراراً واحداً واحداً")}
              </>
            )}
          </Heading>
          <GroupedList>
            {p.pending.map((e, i) => (
              <Row
                key={e.id}
                title={e.title}
                sub={
                  <>
                    <When iso={e.at} />
                    {e.detail ? ` · ${e.detail}` : ""}
                  </>
                }
                last={i === p.pending.length - 1 && p.decided.length === 0}
              >
                <TextField
                  label={`${t("سبب تركه ملغى —")} ${e.title}`}
                  value={reasons[e.id] ?? ""}
                  onChangeText={(x) => setReasons((c) => ({ ...c, [e.id]: x }))}
                />
                <Stack>
                  <Button
                    label={t("إعادة تطبيقه")}
                    financial
                    loading={busy === e.id}
                    onPress={() => void decide(e, "reapply")}
                    disabledReason={lock}
                  />
                  <Button
                    label={t("تركه ملغى مع سبب")}
                    variant="secondary"
                    loading={busy === e.id}
                    onPress={() => void decide(e, "void")}
                    disabledReason={
                      lock ??
                      ((reasons[e.id] ?? "").trim() ? undefined : t("تركه ملغى يحتاج سبباً"))
                    }
                  />
                </Stack>
              </Row>
            ))}
            {p.decided.map((e, i) => (
              <Row
                key={e.id}
                title={e.title}
                sub={<When iso={e.at} />}
                last={i === p.decided.length - 1}
                trailing={
                  <StatusWord
                    tone={e.decision === "reapply" ? "success" : "expired"}
                    label={
                      e.decision === "reapply"
                        ? t("أُعيد تطبيقه")
                        : `${t("تُرك ملغى —")} ${e.decision_reason}`
                    }
                  />
                }
              />
            ))}
          </GroupedList>
          <Heading>{t("التحويلات المتأثرة موقوفة.")}</Heading>
          <GroupedList>
            {p.blocked_transfers.map((x, i) => (
              <Row
                key={x.ref}
                title={x.title}
                sub={x.detail}
                last={i === p.blocked_transfers.length - 1}
                onPress={() => router.push("/market/link/receipts")}
                trailing={<M>{x.ref}</M>}
              />
            ))}
          </GroupedList>
        </>
      ) : null}

      {state === "success" && p ? (
        <StateView state="success" title={t("أُعيد بناء الطلب")}>
          <Para>
            {t(
              "من أحداث الطرفين بهوياتها الأصلية: ما اتفق عليه الدفتران أُثبت، وما لا يُسنَد إلى حدث بقي محجوزاً.",
            )}
          </Para>
          <Note>
            {t("لا تحويل مالي صامت")}{" "}
            {t("· الاستعادة لا تُنشئ قيداً ولا تُلغيه. كل فرق يبقى بنداً معلَناً حتى يُقرَّر.")}
          </Note>
          <AppText variant="bodyStrong">{t("ما أُثبت")}</AppText>
          {p.confirmed.map((e) => (
            <Note key={e.id}>
              {t("نعم")} · {e.title}
            </Note>
          ))}
          {p.decided
            .filter((e) => e.decision === "reapply")
            .map((e) => (
              <Note key={e.id}>
                {t("نعم")} · {e.title} {t("— أُعيد تطبيقه")}
              </Note>
            ))}
          <AppText variant="bodyStrong">{t("ما حُجز")}</AppText>
          {p.decided
            .filter((e) => e.decision === "void")
            .map((e) => (
              <Note key={e.id}>
                {t("لا")} · {e.title} — {e.decision_reason}
              </Note>
            ))}
          {p.decided.filter((e) => e.decision === "void").length === 0 ? (
            <Note>— · {t("لا شيء")}</Note>
          ) : null}
          <AppText variant="bodyStrong">{t("ما يحتاج قراراً")}</AppText>
          <Note>— · {p.pending.length ? <CountWord n={p.pending.length} /> : t("لا شيء")}</Note>
          <Button label={t("تفاصيل الطلب")} onPress={toDetail} />
        </StateView>
      ) : null}
    </Shell>
  );
}
