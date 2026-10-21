import { formatMinorShort } from "@sting/app-core";
import { bankReferenceUsed, recordCreditOverride } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRef, useState } from "react";
import { Text } from "react-native";

import { PayMethods, SaleDone } from "@/components/sale-parts";
import { newId } from "@/lib/crypto";
import { parseAmount, useSale } from "@/lib/pos";
import { getStorage } from "@/lib/storage";

const T = "POS-07";

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoSemiBold, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * POS-07 — الدفع المختلط والتحويل (خطة الجوال M2). ثلاث وجهات: نقد وتحويل بنكي وآجل، يجب أن تساوي الإجمالي
 * تماماً — الحفظ معطّل بسببه حتى يتساوى المجموع. الأجزاء الثلاثة تُحفظ معاً في قيد واحد ذرّي. النقد وحده يدخل
 * الصندوق، والآجل ذمّة على العميل المسمّى، والتحويل يُقيَّد «مسجَّل — غير مطابق» ومرجعه لا يُستهلك مرتين.
 */
export default function PayMixed() {
  const sale = useSale();
  const { draft, party, pendingCredit, totals, phase, push } = sale;
  const [cash, setCash] = useState("");
  const [credit, setCredit] = useState("");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [refUsed, setRefUsed] = useState(false);
  const overrideIds = useRef({ operationId: "", overrideId: "" });

  const total = totals.totalMinor;
  const cashMinor = cash.trim() ? parseAmount(cash) : 0n;
  const creditMinor = credit.trim() ? parseAmount(credit) : 0n;
  const bankMinor = bank.trim() ? parseAmount(bank) : 0n;
  const parsable = cashMinor !== null && creditMinor !== null && bankMinor !== null;
  const sum = parsable ? cashMinor + creditMinor + bankMinor : null;
  const diff = sum === null ? null : total - sum;
  const matched = diff === 0n;
  const creditNeedsParty = (creditMinor ?? 0n) > 0n && !party;
  const bankNeedsRef = (bankMinor ?? 0n) > 0n && !reference.trim();
  const before = BigInt(party?.balance_minor ?? "0") + pendingCredit.pendingMinor;
  const after = before + (creditMinor ?? 0n);
  const limit = BigInt(party?.credit_limit_minor ?? "0");
  const overLimit = limit > 0n && (creditMinor ?? 0n) > 0n && after > limit;
  const blocked = !parsable || !matched || creditNeedsParty || bankNeedsRef || refUsed;
  const touched = Boolean(cash.trim() || credit.trim() || bank.trim());

  const state =
    phase === "saving"
      ? "saving"
      : phase === "saved"
        ? push === "failed"
          ? "server_error"
          : push === "synced"
            ? "success"
            : "saved_local"
        : touched && blocked
          ? "validation_error"
          : "ready";

  const commit = async () => {
    if (!draft || blocked || phase !== "idle") return;
    if ((bankMinor ?? 0n) > 0n && (await bankReferenceUsed(await getStorage(), reference))) {
      setRefUsed(true);
      return;
    }
    if (overLimit && !reason.trim()) return;
    const payments = [
      ...((cashMinor ?? 0n) > 0n
        ? [{ method: "cash" as const, amountMinor: (cashMinor ?? 0n).toString() }]
        : []),
      ...((bankMinor ?? 0n) > 0n
        ? [
            {
              method: "bank" as const,
              amountMinor: (bankMinor ?? 0n).toString(),
              reference: reference.trim(),
            },
          ]
        : []),
      ...((creditMinor ?? 0n) > 0n
        ? [{ method: "credit" as const, amountMinor: (creditMinor ?? 0n).toString() }]
        : []),
    ];
    const saved = await sale.save(draft.lines, payments);
    if (!saved) return;
    if (overLimit && party) {
      if (!overrideIds.current.operationId)
        overrideIds.current = { operationId: newId(), overrideId: newId() };
      await recordCreditOverride(await getStorage(), {
        ...overrideIds.current,
        saleId: saved.id,
        saleOperationId: saved.operation_id,
        partyId: party.id,
        branchId: saved.branch_id,
        creditLimitMinor: limit.toString(),
        balanceAfterMinor: after.toString(),
        reason,
        occurredAt: new Date().toISOString(),
      });
    }
    await sale.pushAfterSave();
  };

  if (phase === "saved" && sale.sale)
    return (
      <Screen screenId={T} state={state} title={tx(T, "الدفع المختلط والتحويل")}>
        <SaleDone sale={sale.sale} push={push} />
      </Screen>
    );

  const why = !parsable
    ? tx(T, "الأجزاء لا تساوي الإجمالي")
    : !matched
      ? tx(T, "الحفظ معطّل حتى يساوي مجموع التسوية الإجمالي")
      : creditNeedsParty
        ? tx(T, "عميل مسمّى — شرط الأثر الآجل")
        : bankNeedsRef
          ? tx(T, "مرجع")
          : refUsed
            ? tx(T, "مرجع تحويل لا يُستهلك مرتين")
            : undefined;

  return (
    <Screen screenId={T} state={state} title={tx(T, "الدفع المختلط والتحويل")}>
      <PayMethods current="mixed" />
      <GroupedList>
        <ListRow
          title={tx(T, "الإجمالي")}
          trailing={<M>{formatMinorShort(total.toString())}</M>}
          last
        />
      </GroupedList>

      <TextField
        label={tx(T, "نقداً")}
        hint={tx(T, "يدخل صندوق الوردية المفتوحة")}
        value={cash}
        onChangeText={setCash}
        keyboardType="decimal-pad"
        mono
      />
      <TextField
        label={tx(T, "تحويل بنكي")}
        hint={tx(T, "يُقيَّد «مسجَّل — غير مطابق» حتى يُرى في الحساب البنكي")}
        value={bank}
        onChangeText={(v) => {
          setBank(v);
          setRefUsed(false);
        }}
        keyboardType="decimal-pad"
        mono
      />
      {(bankMinor ?? 0n) > 0n ? (
        <TextField
          label={tx(T, "مرجع")}
          hint={tx(T, "مرجع تحويل لا يُستهلك مرتين")}
          value={reference}
          onChangeText={(v) => {
            setReference(v);
            setRefUsed(false);
          }}
          error={refUsed ? tx(T, "مرجع تحويل لا يُستهلك مرتين") : undefined}
          mono
        />
      ) : null}
      <TextField
        label={tx(T, "آجل")}
        hint={party ? `${tx(T, "الآجل على")} ${party.name}` : tx(T, "عميل مسمّى — شرط الأثر الآجل")}
        value={credit}
        onChangeText={setCredit}
        keyboardType="decimal-pad"
        mono
      />
      {creditNeedsParty ? (
        <Button
          label={tx("POS-06", "اختيار العميل")}
          variant="secondary"
          onPress={() => sale.router.push("/pos/customer")}
        />
      ) : null}

      {touched && diff !== null && diff !== 0n ? (
        <StateView state="validation_error" title={tx(T, "الأجزاء لا تساوي الإجمالي")}>
          <AppText variant="secondary">
            {diff > 0n ? tx(T, "· ناقص") : tx(T, "· زائد")}{" "}
            <M>{formatMinorShort((diff < 0n ? -diff : diff).toString())}</M>
          </AppText>
        </StateView>
      ) : null}

      {overLimit ? (
        <StateView state="validation_error" title={tx(T, "تجاوز حدّ الائتمان: حدّه")}>
          <M>{formatMinorShort(limit.toString())}</M>
          <TextField label={tx(T, "السبب")} value={reason} onChangeText={setReason} required />
        </StateView>
      ) : null}

      <AppText variant="note" muted style={{ marginVertical: SPACE["2"] }}>
        {tx(T, "الأجزاء الثلاثة تُحفظ معاً أو لا تُحفظ.")}
      </AppText>
      <Button
        label={`${tx(T, "حفظ البيع —")} ${formatMinorShort(total.toString())} ${tx(T, "ج.س")}`}
        financial
        loading={phase === "saving"}
        disabledReason={why}
        onPress={() => void commit()}
      />
    </Screen>
  );
}
