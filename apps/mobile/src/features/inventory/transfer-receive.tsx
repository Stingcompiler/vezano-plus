import { dayMonth, formatMinor, formatQty, hhmm, pushPending } from "@sting/app-core";
import {
  type LocalTransferReceipt,
  readLocalTransfers,
  saveTransferReceiptLocally,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Stepper } from "@/components/inventory/stepper";
import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { Delta, M, type Phase, type PushResult, pushKind } from "./common";
import { branchTitle, type TransferView } from "./transfer-card";
import { parseQtyInput } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-10";
type State = "ready" | "partial" | "validation_error" | "conflict" | "success";

interface Row {
  readonly id: string;
  readonly itemId: string;
  readonly name: string;
  readonly unit: string;
  readonly sentMilli: bigint;
  readonly draft: string;
  readonly receivedMilli: bigint | null;
  readonly valueMinor: bigint;
}

const REMAIN_WORDS = [
  "",
  tx(T, "الواحد"),
  tx(T, "الاثنان"),
  tx(T, "الثلاثة"),
  tx(T, "الأربعة"),
  tx(T, "الخمسة"),
  tx(T, "الستة"),
  tx(T, "السبعة"),
  tx(T, "الثمانية"),
  tx(T, "التسعة"),
  tx(T, "العشرة"),
] as const;

/** «الثلاثة الباقية» كما في الإطار — كلمةً حتى العشرة، وإلا رقمٌ داخل mono. */
function RemainWord({ milli }: { milli: bigint }) {
  const whole = milli % 1000n === 0n ? Number(milli / 1000n) : -1;
  const word = whole >= 1 && whole <= 10 ? REMAIN_WORDS[whole] : undefined;
  return word ? <>{word}</> : <M>{formatQty(milli, 0)}</M>;
}

/**
 * INV-10 — استلام تحويل جزئي ومراجعة فرق (خطة الجوال M3): سطر لكل صنف — المُرسل كما ادّعاه المصدر وما
 * تعدّه أنت بعدّاد؛ ما عُدّ يدخل مخزونك، والفرق يبقى مفتوحاً على التحويل بسبب مكتوب حتى يقرّ المصدر أو
 * يعترض — لا ترجيح؛ الزيادة لا تُقبل صامتة (ACC-128)؛ الإشعار نفسه مرتين = استلام واحد (ACC-18).
 */
export function TransferReceiveScreen({ transferId }: { transferId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [transfer, setTransfer] = useState<TransferView | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [push, setPush] = useState<PushResult>("none");
  const [saved, setSaved] = useState<LocalTransferReceipt | null>(null);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/inventory/transfers/{transfer_id}", {
          params: { path: { transfer_id: transferId } },
        });
        const body = data as unknown as { transfer: TransferView } | undefined;
        if (response.ok && body) {
          setTransfer(body.transfer);
          return;
        }
      } catch {
        /* بلا اتصال: من الإسقاط المحلي إن وصل عبر المزامنة */
      }
      const local = (await readLocalTransfers(await getStorage())).find((t) => t.id === transferId);
      setTransfer(local ? { ...local, late: false } : null);
    })();
  }, [api, transferId]);

  useEffect(() => {
    if (transfer === null) router.replace("/inventory/transfers");
  }, [transfer, router]);

  const rows: Row[] = (transfer?.lines ?? []).map((l) => {
    const sent = BigInt(l.base_qty_milli);
    const draft = drafts[l.id] ?? formatQty(sent, 0);
    return {
      id: l.id,
      itemId: l.item_id,
      name: l.item_name,
      unit: l.unit_name,
      sentMilli: sent,
      draft,
      receivedMilli: parseQtyInput(draft),
      valueMinor: sent > 0n ? BigInt(l.value_minor ?? "0") : 0n,
    };
  });
  const sentTotal = rows.reduce((a, r) => a + r.sentMilli, 0n);
  const receivedTotal = rows.reduce((a, r) => a + (r.receivedMilli ?? 0n), 0n);
  const diff = receivedTotal - sentTotal;
  const excess = rows.filter((r) => r.receivedMilli !== null && r.receivedMilli > r.sentMilli);
  const variance = rows.some((r) => r.receivedMilli !== null && r.receivedMilli !== r.sentMilli);
  const invalidQty = rows.some((r) => r.receivedMilli === null);
  const varianceValue = rows.reduce(
    (a, r) =>
      a +
      (r.receivedMilli !== null && r.sentMilli > 0n
        ? ((r.receivedMilli - r.sentMilli) * r.valueMinor) / r.sentMilli
        : 0n),
    0n,
  );
  const errors: Record<string, string> = {};
  if (invalidQty) errors["qty"] = tx(T, "المستلم فعلياً");
  if (variance && !reason.trim()) errors["reason"] = tx(T, "سبب الفرق — إلزامي");
  const invalid = Object.keys(errors).length > 0;
  const alreadyReceived =
    transfer?.status === "received" ||
    transfer?.status === "partially_received" ||
    transfer?.status === "cancelled";

  const state: State =
    phase === "saved"
      ? variance
        ? "conflict"
        : "success"
      : excess.length > 0 && !reason.trim()
        ? "validation_error"
        : variance
          ? "partial"
          : "ready";

  const confirm = async () => {
    if (!ctx || !transfer || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    ids.current ??= { operationId: newId(), receiptId: newId() };
    const storage = await getStorage();
    const { receipt } = await saveTransferReceiptLocally(storage, {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      transferId: transfer.id,
      branchId: ctx.branchId,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      reason,
      lines: rows.map((r) => ({
        lineId: newId(),
        movementId: newId(),
        transferLineId: r.id,
        itemId: r.itemId,
        sentBaseMilli: r.sentMilli.toString(),
        receivedBaseMilli: (r.receivedMilli ?? 0n).toString(),
      })),
      receivedAt: new Date().toISOString(),
    });
    setSaved(receipt);
    try {
      setPush(pushKind(await pushPending({ api, storage, requestId: newId })));
    } catch {
      setPush("pending");
    } finally {
      setPhase("saved");
    }
  };

  const step = (r: Row, dir: 1 | -1) => {
    const next = (r.receivedMilli ?? 0n) + BigInt(dir) * 1000n;
    if (next < 0n) return;
    setDrafts((d) => ({ ...d, [r.id]: formatQty(next, 0) }));
  };

  const sent = transfer ? dayMonth(transfer.sent_at) : null;
  const unitName = rows[0]?.unit ?? "";

  return (
    <Screen
      screenId={T}
      state={transfer === undefined ? "loading" : state}
      title={tx(T, "استلام تحويل")}
    >
      {transfer ? (
        <View style={{ marginBottom: SPACE["3"] }}>
          <AppText variant="title">
            <M>{transfer.transfer_number}</M> {tx(T, "من")} {branchTitle(transfer.branch_from_name)}
          </AppText>
          {sent ? (
            <AppText variant="note" muted>
              {tx(T, "أُرسل")} <M>{sent.day}</M> {sent.month} <M>{hhmm(transfer.sent_at)}</M> ·{" "}
              {transfer.user_name}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {transfer && alreadyReceived && phase === "idle" ? (
        <StateView state="synced" title={tx(T, "استُلم التحويل")}>
          <AppText variant="secondary">
            {tx(
              T,
              "إن وصل إشعار الاستلام نفسه مرتين — من جهازين أو بعد انقطاع — يُسجَّل استلام واحد. الباقي المفتوح لا يتضاعف.",
            )}
          </AppText>
        </StateView>
      ) : null}

      <GroupedList>
        <ListRow title={tx(T, "مُرسَل")} trailing={<M>{formatQty(sentTotal, 0)}</M>} />
        <ListRow title={tx(T, "مستلم الآن")} trailing={<M>{formatQty(receivedTotal, 0)}</M>} />
        <ListRow
          title={tx(T, "فرق")}
          last
          trailing={
            <AppText
              style={{ color: diff < 0n ? c.danger : diff > 0n ? c.state.synced.fg : undefined }}
            >
              <Delta milli={diff} dp={0} />
            </AppText>
          }
        />
      </GroupedList>

      {state === "validation_error" && excess.length > 0 ? (
        <StateView state="validation_error" title={tx(T, "استلام يتجاوز المرسل")}>
          <AppText variant="secondary">
            {tx(T, "عدُّ")} <M>{formatQty(excess[0].receivedMilli ?? 0n, 0)}</M> {tx(T, "والمرسل")}{" "}
            <M>{formatQty(excess[0].sentMilli, 0)}</M>.
          </AppText>
          <AppText variant="note" muted>
            {tx(
              T,
              "قد يكون خطأ عدٍّ أو إرسالاً زائداً. تُسجَّل بسبب مكتوب وتُحال إلى مراجعة الفرق.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "سطور الاستلام")}>
          {rows.map((r, i) => {
            const d = r.receivedMilli === null ? null : r.receivedMilli - r.sentMilli;
            return (
              <View
                key={r.id}
                style={{
                  padding: SPACE["4"],
                  gap: SPACE["2"],
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <AppText variant="bodyStrong">
                  {r.name} · {r.unit}
                </AppText>
                <AppText variant="note" muted>
                  {tx(T, "مُرسَل")} <M>{formatQty(r.sentMilli, 0)}</M> · {tx(T, "فرق")}{" "}
                  {d === null ? (
                    <M>—</M>
                  ) : (
                    <AppText
                      variant="note"
                      style={{ color: d < 0n ? c.danger : d > 0n ? c.state.synced.fg : undefined }}
                    >
                      <Delta milli={d} dp={0} />
                    </AppText>
                  )}
                </AppText>
                <Stepper
                  value={r.draft}
                  onChangeText={(t) => setDrafts((m) => ({ ...m, [r.id]: t }))}
                  onStep={(dir) => step(r, dir)}
                  editable={phase === "idle"}
                  inputLabel={`${tx(T, "المستلم فعلياً —")} ${r.name}`}
                  minusLabel={`${tx(T, "نقص —")} ${r.name}`}
                  plusLabel={`${tx(T, "زيادة —")} ${r.name}`}
                />
              </View>
            );
          })}
        </GroupedList>
      ) : null}

      {phase !== "saved" ? (
        <>
          {variance ? (
            <TextField
              label={tx(T, "سبب الفرق — إلزامي")}
              value={reason}
              onChangeText={setReason}
              error={attempted ? errors["reason"] : undefined}
              required
            />
          ) : null}
          {variance && diff < 0n ? (
            <StateView
              state="partial"
              title={`${tx(T, "يدخل مخزونك")} ${formatQty(receivedTotal, 0)} ${tx(T, "فقط.")}`}
            >
              <AppText variant="secondary">
                <RemainWord milli={-diff} /> {tx(T, "الباقية تبقى مفتوحة على التحويل حتى يقرّ")}{" "}
                {transfer ? branchTitle(transfer.branch_from_name) : tx(T, "المصدر")}{" "}
                {tx(T, "بالفرق أو يعترض — لا تُخصَم من مخزونه تلقائياً ولا تُضاف إلى مخزونك.")}
              </AppText>
            </StateView>
          ) : null}
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(
              T,
              "إن وصل إشعار الاستلام نفسه مرتين — من جهازين أو بعد انقطاع — يُسجَّل استلام واحد. الباقي المفتوح لا يتضاعف.",
            )}
          </AppText>
          <Button
            label={`${tx(T, "تأكيد استلام")} ${formatQty(receivedTotal, 0)}${variance ? ` ${tx(T, "وفتح مراجعة الفرق")}` : ""}`}
            financial
            loading={phase === "saving"}
            disabledReason={
              !transfer
                ? tx(T, "جارٍ التحميل")
                : alreadyReceived
                  ? tx(T, "استُلم التحويل")
                  : attempted && invalid
                    ? tx(T, "أكمل الحقول المطلوبة")
                    : undefined
            }
            onPress={() => void confirm()}
          />
          <Button
            label={tx(T, "قائمة التحويلات")}
            variant="quiet"
            onPress={() => router.push("/inventory/transfers")}
          />
        </>
      ) : null}

      {phase === "saved" && saved ? (
        <>
          {state === "conflict" ? (
            <StateView state="conflict" title={tx(T, "الفرعان يدّعيان رقمين")}>
              <AppText variant="secondary">
                {tx(T, "المصدر يقول أرسل")} <M>{formatQty(sentTotal, 0)}</M>{" "}
                {tx(T, "والمستقبل عدّ")} <M>{formatQty(receivedTotal, 0)}</M>.{" "}
                <M>{formatQty(diff < 0n ? -diff : diff, 0)}</M> {unitName}{" "}
                {diff < 0n ? tx(T, "مفقودة") : tx(T, "زائدة")} {tx(T, "بين المخزنين.")}
              </AppText>
              <AppText variant="note" muted>
                {tx(T, "لا ترجيح")}{" "}
                {tx(
                  T,
                  "· لا نأخذ رقم المرسل ولا المستلم. الفرق يُحجَز بقيمته ويُراجَع بقرار — والبضاعة قد تكون في الشاحنة أو سُرقت.",
                )}
              </AppText>
              <AppText variant="note" muted>
                {tx(T, "من يقرّر")} {tx(T, "· المالك أو مدير أعلى من الفرعين.")}
              </AppText>
              <AppText variant="note" muted>
                {tx(T, "الفرق المحجوز")} <M>{formatQty(diff, 0)}</M> {unitName} {tx(T, "· بقيمة")}{" "}
                <M>
                  {formatMinor((varianceValue < 0n ? -varianceValue : varianceValue).toString())}
                </M>
              </AppText>
            </StateView>
          ) : null}
          <StateView
            state={push === "synced" ? "success" : "saved_local"}
            title={tx(T, "استُلم التحويل")}
          >
            <AppText variant="secondary">
              {tx(T, "ما دخل رصيدك ومصير الفرق: مغلقٌ بتسوية، أو محجوز للمراجعة.")}
            </AppText>
            <AppText variant="note" muted>
              {tx(T, "مخزون الطريق يُصفّى")}{" "}
              {tx(T, "· ما استُلم يخرج من الطريق إلى الرصيد، وما بقي يبقى في الطريق موسوماً.")}
            </AppText>
          </StateView>
          <GroupedList>
            <ListRow title={tx(T, "الإشعار")} trailing={<M>{saved.receipt_number}</M>} />
            <ListRow
              title={tx(T, "دخل رصيدك")}
              trailing={
                <AppText>
                  <M>{formatQty(receivedTotal, 0)}</M> {unitName}
                </AppText>
              }
            />
            <ListRow
              title={tx(T, "محجوز للمراجعة")}
              last
              trailing={
                <AppText>
                  <M>{formatQty(diff, 0)}</M> {unitName}
                </AppText>
              }
            />
          </GroupedList>
          {push !== "synced" ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "عملية واحدة معلقة من هذا الجهاز")}
            </AppText>
          ) : null}
          <Button
            label={tx(T, "قائمة التحويلات")}
            financial
            onPress={() =>
              router.push({ pathname: "/inventory/transfers", params: { id: transfer?.id ?? "" } })
            }
          />
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="quiet"
            onPress={() => router.push("/inventory")}
          />
        </>
      ) : null}
    </Screen>
  );
}
