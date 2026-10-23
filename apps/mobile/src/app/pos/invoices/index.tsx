import { formatMinorShort, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Chip,
  FONT,
  GroupedList,
  ListRow,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import {
  dayLabel,
  type InvoiceRow,
  localInvoiceRows,
  type Range,
  type ServerSale,
  serverInvoiceRow,
} from "@/lib/invoices";
import { useSession } from "@/lib/session";

const T = "POS-09";
type SyncFilter = "all" | "pending";
const LABEL = {
  local: tx(T, "محفوظ محلياً"),
  pending: tx(T, "معلّق المزامنة"),
  synced: tx(T, "مؤكد خادمياً"),
  reversed: tx(T, "مؤكد خادمياً"),
} as const;

/**
 * POS-09 — قائمة الفواتير (خطة الجوال M2). المحلي فوراً وفواتير الأجهزة الأخرى تلحق موسومة؛ كل فاتورة بوضع
 * مزامنتها (محلي، في الطابور، مؤكَّد)؛ الصف ذو التاريخ المشكوك فيه معلَّم والأصل لم يُعدَّل (ACC-77).
 * الكاشير يرى نطاقه (فواتير جهازه وورديته) والمجاميع بابها «تقرير المبيعات».
 */
export default function Invoices() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [range, setRange] = useState<Range>("today");
  const [syncFilter, setSyncFilter] = useState<SyncFilter>("all");
  const [local, setLocal] = useState<InvoiceRow[] | null>(null);
  const [server, setServer] = useState<InvoiceRow[]>([]);
  const [offline, setOffline] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void localInvoiceRows().then(setLocal);
      void api
        .GET("/api/sales", { params: { query: { range, branch: "mine" } } })
        .then(({ data, response }) => {
          const body = data as unknown as { rows?: ServerSale[] } | undefined;
          if (response.ok && body?.rows) {
            setServer(body.rows.map(serverInvoiceRow));
            setOffline(false);
          }
        })
        .catch(() => setOffline(true));
    }, [api, range]),
  );

  const rows = useMemo(() => {
    const byId = new Map<string, InvoiceRow>();
    for (const r of server) byId.set(r.id, r);
    for (const r of local ?? []) byId.set(r.id, r);
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const since = range === "today" ? startOfDay : startOfDay - 6 * 86_400_000;
    return [...byId.values()]
      .filter((r) => new Date(r.occurredAt).getTime() >= since)
      .filter((r) => (syncFilter === "pending" ? r.sync === "local" || r.sync === "pending" : true))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [local, server, range, syncFilter]);

  const state =
    local === null ? "loading" : offline ? "offline" : rows.length === 0 ? "empty" : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "قائمة الفواتير")}>
      <View
        style={{
          flexDirection: ROW_RTL,
          flexWrap: "wrap",
          gap: SPACE["2"],
          marginBottom: SPACE["3"],
        }}
      >
        <Chip label={tx(T, "اليوم")} on={range === "today"} onPress={() => setRange("today")} />
        <Chip label={tx(T, "هذا الأسبوع")} on={range === "week"} onPress={() => setRange("week")} />
        <Chip
          label={syncFilter === "pending" ? tx(T, "معلّق فقط") : tx(T, "كل حالات المزامنة")}
          on={syncFilter === "pending"}
          onPress={() => setSyncFilter(syncFilter === "all" ? "pending" : "all")}
        />
      </View>
      <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "الكاشير يرى نطاقه — فواتير جهازه وورديته.")}
      </AppText>
      {rows.length === 0 && local !== null ? (
        <StateView state="empty" title={tx(T, "لا فواتير")}>
          <AppText variant="secondary">{tx(T, "لم يُسجَّل بيع بعد.")}</AppText>
        </StateView>
      ) : (
        <GroupedList title={tx(T, "الفواتير")}>
          {rows.map((r, i) => {
            const d = dayLabel(r.occurredAt);
            return (
              <ListRow
                key={r.id}
                title={r.number}
                subtitle={`${d.word ?? d.n} ${hhmm(r.occurredAt)} · ${r.partyName || tx(T, "نقدي")}${r.dateSuspect ? ` ${tx(T, "— تاريخ مشكوك فيه")}` : ""}`}
                trailing={
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>
                      {formatMinorShort(r.totalMinor)}
                    </Text>
                    <AppText
                      variant="note"
                      style={{
                        color:
                          r.sync === "local"
                            ? c.state.saved_local.fg
                            : r.sync === "pending"
                              ? c.state.pending_sync.fg
                              : c.state.synced.fg,
                      }}
                    >
                      {LABEL[r.sync]}
                    </AppText>
                  </View>
                }
                onPress={() =>
                  router.push({ pathname: "/pos/invoices/[id]", params: { id: r.id } })
                }
                last={i === rows.length - 1}
              />
            );
          })}
        </GroupedList>
      )}
    </Screen>
  );
}
