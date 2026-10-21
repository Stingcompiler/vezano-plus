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
import { useSale } from "@/lib/pos";
import { getStorage } from "@/lib/storage";

void bankReferenceUsed;
const T = "POS-06";

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoSemiBold, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * POS-06 — الدفع الآجل (خطة الجوال M2). الرصيد قبل الالتزام مركّباً «خادمي X + معلّق هذا الجهاز Y = Z»،
 * ثم مبلغ الفاتورة ورصيده بعدها. حدّ الائتمان أداة انتباه لا قفل: التجاوز تنبيهٌ بالمبلغ الزائد وسببٌ، ثم
 * يُكمَل البيع بحدث تجاوز يُراجع عند الاتصال. العميل المسمّى شرط الأثر الآجل (اختياره في POS-04).
 */
export default function PayCredit() {
  const sale = useSale();
  const { draft, party, pendingCredit, totals, phase, ctx, push } = sale;
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const overrideIds = useRef({ operationId: "", overrideId: "" });

  const total = totals.totalMinor;
  const serverBalance = BigInt(party?.balance_minor ?? "0");
  const before = serverBalance + pendingCredit.pendingMinor;
  const after = before + total;
  const limit = BigInt(party?.credit_limit_minor ?? "0");
  const overLimit = limit > 0n && after > limit;
  const remaining = limit > 0n ? limit - before : null;
  void ctx;

  const state =
    phase === "saved"
      ? "saved_local"
      : attempted && overLimit && !reason.trim()
        ? "validation_error"
        : "ready";

  const commit = async () => {
    if (!draft || !party) return;
    setAttempted(true);
    if (overLimit && !reason.trim()) return;
    const saved = await sale.save(draft.lines, [
      { method: "credit", amountMinor: total.toString() },
    ]);
    if (!saved) return;
    if (overLimit) {
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
      <Screen screenId={T} state={state} title={tx(T, "الدفع الآجل")}>
        <SaleDone sale={sale.sale} push={push} />
      </Screen>
    );

  return (
    <Screen screenId={T} state={state} title={tx(T, "الدفع الآجل")}>
      <PayMethods current="credit" />
      {!party && draft ? (
        <StateView state="permission_denied" title={tx(T, "آجلاً على")}>
          <AppText variant="secondary">{tx(T, "عميل مسمّى — شرط الأثر الآجل")}</AppText>
          <Button
            label={tx(T, "اختيار العميل")}
            onPress={() => sale.router.push("/pos/customer")}
          />
        </StateView>
      ) : null}

      {party ? (
        <>
          <AppText variant="title" style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "آجل على")} {party.name}
          </AppText>
          <GroupedList>
            <ListRow
              title={tx(T, "عليه قبل هذا البيع")}
              trailing={<M>{formatMinorShort(before.toString())}</M>}
            />
            <ListRow
              title={tx(T, "يضاف الآن")}
              trailing={<M>{formatMinorShort(total.toString())}</M>}
            />
            <ListRow
              title={tx(T, "عليه بعد الحفظ")}
              trailing={<M>{formatMinorShort(after.toString())}</M>}
              last
            />
          </GroupedList>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "الرصيد مركّب: خادمي")} <M>{formatMinorShort(serverBalance.toString())}</M>{" "}
            {tx(T, "+ معلّق هذا الجهاز")}{" "}
            <M>{formatMinorShort(pendingCredit.pendingMinor.toString())}</M> ={" "}
            <M>{formatMinorShort(before.toString())}</M>
            {tx(T, "، وبعد البيع")} <M>{formatMinorShort(after.toString())}</M>
          </AppText>
          <GroupedList>
            <ListRow
              title={tx(T, "حد ائتمان مرن")}
              trailing={
                limit > 0n ? (
                  <AppText>
                    <M>{formatMinorShort(limit.toString())}</M> {tx(T, "· متبقٍ")}{" "}
                    <M>{formatMinorShort((remaining ?? 0n).toString())}</M>
                  </AppText>
                ) : (
                  <AppText>{tx(T, "غير محدد")}</AppText>
                )
              }
              last
            />
          </GroupedList>

          {overLimit ? (
            <StateView state="validation_error" title={tx(T, "تجاوز حدّ الائتمان")}>
              <AppText variant="secondary">{tx(T, "الرصيد بعد البيع يتجاوز حدّ الطرف.")}</AppText>
              <AppText variant="secondary">
                {tx(T, "حدّه")} <M>{formatMinorShort(limit.toString())}</M>{" "}
                {tx(T, "— هذا البيع يرفعه إلى")} <M>{formatMinorShort(after.toString())}</M>
              </AppText>
              <TextField
                label={tx(T, "السبب")}
                value={reason}
                onChangeText={setReason}
                error={attempted && !reason.trim() ? tx(T, "يُطلب سبب") : undefined}
                required
              />
              <Button
                label={tx(T, "تحويل الفارق نقداً في دفع مختلط")}
                variant="secondary"
                onPress={() => sale.router.push("/pos/pay-mixed")}
              />
            </StateView>
          ) : null}

          <Button
            label={`${tx(T, "حفظ البيع الآجل")} · ${formatMinorShort(total.toString())}`}
            financial
            loading={phase === "saving"}
            onPress={() => void commit()}
          />
        </>
      ) : null}
    </Screen>
  );
}
