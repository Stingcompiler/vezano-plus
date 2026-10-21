import { hhmm } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import { M, Note, Row, Stack, StateWord } from "@/components/market-seller/parts";
import { netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "GROW-01";

interface RowT {
  item_id: string;
  item_name: string;
  base_unit_name: string;
  stock_milli: string;
  stock_label: string;
  days_left: number | null;
  days_left_label: string;
  supplier_id: string;
  supplier_name: string;
  lead_days: number | null;
  supplier_line: string;
  unit_code: string;
  unit_name: string;
  factor_milli: string;
  suggested: number;
  suggested_label: string;
  need: boolean;
  basis: string;
}
interface Payload {
  state: "ready" | "empty" | "phase_locked" | "permission_denied";
  role_name?: string;
  can_convert?: boolean;
  value_hidden?: boolean;
  ask_name?: string;
  forwards?: { by_name: string; at: string; note: string; lines: unknown[]; to_name: string }[];
  computed_at?: string;
  branch_name?: string;
  checked_count?: number;
  rows?: RowT[];
  need_count?: number;
  next_check?: string;
}

/** «صنف واحد / صنفان / N أصناف / N صنفاً». */
function ItemsWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "صنف واحد")}</>;
  if (n === 2) return <>{tx(T, "صنفان")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "أصناف") : tx(T, "صنفاً")}
    </>
  );
}

/** GROW-01 — اقتراح إعادة التوريد (32-D24 ready/empty/permission_denied · phase_locked): رأيٌ يُعرَض بسببه؛ لا شيء يُطلب حتى تختار. */
export default function GrowReplenishScreen() {
  const router = useRouter();
  const { api } = useSession();
  const [compute, setCompute] = useState(0);
  const srv = useServerGet<Payload>(
    "cache.grow.replenish",
    () =>
      safeGet(
        () =>
          api.GET("/api/grow/replenish", { params: { query: compute ? { compute: "1" } : {} } }),
        (b) => b as Payload | undefined,
        [403],
      ),
    [compute],
  );
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [forwarded, setForwarded] = useState<{ to_name: string } | null>(null);
  const [created, setCreated] = useState<{ number: string; id: string } | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const rows = data?.rows ?? [];
  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    data?.state === "permission_denied"
      ? "permission_denied"
      : data?.state === "empty"
        ? "empty"
        : (net ?? (data ? "ready" : "loading"));
  const selected = rows.filter(
    (r) => picked[r.item_id] !== undefined && Number(picked[r.item_id]) > 0,
  );
  const supplierIds = new Set(selected.map((r) => r.supplier_id));
  const canConvert = data?.can_convert !== false;
  const lines = () =>
    selected.map((r) => ({
      item_id: r.item_id,
      unit_code: r.unit_code,
      qty_milli: String(Math.round(Number(picked[r.item_id]) * 1000)),
    }));

  const forward = async () => {
    if (busy) return;
    setBusy("forward");
    setErr("");
    setOfflineTry(false);
    try {
      const r = await send<{ forwarded?: { to_name: string }; detail?: string }>(() =>
        api.POST("/api/grow/replenish", {
          body: { action: "forward", note, lines: lines() } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.forwarded) {
        setForwarded(r.body.forwarded);
        setPicked({});
        setNote("");
        return;
      }
      setErr(r.body?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const convert = async () => {
    if (busy || selected.length === 0) return;
    if (supplierIds.size !== 1) {
      setErr("supplier_mixed");
      return;
    }
    setBusy("convert");
    setErr("");
    setOfflineTry(false);
    try {
      const r = await send<{ order?: { id: string; number: string }; detail?: string }>(() =>
        api.POST("/api/grow/replenish", {
          body: { supplier_id: selected[0].supplier_id, lines: lines() } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.order) {
        setCreated(r.body.order);
        setPicked({});
        return;
      }
      setErr(r.body?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "اقتراح إعادة التوريد — رأيٌ يُعرَض بسببه")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "النظام لا يشتري نيابةً عنك. يقترح كمية ويقول من أين جاءت: متوسط بيع، ومهلة توريد، ورصيد أمان. كل رقم في الاقتراح قابل للفتح على حسابه.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "permission_denied" && !data?.rows ? (
        <StateView
          state="permission_denied"
          title={tx(T, "اقتراح التوريد للمالك ومدير الفرع وأمين المخزن")}
        >
          <AppText variant="secondary">
            {tx(T, "الاقتراح يصير أمر شراء — التزام مالي. دورك")}
            {data?.role_name ? ` «${data.role_name}»` : ""} {tx(T, "لا يرى المخزون ولا الاقتراح.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "permission_denied" && data?.rows ? (
        <StateView state="permission_denied" title={tx(T, "يُرى ولا يُحوَّل")}>
          <AppText variant="secondary">
            {tx(T, "أمين المخزن يرى الاقتراح — هو أدرى بما على الرفّ — ولا يحوّله إلى أمر شراء.")}
          </AppText>
        </StateView>
      ) : null}
      {forwarded ? (
        <StateView
          state="success"
          title={`${tx(T, "أُرسل الاقتراح إلى")} ${forwarded.to_name || tx(T, "المالك")}`}
        >
          <AppText variant="secondary">
            {tx(T, "تعديلاتك على الكميات أُرسلت مع الاقتراح موسومةً باسمك.")}
          </AppText>
        </StateView>
      ) : null}
      {data?.forwards?.length && canConvert ? (
        <StateView state="ready" title={`${tx(T, "اقتراح مُرسَل من")} ${data.forwards[0].by_name}`}>
          <AppText variant="secondary">
            {data.forwards[0].note || tx(T, "بلا ملاحظة")} · <M>{hhmm(data.forwards[0].at)}</M>{" "}
            {tx(T, "· تعديلاته على الكميات موسومة باسمه.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && data ? (
        <StateView state="empty" title={tx(T, "لا اقتراحات")}>
          <AppText variant="secondary">
            {tx(
              T,
              "كل الأصناف فوق حدّ الأمان. الفراغ هنا نتيجة حسابٍ تمّ، لا غياب بيانات — والفرق يُقال.",
            )}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "«فُحص")} <M>{data.checked_count ?? 0}</M>{" "}
            {tx(T, "صنفاً · لا شيء يحتاج توريداً اليوم · الفحص التالي")}{" "}
            {data.next_check ?? tx(T, "غداً 6 ص")}».
          </AppText>
        </StateView>
      ) : null}
      {created ? (
        <StateView state="success" title={`${tx(T, "أُنشئ أمر الشراء")} ${created.number}`}>
          <AppText variant="secondary">
            {tx(T, "الكميات كما اخترتها — قابلة للتعديل قبل الإرسال وبعده.")}
          </AppText>
          <Button
            label={tx(T, "افتح أمر الشراء")}
            variant="secondary"
            onPress={() => router.push(`/purchasing/orders/${created.id}`)}
          />
        </StateView>
      ) : null}
      {err ? (
        <StateView state="partial" title={tx(T, "لم يُنشأ الأمر")}>
          <AppText variant="secondary">
            {err === "supplier_mixed"
              ? tx(T, "اختر أصناف مورد واحد لكل أمر — الأمر يذهب إلى مورد بعينه.")
              : err}
          </AppText>
        </StateView>
      ) : null}

      {data && data.rows ? (
        <>
          <AppText variant="secondary" style={{ marginBottom: 8 }}>
            <StateWord state="synced" label={tx(T, "النموّ")} /> {tx(T, "اقتراح التوريد —")}{" "}
            <ItemsWord n={rows.length} /> {tx(T, "· محسوب")}{" "}
            <M>{data.computed_at ? hhmm(data.computed_at) : "—"}</M>
          </AppText>
          <Stack>
            <Button
              label={tx(T, "احسب الآن")}
              variant="quiet"
              onPress={() => setCompute((n) => n + 1)}
            />
          </Stack>
          <Note>
            <AppText variant="bodyStrong">{tx(T, "لا شيء يُطلب حتى تختار")}</AppText>{" "}
            {tx(
              T,
              "· الاقتراح يصير أمر شراء باختيار صريح، والكميات تبقى قابلة للتعديل قبل ذلك وبعده.",
            )}
          </Note>

          <GroupedList title={tx(T, "اقتراح التوريد")}>
            {rows.map((r) => (
              <View key={r.item_id}>
                <Row
                  title={r.item_name}
                  sub={
                    <>
                      {r.supplier_line}
                      {"\n"}
                      {tx(T, "الرصيد")}: {r.stock_label} · {tx(T, "يكفي")} {r.days_left_label}
                      {"\n"}
                      {tx(T, "على أيّ أساس")}: {r.basis}
                    </>
                  }
                  trailing={
                    r.stock_label === tx(T, "نفد") ? (
                      <StateWord state="conflict" label={tx(T, "نفد")} />
                    ) : undefined
                  }
                />
                {r.need || r.supplier_id ? (
                  <View style={{ paddingHorizontal: 16 }}>
                    {r.need ? (
                      <Note>
                        {tx(T, "المقترح")}: {r.suggested_label}
                      </Note>
                    ) : null}
                    <TextField
                      label={
                        r.need
                          ? `${tx(T, "الكمية بـ")}${r.unit_name}`
                          : `${tx(T, "ضمّه (")}${r.unit_name})`
                      }
                      mono
                      keyboardType="decimal-pad"
                      value={picked[r.item_id] ?? ""}
                      onChangeText={(v) => setPicked({ ...picked, [r.item_id]: v })}
                    />
                  </View>
                ) : null}
              </View>
            ))}
            {rows.length === 0 ? <Row title={tx(T, "لا أصناف في الاقتراح.")} dim last /> : null}
          </GroupedList>

          {canConvert ? (
            <Stack>
              <Button
                label={tx(T, "حوّل المختار إلى أمر شراء")}
                financial
                loading={busy === "convert"}
                onPress={() => void convert()}
                disabledReason={selected.length ? undefined : tx(T, "اختر صنفاً واكتب كميته أولاً")}
              />
            </Stack>
          ) : (
            <>
              <TextField
                label={tx(T, "ملاحظاتك على الكميات")}
                value={note}
                onChangeText={setNote}
              />
              <Stack>
                <Button
                  label={`${tx(T, "أرسل الاقتراح إلى")} ${data.ask_name || tx(T, "المالك")}`}
                  financial
                  loading={busy === "forward"}
                  onPress={() => void forward()}
                />
                <Button
                  label={tx(T, "حوّل المختار إلى أمر شراء")}
                  variant="secondary"
                  onPress={() => undefined}
                  disabledReason={tx(T, "أمين المخزن يرى الاقتراح ولا يحوّله إلى أمر شراء")}
                />
              </Stack>
              <Note>{tx(T, "تعديلاته على الكميات تُرسل مع الاقتراح موسومةً باسمه.")}</Note>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
