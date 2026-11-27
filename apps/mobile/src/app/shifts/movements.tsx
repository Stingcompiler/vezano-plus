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
  type PinVerifierRow,
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
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TextField,
  ThemedText as Text,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ApproverPin } from "@/components/approver-pin";
import { ApprovalOutcome, useApprovalStatus } from "@/lib/approvals";
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

/** طلب السحب المرسل يبقى معروفاً إن غادر الكاشير الشاشة (0005 §٢٩٣) — المفتاح نفسه في الويب. */
const PENDING_META = "shift.withdrawal_request";
interface PendingWithdrawal {
  readonly request_id: string;
  readonly shift_id: string;
  readonly amount_minor: string;
  readonly reason: string;
}

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
  const [pending, setPending] = useState<PendingWithdrawal | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const decision = useApprovalStatus("withdrawal", pending?.request_id ?? null);
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
      const storage = await getStorage();
      const s = await readOpenShift(storage);
      setShift(s);
      if (s) await reload(s);
      const raw = await storage.read((t) => t.getMeta(PENDING_META));
      const p = raw ? (JSON.parse(raw) as PendingWithdrawal) : null;
      if (s && p && p.shift_id === s.id) {
        setPending(p);
        setRequested(true);
        setKind("withdrawal");
      }
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
    const { data, response } = await api.POST("/api/shifts/{shift_id}/requests", {
      params: { path: { shift_id: shift.id } },
      body: { kind: "withdrawal", amount_minor: minor, reason: reason.trim() },
    });
    const body = data as unknown as { id: string } | undefined;
    if (response.ok && body) {
      const p: PendingWithdrawal = {
        request_id: body.id,
        shift_id: shift.id,
        amount_minor: minor,
        reason: reason.trim(),
      };
      const storage = await getStorage();
      await storage.transaction((t) => t.putMeta(PENDING_META, JSON.stringify(p)));
      setPending(p);
      setRequested(true);
    }
  };

  /** سحب بإذن المالك: برمزه هنا، أو بطلب وافق عليه في «طلبات تنتظرك» (0005 §٢٩٣). */
  const recordWithdrawal = async (
    auth:
      | { readonly via: "pin"; readonly approver: PinVerifierRow }
      | { readonly via: "inbox"; readonly request: PendingWithdrawal; readonly by: string },
  ) => {
    if (busy || !shift || !ctx) return;
    const amountMinor = auth.via === "inbox" ? auth.request.amount_minor : parseMoneyInput(amount);
    if (!amountMinor) return;
    setBusy(true);
    try {
      const storage = await getStorage();
      const { movement } = await saveCashMovement(storage, {
        ...ids.current,
        shift,
        kind: "withdrawal",
        amountMinor,
        reason: auth.via === "inbox" ? auth.request.reason : reason.trim(),
        actorUserId: ctx.userId,
        actorName: ctx.userName,
        authorizedByUserId: auth.via === "pin" ? auth.approver.user_id : auth.by,
        occurredAt: new Date().toISOString(),
        ...(auth.via === "pin"
          ? {
              pinApproval: {
                approverUserId: auth.approver.user_id,
                verifierVersion: auth.approver.version,
              },
            }
          : { approvalRequestId: auth.request.request_id }),
      });
      ids.current = { movementId: newId(), operationId: newId() };
      if (auth.via === "inbox") await storage.transaction((t) => t.putMeta(PENDING_META, ""));
      setPending(null);
      setRequested(false);
      setPinOpen(false);
      setSaved(movement);
      setKind("expense");
      setAmount("");
      setReason("");
      await reload(shift);
      void pushPending({ api, storage, requestId: newId }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
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
      <View style={{ flexDirection: ROW_RTL, gap: SPACE["2"], marginBottom: SPACE["3"] }}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} on={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>

      {denied ? (
        <StateView state="permission_denied" title={tx(T, "السحب للمالك وحده")}>
          <AppText variant="secondary">{tx(T, "الكاشير يودع ولا يسحب")}</AppText>
          {requested ? <ApprovalOutcome item={decision} /> : null}
          {requested && decision?.status !== "rejected" ? null : (
            <Button
              label={`${tx(T, "اطلب من")} ${ctx?.ownerName ?? tx(T, "المالك")}`}
              variant="secondary"
              onPress={() => void requestFromOwner()}
            />
          )}
          {!pinOpen && !requested ? (
            <Button
              label={tx(T, "اعتماد المالك بالرمز")}
              variant="secondary"
              onPress={() => setPinOpen(true)}
            />
          ) : null}
          {pending && decision?.status === "approved" ? (
            <Button
              label={tx(T, "سجّل السحب المعتمد")}
              financial
              loading={busy}
              onPress={() =>
                void recordWithdrawal({
                  via: "inbox",
                  request: pending,
                  by: decision.decided_by_user_id,
                })
              }
            />
          ) : null}
        </StateView>
      ) : null}
      {denied && pinOpen && ctx && shift ? (
        parseMoneyInput(amount) && validate().length === 0 ? (
          <ApproverPin
            ownerOnly
            request={{
              kind: "withdrawal",
              amountMinor: BigInt(parseMoneyInput(amount) ?? "0"),
              branchId: shift.branch_id,
              requesterId: ctx.userId,
            }}
            onApproved={(approver) => recordWithdrawal({ via: "pin", approver })}
          />
        ) : (
          <AppText variant="note" muted>
            {tx(T, "اكتب المبلغ والسبب أولاً.")}
          </AppText>
        )
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
