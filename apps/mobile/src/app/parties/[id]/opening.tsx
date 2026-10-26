import { formatMinorShort } from "@sting/app-core";
import { storeParties } from "@sting/sync-core";
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
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { M, PRow, Segments, Stack } from "@/components/parties/parts";
import { type Card, firstError } from "@/features/parties/lib";
import { parseAmount } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-04";
type State = "ready" | "validation_error" | "permission_denied" | "success";
type Side = "customer_due" | "supplier_owed";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PTY-04 — رصيد افتتاحي (خطة الجوال M3). جهة الدين والمبلغ والسبب ومعاينة الأثر؛ بند واحد بلا فواتير
 * خلفه فلا «عمر دين» منه؛ للمالك وحده، مرة واحدة لكل صفة وقبل أول حركة؛ بلا تاريخ = «قبل النظام».
 */
export default function Opening() {
  const router = useRouter();
  const { id: partyId } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [side, setSide] = useState<Side>("customer_due");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ amount: string; side: Side; date: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/parties/{party_id}", {
          params: { path: { party_id: partyId } },
        });
        const body = data as unknown as Card | undefined;
        if (!response.ok || !body) {
          setCard(null);
          return;
        }
        setCard(body);
        if (!body.is_customer && body.is_supplier) setSide("supplier_owed");
        if (!body.can_open_balance) setDenied(true);
      } catch {
        setCard(null);
      }
    })();
  }, [api, partyId]);

  useEffect(() => {
    if (card === null) router.replace("/parties");
  }, [card, router]);

  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n)
    errors["amount"] = tx(T, "مبلغ موجب");
  if (!reason.trim()) errors["reason"] = tx(T, "السبب — إلزامي");
  if (date.trim() && !DATE.test(date.trim()))
    errors["date"] = tx(T, "اختياري — بلا تاريخ يظهر «قبل النظام»");
  const alreadyRecorded = card?.opening_balances.some((o) => o.side === side) ?? false;
  const hasMovements = card?.has_movements ?? false;
  const blocked = hasMovements || alreadyRecorded || serverError !== null;
  const invalid = Object.keys(errors).length > 0;

  const state: State = saved
    ? "success"
    : denied
      ? "permission_denied"
      : blocked || (attempted && invalid)
        ? "validation_error"
        : "ready";

  const current = card
    ? BigInt((side === "customer_due" ? card.balance_minor : card.supplier_owed_minor) || "0")
    : 0n;
  const adding = amountMinor && amountMinor > 0n ? amountMinor : 0n;
  const after = current + adding;

  const save = async () => {
    if (!card || busy) return;
    setAttempted(true);
    if (invalid || blocked) return;
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/parties/{party_id}/opening-balance", {
        params: { path: { party_id: card.id } },
        body: {
          side,
          amount_minor: (amountMinor ?? 0n).toString(),
          reason: reason.trim(),
          reference: reference.trim(),
          business_date: date.trim() || null,
        },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.status === 400) {
        setServerError(firstError(error)?.code ?? "invalid");
        return;
      }
      const body = data as unknown as { party: Card } | undefined;
      if (!response.ok || !body) return;
      await storeParties(await getStorage(), [body.party as never], new Date().toISOString());
      setSaved({ amount: (amountMinor ?? 0n).toString(), side, date: date.trim() });
    } catch {
      /* بلا شبكة: الافتتاحي خادمي فقط — لا حفظ محلي */
    } finally {
      setBusy(false);
    }
  };

  const sideWord = (s: Side) => (s === "customer_due" ? tx(T, "عليها لنا") : tx(T, "لها علينا"));
  const go = (pathname: "/parties/[id]" | "/parties/[id]/statement") =>
    router.push({ pathname, params: { id: partyId } });

  return (
    <Screen
      screenId={T}
      state={state}
      title={card ? `${tx(T, "رصيد افتتاحي")} — ${card.name}` : tx(T, "رصيد افتتاحي")}
    >
      {card ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "لتسجيل دين قائم قبل استخدام النظام")}
          </AppText>
          {state === "permission_denied" ? (
            <StateView state="permission_denied" title={tx(T, "الافتتاحي للمالك")}>
              <AppText variant="secondary">
                {tx(T, "يُنشئ ذمّةً بلا فاتورة — إقرارٌ مالي محض.")}
              </AppText>
            </StateView>
          ) : null}

          {state === "success" && saved ? (
            <>
              <StateView state="success" title={tx(T, "سُجّل الافتتاحي")}>
                <AppText variant="secondary">
                  {tx(T, "المبلغ وجهته (عليه أو له) وتاريخه ومستنده المرجعي إن كُتب.")}
                </AppText>
                <AppText variant="note">
                  {tx(T, "يظهر أول الكشف")}{" "}
                  {tx(T, "· سطراً مسمّى «رصيد افتتاحي» لا مندساً بين الفواتير.")}
                </AppText>
                <AppText variant="note">
                  {tx(T, "لا أعمار منه")}{" "}
                  {tx(T, "· الافتتاحي بلا فواتير يُسنَد إليها، فلا يُحتسب في أعمار الدين.")}
                </AppText>
              </StateView>
              <GroupedList>
                <PRow title={tx(T, "المبلغ")} trailing={<M>{formatMinorShort(saved.amount)}</M>} />
                <PRow
                  title={tx(T, "جهة الدين")}
                  trailing={<AppText>{sideWord(saved.side)}</AppText>}
                />
                <PRow
                  title={tx(T, "التاريخ")}
                  trailing={
                    saved.date ? <M>{saved.date}</M> : <AppText>{tx(T, "قبل النظام")}</AppText>
                  }
                  last
                />
              </GroupedList>
              <Stack>
                <Button label={tx(T, "بطاقة الطرف")} onPress={() => go("/parties/[id]")} />
                <Button
                  label={tx(T, "كشف الحساب")}
                  variant="secondary"
                  onPress={() => go("/parties/[id]/statement")}
                />
              </Stack>
            </>
          ) : null}

          {!saved && blocked ? (
            <StateView state="validation_error" title={tx(T, "رصيد على طرف له حركات")}>
              <AppText variant="secondary">
                {tx(T, "الطرف عليه فواتير مسجّلة، وإدخال رصيد افتتاحي الآن يُحرّف تاريخه.")}
              </AppText>
              <AppText variant="note">
                {tx(T, "الافتتاحي مرة واحدة")}{" "}
                {tx(T, "· وقبل أول حركة. بعدها التصحيح بحركة معلَّلة لا برصيد افتتاحي ثانٍ.")}
              </AppText>
              <AppText variant="note">
                {tx(T, "المخرج")}{" "}
                {tx(
                  T,
                  "· حركة تسوية بسبب مكتوب، أو تصحيح تاريخ الأعمال إن كان الخطأ في التاريخ لا المبلغ.",
                )}
              </AppText>
            </StateView>
          ) : null}

          {!saved ? (
            <>
              <AppText variant="section" muted style={{ marginBottom: SPACE["2"] }}>
                {tx(T, "جهة الدين")}
              </AppText>
              <Segments
                value={side}
                onChange={(v) => {
                  setSide(v);
                  setServerError(null);
                }}
                options={[
                  ...(card.is_customer ? [["customer_due", tx(T, "عليها لنا")] as const] : []),
                  ...(card.is_supplier ? [["supplier_owed", tx(T, "لها علينا")] as const] : []),
                ]}
              />
              <TextField
                label={tx(T, "المبلغ")}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                mono
                error={attempted ? errors["amount"] : undefined}
                required
              />
              <GroupedList>
                <ListRow
                  title={tx(T, "العملة")}
                  subtitle={tx(T, "الجنيه السوداني — عملة المنشأة، غير قابلة للتبديل")}
                  last
                />
              </GroupedList>
              <TextField
                label={tx(T, "السبب — إلزامي")}
                value={reason}
                onChangeText={setReason}
                error={attempted ? errors["reason"] : undefined}
                required
              />
              <TextField
                label={tx(T, "مستند مرجعي")}
                value={reference}
                onChangeText={setReference}
                hint={tx(T, "اختياري")}
              />
              <TextField
                label={tx(T, "تاريخ الدين")}
                value={date}
                onChangeText={setDate}
                keyboardType="numbers-and-punctuation"
                mono
                placeholder="YYYY-MM-DD"
                hint={tx(T, "اختياري — بلا تاريخ يظهر «قبل النظام»")}
                error={attempted ? errors["date"] : undefined}
              />

              <GroupedList title={tx(T, "معاينة الأثر قبل الحفظ")}>
                <PRow
                  title={side === "customer_due" ? tx(T, "رصيدها الآن") : tx(T, "لها علينا الآن")}
                  trailing={<M>{formatMinorShort(current.toString())}</M>}
                />
                <PRow
                  title={tx(T, "يضاف افتتاحياً")}
                  trailing={<M>{formatMinorShort(adding.toString())}</M>}
                />
                <PRow
                  title={tx(T, "بعد الحفظ")}
                  trailing={<M strong>{formatMinorShort(after.toString())}</M>}
                  last
                />
              </GroupedList>
              <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
                {tx(
                  T,
                  "الرصيد الافتتاحي بند واحد بلا فواتير خلفه. لن يظهر له «عمر دين» في التقارير، لأن النظام لا يخترع تواريخ فواتير غير موجودة.",
                )}
              </AppText>
              <Stack>
                <Button
                  label={tx(T, "حفظ الرصيد الافتتاحي")}
                  financial
                  onPress={() => void save()}
                  loading={busy}
                  disabledReason={
                    denied
                      ? tx(T, "الافتتاحي للمالك")
                      : hasMovements
                        ? tx(T, "الطرف عليه فواتير مسجّلة")
                        : alreadyRecorded
                          ? tx(T, "الافتتاحي مرة واحدة")
                          : undefined
                  }
                />
                <Button
                  label={tx(T, "بطاقة الطرف")}
                  variant="quiet"
                  onPress={() => go("/parties/[id]")}
                />
              </Stack>
              <AppText variant="note" muted>
                {tx(T, "جهة الدين:")} {sideWord(side)}
              </AppText>
            </>
          ) : null}
        </>
      ) : (
        <StateView state="loading" title={tx("PTY-03", "جلب الأطراف")} />
      )}
    </Screen>
  );
}
