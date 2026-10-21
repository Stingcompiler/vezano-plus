import { formatMinorShort, hhmm } from "@sting/app-core";
import {
  type CashRow,
  type LocalShift,
  readOpenShift,
  readReceiptCashRows,
  readReturnCashRows,
  readSaleCashRows,
  readShift,
  readShiftCash,
  type ShiftCash,
} from "@sting/sync-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";

import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SHIFT-02";
const KIND_LABEL: Record<CashRow["kind"], string> = {
  opening: "افتتاح الدرج",
  deposit: "إيداع في الصندوق",
  withdrawal: "سحب",
  expense: "مصروف",
  sale: "بيع نقدي",
  receipt: "سداد",
  refund: "مرتجع نقدي",
};
const MODE_LABEL = { credit: "بيع آجل", bank: "بيع بالتحويل", mixed: "بيع مختلط" } as const;
/** وسيلة البيع غير النقدي (يضيفها محرّك الجهاز في CashRow.mode — 0005 §١٩١) — تُقرأ بتسامح حتى يصل. */
const modeOf = (r: CashRow): keyof typeof MODE_LABEL | undefined =>
  r.kind === "sale" ? (r as CashRow & { mode?: keyof typeof MODE_LABEL }).mode : undefined;
const SYNC_LABEL = { synced: "مؤكد", pending: "معلّق", conflict: "تعارض", quarantined: "محجور" };

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * SHIFT-02 — الوردية الحالية (خطة الجوال M2). صفّ الصندوق المتوقَّع أولاً ثم حركات الوردية صفوفاً: النقد
 * الفعلي وحده يدخل المتوقَّع، والجزء الآجل يُعرض «خارج الصندوق» لتفهم الفاتورة كاملة ولا يُحتسب. الأرقام
 * محلية أصلاً — من الجهاز فوراً ثم تُطابَق مع الخادم.
 */
export default function CurrentShift() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [cash, setCash] = useState<ShiftCash | null>(null);
  const [matched, setMatched] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const storage = await getStorage();
        const s = id ? await readShift(storage, id) : await readOpenShift(storage);
        setShift(s);
        if (!s) return;
        setCash(
          await readShiftCash(storage, s, [
            ...(await readSaleCashRows(storage, s.id)),
            ...(await readReturnCashRows(storage, s.id)),
            ...(await readReceiptCashRows(storage, s.id)),
          ]),
        );
        try {
          const { response } = await api.GET("/api/shifts/{shift_id}", {
            params: { path: { shift_id: s.id } },
          });
          setMatched(response.ok);
        } catch {
          setMatched(false);
        }
      })();
    }, [api, id]),
  );

  const state =
    shift === undefined
      ? "loading"
      : shift?.state === "closed"
        ? "stale"
        : matched === false
          ? "offline"
          : (cash?.pendingCount ?? 0) > 0
            ? "pending_sync"
            : "ready";

  if (shift === null)
    return (
      <Screen screenId={T} state="empty" title={tx(T, "الوردية الحالية")}>
        <StateView state="empty" title={tx("SHIFT-01", "فتح وردية")}>
          <Button
            label={tx("SHIFT-01", "فتح وردية")}
            onPress={() => router.replace("/shifts/open")}
          />
        </StateView>
      </Screen>
    );

  return (
    <Screen
      screenId={T}
      state={state}
      title={shift ? `${tx(T, "الورديات")} · ${shift.user_name}` : tx(T, "الوردية الحالية")}
    >
      {shift?.state === "closed" ? (
        <StateView state="stale" title={tx(T, "مقفلة · معلّقة الرفع")}>
          <AppText variant="secondary">
            {tx(T, "أُقفلت محلياً وتُرفع عند المزامنة — الأرقام نهائية عندك لا عند الخادم")}
          </AppText>
        </StateView>
      ) : null}
      {matched === false ? (
        <StateView state="offline" title={tx(T, "الوردية تعمل بلا اتصال")}>
          <AppText variant="secondary">{tx(T, "الأرقام كاملة لما بيع على هذا الجهاز.")}</AppText>
        </StateView>
      ) : null}

      {shift && cash ? (
        <>
          <AppText variant="secondary" muted>
            {tx(T, "وردية مفتوحة منذ")}{" "}
            <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
              {hhmm(shift.opened_at)}
            </Text>{" "}
            · {shift.device_name} · {shift.branch_name}
          </AppText>
          <AppText variant="note" muted style={{ marginTop: SPACE["3"] }}>
            {tx(T, "النقد المتوقع في الدرج")}
          </AppText>
          <Text
            style={{
              fontFamily: FONT.monoSemiBold,
              fontSize: 34,
              writingDirection: "ltr",
              color: c.inkStrong,
              marginBottom: SPACE["3"],
            }}
          >
            {formatMinorShort(cash.expectedCashMinor.toString())}
          </Text>
          {cash.pendingCount > 0 ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "من هذا الجهاز")} · <M>{String(cash.pendingCount)}</M>
            </AppText>
          ) : matched === true ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "مطابَق مع الخادم")}
            </AppText>
          ) : null}

          <GroupedList>
            <ListRow
              title={tx(T, "افتتاح الدرج")}
              trailing={<M>{formatMinorShort(cash.totals.openingFloatMinor.toString())}</M>}
            />
            <ListRow
              title={tx(T, "مبيعات نقدية")}
              trailing={<M>{formatMinorShort(cash.totals.cashSalesMinor.toString())}</M>}
            />
            <ListRow
              title={tx(T, "سدادات نقدية")}
              trailing={<M>{formatMinorShort(cash.totals.cashDebtReceiptsMinor.toString())}</M>}
            />
            <ListRow
              title={tx(T, "صرف من الصندوق")}
              trailing={<M>{formatMinorShort(cash.totals.cashWithdrawalsMinor.toString())}</M>}
              last
            />
          </GroupedList>

          <GroupedList title={tx(T, "حركات الوردية")}>
            {cash.rows.map((r, i) => (
              <ListRow
                key={r.doc + r.time}
                title={modeOf(r) ? MODE_LABEL[modeOf(r)!] : KIND_LABEL[r.kind]}
                subtitle={`${r.doc} · ${hhmm(r.time)}${r.note ? ` · ${r.note}` : ""}`}
                trailing={
                  <AppText variant="note">
                    {r.inCashMinor ? <M>{formatMinorShort(r.inCashMinor)}</M> : null}
                    {r.outCashMinor ? (
                      <>
                        {" "}
                        {tx(T, "خارج الصندوق")} <M>{formatMinorShort(r.outCashMinor)}</M>
                      </>
                    ) : null}{" "}
                    {SYNC_LABEL[r.sync]}
                  </AppText>
                }
                last={i === cash.rows.length - 1}
              />
            ))}
          </GroupedList>
          {cash.rows.some((r) => r.outCashMinor) ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(
                T,
                "عمود «خارج الصندوق» يعرض ما لا يدخل النقد: الجزء الآجل والتحويل البنكي. يظهر هنا لتفهم الفاتورة كاملة، ولا يُحتسب في النقد المتوقع.",
              )}
            </AppText>
          ) : null}

          {shift.state === "open" ? (
            <>
              <Button
                label={mtx("shiftClose")}
                financial
                onPress={() => router.push("/shifts/close")}
              />
              <Button
                label={tx("SHIFT-03", "حركة صندوق")}
                variant="secondary"
                onPress={() => router.push("/shifts/movements")}
              />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
