import { formatMinorShort, hhmm, parseMoneyInput, pushPending } from "@sting/app-core";
import {
  type CashMovementKind,
  type LocalCashMovement,
  type LocalShift,
  readMovements,
  readOpenShift,
  readReceiptCashRows,
  readReturnCashRows,
  readSaleCashRows,
  readShiftCash,
  saveCashMovement,
  type ShiftCash,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { newId } from "@/lib/crypto";
import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SHIFT-03";
const KINDS: { kind: CashMovementKind; label: string }[] = [
  { kind: "expense", label: tx(T, "مصروف") },
  { kind: "deposit", label: tx(T, "إيداع") },
  { kind: "withdrawal", label: tx(T, "سحب") },
];

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * SHIFT-03 — حركة صندوق وتسوية (خطة الجوال M2). نوع الحركة (مصروف، إيداع، سحب) والمبلغ والسبب. الحركة تُنسب
 * لمن أذن بها وبوقتها، وتظهر في تسوية الوردية بنداً مستقلاً عن البيع. السحب للمالك وحده («الكاشير يودع ولا
 * يسحب»)؛ الصندوق لا يصير سالباً بحركة يدوية؛ السبب لا يعيد اسم النوع. العكس بحركة مضادّة لا حذف ولا تعديل.
 */
export default function Movements() {
  const router = useRouter();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [cash, setCash] = useState<ShiftCash | null>(null);
  const [movements, setMovements] = useState<LocalCashMovement[]>([]);
  const [kind, setKind] = useState<CashMovementKind>("expense");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ field: "amount" | "reason"; text: string }[]>([]);
  const [saved, setSaved] = useState<LocalCashMovement | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const ids = useRef({ movementId: newId(), operationId: newId() });

  const reload = useCallback(async (s: LocalShift) => {
    const storage = await getStorage();
    setCash(
      await readShiftCash(storage, s, [
        ...(await readSaleCashRows(storage, s.id)),
        ...(await readReturnCashRows(storage, s.id)),
        ...(await readReceiptCashRows(storage, s.id)),
      ]),
    );
    setMovements(await readMovements(storage, s.id));
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await readOpenShift(await getStorage());
      setShift(s);
      if (s) await reload(s);
    })();
  }, [reload]);
  useEffect(() => {
    if (shift === null) router.replace("/shifts/open");
  }, [router, shift]);

  const canWithdraw = ctx?.canWithdraw ?? false;
  const balance = cash?.expectedCashMinor ?? 0n;

  const validate = () => {
    const errs: { field: "amount" | "reason"; text: string }[] = [];
    const minor = parseMoneyInput(amount);
    if (!amount.trim() || minor === null || BigInt(minor) <= 0n) {
      errs.push({ field: "amount", text: tx(T, "اكتب مبلغاً موجباً بأرقام لاتينية.") });
    } else if (kind !== "deposit" && BigInt(minor) > balance) {
      errs.push({
        field: "amount",
        text: `${tx(T, "السحب يتجاوز الرصيد بـ")}${formatMinorShort((BigInt(minor) - balance).toString())}`,
      });
    }
    const words = reason.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      const said = reason.trim() || KINDS.find((k) => k.kind === kind)?.label || "";
      errs.push({
        field: "reason",
        text: `«${said}${tx(T, "» يعيد اسم النوع ولا يقول شيئاً. من يقرأ التقرير بعد شهر يحتاج: على ماذا، ولمن، وبأيّ إيصال.")}`,
      });
    }
    return errs;
  };

  const record = async () => {
    if (busy || !shift || !ctx) return;
    const errs = validate();
    if (errs.length) return setErrors(errs);
    setBusy(true);
    setErrors([]);
    try {
      const storage = await getStorage();
      const { movement } = await saveCashMovement(storage, {
        ...ids.current,
        shift,
        kind,
        amountMinor: parseMoneyInput(amount) ?? "0",
        reason: reason.trim(),
        actorUserId: ctx.userId,
        actorName: ctx.userName,
        occurredAt: new Date().toISOString(),
      });
      ids.current = { movementId: newId(), operationId: newId() };
      setSaved(movement);
      setAmount("");
      setReason("");
      await reload(shift);
      void pushPending({ api, storage, requestId: newId }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const requestFromOwner = async () => {
    const minor = parseMoneyInput(amount);
    if (!shift || !minor || !reason.trim()) return setErrors(validate());
    const { response } = await api.POST("/api/shifts/{shift_id}/requests", {
      params: { path: { shift_id: shift.id } },
      body: { kind: "withdrawal", amount_minor: minor, reason: reason.trim() },
    });
    if (response.ok) setRequested(true);
  };

  const denied = kind === "withdrawal" && !canWithdraw;
  const state = saved
    ? "success"
    : errors.length
      ? "validation_error"
      : denied
        ? "permission_denied"
        : "ready";
  const err = (f: "amount" | "reason") => errors.find((e) => e.field === f)?.text;

  return (
    <Screen screenId={T} state={state} title={tx(T, "حركة صندوق")}>
      <GroupedList>
        <ListRow
          title={tx(T, "الرصيد الحالي")}
          trailing={<M>{formatMinorShort(balance.toString())}</M>}
          last
        />
      </GroupedList>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "نوع الحركة")}
      </AppText>
      <View style={{ flexDirection: "row-reverse", gap: SPACE["2"], marginBottom: SPACE["3"] }}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} on={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>

      {denied ? (
        <StateView state="permission_denied" title={tx(T, "السحب للمالك وحده")}>
          <AppText variant="secondary">{tx(T, "الكاشير يودع ولا يسحب")}</AppText>
          {requested ? (
            <AppText variant="note">{tx(T, "أُرسل الطلب إلى")}</AppText>
          ) : (
            <Button
              label={`${tx(T, "اطلب من")} ${ctx?.ownerName ?? tx(T, "المالك")}`}
              variant="secondary"
              onPress={() => void requestFromOwner()}
            />
          )}
        </StateView>
      ) : null}

      <TextField
        label={tx(T, "المبلغ")}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        mono
        error={err("amount")}
        required
      />
      <TextField
        label={tx(T, "السبب")}
        value={reason}
        onChangeText={setReason}
        error={err("reason")}
        hint={tx(T, "إلزامي")}
        required
      />
      <Button
        label={tx(T, "سجّل الحركة")}
        financial
        loading={busy}
        disabledReason={denied ? tx(T, "السحب للمالك وحده") : undefined}
        onPress={() => void record()}
      />
      {saved ? (
        <AppText variant="note" muted style={{ marginTop: SPACE["2"] }}>
          {tx(T, "سُجّلت الحركة")} <M>{saved.number}</M>
        </AppText>
      ) : null}

      <GroupedList title={tx(T, "حركات الوردية")}>
        {movements.length === 0 ? (
          <ListRow title={tx(T, "البيع لا يظهر هنا — له سجلّه")} last />
        ) : (
          movements.map((m, i) => (
            <ListRow
              key={m.id}
              title={`${m.number} · ${m.reason}`}
              subtitle={`${m.actor_name} · ${hhmm(m.occurred_at)}${m.reverses_movement_id ? ` ${tx(T, "— معكوس")}` : ""}`}
              trailing={<M>{formatMinorShort(m.signed_amount_minor)}</M>}
              last={i === movements.length - 1}
            />
          ))
        )}
      </GroupedList>
    </Screen>
  );
}
