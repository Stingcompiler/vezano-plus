import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView } from "@sting/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import { M, Note, Row, StateWord } from "@/components/market-seller/parts";
import { netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "LINK-05";

interface RLine {
  offer_id: string;
  name: string;
  unit_name: string;
  requested: number;
  approved: number;
  pending: number;
  reason: string;
  price_minor: number;
}
interface Ret {
  return_id: string;
  ref_label: string;
  order_label: string;
  supplier_name: string;
  status: "approved" | "partial" | "rejected" | "executed";
  status_label: string;
  decision_note: string;
  lines: RLine[];
  converted: boolean;
  local_number: string;
  reverse_partial: boolean;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_convert: boolean;
  returns: Ret[];
  pending_count: number;
}
interface Row2 {
  key: string;
  ret: Ret;
  line: RLine;
}

/** LINK-05 — تحويل المرتجع لمستند عكسي (29-D22 ready/partial/success · 38-D30 validation_error · phase_locked): بالكمية المتفَق عليها فقط (ACC-132). */
export default function LinkReturnsScreen() {
  const { api } = useSession();
  const srv = useServerGet<Payload>("cache.market.link.returns", () =>
    safeGet(() => api.GET("/api/market/link/returns")),
  );
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{
    code: string;
    errors: { name: string; max_qty_milli?: string }[];
  } | null>(null);
  const [done, setDone] = useState<{ local_number: string; ref: string } | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  const convert = async (r: Ret) => {
    if (busy) return;
    setBusy(r.return_id);
    setErr(null);
    setOfflineTry(false);
    try {
      const res = await send<{
        link?: { local_number: string };
        detail?: string;
        extra?: { errors?: { name: string; max_qty_milli?: string }[] };
      }>(() =>
        api.POST("/api/market/link/returns/{return_id}/{action}", {
          params: { path: { return_id: r.return_id, action: "convert" } },
          body: {} as never,
        }),
      );
      if (res.kind === "offline") return setOfflineTry(true);
      if (res.kind === "ok" && res.body.link) {
        setDone({ local_number: res.body.link.local_number, ref: r.ref_label });
        await srv.reload();
        return;
      }
      setErr({ code: res.body?.detail ?? "server_error", errors: res.body?.extra?.errors ?? [] });
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const rows: Row2[] = (data?.returns ?? []).flatMap((ret) =>
    ret.lines.map((line) => ({ key: `${ret.return_id}:${line.offer_id}`, ret, line })),
  );
  const anyPartial = (data?.returns ?? []).some((r) => r.converted && r.reverse_partial);
  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    err?.code === "exceeds_received"
      ? "validation_error"
      : done
        ? "success"
        : anyPartial
          ? "partial"
          : (net ?? (data ? "ready" : "loading"));

  const reverseCell = (r: Row2) => {
    if (r.ret.status === "rejected")
      return (
        <AppText variant="secondary">
          {tx(T, "رُفض الإرجاع بسبب مكتوب. لا مستند عكسي، والبند مفتوح لخلاف إن أردت.")}
        </AppText>
      );
    if (r.ret.converted) {
      if (r.line.pending > 0)
        return (
          <AppText variant="secondary">
            {tx(T, "عكسي بـ")}
            <M>{r.line.approved}</M> {tx(T, "فقط.")}{" "}
            {r.line.pending === 8 ? (
              tx(T, "الثمانية الباقية")
            ) : (
              <>
                {tx(T, "الباقي (")}
                <M>{r.line.pending}</M>)
              </>
            )}{" "}
            {tx(T, "بند معلّق بسبب المورد المكتوب — لا تُلغى ولا تُكتب.")}{" "}
            <M>{r.ret.local_number}</M>
          </AppText>
        );
      return (
        <AppText variant="secondary">
          {tx(T, "مستند عكسي")} <M>{r.ret.local_number}</M> {tx(T, "— كامل")}
        </AppText>
      );
    }
    return null;
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "تحويل المرتجع لمستند عكسي")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "المستند العكسي يُكتب بالكمية المتفَق عليها فقط. ما لم يوافق عليه المورد لا يُكتب ولا يُلغى — يظل بنداً معلّقاً بسببه، لأن طيّه صامتاً يعني تنازلاً لم تقرّه.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "validation_error" && err ? (
        <StateView state="validation_error" title={tx(T, "مرتجع يتجاوز ما استُلم")}>
          <AppText variant="secondary">
            {tx(T, "مرتجع السوق أكبر مما دخل دفترك من مستند الاستلام.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الحدّ من دفترك")}</AppText>{" "}
            {tx(T, "· لا من دفتر الطرف الآخر. دفتراهما مستقلان، وما نعكسه هو ما دخل عندنا.")}
          </AppText>
          {err.errors.map((e, i) => (
            <AppText key={i} variant="secondary">
              <AppText variant="bodyStrong">{e.name}</AppText>
              {e.max_qty_milli ? (
                <>
                  {" "}
                  {tx(T, "الحدّ من دفترك:")} <M>{Number(e.max_qty_milli) / 1000}</M>
                </>
              ) : null}
            </AppText>
          ))}
        </StateView>
      ) : null}
      {err && err.code !== "exceeds_received" ? (
        <StateView state="partial" title={tx(T, "لم يُكتب المستند العكسي")}>
          <AppText variant="secondary">
            {err.code === "receipt_not_converted"
              ? tx(T, "حوّل استلام هذا الطلب أولاً — العكسي يشير إلى الأصل.")
              : err.code}
          </AppText>
        </StateView>
      ) : null}
      {state === "success" && done ? (
        <StateView state="success" title={tx(T, "كُتب المستند العكسي بالمقبول وحده")}>
          <AppText variant="secondary">
            <M>{done.local_number}</M> {tx(T, "من")} {done.ref}.{" "}
            <AppText variant="bodyStrong">{tx(T, "الجزء المتبقّي يبقى مطلباً مفتوحاً.")}</AppText>
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الأثر السابق محفوظ")}</AppText>{" "}
            {tx(T, "· مستند الاستلام الأصلي لا يُعدَّل ولا يُحذف. المرتجع مستند مستقلّ يشير إليه.")}
          </AppText>
          <Button label={tx(T, "التالي")} variant="secondary" onPress={() => setDone(null)} />
        </StateView>
      ) : null}
      {state === "partial" ? (
        <StateView state="partial" title={tx(T, "الجزء المتبقّي يبقى مطلباً مفتوحاً.")}>
          <AppText variant="secondary">
            {tx(
              T,
              "المستند العكسي يُكتب بالكمية المتفَق عليها فقط. ما لم يوافق عليه المورد لا يُكتب ولا يُلغى — يظل بنداً معلّقاً بسببه، لأن طيّه صامتاً يعني تنازلاً لم تقرّه.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {data ? (
        <>
          <AppText variant="secondary" style={{ marginBottom: 8 }}>
            <StateWord
              state={anyPartial ? "partial" : "synced"}
              label={anyPartial ? tx(T, "بند معلّق") : tx(T, "مرتجعات محسومة")}
            />
            {" · "}
            <M>{data.pending_count}</M> {tx(T, "بانتظار مستند عكسي")}
          </AppText>
          <GroupedList title={tx(T, "المرتجعات ومستنداتها العكسية")}>
            {rows.map((r) => (
              <View key={r.key}>
                <Row
                  title={
                    <>
                      {r.line.name} — {r.line.unit_name}
                    </>
                  }
                  sub={
                    <>
                      <M>{r.ret.ref_label}</M> · <M>{r.ret.order_label}</M> · {r.ret.supplier_name}
                      {"\n"}
                      {tx(T, "طُلب إرجاعه")}: <M>{r.line.requested}</M>
                      {"\n"}
                      {tx(T, "وافق المورد")}:{" "}
                      {r.ret.status === "rejected" ? tx(T, "رُفض") : <M>{r.line.approved}</M>}
                    </>
                  }
                />
                <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                  {reverseCell(r)}
                  {r.ret.status !== "rejected" && !r.ret.converted ? (
                    <Button
                      label={`${tx(T, "اكتب المستند العكسي بالمقبول (")}${r.line.approved})`}
                      financial
                      loading={busy === r.ret.return_id}
                      onPress={() => void convert(r.ret)}
                      disabledReason={
                        data.can_convert ? undefined : tx(T, "التحويل للمالك ومدير الفرع")
                      }
                    />
                  ) : null}
                </View>
              </View>
            ))}
            {rows.length === 0 ? (
              <Row title={tx(T, "لا مرتجعات محسومة من منشآت مربوطة بعد.")} dim last />
            ) : null}
          </GroupedList>
          <Note>
            <AppText variant="bodyStrong">{tx(T, "الأثر السابق محفوظ")}</AppText>{" "}
            {tx(T, "· مستند الاستلام الأصلي لا يُعدَّل ولا يُحذف. المرتجع مستند مستقلّ يشير إليه.")}
          </Note>
        </>
      ) : null}
    </Screen>
  );
}
