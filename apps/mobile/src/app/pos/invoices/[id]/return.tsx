import { formatMinorShort, formatQty, pushPending } from "@sting/app-core";
import {
  type LocalSale,
  type LocalShift,
  readOpenShift,
  readReturnedQty,
  readSale,
  type ReturnCondition,
  type ReturnDestination,
  returnTotals,
  saveReturnLocally,
  unitDisplay,
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
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { newId } from "@/lib/crypto";
import { type ShiftContext, readShiftContext, today } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "POS-10";
/** سقوف الردّ للدور (G-09 مؤقتاً — كالويب): المالك بلا سقف. */
const CASH_CAP: Record<string, bigint> = { cashier: 20000n, manager: 500000n };
const CREDIT_CAP: Record<string, bigint> = { cashier: 100000n, manager: 2000000n };

interface RowState {
  readonly line: LocalSale["lines"][number];
  readonly available: bigint;
  readonly now: bigint;
}

const trimQty = (milli: bigint | string, dp: number) =>
  formatQty(milli.toString(), dp as 0 | 1 | 2 | 3)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * POS-10 — مرتجع كلي أو جزئي (خطة الجوال M2). من الفاتورة الأصل: كل سطر يعرض المُباع والمُرتجَع سابقاً
 * والمتاح ردّه (السقف تراكمي)؛ حالة البضاعة تُسأل (صالحة → المخزون، تالفة → الحجر)؛ وجهة الردّ معلنة؛
 * مستند مستقل لا يمحو الأصل. فواتير الأجهزة الأخرى (الخادمية) تُرتجع من الويب حتى تصل المرحلة اللاحقة.
 */
export default function Return() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { state: session, api } = useSession();
  const [sale, setSale] = useState<LocalSale | null | undefined>(undefined);
  const [saleOpId, setSaleOpId] = useState<string | undefined>(undefined);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [returned, setReturned] = useState<Map<string, bigint>>(new Map());
  const [qty, setQty] = useState<Map<string, bigint>>(new Map());
  const [condition, setCondition] = useState<ReturnCondition>("good");
  const [destination, setDestination] = useState<ReturnDestination>("cash");
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<{ number: string; total: string } | null>(null);
  const [over, setOver] = useState(false);
  const ids = useRef<{
    operationId: string;
    returnId: string;
    lines: string[];
    movements: string[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [s, c, local, ret] = await Promise.all([
        readOpenShift(storage),
        readShiftContext(storage, { deviceId: session.deviceId, userId: session.userId }),
        readSale(storage, id),
        readReturnedQty(storage, id),
      ]);
      setShift(s);
      setCtx(c);
      if (!local) return setSale(null);
      const op = await storage.read((t) => t.getOperation(local.operation_id));
      setSale(local);
      setSaleOpId(op ? local.operation_id : undefined);
      setReturned(ret);
    })();
  }, [id, session.deviceId, session.userId]);

  useEffect(() => {
    if (sale === null || shift === null)
      router.replace({ pathname: "/pos/invoices/[id]", params: { id } });
  }, [router, sale, shift, id]);

  const rows: RowState[] = (sale?.lines ?? []).map((l) => {
    const sold = BigInt(l.qty_milli);
    const r = returned.get(l.id) ?? 0n;
    return { line: l, available: sold - r > 0n ? sold - r : 0n, now: qty.get(l.id) ?? 0n };
  });
  const active = rows.filter((r) => r.now > 0n);
  const total =
    sale && active.length
      ? returnTotals(
          sale,
          active.map((r) => ({ saleLineId: r.line.id, qtyMilli: r.now.toString() })),
        ).totalMinor
      : 0n;
  const role = ctx?.roleCode ?? "cashier";
  const isOwner = ctx?.roleName === "مالك" || role === "owner";
  const cap = isOwner ? null : ((destination === "cash" ? CASH_CAP : CREDIT_CAP)[role] ?? null);
  const overCap = cap !== null && total > cap;
  const creditNoParty = destination === "credit" && !sale?.party_id;
  const allAvailable = rows.reduce((a, r) => a + r.available, 0n);
  const chosen = rows.reduce((a, r) => a + r.now, 0n);

  const state =
    phase === "saved"
      ? push === "synced"
        ? "success"
        : "saved_local"
      : over
        ? "validation_error"
        : overCap
          ? "permission_denied"
          : chosen > 0n && chosen < allAvailable
            ? "partial"
            : "ready";

  const step = (r: RowState, dir: 1 | -1) => {
    let next = r.now + BigInt(dir) * 1000n;
    if (dir === 1 && next > r.available && r.now < r.available) next = r.available;
    if (next < 0n) next = 0n;
    if (next > r.available) return setOver(true);
    setOver(false);
    setQty((m) => new Map(m).set(r.line.id, next));
  };

  const commit = async () => {
    if (!sale || !shift || !ctx || phase !== "idle" || !active.length || overCap || creditNoParty)
      return;
    setPhase("saving");
    ids.current ??= {
      operationId: newId(),
      returnId: newId(),
      lines: active.map(() => newId()),
      movements: active.map(() => newId()),
    };
    const storage = await getStorage();
    const { ret } = await saveReturnLocally(storage, {
      operationId: ids.current.operationId,
      returnId: ids.current.returnId,
      sale,
      saleOperationId: saleOpId,
      lines: active.map((r) => ({ saleLineId: r.line.id, qtyMilli: r.now.toString() })),
      condition,
      destination,
      shift,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      businessDate: shift.business_date || today(),
      occurredAt: new Date().toISOString(),
      memberIds: { lines: ids.current.lines, movements: ids.current.movements },
    });
    setSaved({ number: ret.return_number, total: ret.total_minor });
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
      setPush("pending");
    } finally {
      setPhase("saved");
    }
  };

  if (!sale)
    return (
      <Screen screenId={T} state="loading" title={tx(T, "مرتجع كلي أو جزئي")}>
        {null}
      </Screen>
    );

  if (phase === "saved" && saved)
    return (
      <Screen screenId={T} state={state} title={tx(T, "سُجّل المرتجع")}>
        <StateView
          state={push === "synced" ? "success" : "saved_local"}
          title={tx(T, "سُجّل المرتجع")}
        >
          <AppText variant="bodyStrong">
            {tx(T, "رقم المرتجع")} <M>{saved.number}</M>
          </AppText>
          <AppText variant="secondary">
            {tx(T, "قيمة المرتجع")} <M>{formatMinorShort(saved.total)}</M>
          </AppText>
          {push !== "synced" ? (
            <AppText variant="note">{tx(T, "محفوظ محلياً، والنقد خرج من الصندوق فعلاً.")}</AppText>
          ) : null}
        </StateView>
        <Button label={tx(T, "بيع جديد")} financial onPress={() => router.replace("/pos")} />
      </Screen>
    );

  return (
    <Screen
      screenId={T}
      state={state}
      title={`${tx(T, "مرتجع على الفاتورة")} ${sale.invoice_number}`}
    >
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الأصل يبقى كما هو؛ هذا مستند مرتجع مستقل")}
      </AppText>

      <GroupedList title={tx(T, "سطور الأصل")}>
        {rows.map((r, i) => (
          <View key={r.line.id}>
            <ListRow
              title={r.line.item_name}
              subtitle={`${tx(T, "المتاح")} ${trimQty(r.available, r.line.decimal_places)} ${unitDisplay(r.line.unit_code)}`}
              trailing={<M>{trimQty(r.now, r.line.decimal_places)}</M>}
              last={i === rows.length - 1}
            />
            <View
              style={{
                flexDirection: "row",
                gap: SPACE["2"],
                paddingHorizontal: SPACE["4"],
                paddingBottom: SPACE["2"],
              }}
            >
              {([-1, 1] as const).map((d) => (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.line.item_name} ${d === 1 ? tx(T, "زيادة") : tx(T, "إنقاص")}`}
                  onPress={() => step(r, d)}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AppText variant="title">{d === 1 ? "+" : "−"}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </GroupedList>
      {over ? (
        <StateView state="validation_error" title={tx(T, "كمية تتجاوز المتاح")}>
          <AppText variant="secondary">{tx(T, "المُباع ناقص المُرتجَع سابقاً")}</AppText>
        </StateView>
      ) : null}

      <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "حالة البضاعة")}
      </AppText>
      <View
        style={{
          flexDirection: ROW_RTL,
          gap: SPACE["2"],
          marginBottom: SPACE["3"],
          flexWrap: "wrap",
        }}
      >
        <Chip
          label={tx(T, "صالحة — تعود للمخزون")}
          on={condition === "good"}
          onPress={() => setCondition("good")}
        />
        <Chip
          label={tx(T, "تالفة — إلى الحجر أو الهالك")}
          on={condition === "damaged"}
          onPress={() => setCondition("damaged")}
        />
      </View>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "وجهة الرد")}
      </AppText>
      <View
        style={{
          flexDirection: ROW_RTL,
          gap: SPACE["2"],
          marginBottom: SPACE["3"],
          flexWrap: "wrap",
        }}
      >
        <Chip
          label={tx(T, "نقداً من الصندوق")}
          on={destination === "cash"}
          onPress={() => setDestination("cash")}
        />
        <Chip
          label={tx(T, "خصماً من ذمة العميل")}
          on={destination === "credit"}
          onPress={() => setDestination("credit")}
        />
      </View>

      {overCap ? (
        <StateView state="permission_denied" title={tx(T, "ردّ نقدي فوق الحدّ")}>
          <AppText variant="secondary">
            {tx(T, "الحدّ")} <M>{formatMinorShort((cap ?? 0n).toString())}</M>
          </AppText>
        </StateView>
      ) : null}

      <GroupedList>
        <ListRow
          title={tx(T, "قيمة المرتجع")}
          trailing={<M>{formatMinorShort(total.toString())}</M>}
          last
        />
      </GroupedList>
      <Button
        label={tx(T, "تسجيل المرتجع")}
        financial
        loading={phase === "saving"}
        disabledReason={
          !active.length
            ? tx(T, "اختر كمية")
            : overCap
              ? tx(T, "ردّ نقدي فوق الحدّ")
              : creditNoParty
                ? tx(T, "عميل مسمّى — شرط الأثر الآجل")
                : undefined
        }
        onPress={() => void commit()}
      />
    </Screen>
  );
}
