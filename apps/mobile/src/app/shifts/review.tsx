import { formatMinorShort, hhmm } from "@sting/app-core";
import { type ClosedShift, readPendingClosedShifts } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  Sheet,
  SPACE,
  StateView,
  TextField,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SHIFT-05";

interface ServerRow {
  readonly id: string;
  readonly device_name: string;
  readonly user_name: string;
  readonly opened_at: string;
  readonly closed_at: string;
  readonly state: "open" | "closed";
  readonly count_status: string;
  readonly expected_cash_at_close_minor: string;
  readonly counted_cash_minor: string;
  readonly counted_by_name: string;
  readonly variance_minor: string;
  readonly abandoned: boolean;
  readonly review: { approved_by_name: string; reason: string } | null;
}
interface ReviewData {
  readonly scope: "all" | "branch";
  readonly can_settle: boolean;
  readonly shifts: readonly ServerRow[];
}

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * SHIFT-05 — مراجعة فروق الورديات والعمليات المتأخرة (خطة الجوال M2). الفوارق مرتّبة بالقيمة، وكل وردية
 * بفارقها ومن عدّها؛ الوردية المقفلة على جهاز لم يرفع بعد تُسمّى ويُقال إن رقمها ناقص. مدير الفرع يرى
 * فرعه ويراجع ويعلّق ولا يُسوّي؛ «إقرار المراجعة» للمالك بسبب مكتوب وباسمه، ولا يغيّر فرق الوردية المقفلة.
 */
export default function Review() {
  const c = useColors();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [data, setData] = useState<ReviewData | null>(null);
  const [local, setLocal] = useState<ClosedShift[]>([]);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<ServerRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLocal(await readPendingClosedShifts(await getStorage()));
    try {
      const { data: d, response } = await api.GET("/api/shifts/review");
      if (response.ok && d) {
        setData(d);
        setOffline(false);
      }
    } catch {
      setOffline(true);
    }
  }, [api]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows = [...(data?.shifts ?? [])].sort(
    (a, b) => Math.abs(Number(b.variance_minor)) - Math.abs(Number(a.variance_minor)),
  );
  const settle = async () => {
    if (!selected || busy || !reason.trim()) return;
    setBusy(true);
    try {
      const { response } = await api.POST("/api/shifts/{shift_id}/review", {
        params: { path: { shift_id: selected.id } },
        body: { reason: reason.trim() },
      });
      if (response.ok) {
        setSelected(null);
        setReason("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const state = offline
    ? "offline"
    : local.length
      ? "stale"
      : rows.length === 0
        ? "empty"
        : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "مراجعة فروق وعمليات متأخرة")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "كل وردية بفارقها ومن عدّها.")}
      </AppText>

      {local.length ? (
        <StateView state="stale" title={tx(T, "ورديات بانتظار المزامنة")}>
          <AppText variant="secondary">
            {tx(T, "وردية أُقفلت على جهازٍ لم يرفع بعد، فرقمها هنا ناقص.")}
          </AppText>
          {local.map((s) => (
            <AppText key={s.id} variant="note">
              {s.user_name} · <M>{hhmm(s.closed_at)}</M> · {tx(T, "مقفلة · معلّقة الرفع")}
            </AppText>
          ))}
        </StateView>
      ) : null}

      {rows.length === 0 && !offline ? (
        <StateView state="empty" title={tx(T, "لا فوارق")}>
          <AppText variant="secondary">{tx(T, "كل الورديات أُقفلت مطابقةً.")}</AppText>
        </StateView>
      ) : (
        <GroupedList title={tx(T, "الفوارق مرتّبةً بالقيمة")}>
          {rows.map((r, i) => {
            const v = BigInt(r.variance_minor || "0");
            return (
              <ListRow
                key={r.id}
                title={r.user_name}
                subtitle={`${r.device_name} · ${
                  r.state === "open"
                    ? r.abandoned
                      ? tx(T, "وردية مهجورة")
                      : tx(T, "وردية مفتوحة")
                    : r.count_status === "counted"
                      ? `${tx(T, "المعدود")} ${formatMinorShort(r.counted_cash_minor)}`
                      : tx(T, "بلا عدّ — الفارق غير معروف.")
                }`}
                trailing={
                  <Text
                    style={{
                      fontFamily: FONT.monoSemiBold,
                      writingDirection: "ltr",
                      color: v === 0n ? c.inkMuted : v < 0n ? c.danger : c.warn,
                    }}
                  >
                    {v === 0n ? tx(T, "مطابقة") : formatMinorShort(v.toString())}
                  </Text>
                }
                onPress={r.state === "closed" ? () => setSelected(r) : undefined}
                last={i === rows.length - 1}
              />
            );
          })}
        </GroupedList>
      )}

      {selected ? (
        <Sheet open title={tx(T, "مراجعة الوردية")} onClose={() => setSelected(null)}>
          <GroupedList>
            <ListRow
              title={tx(T, "النقد المتوقع وقت الإغلاق")}
              trailing={<M>{formatMinorShort(selected.expected_cash_at_close_minor)}</M>}
            />
            <ListRow
              title={tx(T, "المعدود")}
              trailing={<M>{formatMinorShort(selected.counted_cash_minor)}</M>}
            />
            <ListRow
              title={tx(T, "الفرق وقت الإغلاق")}
              trailing={<M>{formatMinorShort(selected.variance_minor)}</M>}
              last
            />
          </GroupedList>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "لن يتغير فرق الوردية المغلقة.")}
          </AppText>
          {selected.review ? (
            <AppText variant="secondary">
              {tx(T, "إقرار المراجعة باسم")} {selected.review.approved_by_name}:{" "}
              {selected.review.reason}
            </AppText>
          ) : data?.can_settle ? (
            <>
              <TextField
                label={tx(T, "السبب")}
                hint={tx(T, "إلزامي")}
                value={reason}
                onChangeText={setReason}
                required
              />
              <Button
                label={tx(T, "إقرار المراجعة")}
                financial
                loading={busy}
                disabledReason={reason.trim() ? undefined : tx(T, "السبب")}
                onPress={() => void settle()}
              />
            </>
          ) : (
            <AppText variant="note">{tx(T, "التسوية للمالك")}</AppText>
          )}
        </Sheet>
      ) : null}
      {ctx ? null : null}
    </Screen>
  );
}
