import { dayMonth, formatMinorShort } from "@sting/app-core";
import { storeParties } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { AppText, Button, Screen, SPACE, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { M, Segments, Stack } from "@/components/parties/parts";
import { firstError } from "@/features/parties/lib";
import { parseAmount } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-09";
type State = "ready" | "validation_error" | "permission_denied" | "success";
type Kind = "method" | "reverse" | "amount" | "date";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Context {
  readonly receipt: {
    readonly id: string;
    readonly receipt_number: string;
    readonly party_id: string;
    readonly kind: "receipt" | "refund";
    readonly method: "cash" | "bank";
    readonly amount_minor: string;
    readonly reference: string;
    readonly reason: string;
    readonly user_name: string;
    readonly business_date: string;
  };
  readonly effective: {
    readonly method: "cash" | "bank";
    readonly reference: string;
    readonly amount_minor: string;
    readonly business_date: string;
    readonly reversed: boolean;
    readonly effective: boolean;
  };
  readonly corrections: readonly { readonly id: string; readonly kind: Kind }[];
  readonly party: { readonly id: string; readonly name: string; readonly balance_minor: string };
  readonly locked_before: string;
}

interface Result {
  readonly correction: { readonly id: string; readonly kind: Kind; readonly occurred_at: string };
  readonly party: { readonly id: string; readonly name: string; readonly balance_minor: string };
}

/**
 * PTY-09 — تصحيح تاريخ الأعمال (خطة الجوال M3): الأصل ثابت والتصحيح مستند مستقل مرتبط به بسبب واضح
 * وهوية منفّذ؛ للمالك وحده؛ تاريخ داخل فترة مقفلة يُمنع (period_locked) ويُقال السبب؛ الأثر يُعلَن بعد
 * الحفظ (رصيد الطرف كما هو أو تغيّر). خادمي فقط: لا حفظ محلي لتصحيح.
 */
export default function Correction() {
  const router = useRouter();
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const { api } = useSession();
  const [ctx, setCtx] = useState<Context | null | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [kind, setKind] = useState<Kind>("method");
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ field: string; code: string } | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/parties/receipts/{receipt_id}/correct", {
          params: { path: { receipt_id: receiptId } },
        });
        if (response.status === 403) {
          setDenied(true);
          setCtx(null);
          return;
        }
        const body = data as unknown as Context | undefined;
        if (!response.ok || !body) {
          setCtx(null);
          return;
        }
        setCtx(body);
        setMethod(body.effective.method === "cash" ? "bank" : "cash");
      } catch {
        setCtx(null);
      }
    })();
  }, [api, receiptId]);

  useEffect(() => {
    if (ctx === null && !denied) router.replace("/parties");
  }, [ctx, denied, router]);

  const eff = ctx?.effective;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!reason.trim()) errors["reason"] = tx(T, "السبب — إلزامي ويظهر في سجل التدقيق");
  if (kind === "method" && method === "bank" && !reference.trim())
    errors["reference"] = tx(T, "مرجع التحويل — إلزامي");
  if (kind === "amount" && (!amount.trim() || amountMinor === null || amountMinor <= 0n))
    errors["amount"] = tx(T, "مبلغ موجب");
  if (kind === "date") {
    if (!DATE.test(date.trim())) errors["date"] = tx(T, "تاريخ الأعمال");
    else if (
      ctx &&
      eff &&
      (date.trim() < ctx.locked_before || eff.business_date < ctx.locked_before)
    )
      errors["date"] = tx(T, "تاريخ داخل فترة مقفلة");
  }
  const invalid = Object.keys(errors).length > 0;
  const lockedPeriod =
    serverError?.code === "period_locked" ||
    (attempted && errors["date"] === tx(T, "تاريخ داخل فترة مقفلة"));

  const state: State = done
    ? "success"
    : denied
      ? "permission_denied"
      : serverError !== null || (attempted && invalid) || eff?.reversed
        ? "validation_error"
        : "ready";

  const save = async () => {
    if (!ctx || busy) return;
    setAttempted(true);
    if (invalid || ctx.effective.reversed) return;
    setBusy(true);
    setServerError(null);
    try {
      const { data, error, response } = await api.POST(
        "/api/parties/receipts/{receipt_id}/correct",
        {
          params: { path: { receipt_id: ctx.receipt.id } },
          body: {
            kind,
            reason: reason.trim(),
            new_method: kind === "method" ? method : "",
            new_reference: kind === "method" && method === "bank" ? reference.trim() : "",
            new_amount_minor: kind === "amount" ? (amountMinor ?? 0n).toString() : "",
            new_business_date: kind === "date" ? date.trim() : null,
          },
        },
      );
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.status === 400) {
        setServerError(firstError(error) ?? { field: "correction", code: "invalid" });
        return;
      }
      const body = data as unknown as Result | undefined;
      if (!response.ok || !body) return;
      await storeParties(await getStorage(), [body.party as never], new Date().toISOString());
      setDone(body);
    } catch {
      /* بلا شبكة: التصحيح خادمي فقط — لا حفظ محلي */
    } finally {
      setBusy(false);
    }
  };

  const rec = ctx?.receipt;
  const kindLabel = rec?.kind === "refund" ? tx(T, "ردّ مبلغ") : tx(T, "سداد");
  const balanceBefore = ctx ? BigInt(ctx.party.balance_minor || "0") : 0n;
  const balanceAfter = done ? BigInt(done.party.balance_minor || "0") : balanceBefore;
  const origDate = eff ? dayMonth(eff.business_date) : null;
  const goParty = (pathname: "/parties/[id]" | "/parties/[id]/statement", id: string) =>
    router.push({ pathname, params: { id } });

  return (
    <Screen screenId={T} state={state} title={tx(T, "تصحيح حركة")}>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الأصل ثابت، والتصحيح مستند مستقل بسبب واضح وهوية منفّذ.")}
      </AppText>

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "التصحيح للمالك")}>
          <AppText variant="secondary">
            {tx(T, "تغيير التاريخ يُعيد ترتيب الدفتر ويمسّ تقارير صدرت.")}
          </AppText>
        </StateView>
      ) : null}

      {rec && eff && origDate ? (
        <StateView state="ready" title={tx(T, "الحركة الأصلية — لن تتغير")}>
          <AppText variant="bodyStrong">
            {kindLabel} <M>{formatMinorShort(eff.amount_minor)}</M> · <M>{origDate.day}</M>{" "}
            {origDate.month}
            {rec.user_name ? <>{` · ${rec.user_name}`}</> : null}
          </AppText>
          <AppText variant="note">
            {eff.method === "cash" ? tx(T, "نقداً") : tx(T, "تحويل بنكي")}
            {eff.reference ? (
              <>
                {" · "}
                <M>{eff.reference}</M>
              </>
            ) : null}
            {rec.reason ? <>{` · ${rec.reason}`}</> : null}
            {" · "}
            <M>{rec.receipt_number}</M>
          </AppText>
        </StateView>
      ) : null}

      {lockedPeriod ? (
        <StateView state="validation_error" title={tx(T, "تاريخ داخل فترة مقفلة")}>
          <AppText variant="secondary">
            {tx(T, "نقل حركة إلى شهر أُقفلت ورديّاته وصُدِّرت تقاريره.")}
          </AppText>
          <AppText variant="note">
            {tx(T, "الفترة مقفلة — الحركة تبقى بتاريخها ويُسجَّل التصحيح بحركة معلَّلة.")}
          </AppText>
        </StateView>
      ) : null}

      {eff?.reversed && !done ? (
        <StateView state="validation_error" title={tx(T, "عكس الحركة بالكامل")}>
          <AppText variant="secondary">
            {tx(T, "الحركة معكوسة بمستند تصحيح سابق — لا تصحيح بعده.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" && done ? (
        <>
          <StateView
            state="success"
            title={
              done.correction.kind === "date" ? tx(T, "صُحِّح التاريخ") : tx(T, "مستند تصحيح جديد")
            }
          >
            <AppText variant="secondary">
              {tx(
                T,
                "التاريخ القديم والجديد وسبب التصحيح ومن نفّذه — الثلاثة في السجل لا التاريخ الجديد وحده.",
              )}
            </AppText>
            <AppText variant="note">
              {balanceAfter === balanceBefore ? (
                tx(T, "رصيد الطرف كما هو")
              ) : (
                <>
                  {tx(T, "رصيد الطرف")} <M>{formatMinorShort(balanceBefore.toString())}</M> →{" "}
                  <M>{formatMinorShort(balanceAfter.toString())}</M>
                </>
              )}
            </AppText>
          </StateView>
          <Stack>
            <Button
              label={tx(T, "كشف الحساب")}
              financial
              onPress={() => goParty("/parties/[id]/statement", done.party.id)}
            />
            <Button
              label={tx(T, "بطاقة الطرف")}
              variant="secondary"
              onPress={() => goParty("/parties/[id]", done.party.id)}
            />
          </Stack>
        </>
      ) : null}

      {ctx && !done && !eff?.reversed ? (
        <>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "نوع التصحيح")}
          </AppText>
          <Segments
            value={kind}
            onChange={(k) => {
              setKind(k);
              setServerError(null);
            }}
            options={[
              ["method", tx(T, "تصحيح وسيلة الدفع")],
              ["reverse", tx(T, "عكس الحركة بالكامل")],
              ["amount", tx(T, "تصحيح المبلغ")],
              ["date", tx(T, "تصحيح تاريخ الأعمال")],
            ]}
          />
          {kind === "method" ? (
            <>
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
                <TextField
                  label={tx(T, "مرجع التحويل — إلزامي")}
                  value={reference}
                  onChangeText={setReference}
                  mono
                  autoCorrect={false}
                  error={attempted ? errors["reference"] : undefined}
                  required
                />
              ) : null}
            </>
          ) : null}
          {kind === "amount" ? (
            <TextField
              label={tx(T, "المبلغ")}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              mono
              error={attempted ? errors["amount"] : undefined}
              required
            />
          ) : null}
          {kind === "date" ? (
            <TextField
              label={tx(T, "تاريخ الأعمال")}
              value={date}
              onChangeText={(v) => {
                setDate(v);
                setServerError(null);
              }}
              keyboardType="numbers-and-punctuation"
              mono
              placeholder="YYYY-MM-DD"
              error={attempted ? errors["date"] : undefined}
              required
            />
          ) : null}
          <TextField
            label={tx(T, "السبب — إلزامي ويظهر في سجل التدقيق")}
            value={reason}
            onChangeText={setReason}
            error={attempted ? errors["reason"] : undefined}
            required
          />
          <StateView state="ready" title={tx(T, "سيُنشأ مستند تصحيح جديد")}>
            <AppText variant="secondary">
              {tx(
                T,
                "مرتبط بالأصل. كلاهما يظهر في كشف الحساب: الأصل بوسم «مصحَّح» والتصحيح بوسم «يصحّح حركة",
              )}{" "}
              <M>{origDate?.day ?? ""}</M> {origDate?.month ?? ""}
              {tx(T, "». الرصيد النهائي واحد.")}
            </AppText>
          </StateView>
          <Stack>
            <Button
              label={tx(T, "إنشاء مستند التصحيح")}
              financial
              onPress={() => void save()}
              loading={busy}
              disabledReason={attempted && invalid ? tx(T, "أكمل الحقول المطلوبة") : undefined}
            />
            <Button
              label={tx(T, "كشف الحساب")}
              variant="quiet"
              onPress={() => goParty("/parties/[id]/statement", ctx.party.id)}
            />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}
