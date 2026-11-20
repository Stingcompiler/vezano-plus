import { formatMinorShort } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { M, PRow, Stack } from "@/components/parties/parts";
import { parseAmount } from "@/lib/pos";
import { useSession } from "@/lib/session";

const T = "PTY-06";
type State = "ready" | "validation_error" | "saving" | "success" | "permission_denied";

interface Card {
  readonly name: string;
  readonly is_customer: boolean;
  readonly is_supplier: boolean;
  readonly balance_minor: string;
  readonly supplier_owed_minor: string;
}

/**
 * «مقاصة بين الرصيدين» (مراجعة الأطراف 2026-11-20، المرحلة ٣ ب — 0005 §٢٨٥): حركتان متقابلتان
 * بالمبلغ نفسه للطرف ذي الصفتين، للمالك، بسبب، وبما لا يتجاوز أصغر الرصيدين. أونلاين.
 */
export default function Offset() {
  const router = useRouter();
  const { id: partyId } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [denied, setDenied] = useState(false);
  const [serverError, setServerError] = useState("");
  const [numbers, setNumbers] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/parties/{party_id}", {
          params: { path: { party_id: partyId } },
        });
        const body = data as unknown as Card | undefined;
        setCard(response.ok && body && body.is_customer && body.is_supplier ? body : null);
      } catch {
        setCard(null);
      }
    })();
  }, [api, partyId]);

  useEffect(() => {
    if (card === null) router.replace({ pathname: "/parties/[id]", params: { id: partyId } });
  }, [card, partyId, router]);

  const due = card ? BigInt(card.balance_minor || "0") : 0n;
  const owed = card ? BigInt(card.supplier_owed_minor || "0") : 0n;
  const max = due < owed ? due : owed;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n)
    errors["amount"] = tx(T, "مبلغ موجب");
  else if (amountMinor > max) errors["amount"] = tx(T, "أكبر من أصغر الرصيدين");
  if (!reason.trim()) errors["reason"] = tx(T, "يُطلب سبب");
  const invalid = Object.keys(errors).length > 0;
  const take = amountMinor && amountMinor > 0n && amountMinor <= max ? amountMinor : 0n;

  const state: State = denied
    ? "permission_denied"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? "success"
        : (attempted && invalid) || serverError
          ? "validation_error"
          : "ready";

  const commit = async () => {
    if (!card || phase !== "idle") return;
    setAttempted(true);
    setServerError("");
    if (invalid) return;
    setPhase("saving");
    try {
      const { data, error, response } = await api.POST("/api/parties/{party_id}/offset", {
        params: { path: { party_id: partyId } },
        body: { amount_minor: (amountMinor ?? 0n).toString(), reason },
      });
      if (response.status === 403) {
        setDenied(true);
        setPhase("idle");
        return;
      }
      if (!response.ok) {
        const code =
          (error as { errors?: { code?: string }[] } | undefined)?.errors?.[0]?.code ?? "";
        setServerError(
          code === "exceeds" ? tx(T, "أكبر من أصغر الرصيدين") : tx(T, "تعذّر التسجيل"),
        );
        setPhase("idle");
        return;
      }
      setNumbers((data as unknown as { numbers: string[] } | undefined)?.numbers ?? []);
      setPhase("saved");
    } catch {
      setServerError(tx(T, "تعذّر التسجيل"));
      setPhase("idle");
    }
  };

  return (
    <Screen screenId={T} state={state} title={tx(T, "مقاصة بين الرصيدين")}>
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "المقاصة للمالك")}>
          <AppText variant="secondary">
            {tx(T, "قرار على رصيدين معاً، فلا يُتّخذ إلا بصلاحية المالك.")}
          </AppText>
        </StateView>
      ) : null}
      {card ? (
        <>
          <GroupedList>
            <PRow
              title={tx(T, "بصفته عميلاً — عليه لنا")}
              trailing={<M strong>{formatMinorShort(due.toString())}</M>}
            />
            <PRow
              title={tx(T, "بصفته مورداً — له علينا")}
              trailing={<M strong>{formatMinorShort(owed.toString())}</M>}
            />
            <PRow
              title={tx(T, "الحدّ الأقصى للمقاصة")}
              trailing={<M strong>{formatMinorShort(max.toString())}</M>}
              last
            />
          </GroupedList>
          {phase !== "saved" ? (
            <>
              <TextField
                label={tx(T, "مبلغ المقاصة")}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                mono
                error={attempted ? errors["amount"] : undefined}
                required
              />
              <TextField
                label={tx(T, "السبب")}
                value={reason}
                onChangeText={setReason}
                error={attempted ? errors["reason"] : undefined}
                required
              />
              <GroupedList>
                <PRow
                  title={tx(T, "عليه بعدها")}
                  trailing={<M>{formatMinorShort((due - take).toString())}</M>}
                />
                <PRow
                  title={tx(T, "له علينا بعدها")}
                  trailing={<M>{formatMinorShort((owed - take).toString())}</M>}
                  last
                />
              </GroupedList>
              {serverError ? (
                <StateView state="validation_error" title={serverError}>
                  <AppText variant="secondary">{tx(T, "لم تُسجَّل أي حركة.")}</AppText>
                </StateView>
              ) : null}
              <Stack>
                <Button
                  label={tx(T, "سجّل المقاصة")}
                  financial
                  loading={phase === "saving"}
                  onPress={() => void commit()}
                />
              </Stack>
            </>
          ) : (
            <StateView state="success" title={tx(T, "سُجّلت المقاصة")}>
              <AppText variant="secondary">
                {numbers.map((n, i) => (
                  <AppText key={n}>
                    {i > 0 ? " · " : ""}
                    <M>{n}</M>
                  </AppText>
                ))}
              </AppText>
            </StateView>
          )}
        </>
      ) : null}
    </Screen>
  );
}
