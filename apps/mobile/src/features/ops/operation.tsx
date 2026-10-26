import { hhmm, reconcileNow } from "@sting/app-core";
import type { StoredOperation } from "@sting/platform";
import {
  type AttemptEntry,
  describeOperation,
  readAttempts,
  renumberSale,
  requeueOperation,
  SALE_PREFIX,
  savedAt,
} from "@sting/sync-core";
import { readHalted } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";

import { DayLabel, Fact, N, Row, Strong } from "@/components/ops/ui";
import { newId } from "@/lib/crypto";
import { supportLine } from "@/lib/ago";
import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SYS-02";
type State = "ready" | "empty" | "server_error" | "conflict" | "pending_sync";
interface Quarantine {
  readonly code: string;
  readonly detail: string;
}

const EVENT_LABEL: Record<AttemptEntry["event"], string> = {
  saved: tx(T, "حُفظت محلياً"),
  sent: tx(T, "حاولت الرفع"),
  transient: tx(T, "تعذّر الوصول إلى الخادم"),
  auth: tx(T, "رُفضت المصادقة — يلزم دخول جديد"),
  epoch_mismatch: tx(T, "جيل الخادم تغيّر — يلزم تنزيل جديد"),
  permanent: tx(T, "رفض الخادم النقل"),
  accepted: tx(T, "قبلها الخادم"),
  duplicate: tx(T, "مقبولة سلفاً — لم تُحسب مرتين"),
  conflicted: tx(T, "تعارض مع ما عند الخادم"),
  rejected: tx(T, "رفضها الخادم"),
  pending_dependency: tx(T, "تنتظر عملية سابقة"),
  requeued: tx(T, "عادت إلى الطابور"),
  renumbered: tx(T, "أُعيد ترقيمها"),
  handed_over: tx(T, "سُلِّمت إلى الحجر — الجهاز مسحوب وينتظر المالك"),
};

/** السبب بلغة مفهومة والفعل الواحد لكل رمز رفض من الخادم (§٨.٣: دائم → حجر بلا سدّ الطابور). */
export function explainRejection(
  op: StoredOperation,
  q: Quarantine | null,
): { cause: string; action: "renumber" | "requeue"; actionLabel: string } {
  const code = q?.code ?? "";
  const detail = q?.detail ?? "";
  if (op.kind === "sale" && /invoice_number|unique|duplicate key/i.test(detail)) {
    return {
      cause: tx(T, "رقم الفاتورة استعمله جهاز آخر"),
      action: "renumber",
      actionLabel: tx(T, "إعادة ترقيم بموافقتك ثم رفع"),
    };
  }
  if (code === "dependency_rejected")
    return {
      cause: tx(T, "عملية سابقة تعتمد عليها رُفضت — تُحلّ تلك أولاً"),
      action: "requeue",
      actionLabel: tx(T, "أعد إلى الطابور بعد إصلاح السابقة"),
    };
  if (code === "dependency_cycle")
    return {
      cause: tx(T, "العمليات تعتمد على بعضها في حلقة"),
      action: "requeue",
      actionLabel: tx(T, "أعد إلى الطابور"),
    };
  if (code === "commit_failed")
    return {
      cause: tx(T, "الخادم لم يستطع تثبيتها — قيد في بياناتها"),
      action: "requeue",
      actionLabel: tx(T, "أعد إلى الطابور بعد الإصلاح"),
    };
  if (code === "validation")
    return {
      cause: `${tx(T, "الخادم رفض بياناتها")}${detail ? `: ${detail}` : ""}`,
      action: "requeue",
      actionLabel: tx(T, "أعد إلى الطابور بعد الإصلاح"),
    };
  return {
    cause: detail || code || tx(T, "رفضها الخادم بلا تفصيل"),
    action: "requeue",
    actionLabel: tx(T, "أعد إلى الطابور"),
  };
}

/**
 * SYS-02 — تفاصيل عملية متعثرة (نظير `operation-client.tsx`): خطّ زمني لعملية واحدة بكل محاولة ووقتها
 * وسببها؛ «بلغة المحل» لا HTTP؛ لكل سبب مخرجٌ واحد؛ التعارض لا يُعاد بل يُحال إلى مراجعة المالك
 * (SYS-03)؛ العائدة إلى الطابور تعود لموضعها الزمني لا رأسها. محلي بالكامل (sync-core).
 */
export function OperationScreen({ operationId }: { operationId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [op, setOp] = useState<StoredOperation | null | undefined>(undefined);
  const [attempts, setAttempts] = useState<AttemptEntry[]>([]);
  const [quarantine, setQuarantine] = useState<Quarantine | null>(null);
  const [halted, setHalted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reached, setReached] = useState(true);

  const load = useCallback(async () => {
    const storage = await getStorage();
    const [row, q] = await storage.read(async (t) => [
      await t.getOperation(operationId),
      await t.getMeta(`quarantine:${operationId}`),
    ]);
    setOp(row ?? null);
    setAttempts(await readAttempts(storage, operationId));
    setQuarantine(q ? (JSON.parse(q) as Quarantine) : null);
    setHalted(await readHalted(storage));
  }, [operationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const last = [...attempts].reverse().find((a) => a.event !== "saved" && a.event !== "sent");
  const lastFailure = [...attempts]
    .reverse()
    .find((a) =>
      ["transient", "auth", "epoch_mismatch", "permanent", "rejected", "conflicted"].includes(
        a.event,
      ),
    );
  const transportFailed =
    last && ["transient", "auth", "epoch_mismatch", "permanent"].includes(last.event);

  const state: State =
    op === undefined
      ? "empty"
      : !op || op.state === "synced"
        ? "empty"
        : op.state === "conflict"
          ? "conflict"
          : op.state === "quarantined"
            ? "ready"
            : last?.event === "requeued" || last?.event === "renumbered"
              ? "pending_sync"
              : transportFailed || halted
                ? "server_error"
                : "pending_sync";

  const d = op ? describeOperation(op) : null;
  const saved = savedAt(attempts);
  const rejection = op && op.state === "quarantined" ? explainRejection(op, quarantine) : null;
  const support = supportLine({
    status: lastFailure?.status ?? undefined,
    devicePrefix: ctx?.devicePrefix ?? null,
  });
  const supportFull = `${support} · op ${operationId.replace(/-/g, "").slice(0, 6)}`;

  const act = async (kind: "requeue" | "renumber" | "retry") => {
    if (busy || !op) return;
    setBusy(true);
    try {
      const storage = await getStorage();
      if (kind === "renumber") {
        await renumberSale(
          storage,
          op.operationId,
          {
            branchCode: ctx?.branchCode || "BR",
            devicePrefix: ctx?.devicePrefix || "X",
            yearTwoDigits: new Date().toISOString().slice(2, 4),
          },
          SALE_PREFIX,
        );
      } else if (kind === "requeue") {
        await requeueOperation(storage, op.operationId);
      } else {
        const out = await reconcileNow({ api, storage, requestId: newId });
        setReached(out.reach !== null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await Share.share({ message: supportFull });
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const open = (href: string) => router.push(href);

  return (
    <Screen screenId={T} state={state} title={tx(T, "مركز الاتصال والمزامنة")}>
      <AppText variant="section" style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "تفاصيل عملية متعثرة")}
      </AppText>

      {state === "empty" && op !== undefined ? (
        <StateView state="empty" title={tx(T, "لا عمليات متعثرة")}>
          <AppText variant="secondary">
            {lastFailure ? (
              <>
                {tx(T, "لا شيء متعثر — آخر تعثّر كان")} <DayLabel iso={lastFailure.at} />{" "}
                <N>{hhmm(lastFailure.at)}</N> {tx(T, "وحُلّ")}{" "}
                {op?.state === "synced" ? tx(T, "بإعادة المحاولة") : tx(T, "أو لم يعد موجوداً")}.
              </>
            ) : (
              tx(T, "لا شيء متعثر — ولا تعثّر مسجّلاً لهذه العملية.")
            )}
          </AppText>
          <Button label={tx(T, "مركز المزامنة")} onPress={() => open("/sync")} />
        </StateView>
      ) : null}

      {op && d ? (
        <GroupedList>
          <Row
            title={tx(T, "العملية")}
            detail={
              <>
                {d.title}
                {d.number ? (
                  <>
                    {" "}
                    <N>{d.number}</N>
                  </>
                ) : null}
              </>
            }
          />
          <Row title={tx(T, "أثرها على مالك")} detail={d.effect || "—"} />
          <Row
            title={tx(T, "الجهاز والوقت")}
            detail={
              <>
                {ctx?.deviceName || tx(T, "هذا الجهاز")} ·{" "}
                {saved ? (
                  <>
                    <DayLabel iso={saved} /> <N>{hhmm(saved)}</N>
                  </>
                ) : (
                  "—"
                )}
              </>
            }
          />
          <Row
            title={tx(T, "الحالة")}
            trailing={
              <AppText
                variant="note"
                style={{
                  color:
                    op.state === "synced"
                      ? c.state.synced.fg
                      : op.state === "conflict"
                        ? c.state.conflict.fg
                        : op.state === "quarantined"
                          ? c.state.server_error.fg
                          : c.state.pending_sync.fg,
                }}
              >
                {op.state === "quarantined"
                  ? tx(T, "متعثّرة")
                  : op.state === "conflict"
                    ? tx(T, "محجوز للمراجعة")
                    : op.state === "synced"
                      ? tx(T, "مؤكَّدة بختم وقت الخادم")
                      : tx(T, "معلّق على هذا الجهاز")}
              </AppText>
            }
            last
          />
        </GroupedList>
      ) : null}

      {state === "conflict" ? (
        <StateView state="conflict" title={tx(T, "العملية موقوفة بتعارض")}>
          <AppText variant="secondary">
            {tx(
              T,
              "ليست فشلاً تقنياً: جهازان عدّلا الشيء نفسه. لا تُعاد المحاولة — إعادة المحاولة لا تحلّ خلافاً.",
            )}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "التحويل")}</Strong>{" "}
            {tx(T, "· مسارها إلى «مراجعة التعارضات» حيث يُراجعها المالك بالنسختين.")}
          </AppText>
          <Button
            label={tx(T, "مراجعة المالك")}
            onPress={() => router.push({ pathname: "/sync/review", params: { op: operationId } })}
          />
        </StateView>
      ) : null}

      {state === "ready" && rejection ? (
        <View style={{ gap: SPACE["2"], marginBottom: SPACE["4"] }}>
          <Fact k={tx(T, "ما الذي لم يحدث")}>
            {op?.kind === "sale" ? tx(T, "الفاتورة") : tx(T, "العملية")}{" "}
            {tx(T, "لم تُسجَّل عند الخادم")}
          </Fact>
          <Fact k={tx(T, "ما الذي حدث فعلاً")}>{tx(T, "محفوظة على الجهاز بالكامل")}</Fact>
          <Fact k={tx(T, "السبب بلغة مفهومة")}>{rejection.cause}</Fact>
          <Fact k={tx(T, "ما تفعله الآن")}>{rejection.actionLabel}</Fact>
          <Button
            label={rejection.actionLabel}
            loading={busy}
            onPress={() => void act(rejection.action)}
          />
        </View>
      ) : null}

      {state === "server_error" ? (
        <View style={{ gap: SPACE["2"], marginBottom: SPACE["4"] }}>
          <Fact k={tx(T, "ما الذي لم يحدث")}>
            {op?.kind === "sale" ? tx(T, "الفاتورة") : tx(T, "العملية")}{" "}
            {tx(T, "لم تُسجَّل عند الخادم")}
          </Fact>
          <Fact k={tx(T, "ما الذي حدث فعلاً")}>{tx(T, "محفوظة على الجهاز بالكامل")}</Fact>
          <Fact k={tx(T, "السبب بلغة مفهومة")}>
            {last?.event === "auth" ? (
              tx(T, "انتهت جلسة الجهاز — يلزم دخول جديد")
            ) : last?.event === "epoch_mismatch" ? (
              tx(T, "الخادم استُعيد من نسخة — يلزم تنزيل جديد")
            ) : last?.status ? (
              <>
                {tx(T, "الخادم يردّ بخطأ")} <N>{last.status}</N>{" "}
                {tx(T, "— الشبكة تعمل والخادم يرفض")}
              </>
            ) : (
              tx(T, "لم يصل الخادم — الشبكة أو المهلة")
            )}
          </Fact>
          <Fact k={tx(T, "ما تفعله الآن")}>
            {halted
              ? tx(T, "وقف الرفع التلقائي بعد ثلاث محاولات — إعادة المحاولة بيدك")
              : tx(T, "تُعاد المحاولة تلقائياً بفواصل متباعدة")}
          </Fact>
          <Button
            label={tx(T, "إعادة المحاولة")}
            loading={busy}
            onPress={() => void act("retry")}
            disabledReason={!reached ? tx(T, "بلا اتصال — يُرفع عند عودة الشبكة") : undefined}
          />
        </View>
      ) : null}

      {state === "pending_sync" ? (
        <StateView state="pending_sync" title={tx(T, "عادت إلى الطابور")}>
          <AppText variant="secondary">
            {last?.event === "renumbered" ? (
              <>
                {tx(T, "أُصلح السبب (رقم جديد")} <N>{last.detail ?? ""}</N>{" "}
                {tx(T, ") والعملية عادت تنتظر دورها.")}
              </>
            ) : (
              tx(T, "أُصلح السبب والعملية عادت تنتظر دورها.")
            )}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "لا قفز")}</Strong>{" "}
            {tx(T, "· تعود إلى موضعها الزمني لا إلى رأس الطابور.")}
          </AppText>
        </StateView>
      ) : null}

      {op ? (
        <>
          <GroupedList title={tx(T, "العملية وتاريخها")}>
            {attempts.map((a, i) => (
              <Row
                key={i}
                title={
                  <AppText>
                    <N>{hhmm(a.at)}</N> {EVENT_LABEL[a.event]}
                    {a.status ? (
                      <>
                        {" ("}
                        <N>{a.status}</N>
                        {")"}
                      </>
                    ) : null}
                    {a.event === "rejected" && a.code ? (
                      <>
                        {" — "}
                        <N>{a.code}</N>
                      </>
                    ) : null}
                  </AppText>
                }
                last={i === attempts.length - 1}
              />
            ))}
          </GroupedList>
          <AppText variant="section" muted>
            {tx(T, "تفاصيل للدعم")}
          </AppText>
          <View style={{ marginBottom: SPACE["3"], gap: SPACE["1"] }}>
            <N>{supportFull}</N>
            <Button
              variant="quiet"
              label={copied ? tx(T, "نُسخ") : tx(T, "نسخ")}
              onPress={() => void copy()}
            />
          </View>
        </>
      ) : null}
      <Button variant="quiet" label={tx(T, "مركز المزامنة")} onPress={() => open("/sync")} />
    </Screen>
  );
}
