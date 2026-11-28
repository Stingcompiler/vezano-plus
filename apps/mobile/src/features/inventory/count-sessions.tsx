import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";

import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";

import { M } from "./common";

const T = "INV-14";
type State = "loading" | "ready" | "empty" | "offline" | "server_error";

interface SessionRow {
  readonly id: string;
  readonly session_number: string;
  readonly status: "closed" | "adjusted";
  readonly user_name: string;
  readonly counted_items: number;
  readonly total_items: number;
  readonly closed_at: string;
}

/**
 * INV-14 — جلسات الجرد (I-10، 0005 §٢٩٥؛ نظير الويب): الجرد الذي يعدّه أمين المخزن يجده المدير هنا —
 * كل جلسة بمن عدّها ومتى، و«جرد ينتظر التسوية» حتى تُسوّى في «مراجعة الفروق». أونلاين.
 */
export function CountSessionsScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, response } = await api.GET("/api/inventory/count-sessions", {});
      const body = data as unknown as { sessions: SessionRow[] } | undefined;
      if (!response.ok || !body) return setFailed(true);
      setFailed(false);
      setOffline(false);
      setRows(body.sessions);
    } catch {
      setOffline(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const state: State =
    offline && rows === null
      ? "offline"
      : failed && rows === null
        ? "server_error"
        : rows === null
          ? "loading"
          : rows.length === 0
            ? "empty"
            : "ready";
  const waiting = (rows ?? []).filter((r) => r.status === "closed").length;
  const open = (id: string) =>
    router.push({ pathname: "/inventory/count/[id]/review", params: { id } });

  return (
    <Screen screenId={T} state={state} title={tx(T, "جلسات الجرد")} onRefresh={() => void load()}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "جرد ينتظر التسوية")} <M>{waiting}</M>
      </AppText>
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "بلا اتصال")}>
          <AppText variant="secondary">{tx(T, "يحتاج اتصالاً")}</AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "تعذّر التحميل. أعد المحاولة.")}>
          {null}
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلسات الجرد")}>
          {null}
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا جلسات جرد")}>
          <Button label={tx(T, "جلسة جرد")} onPress={() => router.push("/inventory/count")} />
        </StateView>
      ) : null}
      {rows && rows.length > 0 ? (
        <GroupedList title={tx(T, "جلسات الجرد")}>
          {rows.map((r, i) => {
            const day = dayLabel(r.closed_at);
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={r.session_number}
                onPress={() => open(r.id)}
                style={{
                  padding: SPACE["4"],
                  gap: SPACE["1"],
                  minHeight: 52,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <AppText variant="bodyStrong">
                  {tx(T, "الجلسة")} <M>{r.session_number}</M>
                </AppText>
                <AppText variant="note" muted>
                  {r.user_name} · {tx(T, "المعدود")} <M>{r.counted_items}</M> {tx(T, "من")}{" "}
                  <M>{r.total_items}</M> · {tx(T, "أُغلقت")} {day.word ?? ""}
                  {day.n ? <M>{day.n}</M> : null} <M>{hhmm(r.closed_at)}</M>
                </AppText>
                <AppText
                  variant="note"
                  style={{ color: c.state[r.status === "closed" ? "stale" : "synced"].fg }}
                >
                  {r.status === "closed" ? tx(T, "جرد ينتظر التسوية") : tx(T, "سُوّيت")}
                </AppText>
              </Pressable>
            );
          })}
        </GroupedList>
      ) : null}
    </Screen>
  );
}
