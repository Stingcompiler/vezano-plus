import { formatMinorShort } from "@sting/app-core";
import {
  type CartDiscount,
  type CartDraft,
  cartTotals,
  checkDiscount,
  type DiscountCheck,
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
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { newId } from "@/lib/crypto";
import { parseAmount, useShiftContext } from "@/lib/pos";
import { getStorage } from "@/lib/storage";

const T = "POS-03";
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
  const opIds = useRef({ operationId: "", requestId: "" });

  useEffect(() => {
    void (async () => {
      const d = await readCartDraft(await getStorage());
      setDraft(d);
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
    if (!opIds.current.operationId) opIds.current = { operationId: newId(), requestId: newId() };
    await requestDiscountOverride(await getStorage(), {
      ...opIds.current,
      branchId: ctx?.branchId ?? "",
      discount: d,
      cap: check.cap,
      cartTotalMinor: subtotal.toString(),
      occurredAt: new Date().toISOString(),
    });
    setRequested(true);
  };

  const clear = async () => {
    if (!draft) return;
    await writeCartDraft(await getStorage(), { ...draft, discount: undefined });
    router.back();
  };

  const state = check && !check.ok ? "validation_error" : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "خصم على الفاتورة")}>
      <View style={{ flexDirection: "row-reverse", gap: SPACE["2"], marginBottom: SPACE["3"] }}>
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
        <StateView state="permission_denied" title={tx(T, "خصم يتجاوز سقف الدور")}>
          <AppText variant="secondary">
            {tx(T, "سقفك")}{" "}
            <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
              {check.reason === "over_percent" ? `${check.cap}%` : formatMinorShort(check.cap)}
            </Text>
          </AppText>
          {requested ? (
            <AppText variant="note">{tx(T, "طلب تفويضٍ يسجَّل باسم من وافق.")}</AppText>
          ) : (
            <Button
              label={tx(T, "طلب اعتماد من مدير الفرع")}
              variant="secondary"
              onPress={() => void requestApproval()}
            />
          )}
        </StateView>
      ) : null}
      <Button label={tx(T, "تطبيق الخصم")} financial onPress={() => void apply()} />
      {draft?.discount ? (
        <Button label={mtx("discountClear")} variant="quiet" onPress={() => void clear()} />
      ) : null}
    </Screen>
  );
}
