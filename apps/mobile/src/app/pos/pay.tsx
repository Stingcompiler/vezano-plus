import { formatMinorShort } from "@sting/app-core";
import { toBaseQtyMilli, parseUnitFactor } from "@sting/domain";
import { type CartDraftLine, cartTotals } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  GroupedList,
  Keypad,
  ListRow,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  ThemedText as Text,
} from "@sting/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { PayMethods, SaleDone } from "@/components/sale-parts";
import { parseAmount, useSale } from "@/lib/pos";

const T = "POS-05";
type PriceMode = "operation" | "skip";

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoSemiBold, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * POS-05 — الدفع النقدي (خطة الجوال M2). لوحة نقد: مبالغ سريعة ومبلغ مضبوط بلوحة أرقام كبيرة، والمستلَم
 * والباقي محسوبان محلياً بنفس التقريب (ACC-24). خط الحفظ واحد (`saveSaleLocally`) في معاملة محلية، والنجاح بعد
 * الحفظ لا بعد الطباعة. صنف بلا سعر لا يوقف زبوناً واقفاً: يُطلب الرقم ويُسجَّل باسم من أدخله، أو يُتخطّى.
 * بيع فوق الرصيد الدفتري يمرّ ويُوسم (ACC-17). ما تغيّر عن الويب: مبالغ سريعة بدل حقل حرّ فقط.
 */
export default function Pay() {
  const sale = useSale();
  const { draft, shift, balances, totals: rawTotals, phase, push } = sale;
  const [received, setReceived] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [priceMode, setPriceMode] = useState<Record<string, PriceMode>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const lines = draft?.lines ?? [];
  const unpriced = lines.filter(
    (l) => BigInt(l.unit_price_minor) === 0n && priceMode[l.id] !== "skip",
  );
  const effective: CartDraftLine[] = lines
    .filter((l) => priceMode[l.id] !== "skip")
    .map((l) => {
      const typed = BigInt(l.unit_price_minor) === 0n ? parseAmount(manual[l.id] ?? "") : null;
      return typed && typed > 0n
        ? { ...l, unit_price_minor: typed.toString(), manual_price: true }
        : l;
    });
  const totals =
    unpriced.length || effective.length !== lines.length
      ? cartTotals(effective, draft?.discount)
      : rawTotals;
  const total = totals.totalMinor;
  const receivedMinor = parseAmount(received);
  const change = receivedMinor !== null && receivedMinor >= total ? receivedMinor - total : null;
  const unresolved = unpriced.filter((l) => {
    const v = parseAmount(manual[l.id] ?? "");
    return v === null || v === 0n;
  });
  const overStock = effective.filter((l) => {
    const b = balances.get(l.item_id);
    if (!b) return false;
    return (
      toBaseQtyMilli(BigInt(l.qty_milli), parseUnitFactor(l.factor_milli, "1000")) >
      BigInt(b.qty_milli)
    );
  });
  const state =
    phase === "saving"
      ? "saving"
      : phase === "saved"
        ? push === "synced"
          ? "success"
          : "saved_local"
        : unresolved.length > 0
          ? "validation_error"
          : "ready";

  const quick = [
    ...new Set([
      total,
      ...[100n, 200n, 500n, 1000n, 5000n].map(
        (s) => ((total + s * 100n - 1n) / (s * 100n)) * (s * 100n),
      ),
    ]),
  ]
    .filter((v) => v >= total && v > 0n)
    .slice(0, 4);

  const commit = async () => {
    if (unresolved.length || receivedMinor === null || receivedMinor < total) return;
    const saved = await sale.save(effective, [
      {
        method: "cash",
        amountMinor: total.toString(),
        receivedMinor: receivedMinor.toString(),
        changeMinor: (receivedMinor - total).toString(),
      },
    ]);
    if (saved) await sale.pushAfterSave();
  };

  if (phase === "saved" && sale.sale)
    return (
      <Screen screenId={T} state={state} title={tx(T, "الدفع النقدي")}>
        <SaleDone sale={sale.sale} push={push} />
      </Screen>
    );

  return (
    <Screen screenId={T} state={state} title={tx(T, "الدفع النقدي")}>
      <PayMethods current="cash" />
      {shift ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
          {tx(T, "وردية مفتوحة")} · {shift.user_name}
        </AppText>
      ) : null}

      {unpriced.map((l) => (
        <StateView
          key={l.id}
          state="validation_error"
          title={`«${l.item_name}${tx(T, "» بلا سعر في بطاقته")}`}
        >
          <AppText variant="secondary">
            {tx(T, "أُضيف الصنف من جرد سابق ولم يُسعَّر. الزبون واقف، والبيع يكمل.")}
          </AppText>
          <Chip
            label={`${tx(T, "سعر البيع لهذه العملية")}${manual[l.id] ? ` · ${manual[l.id]}` : ""}`}
            on={editing === l.id}
            onPress={() => setEditing(editing === l.id ? null : l.id)}
          />
          <Button
            label={tx(T, "تخطي الصنف وإكمال البيع")}
            variant="quiet"
            onPress={() => setPriceMode({ ...priceMode, [l.id]: "skip" })}
          />
        </StateView>
      ))}

      <GroupedList>
        <ListRow title={tx(T, "المطلوب")} trailing={<M>{formatMinorShort(total.toString())}</M>} />
        <ListRow
          title={tx(T, "المبلغ المستلم")}
          trailing={<M>{received ? formatMinorShort((receivedMinor ?? 0n).toString()) : "—"}</M>}
        />
        <ListRow
          title={tx(T, "الباقي للعميل")}
          trailing={<M>{change !== null ? formatMinorShort(change.toString()) : "—"}</M>}
          last
        />
      </GroupedList>

      {overStock.length ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
          {tx(T, "الكمية المطلوبة تتجاوز الرصيد الدفتري")} · {tx(T, "البيع يمر.")}
        </AppText>
      ) : null}

      <AppText variant="secondary" muted style={{ marginBottom: SPACE["1"] }}>
        {tx(T, "مبالغ سريعة")}
      </AppText>
      <View
        style={{
          flexDirection: ROW_RTL,
          flexWrap: "wrap",
          gap: SPACE["2"],
          marginBottom: SPACE["3"],
        }}
      >
        {quick.map((q) => (
          <Chip
            key={q.toString()}
            label={q === total ? tx(T, "مبلغ مضبوط") : formatMinorShort(q.toString())}
            on={receivedMinor === q}
            onPress={() => {
              setEditing(null);
              setReceived((Number(q) / 100).toFixed(2).replace(/\.00$/, ""));
            }}
          />
        ))}
      </View>

      <Keypad
        value={editing ? (manual[editing] ?? "") : received}
        onChange={(v) => (editing ? setManual({ ...manual, [editing]: v }) : setReceived(v))}
      />
      <View style={{ marginTop: SPACE["3"] }}>
        <Button
          label={`${tx(T, "حفظ البيع —")} ${formatMinorShort(total.toString())} ${tx(T, "ج.س")}`}
          financial
          loading={phase === "saving"}
          disabledReason={
            unresolved.length
              ? tx(T, "سعر البيع لهذه العملية")
              : receivedMinor === null || receivedMinor < total
                ? tx(T, "المبلغ المستلم")
                : undefined
          }
          onPress={() => void commit()}
        />
      </View>
    </Screen>
  );
}
