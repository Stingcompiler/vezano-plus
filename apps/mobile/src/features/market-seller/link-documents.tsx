import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import {
  ChipRow,
  Heading,
  M,
  NodeChip,
  Note,
  Row,
  Stack,
  StateWord,
} from "@/components/market-seller/parts";
import { netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "LINK-04";

interface Link {
  id: string;
  kind: "receipt" | "return";
  kind_label: string;
  mode: string;
  order_label: string;
  shipment_label: string;
  local_number: string;
  my_value_minor: string;
  their_value_minor: string;
  diff_minor: string;
  path: string;
  settled: boolean;
  settled_by_name: string;
  settlement_path: string;
  settlement_note: string;
}
interface Payment {
  id: string;
  ref_label: string;
  order_label: string;
  amount_minor: string;
  path: string;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_settle: boolean;
  links: Link[];
  payments: Payment[];
  linked_count: number;
  diff_count: number;
}

/** «مستند واحد مرتبط / مستندان مرتبطان / N مستندات مرتبطة / N مستنداً مرتبطاً». */
function DocsLinked({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "مستند واحد مرتبط")}</>;
  if (n === 2) return <>{tx(T, "مستندان مرتبطان")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "مستندات مرتبطة") : tx(T, "مستنداً مرتبطاً")}
    </>
  );
}

/** LINK-04 — روابط المستندات وتسوية الفرق (29-D22 ready/conflict/permission_denied · 38-D30 empty · phase_locked): دفتران مستقلّان لا دفتر مشترك. */
export default function LinkDocumentsScreen() {
  const { api } = useSession();
  const srv = useServerGet<Payload>("cache.market.link.documents", () =>
    safeGet(() => api.GET("/api/market/link/documents")),
  );
  const [settling, setSettling] = useState<Link | null>(null);
  const [path, setPath] = useState<"dispute" | "agreement">("dispute");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  const settle = async (l: Link) => {
    if (busy) return;
    setBusy(l.id);
    setErr("");
    setOfflineTry(false);
    try {
      const r = await send<{ detail?: string }>(() =>
        api.POST("/api/market/link/documents/{link_id}/{action}", {
          params: { path: { link_id: l.id, action: "settle" } },
          body: { path, note } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok") {
        setSettling(null);
        setNote("");
        await srv.reload();
        return;
      }
      setErr(r.body?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    err === "permission_denied" || (data && !data.can_settle && settling)
      ? "permission_denied"
      : data && data.diff_count === 0
        ? "empty"
        : data && data.diff_count > 0
          ? "conflict"
          : (net ?? "loading");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "روابط المستندات وتسوية الفرق — دفتران مستقلّان لا دفتر مشترك")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "نعرض رقمك ورقمه والفرق بينهما. لا نُصدر «الرقم الصحيح» — التسوية إجراء مخوَّل يكتبه أحد الطرفين في دفتره وحده.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الفرق مسجَّل — أُرسل للمالك للمراجعة")}>
          <AppText variant="secondary">
            {tx(
              T,
              "التسوية تكتب رقماً في دفترك المالي، فهي صلاحية من له حدّ مالي. لمن دونه: «الفرق مسجَّل — أُرسل للمالك للمراجعة» ومعه نسخة من المستندين.",
            )}
          </AppText>
          <Button
            label={tx(T, "فهمت")}
            variant="secondary"
            onPress={() => {
              setSettling(null);
              setErr("");
            }}
          />
        </StateView>
      ) : null}
      {state === "empty" && data ? (
        <StateView state="empty" title={tx(T, "لا فروق")}>
          <AppText variant="secondary">
            {tx(T, "كل مستندات السوق طابقت نظائرها المحلية. حالةٌ صحّية.")}
          </AppText>
          <AppText variant="note" muted>
            «<DocsLinked n={data.linked_count} /> {tx(T, "· لا فروق».")}
          </AppText>
        </StateView>
      ) : null}
      {err && err !== "permission_denied" ? (
        <StateView state="partial" title={tx(T, "لم تُسجَّل التسوية")}>
          <AppText variant="secondary">
            {err === "note_required" ? tx(T, "الاتفاق المكتوب يحتاج نصّه.") : err}
          </AppText>
        </StateView>
      ) : null}

      {data ? (
        <>
          <AppText variant="secondary" style={{ marginBottom: 8 }}>
            <StateWord
              state={data.diff_count ? "conflict" : "success"}
              label={
                data.diff_count ? (
                  <>
                    <M>{data.diff_count}</M> {tx(T, "فروق بانتظار مسار")}
                  </>
                ) : (
                  tx(T, "لا فروق")
                )
              }
            />
            {" · "}
            <M>{data.linked_count}</M> {tx(T, "مستنداً مرتبطاً")}
          </AppText>

          <GroupedList title={tx(T, "روابط المستندات")}>
            {data.links.map((l) => (
              <View key={l.id}>
                <Row
                  title={
                    <>
                      {l.kind_label} · <M>{l.local_number}</M> ↔{" "}
                      <M>{l.shipment_label || l.order_label}</M>
                    </>
                  }
                  sub={
                    <>
                      {tx(T, "في دفترك")}: <M>{formatMinor(l.my_value_minor)}</M>
                      {"\n"}
                      {tx(T, "في دفتر المورد")}: <M>{formatMinor(l.their_value_minor)}</M>
                      {"\n"}
                      {tx(T, "الفرق")}:{" "}
                      {l.diff_minor === "0" ? tx(T, "متطابق") : <M>{formatMinor(l.diff_minor)}</M>}
                      {"\n"}
                      {tx(T, "المسار")}:{" "}
                      {l.settled ? (
                        <>
                          {tx(T, "سُوّي ·")}{" "}
                          {l.settlement_path === "dispute"
                            ? tx(T, "خلاف موثَّق")
                            : tx(T, "اتفاق مكتوب")}{" "}
                          · {l.settled_by_name}
                          {l.settlement_note ? `\n${l.settlement_note}` : ""}
                        </>
                      ) : (
                        l.path
                      )}
                    </>
                  }
                  trailing={
                    l.diff_minor === "0" ? (
                      <StateWord state="success" label={tx(T, "متطابق")} />
                    ) : undefined
                  }
                />
                {!l.settled && l.diff_minor !== "0" ? (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                    <Button
                      label={tx(T, "سجّل مسار التسوية")}
                      variant="secondary"
                      onPress={() => {
                        setSettling(l);
                        setErr("");
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ))}
            {data.links.length === 0 ? (
              <Row
                title={tx(T, "لا مستندات مرتبطة بعد — حوّل استلاماً من «تحويل الاستلام».")}
                dim
                last
              />
            ) : null}
          </GroupedList>

          {data.payments.length ? (
            <>
              <Heading>{tx(T, "إثبات دفع بلا مقابل")}</Heading>
              <GroupedList>
                {data.payments.map((p, i) => (
                  <Row
                    key={p.id}
                    title={
                      <>
                        <M>{p.ref_label}</M> {tx(T, "على")} <M>{p.order_label}</M> ·{" "}
                        <M>{formatMinor(p.amount_minor)}</M>
                      </>
                    }
                    sub={p.path}
                    trailing={<StateWord state="stale" label={tx(T, "معلّق للمطابقة")} />}
                    last={i === data.payments.length - 1}
                  />
                ))}
              </GroupedList>
            </>
          ) : null}

          {settling && data.can_settle ? (
            <>
              <Heading>
                {tx(T, "مسار التسوية —")} <M>{settling.local_number}</M>
              </Heading>
              <ChipRow>
                <NodeChip on={path === "dispute"} onPress={() => setPath("dispute")}>
                  {tx(T, "فتح خلاف موثَّق")}
                </NodeChip>
                <NodeChip on={path === "agreement"} onPress={() => setPath("agreement")}>
                  {tx(T, "اتفاق مكتوب")}
                </NodeChip>
              </ChipRow>
              <TextField
                label={tx(T, "نصّ الاتفاق أو مرجع الخلاف")}
                value={note}
                onChangeText={setNote}
              />
              <Stack>
                <Button
                  label={tx(T, "سجّل — في دفترك وحده")}
                  financial
                  loading={busy === settling.id}
                  onPress={() => void settle(settling)}
                />
                <Button label={tx(T, "إلغاء")} variant="quiet" onPress={() => setSettling(null)} />
              </Stack>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
