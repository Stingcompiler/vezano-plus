import { formatMinor, hhmm } from "@sting/app-core";
import type { StoredOperation } from "@sting/platform";
import { describeOperation, EPOCH_RECONCILED_META } from "@sting/sync-core";
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
import { View } from "react-native";

import { DayLabel, N, Row, Strong } from "@/components/ops/ui";
import {
  type EpochChange,
  readEpochChange,
  type ReconcileOutcome,
  reconcileEpoch,
} from "@/features/ops/epoch-logic";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SYS-08";
type State = "stale" | "conflict" | "pending_sync" | "success";
interface Reconciled {
  readonly previous: string;
  readonly next: string;
  readonly at: string;
  readonly present: number;
  readonly uploaded: number;
  readonly held: number;
}

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
function amountOf(op: StoredOperation): string {
  const find = (e: string) => op.members.find((m) => m.entity === e)?.payload ?? {};
  if (op.kind === "sale") return str(find("sales.Sale")["total_minor"]);
  if (op.kind === "sale_return") return str(find("sales.SaleReturn")["total_minor"]);
  if (op.kind === "payment_receipt" || op.kind === "refund")
    return str(find("parties.PaymentReceipt")["amount_minor"]);
  return "";
}
/** آخر مقطع مقروء من معرّف الجيل للعرض داخل mono. */
const short = (epoch: string): string => (epoch.length > 8 ? epoch.slice(-8) : epoch) || "—";

/**
 * SYS-08 — تغيّر جيل الخادم والمصالحة (نظير `epoch-client.tsx`): الخادم استُعيد إلى نقطة أقدم فصار عند
 * الجهاز عملٌ لا يعرفه. نعترف بالأمر ولا نمسح ولا نرفع تلقائياً: المصالحة تُقارن بالهويات الأصلية — ما
 * نجا يُترك، وما فُقد يُرفع، وما اختلف يُحجز. المعلَّق ليس مفقوداً.
 */
export function EpochScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [change, setChange] = useState<EpochChange | null>(null);
  const [pending, setPending] = useState<StoredOperation[]>([]);
  const [synced, setSynced] = useState<StoredOperation[]>([]);
  const [reconciled, setReconciled] = useState<Reconciled | null>(null);
  const [outcome, setOutcome] = useState<ReconcileOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const storage = await getStorage();
    setChange(await readEpochChange(storage));
    const [local, pend, syn, rec] = await storage.read(async (t) => [
      await t.listOperationsByState("local"),
      await t.listOperationsByState("pending"),
      await t.listOperationsByState("synced"),
      await t.getMeta(EPOCH_RECONCILED_META),
    ]);
    setPending([...local, ...pend]);
    setSynced(syn);
    setReconciled(rec ? (JSON.parse(rec) as Reconciled) : null);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const state: State = outcome
    ? "success"
    : busy
      ? "pending_sync"
      : change
        ? synced.length > 0
          ? "conflict"
          : "stale"
        : "success";

  const start = async () => {
    if (!change || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setOutcome(await reconcileEpoch(api, await getStorage(), change));
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const pendingValue = pending.reduce((a, op) => a + BigInt(amountOf(op) || "0"), 0n);
  const present = outcome?.present ?? reconciled?.present ?? 0;
  const uploaded = outcome?.toUpload ?? reconciled?.uploaded ?? 0;
  const heldCount = outcome?.held ?? reconciled?.held ?? 0;

  return (
    <Screen screenId={T} state={state} title={tx(T, "مركز الاتصال والمزامنة")}>
      <AppText variant="section">{tx(T, "مصالحة بعد تغيّر جيل الخادم")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الخادم استُعيد إلى نقطة أقدم، فصار عند الأجهزة عملٌ لا يعرفه.")}
      </AppText>

      {change ? (
        <GroupedList>
          <Row title={tx(T, "الجيل الحالي")} trailing={<N>{short(change.next)}</N>} />
          <Row title={tx(T, "· وصلت ردود تخصّ")} trailing={<N>{short(change.previous)}</N>} />
          <Row
            title={tx(T, "اكتُشف")}
            detail={
              <>
                <DayLabel iso={change.detectedAt} /> <N>{hhmm(change.detectedAt)}</N>
              </>
            }
            last
          />
        </GroupedList>
      ) : null}

      {state === "conflict" ? (
        <StateView state="conflict" title={tx(T, "الخادم لا يعرف عملك")}>
          <AppText variant="secondary">
            {tx(T, "جيل جديد للخادم: استُعيد إلى نقطة سابقة، وعلى جهازك")} <N>{synced.length}</N>{" "}
            {tx(T, "عملية مؤكَّدة بعد تلك النقطة. كانت «مؤكَّدة» وصارت غير معروفة.")}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "لا نمسح ولا نرفع تلقائياً")}</Strong>{" "}
            {tx(T, "· المصالحة تُقارن بالهويات الأصلية أولاً.")}
          </AppText>
          <Button
            financial
            label={tx(T, "ابدأ المصالحة")}
            loading={busy}
            onPress={() => void start()}
          />
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "المعلَّق ليس مفقوداً.")}>
          <AppText variant="secondary">
            {tx(
              T,
              "يبقى في قائمة محدَّدة بعدد وقيمة، وتُعاد محاولته على الجيل الجديد. لن يختفي رقم من دفترك لأن الخادم تغيّر.",
            )}
          </AppText>
          <AppText variant="note">
            <N>{pending.length}</N> {tx(T, "عملية معلّقة بقيمة")}{" "}
            <N>{formatMinor(pendingValue.toString())}</N>
          </AppText>
          <Button
            financial
            label={tx(T, "ابدأ المصالحة")}
            loading={busy}
            onPress={() => void start()}
          />
        </StateView>
      ) : null}
      {state === "pending_sync" ? (
        <StateView state="pending_sync" title={tx(T, "المصالحة جارية")}>
          <AppText variant="secondary">
            {tx(T, "تُقارَن هويات")} <N>{synced.length + pending.length}</N>{" "}
            {tx(T, "عملية بما عند الخادم: ما نجا يُترك، وما فُقد يُرفع، وما اختلف يُحجز.")}
          </AppText>
          <AppText variant="note">
            {tx(T, "موجودة · سترفع · للمراجعة — والبيع مستمر أثناء ذلك.")}
          </AppText>
          <AppText variant="note" style={{ color: c.state.saving.fg }}>
            {tx(T, "جارٍ")}
          </AppText>
        </StateView>
      ) : null}
      {state === "success" && !outcome && !reconciled && loaded ? (
        <StateView state="success" title={tx(T, "لا مصالحة مطلوبة")}>
          <AppText variant="secondary">{tx(T, "لا تغيّر جيلٍ معلّقاً على هذا الجهاز.")}</AppText>
        </StateView>
      ) : state === "success" ? (
        <StateView state="success" title={tx(T, "تمّت المصالحة")}>
          <AppText variant="secondary">
            {tx(T, "استقرّ الدفتران.")}{" "}
            {outcome || reconciled ? (
              <>
                <N>{present}</N> {tx(T, "موجودة ·")} <N>{uploaded}</N> {tx(T, "رُفعت ·")}{" "}
                <N>{heldCount}</N> {tx(T, "للمراجعة")}
              </>
            ) : null}
          </AppText>
          {heldCount > 0 ? (
            <Button
              variant="secondary"
              label={tx(T, "البندان المحجوزان في مراجعة التعارضات")}
              onPress={() => router.push("/sync/review")}
            />
          ) : null}
          <AppText variant="note">
            <Strong>{tx(T, "أثرٌ دائم")}</Strong>{" "}
            {tx(
              T,
              "· الحدث يبقى في سجل التدقيق بتاريخه. من يراجع بعد أشهر سيجد فجوةً في الترقيم — هذا السطر يفسّرها.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {failed ? (
        <StateView state="server_error" title={tx(T, "تعذّرت المصالحة")}>
          <AppText variant="secondary">
            {tx(T, "الخادم لم يردّ على المقارنة — أعد المحاولة لاحقاً.")}
          </AppText>
        </StateView>
      ) : null}

      <GroupedList>
        <Row
          title={tx(T, "مؤكَّد")}
          detail={`${tx(T, "عمليات ثبتت على الجيل الجديد")} — ${tx(T, "موجودة في دفتر الخادم بأرقامها")}`}
        />
        <Row
          title={tx(T, "معلَّق")}
          detail={`${tx(T, "ردود تخصّ جيلاً قديماً")} — ${tx(T, "لن تُطبَّق. تُعاد محاولتها على الجيل الجديد ويُعرض ناتجها قبل الاعتماد.")}`}
        />
        <Row
          title={tx(T, "يحتاجك")}
          detail={`${tx(T, "عمليات نجحت عندك وغابت عن الخادم")} — ${tx(T, "موجودة في جهازك ومفقودة عنده. تُرفع من جديد بعد مراجعتك — ولا تُحذف تلقائياً لتطابق الخادم.")}`}
        />
        <Row
          title={tx(T, "محسوم")}
          detail={`${tx(T, "مكرّرات مُنعت")} — ${tx(T, "وصلت مرتين بمعرّف واحد فحُسبت مرة")}`}
          last
        />
      </GroupedList>

      {pending.length > 0 && state !== "success" ? (
        <GroupedList title={tx(T, "المعلّق")}>
          {pending.slice(0, 10).map((op, i, arr) => {
            const d = describeOperation(op);
            const amount = amountOf(op);
            return (
              <Row
                key={op.operationId}
                title={
                  <AppText>
                    {d.title} <N>{d.number}</N>
                  </AppText>
                }
                trailing={amount ? <N>{formatMinor(amount)}</N> : undefined}
                last={i === arr.length - 1}
              />
            );
          })}
        </GroupedList>
      ) : null}
      <View>
        <Button
          variant="quiet"
          label={tx(T, "مركز المزامنة")}
          onPress={() => router.push("/sync")}
        />
      </View>
    </Screen>
  );
}
