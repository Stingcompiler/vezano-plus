import { formatMinorShort, formatQty } from "@sting/app-core";
import {
  addToCart,
  type CartDraftLine,
  type CatalogRow,
  catalogRows,
  cartTotals,
  filterLocalItems,
  holdCart,
  type LocalBalance,
  type LocalItem,
  looksLikeBarcode,
  readBalanceMatchedAt,
  readCartDraft,
  readLocalBalances,
  readLocalItems,
  readOpenShift,
  rowByBarcode,
  stepCartLine,
  unitDisplay,
  writeCartDraft,
  type CartDiscount,
  type CartCustomer,
  type LocalShift,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  GroupedList,
  ListRow,
  RADIUS,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TOUCH,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { UnitSheet } from "@/components/unit-sheet";
import { newId } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";

const T = "POS-01";
const ALL = "__all";
const WEIGH = "__weigh";
const MAX_ROWS = 40;

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

interface Sheet {
  readonly row: CatalogRow;
  readonly lineId: string | null;
  readonly qtyMilli?: string | undefined;
}

/**
 * POS-01 — نقطة البيع والسلة (خطة الجوال M2). البحث والأصناف أولاً والسلة شريط مثبّت أسفل الشاشة
 * (منطقة الإبهام). الكتالوج والبحث والباركود والحساب من الإسقاط المحلي بلا انتظار؛ لا بيع نقدي بلا
 * وردية مفتوحة («افتح وردية» لا «ليست لديك صلاحية»)؛ الأرصدة القديمة تنبيه لا منع. السلة مسودّة محلية
 * تبقى بعد إغلاق التطبيق. الحفظ الفعلي خط `sale` مع POS-05.
 */
export default function Pos() {
  const router = useRouter();
  const c = useColors();
  const [items, setItems] = useState<LocalItem[] | null>(null);
  const [balances, setBalances] = useState<Map<string, LocalBalance>>(new Map());
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [lines, setLines] = useState<readonly CartDraftLine[]>([]);
  const [discount, setDiscount] = useState<CartDiscount | undefined>(undefined);
  const [customer, setCustomer] = useState<CartCustomer | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState(ALL);
  const [barcodeMiss, setBarcodeMiss] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  // عند كل عودة إلى الشاشة (من الدفع أو الخصم أو العميل) تُقرأ المسودة من جديد
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const storage = await getStorage();
        const [its, draft, bal, at, s] = await Promise.all([
          readLocalItems(storage),
          readCartDraft(storage),
          readLocalBalances(storage),
          readBalanceMatchedAt(storage),
          readOpenShift(storage),
        ]);
        setItems(its);
        setLines(draft.lines);
        setDiscount(draft.discount);
        setCustomer(draft.customer);
        setBalances(bal);
        setMatchedAt(at);
        setShift(s);
      })();
    }, []),
  );

  const persist = (next: readonly CartDraftLine[]) => {
    setLines(next);
    const keep = next.length > 0;
    if (!keep) {
      setDiscount(undefined);
      setCustomer(undefined);
    }
    void getStorage().then((s) =>
      writeCartDraft(s, {
        lines: next,
        discount: keep ? discount : undefined,
        customer: keep ? customer : undefined,
      }),
    );
  };

  const active = useMemo(() => (items ?? []).filter((i) => i.is_active), [items]);
  const allRows = useMemo(() => catalogRows(active), [active]);
  const groups = useMemo(
    () => [...new Set(active.map((i) => i.group_name).filter(Boolean))],
    [active],
  );
  const visible = useMemo(() => {
    const filtered = filterLocalItems(active, { q: query });
    const ids = new Set(filtered.map((i) => i.id));
    return allRows.filter(
      (r) =>
        ids.has(r.item.id) &&
        (chip === ALL ? true : chip === WEIGH ? r.weighable : r.item.group_name === chip.slice(2)),
    );
  }, [active, allRows, chip, query]);
  const shown = visible.slice(0, MAX_ROWS);
  const totals = useMemo(() => cartTotals(lines, discount), [lines, discount]);
  const inCart = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const l of lines) {
      const k = `${l.item_id}:${l.unit_id}`;
      m.set(k, (m.get(k) ?? 0n) + BigInt(l.qty_milli));
    }
    return m;
  }, [lines]);

  const add = (row: CatalogRow) => {
    if (row.weighable) return setSheet({ row, lineId: null });
    persist(addToCart(lines, row, "1000", newId));
  };
  const confirmSheet = (row: CatalogRow, qtyMilli: string) => {
    if (sheet?.lineId) {
      persist(
        lines.map((l) =>
          l.id === sheet.lineId
            ? {
                ...l,
                unit_id: row.unitId,
                unit_code: row.unitCode,
                unit_name: row.unitName,
                factor_milli: row.factorMilli,
                decimal_places: row.decimalPlaces,
                unit_price_minor: row.unitPriceMinor,
                qty_milli: qtyMilli,
              }
            : l,
        ),
      );
    } else {
      persist(addToCart(lines, row, qtyMilli, newId));
    }
    setSheet(null);
  };
  const editLine = (lineId: string) => {
    const l = lines.find((x) => x.id === lineId);
    const row = l && allRows.find((r) => r.item.id === l.item_id && r.unitId === l.unit_id);
    if (l && row) setSheet({ row, lineId, qtyMilli: l.qty_milli });
  };
  const submitSearch = () => {
    const row = rowByBarcode(allRows, query);
    if (row) {
      add(row);
      setQuery("");
      setBarcodeMiss(null);
      return;
    }
    if (looksLikeBarcode(query)) setBarcodeMiss(query.trim());
  };
  const onScan = (code: string) => {
    const row = rowByBarcode(allRows, code);
    if (row) {
      add(row);
      setBarcodeMiss(null);
    } else {
      setQuery(code);
      setBarcodeMiss(code.trim());
    }
  };
  const hold = async () => {
    const n = await holdCart(await getStorage(), lines);
    setLines([]);
    setDiscount(undefined);
    setCustomer(undefined);
    setHeld(n);
    setCartOpen(false);
  };

  const state =
    shift === null
      ? "permission_denied"
      : items !== null && active.length === 0
        ? "empty"
        : items === null
          ? "loading"
          : "ready";
  const payDisabled = !lines.length
    ? tx(T, "السلة فارغة")
    : shift
      ? undefined
      : tx(T, "لا وردية مفتوحة");

  return (
    <View style={{ flex: 1, backgroundColor: c.surfacePage }}>
      <Screen screenId={T} state={state} title={tx(T, "نقطة البيع")}>
        {shift === null ? (
          <StateView state="phase_locked" title={tx(T, "لا وردية مفتوحة")}>
            <AppText variant="secondary">
              {tx(T, "البيع النقدي يحتاج صندوقاً مفتوحاً يستقبل النقد.")}
            </AppText>
            <Button label={tx(T, "افتح وردية")} onPress={() => router.push("/shifts/open")} />
          </StateView>
        ) : shift ? (
          <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "وردية مفتوحة")} · {tx(T, "الوردية تخصّ هذا الجهاز")}
          </AppText>
        ) : null}

        {items !== null && active.length === 0 ? (
          <StateView state="empty" title={tx(T, "كتالوج فارغ")}>
            <AppText variant="secondary">{tx(T, "منشأة جديدة لم تُدخل أصنافها.")}</AppText>
            <Button label={tx(T, "جهّز هذا الجهاز")} onPress={() => router.push("/setup-device")} />
          </StateView>
        ) : null}

        <TextInput
          accessibilityLabel={tx(T, "ابحث عن صنف…")}
          value={query}
          onChangeText={(v) => {
            setQuery(v);
            setBarcodeMiss(null);
          }}
          onSubmitEditing={submitSearch}
          placeholder={tx(T, "ابحث أو امسح باركود…")}
          placeholderTextColor={c.inkFaint}
          returnKeyType="search"
          autoCorrect={false}
          style={{
            minHeight: TOUCH.row,
            borderRadius: RADIUS.button,
            backgroundColor: c.surfaceCard,
            borderWidth: 1,
            borderColor: c.border,
            paddingHorizontal: SPACE["3"],
            fontFamily: FONT.regular,
            fontSize: 17,
            color: c.inkStrong,
            textAlign: "right", // TextInput: قيمة فيزيائية (لا تبديل في RTL)
            writingDirection: "rtl",
            marginBottom: SPACE["2"],
          }}
        />
        <Button label={tx(T, "مسح باركود")} variant="secondary" onPress={() => setScanning(true)} />
        <View
          style={{
            flexDirection: ROW_RTL,
            flexWrap: "wrap",
            gap: SPACE["2"],
            marginTop: SPACE["3"],
            marginBottom: SPACE["3"],
          }}
        >
          <Chip label={tx(T, "الكل")} on={chip === ALL} onPress={() => setChip(ALL)} />
          {groups.map((g) => (
            <Chip key={g} label={g} on={chip === `g:${g}`} onPress={() => setChip(`g:${g}`)} />
          ))}
          <Chip label={tx(T, "وزن")} on={chip === WEIGH} onPress={() => setChip(WEIGH)} />
        </View>

        {barcodeMiss ? (
          <StateView state="empty" title={tx("POS-02", "باركود مجهول")}>
            <AppText variant="secondary">
              {tx(
                "POS-02",
                "قُرئ الباركود بنجاح ولا صنف مربوط به. العطل ليس في الماسح ولا في الشبكة.",
              )}
            </AppText>
            <AppText variant="note">
              <N>{barcodeMiss}</N>
            </AppText>
          </StateView>
        ) : query.trim() && visible.length === 0 ? (
          <StateView state="empty" title={tx("POS-02", "بحث بلا تطابق")}>
            <AppText variant="secondary">
              {tx("POS-02", "لا صنف بهذا الاسم بين")} <N>{active.length}</N>
            </AppText>
          </StateView>
        ) : null}

        {matchedAt ? (
          <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "الأرصدة بآخر مطابقة")} <N>{matchedAt.slice(11, 16)}</N>
          </AppText>
        ) : null}

        <GroupedList title={tx(T, "الأصناف")}>
          {shown.map((r, i) => {
            const b = balances.get(r.item.id);
            const qty = b ? BigInt(b.qty_milli) : null;
            const inC = inCart.get(`${r.item.id}:${r.unitId}`);
            const tag = inC
              ? `${tx(T, "في السلة ×")}${formatQty(inC, r.decimalPlaces)}`
              : qty !== null && qty < 0n
                ? tx(T, "رصيد سالب")
                : qty === 0n
                  ? tx(T, "نفد")
                  : "";
            return (
              <ListRow
                key={r.key}
                title={r.label}
                subtitle={`${r.unitLabel}${tag ? ` · ${tag}` : ""}${
                  qty !== null
                    ? ` · ${tx(T, "المتاح")} ${formatQty(qty, r.item.base_unit_decimal_places ?? 0)}`
                    : ""
                }`}
                trailing={
                  <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>
                    {formatMinorShort(r.unitPriceMinor)}
                  </Text>
                }
                onPress={() => add(r)}
                last={i === shown.length - 1}
              />
            );
          })}
        </GroupedList>
        {visible.length > MAX_ROWS ? (
          <AppText variant="note" muted>
            <N>{visible.length}</N> {tx(T, "صنفاً — ضيّق البحث للوصول أسرع")}
          </AppText>
        ) : null}
        {held ? (
          <AppText variant="note" muted>
            {tx(T, "عُلّقت —")} <N>{held}</N> {tx(T, "في المعلّقات")}
          </AppText>
        ) : null}

        {cartOpen && lines.length ? (
          <GroupedList title={tx(T, "السلة")}>
            {lines.map((l, i) => (
              <View key={l.id}>
                <ListRow
                  title={l.item_name}
                  subtitle={`${formatQty(l.qty_milli, l.decimal_places)} ${unitDisplay(l.unit_code)} × ${formatMinorShort(l.unit_price_minor)}`}
                  trailing={
                    <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>
                      {formatMinorShort((totals.lineTotals.get(l.id) ?? 0n).toString())}
                    </Text>
                  }
                  onPress={() => editLine(l.id)}
                  last={i === lines.length - 1}
                />
                <View
                  style={{
                    flexDirection: "row",
                    gap: SPACE["2"],
                    paddingHorizontal: SPACE["4"],
                    paddingBottom: SPACE["2"],
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${l.item_name} −`}
                    onPress={() => persist(stepCartLine(lines, l.id, -1))}
                    style={{
                      minHeight: TOUCH.min,
                      minWidth: TOUCH.min,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <AppText variant="title">−</AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${l.item_name} +`}
                    onPress={() => persist(stepCartLine(lines, l.id, 1))}
                    style={{
                      minHeight: TOUCH.min,
                      minWidth: TOUCH.min,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <AppText variant="title">+</AppText>
                  </Pressable>
                </View>
              </View>
            ))}
          </GroupedList>
        ) : null}
        {cartOpen && lines.length ? (
          <View style={{ gap: SPACE["2"], marginTop: SPACE["2"] }}>
            <Button
              label={tx(T, "خصم")}
              variant="secondary"
              onPress={() => router.push("/pos/discount")}
            />
            <Button
              label={customer ? customer.name : tx(T, "اختيار العميل")}
              variant="secondary"
              onPress={() => router.push("/pos/customer")}
            />
            <Button
              label={tx(T, "تعليق الفاتورة")}
              variant="secondary"
              onPress={() => void hold()}
            />
            <Button label={tx(T, "إلغاء السلة")} variant="quiet" onPress={() => persist([])} />
          </View>
        ) : null}
      </Screen>

      {lines.length ? (
        <View
          accessibilityRole="summary"
          accessibilityLabel={tx(T, "ملخّص السلة")}
          style={{
            flexDirection: ROW_RTL,
            alignItems: "center",
            gap: SPACE["3"],
            padding: SPACE["3"],
            backgroundColor: c.surfaceCard,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx(T, "السلة")}
            onPress={() => setCartOpen((v) => !v)}
            style={{ flex: 1, minHeight: TOUCH.min, justifyContent: "center" }}
          >
            <AppText variant="secondary">
              {tx(T, "السلة ·")} <N>{totals.lineCount}</N>
            </AppText>
            <Text style={{ fontFamily: FONT.monoSemiBold, fontSize: 20, writingDirection: "ltr" }}>
              {formatMinorShort(totals.totalMinor.toString())} {tx(T, "ج.س")}
            </Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Button
              label={tx(T, "تحصيل")}
              financial
              disabledReason={payDisabled}
              onPress={() => router.push("/pos/pay")}
            />
          </View>
        </View>
      ) : null}

      <BarcodeScanner open={scanning} onScan={onScan} onClose={() => setScanning(false)} />
      {sheet ? (
        <UnitSheet
          row={sheet.row}
          initialQtyMilli={sheet.qtyMilli}
          onConfirm={confirmSheet}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}
