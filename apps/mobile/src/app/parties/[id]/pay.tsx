import { formatMinorShort, pushPending } from "@sting/app-core";
import {
  bankReferenceUsed,
  type LocalParty,
  type LocalReceipt,
  type LocalShift,
  readLocalParties,
  readOpenShift,
  readPendingSupplierPayments,
  type ReceiptMethod,
  saveReceiptLocally,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { M, PRow, Segments, Stack } from "@/components/parties/parts";
import { newId } from "@/lib/crypto";
import { parseAmount, today, useShiftContext } from "@/lib/pos";
import { printReceipt } from "@/lib/receipt-print";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-06";
type State =
  "ready" | "validation_error" | "saving" | "saved_local" | "success" | "permission_denied";

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** سند الصرف بخط النظام وRTL — يُطبع بعد الحفظ لا قبله. */
function voucherHtml(r: LocalReceipt): string {
  const method = r.method === "cash" ? tx(T, "نقداً") : tx(T, "تحويل بنكي");
  const row = (k: string, v: string, mono = false) =>
    `<tr><td>${esc(k)}</td><td dir="ltr" style="text-align:left${mono ? ";font-family:monospace" : ""}">${esc(v)}</td></tr>`;
  return `<html dir="rtl" lang="ar"><body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;max-width:380px">
<h3 style="text-align:center;margin:0">${esc(tx(T, "سند صرف"))} — ${esc(r.party_name)}</h3>
<table style="width:100%;border-collapse:collapse">
${row(tx(T, "السند"), r.receipt_number, true)}
${row(tx(T, "المبلغ"), formatMinorShort(r.amount_minor), true)}
${row(tx(T, "الوسيلة"), method)}
${r.reference ? row(tx(T, "المرجع"), r.reference, true) : ""}
${r.reason ? row(tx(T, "ملاحظة"), r.reason) : ""}
</table></body></html>`;
}

/**
 * «دفع لمورد» — سند صرف (مراجعة الأطراف 2026-11-20، المرحلة ٣؛ 0005 §٢٨٤): يخفّض «له علينا» تراكمياً؛
 * النقد يخرج من صندوق الوردية المفتوحة كالسحب؛ التحويل الصادر أثره فوري. للمدير والمالك. الحفظ محلي
 * (saveReceiptLocally بنوع payment) ثم الرفع.
 */
export default function SupplierPay() {
  const router = useRouter();
  const { id: partyId, amount: prefill } = useLocalSearchParams<{ id: string; amount?: string }>();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [party, setParty] = useState<LocalParty | null | undefined>(undefined);
  const [pending, setPending] = useState(0n);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [method, setMethod] = useState<ReceiptMethod>("cash");
  // «ادفع الآن» من مستند شراء معتمد يمرّر مبلغه بالوحدة الصغرى (0005 §٢٨٥)
  const [amount, setAmount] = useState(() =>
    prefill && /^[0-9]+$/.test(prefill) ? formatMinorShort(prefill).replace(/,/g, "") : "",
  );
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [refUsed, setRefUsed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending">("none");
  const [saved, setSaved] = useState<LocalReceipt | null>(null);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [parties, s, pend] = await Promise.all([
        readLocalParties(storage),
        readOpenShift(storage),
        readPendingSupplierPayments(storage, partyId),
      ]);
      const p = parties.find((x) => x.id === partyId) ?? null;
      setParty(p && p.is_supplier ? p : null);
      setShift(s);
      setPending(pend.signedMinor);
    })();
  }, [partyId]);

  useEffect(() => {
    if (party === null) router.replace({ pathname: "/parties/[id]", params: { id: partyId } });
  }, [party, partyId, router]);

  useEffect(() => {
    if (method !== "bank" || !reference.trim()) {
      setRefUsed(false);
      return;
    }
    void getStorage()
      .then((s) => bankReferenceUsed(s, reference))
      .then(setRefUsed);
  }, [method, reference]);

  const canPay = ctx?.roleCode === "owner" || ctx?.roleCode === "manager";
  // «له علينا» من صفّ قائمة الموردين المخزَّن (storeParties) — ليس في الإسقاط المرجعي دائماً
  const owedRaw = party
    ? (party as unknown as { supplier_owed_minor?: string }).supplier_owed_minor
    : undefined;
  const known = Boolean(owedRaw) || pending !== 0n;
  const before = (owedRaw ? BigInt(owedRaw) : 0n) + pending;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n)
    errors["amount"] = tx(T, "مبلغ موجب");
  if (method === "bank" && !reference.trim()) errors["reference"] = tx(T, "مرجع التحويل — إلزامي");
  if (method === "bank" && refUsed) errors["reference"] = tx(T, "مرجع تحويل لا يُستهلك مرتين");
  const invalid = Object.keys(errors).length > 0;
  const after = before - (amountMinor && amountMinor > 0n ? amountMinor : 0n);

  const state: State =
    ctx && !canPay
      ? "permission_denied"
      : phase === "saving"
        ? "saving"
        : phase === "saved"
          ? push === "synced"
            ? "success"
            : "saved_local"
          : attempted && invalid
            ? "validation_error"
            : "ready";

  const commit = async () => {
    if (!party || !shift || !ctx || !canPay || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    ids.current ??= { operationId: newId(), receiptId: newId() };
    const storage = await getStorage();
    const { receipt } = await saveReceiptLocally(storage, {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      partyId: party.id,
      partyName: party.name,
      partyOperationId: party.operation_id,
      kind: "payment",
      method,
      amountMinor: (amountMinor ?? 0n).toString(),
      reference,
      reason: note,
      shift,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      businessDate: shift.business_date || today(),
      occurredAt: new Date().toISOString(),
    });
    setSaved(receipt);
    try {
      const out = await pushPending({ api, storage, requestId: newId });
      setPush(out.kind === "applied" || out.kind === "idle" ? "synced" : "pending");
    } catch {
      setPush("pending");
    } finally {
      setPhase("saved");
    }
  };

  return (
    <Screen screenId={T} state={state} title={tx(T, "دفع لمورد — سند صرف")}>
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الدفع للمورد للمدير والمالك")}>
          <AppText variant="secondary">
            {tx(T, "الدفع يُخرج نقداً من الصندوق، فصلاحيته كصلاحية ردّ المبلغ.")}
          </AppText>
        </StateView>
      ) : null}
      {party && phase !== "saved" && state !== "permission_denied" ? (
        <>
          <AppText variant="title">
            {tx(T, "دفع إلى")} {party.name}
          </AppText>
          <GroupedList>
            <PRow
              title={tx(T, "له علينا الآن")}
              trailing={<M strong>{known ? formatMinorShort(before.toString()) : "—"}</M>}
              last
            />
          </GroupedList>
          <TextField
            label={tx(T, "المبلغ المدفوع")}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            mono
            error={attempted ? errors["amount"] : undefined}
            required
          />
          <Segments
            value={method}
            onChange={setMethod}
            options={[
              ["cash", tx(T, "نقداً")],
              ["bank", tx(T, "تحويل بنكي")],
            ]}
          />
          {method === "bank" ? (
            <TextField
              label={tx(T, "مرجع التحويل — إلزامي")}
              value={reference}
              onChangeText={setReference}
              mono
              error={attempted ? errors["reference"] : undefined}
              required
            />
          ) : null}
          <TextField label={tx(T, "ملاحظة")} value={note} onChangeText={setNote} />
          <GroupedList>
            <PRow
              title={tx(T, "له علينا بعد الدفع")}
              trailing={<M strong>{known ? formatMinorShort(after.toString()) : "—"}</M>}
              last
            />
          </GroupedList>
          <AppText variant="note" muted>
            {method === "cash"
              ? tx(T, "النقد يخرج من صندوق الوردية المفتوحة فوراً ويظهر في «الوردية».")
              : tx(T, "التحويل الصادر يخفّض ما له علينا فوراً — أرسلته أنت.")}
          </AppText>
          <Stack>
            <Button
              label={tx(T, "تسجيل الدفع وطباعة سند صرف")}
              financial
              loading={phase === "saving"}
              onPress={() => void commit()}
              disabledReason={
                !shift ? tx(T, "لا وردية مفتوحة — النقد يخرج من صندوق الوردية") : undefined
              }
            />
          </Stack>
        </>
      ) : null}
      {phase === "saved" && saved ? (
        <>
          <StateView
            state={state === "success" ? "success" : "saved_local"}
            title={state === "success" ? tx(T, "سُجّل الدفع") : tx(T, "سُجّل بلا اتصال")}
          >
            <AppText variant="secondary">
              {state === "success" ? (
                <>
                  {tx(T, "سند صرف")} <M>{saved.receipt_number}</M>
                </>
              ) : (
                tx(T, "الدفع محفوظ على الجهاز ويُرفع عند الاتصال. ما له علينا يُحدَّث محلياً.")
              )}
            </AppText>
          </StateView>
          <Stack>
            <Button label={tx(T, "اطبع")} onPress={() => void printReceipt(voucherHtml(saved))} />
            <Button
              label={tx(T, "كشف حساب المورد")}
              variant="secondary"
              onPress={() =>
                router.replace({
                  pathname: "/parties/[id]/supplier-statement",
                  params: { id: partyId },
                })
              }
            />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}
