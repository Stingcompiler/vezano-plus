import { formatMinorShort } from "@sting/app-core";
import {
  type CartDiscount,
  type CartDraft,
  cartTotals,
  checkDiscount,
  type DiscountCheck,
  type PinVerifierRow,
  readCartDraft,
  requestDiscountOverride,
  writeCartDraft,
} from "@sting/sync-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  Keypad,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TextField,
  ThemedText as Text,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ApproverPin } from "@/components/approver-pin";
import { ApprovalOutcome, useApprovalStatus } from "@/lib/approvals";
import { newId } from "@/lib/crypto";
import { parseAmount, useShiftContext } from "@/lib/pos";
import { getStorage } from "@/lib/storage";

const T = "POS-03";
/** طلب الاعتماد المرسل يبقى معروفاً إن غادر الكاشير الشاشة (0005 §٢٩٣) — المفتاح نفسه في الويب. */
const PENDING_META = "pos.discount_request";
interface PendingRequest {
  readonly request_id: string;
  readonly discount: CartDiscount;
}
const DEFAULT_CAPS = { per_op_minor: "0", daily_minor: "0", percent: 0, used_today_minor: "0" };

/**
 * POS-03 — خصم وتجاوز سعر (خطة الجوال M2). مبلغ أو نسبة بلوحة أرقام، والسبب إلزامي، وسقوف الدور معلنة.
 * «الرفض الصامت يدفع إلى الحيَل»: التجاوز يقول أي سقف وكم، وطلب اعتماد مدير الفرع حدث يُنسب للكاشير
 * ويُراجع عند الاتصال ولا يحجب البيع.
 */
export default function Discount() {
  const router = useRouter();
  const ctx = useShiftContext();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [mode, setMode] = useState<CartDiscount["mode"]>("amount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<DiscountCheck | null>(null);
  const [requested, setRequested] = useState(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const decision = useApprovalStatus("discount", pending?.request_id ?? null);
  const opIds = useRef({ operationId: "", requestId: "" });

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const d = await readCartDraft(storage);
      setDraft(d);
      const raw = await storage.read((t) => t.getMeta(PENDING_META));
      const p = raw ? (JSON.parse(raw) as PendingRequest) : null;
      if (p && d.lines.length) {
        setPending(p);
        setRequested(true);
      }
      if (d.discount) {
        setMode(d.discount.mode);
        setValue(
          d.discount.mode === "amount"
            ? (Number(d.discount.value) / 100).toFixed(2).replace(/\.00$/, "")
            : d.discount.value,
        );
        setReason(d.discount.reason);
      }
    })();
  }, []);

  const caps = ctx?.discountCaps ?? DEFAULT_CAPS;
  const subtotal = draft ? cartTotals(draft.lines).subtotalMinor : 0n;

  const current = (): CartDiscount | null => {
    const raw =
      mode === "amount"
        ? parseAmount(value)?.toString()
        : /^(0|[1-9][0-9]*)$/.test(value.trim()) && Number(value) <= 100
          ? value.trim()
          : undefined;
    return raw === undefined ? null : { mode, value: raw, reason: reason.trim() };
  };

  const apply = async () => {
    const d = current();
    if (!draft || !d) return setCheck({ ok: false, reason: "invalid", cap: "", minor: 0n });
    if (!d.reason) return setCheck({ ok: false, reason: "invalid", cap: "", minor: 0n });
    const result = checkDiscount(d, caps, subtotal);
    setCheck(result);
    if (!result.ok) return;
    await writeCartDraft(await getStorage(), { ...draft, discount: d });
    router.back();
  };

  const requestApproval = async () => {
    const d = current();
    if (!draft || !d || check?.ok !== false) return;
    if (!opIds.current.operationId || decision?.status === "rejected")
      opIds.current = { operationId: newId(), requestId: newId() };
    const storage = await getStorage();
    await requestDiscountOverride(storage, {
      ...opIds.current,
      branchId: ctx?.branchId ?? "",
      discount: d,
      cap: check.cap,
      cartTotalMinor: subtotal.toString(),
      discountMinor: check.minor.toString(),
      occurredAt: new Date().toISOString(),
    });
    const p: PendingRequest = { request_id: opIds.current.requestId, discount: d };
    await storage.transaction((t) => t.putMeta(PENDING_META, JSON.stringify(p)));
    setPending(p);
    setRequested(true);
  };

  /** مدير حاضر اعتمد برمزه: الطلب معتمداً باسمه والخصم في السلة (0005 §٢٩٣). */
  const approvedOnSpot = async (approver: PinVerifierRow) => {
    const d = current();
    if (!draft || !d || check?.ok !== false) return;
    const ids = { operationId: newId(), requestId: newId() };
    const storage = await getStorage();
    await requestDiscountOverride(storage, {
      ...ids,
      branchId: ctx?.branchId ?? "",
      discount: d,
      cap: check.cap,
      cartTotalMinor: subtotal.toString(),
      discountMinor: check.minor.toString(),
      occurredAt: new Date().toISOString(),
      pinApproval: { approverUserId: approver.user_id, verifierVersion: approver.version },
    });
    await writeCartDraft(storage, {
      ...draft,
      discount: {
        ...d,
        approval: {
          request_id: ids.requestId,
          approved_by_user_id: approver.user_id,
          approved_by_name: approver.display_name,
          via: "pin",
        },
      },
    });
    router.back();
  };

  /** وافق المالك أو المدير من «طلبات تنتظرك»: الخصم المطلوب يدخل السلة. */
  const applyApproved = async () => {
    if (!pending || !draft || decision?.status !== "approved") return;
    const storage = await getStorage();
    await writeCartDraft(storage, {
      ...draft,
      discount: {
        ...pending.discount,
        approval: {
          request_id: pending.request_id,
          approved_by_user_id: decision.decided_by_user_id,
          approved_by_name: decision.decided_by_name,
          via: "inbox",
        },
      },
    });
    await storage.transaction((t) => t.putMeta(PENDING_META, ""));
    router.back();
  };

  const clear = async () => {
    if (!draft) return;
    await writeCartDraft(await getStorage(), { ...draft, discount: undefined });
    router.back();
  };

  const state = check && !check.ok ? "validation_error" : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "خصم على الفاتورة")}>
      <View style={{ flexDirection: ROW_RTL, gap: SPACE["2"], marginBottom: SPACE["3"] }}>
        <Chip
          label={tx(T, "مبلغ")}
          on={mode === "amount"}
          onPress={() => {
            setMode("amount");
            setValue("");
          }}
        />
        <Chip
          label={tx(T, "نسبة")}
          on={mode === "percent"}
          onPress={() => {
            setMode("percent");
            setValue("");
          }}
        />
      </View>
      <Text
        style={{
          fontFamily: FONT.monoSemiBold,
          fontSize: 32,
          textAlign: "center",
          writingDirection: "ltr",
          marginBottom: SPACE["2"],
        }}
      >
        {value || "0"}
        {mode === "percent" ? "%" : ""}
      </Text>
      <Keypad value={value} onChange={setValue} decimals={mode === "amount"} />
      <View style={{ height: SPACE["3"] }} />
      <TextField
        label={tx(T, "السبب — إلزامي")}
        value={reason}
        onChangeText={setReason}
        error={
          check && !check.ok && check.reason === "invalid" && !reason.trim()
            ? tx(T, "السبب — إلزامي")
            : undefined
        }
        required
      />
      {check && !check.ok && check.reason !== "invalid" ? (
        <StateView
          state="permission_denied"
          title={
            check.reason === "forbidden"
              ? tx(T, "الخصم ليس من صلاحية دورك")
              : tx(T, "خصم يتجاوز سقف الدور")
          }
        >
          {check.reason === "forbidden" ? (
            <AppText variant="secondary">
              {tx(T, "يحتاج اعتماد مدير الفرع أو المالك. الفاتورة محفوظة في السلة ولن تُفقد.")}
            </AppText>
          ) : (
            <AppText variant="secondary">
              {tx(T, "سقفك")}{" "}
              <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
                {check.reason === "over_percent" ? `${check.cap}%` : formatMinorShort(check.cap)}
              </Text>
            </AppText>
          )}
          {requested && decision?.status !== "rejected" ? (
            <AppText variant="note">{tx(T, "طلب تفويضٍ يسجَّل باسم من وافق.")}</AppText>
          ) : (
            <Button
              label={tx(T, "طلب اعتماد من مدير الفرع")}
              variant="secondary"
              onPress={() => void requestApproval()}
            />
          )}
          {!pinOpen ? (
            <Button
              label={tx(T, "اعتماد مدير حاضر")}
              variant="secondary"
              disabledReason={!reason.trim() ? tx(T, "السبب — إلزامي") : undefined}
              onPress={() => setPinOpen(true)}
            />
          ) : null}
        </StateView>
      ) : null}
      {pinOpen && check && !check.ok && check.reason !== "invalid" && ctx ? (
        <ApproverPin
          request={{
            kind: "discount",
            amountMinor: check.minor,
            branchId: ctx.branchId,
            requesterId: ctx.userId,
          }}
          onApproved={approvedOnSpot}
        />
      ) : null}
      {requested ? (
        <StateView state="pending_sync" title={tx(T, "طلب اعتماد من مدير الفرع")}>
          <ApprovalOutcome item={decision} />
          {decision?.status === "approved" ? (
            <Button
              label={tx(T, "طبّق الخصم المعتمد")}
              financial
              onPress={() => void applyApproved()}
            />
          ) : null}
        </StateView>
      ) : null}
      <Button label={tx(T, "تطبيق الخصم")} financial onPress={() => void apply()} />
      {draft?.discount ? (
        <Button label={mtx("discountClear")} variant="quiet" onPress={() => void clear()} />
      ) : null}
    </Screen>
  );
}
