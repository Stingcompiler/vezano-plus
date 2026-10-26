import { formatMinorShort, pushPending } from "@sting/app-core";
import {
  bankReferenceUsed,
  type LocalParty,
  type LocalReceipt,
  type LocalShift,
  readLocalParties,
  readOpenShift,
  readPartyPendingCredit,
  type ReceiptKind,
  type ReceiptMethod,
  saveReceiptLocally,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  ALIGN_LEFT,
  AppText,
  Button,
  FONT,
  GroupedList,
  Keypad,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Composite, M, PRow, Segments, Stack } from "@/components/parties/parts";
import { newId } from "@/lib/crypto";
import { parseAmount, today, useShiftContext } from "@/lib/pos";
import { printReceipt } from "@/lib/receipt-print";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-06";
type State =
  "ready" | "validation_error" | "saving" | "saved_local" | "success" | "permission_denied";

/** نصّ رفض المرجع المستهلَك — خطأ الحقل وعنوان التنبيه معاً. */
const REF_USED_TEXT = tx(T, "مرجع تحويل لا يُستهلك مرتين");

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** إيصال سند بخط النظام وRTL — يُطبع بعد الحفظ لا قبله. */
function receiptHtml(r: LocalReceipt, partyName: string, balance: string): string {
  const method = r.method === "cash" ? tx(T, "نقداً") : tx(T, "تحويل بنكي · مسجَّل — غير مطابق");
  const row = (k: string, v: string, mono = false) =>
    `<tr><td>${esc(k)}</td><td dir="ltr" style="text-align:left${mono ? ";font-family:monospace" : ""}">${esc(v)}</td></tr>`;
  return `<html dir="rtl" lang="ar"><body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;max-width:380px">
<h3 style="text-align:center;margin:0">${esc(r.kind === "refund" ? tx(T, "ردّ مبلغ") : tx(T, "سداد"))} — ${esc(partyName)}</h3>
<table style="width:100%;border-collapse:collapse">
${row(tx(T, "السند"), r.receipt_number, true)}
${row(tx(T, "المبلغ"), formatMinorShort(r.amount_minor), true)}
${row(tx(T, "الوسيلة"), method)}
${row(tx(T, "رصيد الطرف"), balance, true)}
</table></body></html>`;
}

/**
 * PTY-06 — تسجيل سداد أو ردّ مبلغ (خطة الجوال M3): بحث ثم مبلغ ثم حفظ؛ يخفض التراكمي دون توزيع على
 * فواتير؛ النقد يدخل صندوق الوردية المفتوحة فوراً؛ التحويل «مسجَّل — غير مطابق» لا يُسقط الذمّة حتى
 * المطابقة ومرجعه لا يُستهلك مرتين؛ الكاشير يقبض ولا يردّ. الحفظ محلي (saveReceiptLocally) ثم الرفع،
 * والنجاح بعد الحفظ المحلي. الإسقاط المحلي لا يتحدّث بالرفع: الرصيد المعروض = خادمي + معلّق.
 */
export default function Payment() {
  const router = useRouter();
  const c = useColors();
  const { id: partyId } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [party, setParty] = useState<LocalParty | null | undefined>(undefined);
  const [pending, setPending] = useState(0n);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [kind, setKind] = useState<ReceiptKind>("receipt");
  const [method, setMethod] = useState<ReceiptMethod>("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [refUsed, setRefUsed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [denied, setDenied] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<LocalReceipt | null>(null);
  const [savedAfter, setSavedAfter] = useState<bigint>(0n);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [parties, s, pend] = await Promise.all([
        readLocalParties(storage),
        readOpenShift(storage),
        readPartyPendingCredit(storage, partyId),
      ]);
      setParty(parties.find((p) => p.id === partyId) ?? null);
      setShift(s);
      setPending(pend.pendingMinor);
    })();
  }, [partyId]);

  useEffect(() => {
    if (party === null) router.replace("/parties");
  }, [party, router]);

  useEffect(() => {
    if (method !== "bank" || !reference.trim()) {
      setRefUsed(false);
      return;
    }
    void getStorage()
      .then((s) => bankReferenceUsed(s, reference))
      .then(setRefUsed);
  }, [method, reference]);

  const isOwner = ctx?.roleName === tx(T, "مالك") || ctx?.roleCode === "owner";
  const canRefund = isOwner || ctx?.roleCode === "manager";
  const serverBalance = BigInt(party?.balance_minor || "0");
  const before = serverBalance + pending;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n)
    errors["amount"] = tx(T, "مبلغ موجب");
  if (method === "bank" && !reference.trim()) errors["reference"] = tx(T, "مرجع التحويل — إلزامي");
  // المرجع المستهلَك يُعرَف بعَلَم لا بنصّ الخطأ — النص للمستخدم ولا يحمل رموزاً داخلية
  const refDuplicate = method === "bank" && refUsed;
  if (refDuplicate) errors["reference"] = REF_USED_TEXT;
  if (kind === "refund" && !reason.trim()) errors["reason"] = tx(T, "يُطلب سبب");
  const invalid = Object.keys(errors).length > 0;
  // النقد يؤثر فوراً؛ التحويل غير المطابق لا يغيّر الرصيد
  const effect =
    method === "bank" || !amountMinor || amountMinor <= 0n
      ? 0n
      : kind === "receipt"
        ? -amountMinor
        : amountMinor;
  const after = before + effect;

  const state: State = denied
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
    if (!party || !shift || !ctx || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    if (!ids.current) ids.current = { operationId: newId(), receiptId: newId() };
    const storage = await getStorage();
    const { receipt } = await saveReceiptLocally(storage, {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      partyId: party.id,
      partyName: party.name,
      partyOperationId: party.operation_id,
      kind,
      method,
      amountMinor: (amountMinor ?? 0n).toString(),
      reference,
      reason,
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
    setSavedAfter(after);
    try {
      const out = await pushPending({ api, storage, requestId: newId });
      setPush(
        out.kind === "applied" || out.kind === "idle"
          ? "synced"
          : out.kind === "retry"
            ? "failed"
            : "pending",
      );
    } catch {
      setPush("failed");
    } finally {
      // لا إعادة قراءة للطرف بعد الرفع: الإسقاط المحلي لا يتحدّث به، والرصيد المركّب يبقى خادمي + معلّق
      setPhase("saved");
    }
  };

  const heading =
    kind === "receipt"
      ? method === "cash"
        ? tx(T, "— سداد نقدي")
        : tx(T, "— تحويل غير مطابق")
      : tx(T, "— ردّ مبلغ");
  const goStatement = () =>
    router.push({ pathname: "/parties/[id]/statement", params: { id: partyId } });
  const rowFont = { fontFamily: FONT.monoSemiBold, writingDirection: "ltr" as const };

  return (
    <Screen screenId={T} state={state} title={`${tx(T, "تسجيل سداد أو رد مبلغ")} ${heading}`}>
      {party ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "التحويل البنكي لا يُسقط الذمة حتى المطابقة.")}
          </AppText>

          {phase !== "saved" ? (
            <Segments
              value={kind}
              onChange={(k) => {
                if (k === "refund" && !canRefund) {
                  setDenied(true);
                  return;
                }
                setKind(k);
                setDenied(false);
              }}
              options={[
                ["receipt", tx(T, "سداد")],
                ["refund", tx(T, "ردّ مبلغ")],
              ]}
            />
          ) : null}
          {phase !== "saved" ? (
            <AppText
              variant="note"
              muted
              style={{ marginTop: -SPACE["2"], marginBottom: SPACE["3"] }}
            >
              {tx(T, "نوع السند")}
            </AppText>
          ) : null}

          {state === "permission_denied" ? (
            <StateView state="permission_denied" title={tx(T, "الكاشير يقبض ولا يردّ")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "القبض يزيد النقد والردّ يُخرجه. الفعلان متعاكسان في الأثر فلا يتساويان في الصلاحية.",
                )}
              </AppText>
              <AppText variant="note">
                {tx(T, "«اطلب من")} {ctx?.ownerName || tx(T, "المالك")}{" "}
                {tx(T, "» بالمبلغ والسبب والطرف، فتوافق من جهازها ويُنسب الردّ إليها.")}
              </AppText>
            </StateView>
          ) : null}

          {phase !== "saved" ? (
            <>
              <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
                {kind === "receipt" ? tx(T, "سداد من") : tx(T, "ردّ مبلغ إلى")} {party.name}
              </AppText>
              <GroupedList>
                <PRow
                  title={tx(T, "عليه الآن")}
                  trailing={<M strong>{formatMinorShort(before.toString())}</M>}
                  sub={
                    pending !== 0n ? (
                      <Composite
                        serverLabel={tx(T, "خادمي")}
                        pendingLabel={`${pending > 0n ? "+" : "−"} ${tx(T, "معلّق هذا الجهاز")}`}
                        server={formatMinorShort(serverBalance.toString())}
                        pending={formatMinorShort((pending > 0n ? pending : -pending).toString())}
                        total={formatMinorShort(before.toString())}
                      />
                    ) : undefined
                  }
                  last
                />
              </GroupedList>

              <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
                {kind === "receipt" ? tx(T, "المبلغ المسدَّد") : tx(T, "المبلغ المردود")}
              </AppText>
              <View
                style={{
                  minHeight: 64,
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: attempted && errors["amount"] ? c.danger : c.border,
                  borderRadius: 12,
                  backgroundColor: c.surfaceCard,
                  paddingHorizontal: SPACE["4"],
                  marginBottom: SPACE["2"],
                }}
              >
                <Text
                  testID="amount-display"
                  style={{
                    fontFamily: FONT.monoSemiBold,
                    fontSize: 32,
                    writingDirection: "ltr",
                    textAlign: ALIGN_LEFT,
                    color: amount ? c.inkStrong : c.inkFaint,
                  }}
                >
                  {amount || "0"}
                </Text>
              </View>
              {attempted && errors["amount"] ? (
                <AppText variant="note" style={{ color: c.danger, marginBottom: SPACE["2"] }}>
                  {errors["amount"]}
                </AppText>
              ) : null}
              <View style={{ marginBottom: SPACE["4"] }}>
                <Keypad value={amount} onChange={setAmount} />
              </View>

              <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
                {tx(T, "الوسيلة")}
              </AppText>
              <Segments
                value={method}
                onChange={setMethod}
                options={[
                  ["cash", tx(T, "نقداً")],
                  ["bank", tx(T, "تحويل بنكي")],
                ]}
              />
              {method === "bank" ? (
                <>
                  <TextField
                    label={tx(T, "مرجع التحويل — إلزامي")}
                    value={reference}
                    onChangeText={setReference}
                    mono
                    autoCapitalize="characters"
                    autoCorrect={false}
                    error={attempted ? errors["reference"] : undefined}
                    required
                  />
                  <StateView state="stale" title={tx(T, "مسجَّل — غير مطابق")}>
                    <AppText variant="secondary">
                      {tx(T, "رفع الإيصال لا يعني وصول المبلغ. تبقى ذمة العميل")}{" "}
                      <M>{formatMinorShort(before.toString())}</M>{" "}
                      {tx(T, "حتى تؤكد الاستلام في كشف البنك، ثم يُسقط الدين بفعل صريح.")}
                    </AppText>
                  </StateView>
                </>
              ) : null}
              {kind === "refund" ? (
                <>
                  <TextField
                    label={tx(T, "السبب")}
                    value={reason}
                    onChangeText={setReason}
                    error={attempted ? errors["reason"] : undefined}
                    required
                  />
                  <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
                    {tx(T, "الردّ يطلب سبباً مكتوباً دائماً، ولو نفّذه المالك بنفسه.")}
                  </AppText>
                </>
              ) : null}

              <GroupedList>
                <PRow
                  title={
                    method === "bank" ? tx(T, "الرصيد بعد التسجيل") : tx(T, "الرصيد بعد السداد")
                  }
                  trailing={<M strong>{formatMinorShort(after.toString())}</M>}
                  last
                />
              </GroupedList>
              <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
                {method === "bank" ? (
                  tx(T, "— لا يتغير")
                ) : (
                  <>
                    {tx(T, "النقد")} {kind === "receipt" ? tx(T, "يدخل") : tx(T, "يخرج من")}{" "}
                    {tx(T, "صندوق الوردية المفتوحة فوراً ويظهر في «الوردية».")}
                  </>
                )}
              </AppText>
              {state === "validation_error" && refDuplicate ? (
                <StateView state="validation_error" title={REF_USED_TEXT}>
                  <AppText variant="secondary">
                    <M>{reference.trim()}</M>{" "}
                    {tx(T, "مسجَّل على سند أو فاتورة أخرى على هذا الجهاز.")}
                  </AppText>
                </StateView>
              ) : null}
              <Stack>
                <Button
                  label={
                    method === "bank"
                      ? tx(T, "تسجيل التحويل بانتظار المطابقة")
                      : kind === "receipt"
                        ? tx(T, "تسجيل السداد وطباعة إيصال")
                        : tx(T, "تسجيل الردّ وطباعة إيصال")
                  }
                  financial
                  onPress={() => void commit()}
                  loading={phase === "saving"}
                  disabledReason={
                    shift === null
                      ? tx(T, "لا وردية مفتوحة — النقد يدخل صندوق الوردية")
                      : attempted && invalid
                        ? tx(T, "أكمل الحقول المطلوبة")
                        : undefined
                  }
                />
                <Button label={tx(T, "كشف الحساب")} variant="quiet" onPress={goStatement} />
              </Stack>
            </>
          ) : null}

          {state === "saving" ? (
            <StateView state="saving" title={tx(T, "جارٍ الحفظ")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "الحفظ والطباعة منفصلان هنا أيضاً: يُحفظ السند ثم يُطبع. لا تُطبع ورقة على شيء لم يُحفظ.",
                )}
              </AppText>
            </StateView>
          ) : null}

          {phase === "saved" && saved ? (
            <>
              {state === "success" ? (
                <StateView state="success" title={tx(T, "سُجّل السداد")}>
                  <AppText variant="secondary">
                    {tx(T, "سند")} <M>{saved.receipt_number}</M>{" "}
                    {tx(T, "· رقم نهائي وطباعة جاهزة. نسخة للطرف ونسخة تبقى في المستندات.")}
                  </AppText>
                  <AppText variant="note">
                    {tx(T, "لا يُحذف")} {tx(T, "· التصحيح بسند عكس يشير إليه.")}
                  </AppText>
                </StateView>
              ) : (
                <StateView state="saved_local" title={tx(T, "سُجّل بلا اتصال")}>
                  <AppText variant="secondary">
                    {tx(
                      T,
                      "السداد محفوظ على الجهاز بسند مؤقت. رصيد الطرف يُحدَّث محلياً ويُوسم «غير مزامن».",
                    )}
                  </AppText>
                  <AppText variant="note">
                    {tx(T, "الخطر")}{" "}
                    {tx(
                      T,
                      "· قد يكون الطرف قد سدّد في فرع آخر في الوقت نفسه. الكشف يُظهر السند المؤقت بوسمه حتى تتم المزامنة ويُطابَق.",
                    )}
                  </AppText>
                </StateView>
              )}
              <GroupedList>
                <PRow
                  title={tx(T, "السند")}
                  trailing={<Text style={rowFont}>{saved.receipt_number}</Text>}
                />
                <PRow
                  title={tx(T, "المبلغ")}
                  trailing={<M>{formatMinorShort(saved.amount_minor)}</M>}
                />
                <PRow
                  title={tx(T, "الوسيلة")}
                  trailing={
                    <AppText>
                      {saved.method === "cash"
                        ? tx(T, "نقداً")
                        : tx(T, "تحويل بنكي · مسجَّل — غير مطابق")}
                    </AppText>
                  }
                />
                <PRow
                  title={tx(T, "رصيد الطرف")}
                  trailing={<M>{formatMinorShort(savedAfter.toString())}</M>}
                  last
                />
              </GroupedList>
              {push !== "synced" ? (
                <AppText
                  variant="note"
                  style={{ color: c.state.pending_sync.fg, marginBottom: SPACE["3"] }}
                >
                  {tx(T, "عملية واحدة معلقة من هذا الجهاز")}
                </AppText>
              ) : null}
              <Stack>
                <Button
                  label={tx(T, "اطبع")}
                  financial
                  onPress={() =>
                    void printReceipt(
                      receiptHtml(saved, party.name, formatMinorShort(savedAfter.toString())),
                    )
                  }
                />
                <Button label={tx(T, "كشف الحساب")} variant="secondary" onPress={goStatement} />
                <Button
                  label={tx(T, "طرف آخر")}
                  variant="quiet"
                  onPress={() => router.replace("/parties")}
                />
              </Stack>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
