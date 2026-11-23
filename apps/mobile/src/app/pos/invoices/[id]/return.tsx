import { formatMinorShort, formatQty, pushPending } from "@sting/app-core";
import {
  EMPTY_RETURN_HISTORY,
  type LocalSale,
  type LocalShift,
  readOpenShift,
  readReturnHistory,
  readSale,
  type ReturnCondition,
  type ReturnHistory,
  returnTotals,
  saveReturnLocally,
  type ServerReturnRow,
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
  ThemedText as Text,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

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
  const [history, setHistory] = useState<ReturnHistory>(EMPTY_RETURN_HISTORY);
  // S-06: فاتورة ألغاها مستند عكسي لا تُردّ — يُسأل الخادم متى وُجد اتصال
  const [reversed, setReversed] = useState(false);
  const [qty, setQty] = useState<Map<string, bigint>>(new Map());
  const [condition, setCondition] = useState<ReturnCondition>("good");
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<{ number: string; total: string; cash: string } | null>(null);
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
      const [s, c, local] = await Promise.all([
        readOpenShift(storage),
        readShiftContext(storage, { deviceId: session.deviceId, userId: session.userId }),
        readSale(storage, id),
      ]);
      setShift(s);
      setCtx(c);
      if (!local) return setSale(null);
      // الخادم يعرف مرتجعات الأجهزة الأخرى والعكس؛ بلا اتصال يكفي المحلي
      let server: { sync_state?: string; returns?: readonly ServerReturnRow[] } | null = null;
      try {
        const { data, response } = await api.GET("/api/sales/{sale_id}", {
          params: { path: { sale_id: id } },
        });
        if (response.ok && data) server = data;
      } catch {
        server = null;
      }
      setReversed(server?.sync_state === "reversed");
      setHistory(await readReturnHistory(storage, id, server?.returns ?? []));
      const op = await storage.read((t) => t.getOperation(local.operation_id));
      setSale(local);
      setSaleOpId(op ? local.operation_id : undefined);
    })();
  }, [api, id, session.deviceId, session.userId]);

  useEffect(() => {
    if (sale === null || shift === null)
      router.replace({ pathname: "/pos/invoices/[id]", params: { id } });
  }, [router, sale, shift, id]);

  const rows: RowState[] = (sale?.lines ?? []).map((l) => {
    const sold = BigInt(l.qty_milli);
    const r = history.qtyByLine.get(l.id) ?? 0n;
    return { line: l, available: sold - r > 0n ? sold - r : 0n, now: qty.get(l.id) ?? 0n };
  });
  const active = rows.filter((r) => r.now > 0n);
  // القيمة ما دُفع بعد خصم الفاتورة، والوجهة من الدفع الأصلي (0005 §٢٩٠) — كالويب والخادم
  let totals: ReturnType<typeof returnTotals> | null = null;
  let unpriced = false;
  if (sale && active.length) {
    try {
      totals = returnTotals(
        sale,
        active.map((r) => ({ saleLineId: r.line.id, qtyMilli: r.now.toString() })),
        history,
      );
    } catch {
      unpriced = true;
    }
  }
  const total = totals?.totalMinor ?? 0n;
  const split = totals?.split ?? { creditMinor: 0n, bankMinor: 0n, cashMinor: 0n };
  const role = ctx?.roleCode ?? "cashier";
  const isOwner = ctx?.roleName === "مالك" || role === "owner";
  const moneyOut = split.cashMinor + split.bankMinor;
  const cashCap = isOwner ? null : (CASH_CAP[role] ?? null);
  const creditCap = isOwner ? null : (CREDIT_CAP[role] ?? null);
  const overCash = cashCap !== null && moneyOut > cashCap;
  const overCap = overCash || (creditCap !== null && split.creditMinor > creditCap);
  const cap = overCash ? cashCap : creditCap;
  const creditNoParty = split.creditMinor > 0n && !sale?.party_id;
  const paidCredit = BigInt(sale?.credit_minor || "0") > 0n;
  const paidBank = BigInt(sale?.bank_minor || "0") > 0n;
  const paidCash = BigInt(sale?.cash_minor || "0") > 0n || (!paidCredit && !paidBank);
  const discounted = BigInt(sale?.discount_minor || "0") > 0n;
  const allAvailable = rows.reduce((a, r) => a + r.available, 0n);
  const chosen = rows.reduce((a, r) => a + r.now, 0n);

  const state =
    phase === "saved"
      ? push === "synced"
        ? "success"
        : "saved_local"
      : over || unpriced || reversed
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
    if (!sale || !shift || !ctx || phase !== "idle" || !active.length) return;
    if (overCap || creditNoParty || unpriced || reversed) return;
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
      history,
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
    setSaved({ number: ret.return_number, total: ret.total_minor, cash: ret.cash_minor });
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
          {push !== "synced" && BigInt(saved.cash) > 0n ? (
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
      {reversed ? (
        <StateView
          state="validation_error"
          title={tx(T, "هذه الفاتورة أُلغيت بمستند عكسي — لا تُردّ.")}
        />
      ) : null}

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
      <AppText variant="note" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "الردّ يتبع طريقة دفع الفاتورة.")}
      </AppText>
      <GroupedList title={tx(T, "وجهة الرد")}>
        {paidCredit ? (
          <ListRow
            title={tx(T, "خصماً من ذمة العميل")}
            trailing={<M>{formatMinorShort(split.creditMinor.toString())}</M>}
            last={!paidBank && !paidCash}
          />
        ) : null}
        {paidBank ? (
          <ListRow
            title={tx(T, "تحويلاً بنكياً")}
            trailing={<M>{formatMinorShort(split.bankMinor.toString())}</M>}
            last={!paidCash}
          />
        ) : null}
        {paidCash ? (
          <ListRow
            title={tx(T, "نقداً من الصندوق")}
            trailing={<M>{formatMinorShort(split.cashMinor.toString())}</M>}
            last
          />
        ) : null}
      </GroupedList>
      {paidCredit ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
          {tx(T, "الفاتورة آجلة: الردّ يُخصم من ذمّة العميل أولاً.")}
        </AppText>
      ) : null}
      {paidCash && (paidCredit || paidBank) ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
          {tx(T, "الردّ نقداً لا يتجاوز ما دُفع نقداً في الفاتورة.")}
        </AppText>
      ) : null}

      {overCap ? (
        <StateView state="permission_denied" title={tx(T, "ردّ نقدي فوق الحدّ")}>
          <AppText variant="secondary">
            {tx(T, "الحدّ")} <M>{formatMinorShort((cap ?? 0n).toString())}</M>
          </AppText>
        </StateView>
      ) : null}

      <GroupedList>
        <ListRow
          title={discounted ? tx(T, "قيمة المرتجع بعد خصم الفاتورة") : tx(T, "قيمة المرتجع")}
          trailing={<M>{formatMinorShort(total.toString())}</M>}
          last
        />
      </GroupedList>
      <Button
        label={tx(T, "تسجيل المرتجع")}
        financial
        loading={phase === "saving"}
        disabledReason={
          reversed
            ? tx(T, "هذه الفاتورة أُلغيت بمستند عكسي — لا تُردّ.")
            : !active.length
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
