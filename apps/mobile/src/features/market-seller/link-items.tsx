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

const T = "LINK-02";

interface Mapping {
  id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  offer_id: string;
  offer_name: string;
  offer_unit_name: string;
  offer_pack_label: string;
  factor_milli: string;
  status: "matched" | "needs_definition" | "needs_review";
  status_label: string;
  supplier_changed: boolean;
}
interface UnmappedOffer {
  offer_id: string;
  public_name: string;
  unit_name: string;
  pack_label: string;
  defined: boolean;
}
interface ItemRow {
  item_id: string;
  name: string;
  base_unit_code: string;
  base_unit_name: string;
  units: { code: string; name: string; factor_milli: string }[];
}
interface Payload {
  state: "ready" | "phase_locked";
  counterparties: { tenant_id: string; name: string }[];
  counterparty_tenant_id: string;
  mappings: Mapping[];
  matched_count: number;
  review_count: number;
  unmapped_offers: UnmappedOffer[];
  items: ItemRow[];
}

export const factorWord = (milli: string) => {
  const n = Number(milli) / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
};

/** جمع وحدتك مضافاً إليك كما يكتبه الإطار («أكياسك») — لأشهر الوحدات، وإلا «وحداتك (…)». */
const unitsOfYours = (unitName: string) => {
  const u = unitName.trim();
  if (u.startsWith(tx(T, "كيس"))) return tx(T, "أكياسك");
  if (u.startsWith(tx(T, "علبة"))) return tx(T, "علبك");
  if (u.startsWith(tx(T, "عبوة"))) return tx(T, "عبواتك");
  if (u.startsWith(tx(T, "كرتونة"))) return tx(T, "كراتينك");
  if (u.startsWith(tx(T, "قطعة"))) return tx(T, "قطعك");
  return `${tx(T, "وحداتك (")}${u})`;
};
/** «كرتونته»: وحدة المورد مضافةً إليه — التاء المربوطة تُفتح قبل الضمير. */
const hisUnit = (u: string) =>
  u.trim().endsWith(tx(T, "ة"))
    ? `${u.trim().slice(0, -1)}${tx(T, "ته")}`
    : `${u.trim()}${tx(T, "ه")}`;

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

function FactorCell({ m }: { m: Mapping }) {
  if (m.status === "needs_definition")
    return (
      <>
        {tx(T, "وحدته «")}
        {m.offer_unit_name}
        {tx(T, "» بلا عدد معلَن. لا نُخمّن 4 أو 6 — نطلب توضيحاً منه قبل المطابقة.")}
      </>
    );
  if (m.status === "needs_review")
    return (
      <>
        {tx(
          T,
          "غيّر المورد تعريف صنفه. المطابقة القديمة موقوفة حتى تراجعها — لا نُمرّرها بافتراض أنها كما كانت.",
        )}
      </>
    );
  if (m.factor_milli === "1000" && m.item_name !== m.offer_name)
    return <>{tx(T, "مطابَق. الاسم مختلف والصنف واحد — الأسماء لا تُطابِق، أنت تُطابِق.")}</>;
  return (
    <>
      {tx(T, "تحويل مؤكَّد:")} {hisUnit(m.offer_unit_name)} = <M>{factorWord(m.factor_milli)}</M>{" "}
      {tx(T, "من")} {unitsOfYours(m.unit_name)}
      {tx(T, ". أنت أقررته.")}
    </>
  );
}

/** LINK-02 — مطابقة الأصناف والوحدات (29-D22 ready/conflict · 38-D30 validation_error/success · phase_locked): التحويل مؤكَّد أو لا يكون. */
export default function LinkItemsScreen() {
  const { api } = useSession();
  const [cpSel, setCpSel] = useState("");
  const srv = useServerGet<Payload>(
    `cache.market.link.items.${cpSel || "default"}`,
    () =>
      safeGet(() =>
        api.GET("/api/market/link/items", {
          params: { query: cpSel ? { counterparty: cpSel } : {} },
        }),
      ),
    [cpSel],
  );
  const [offer, setOffer] = useState<UnmappedOffer | null>(null);
  const [itemId, setItemId] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [factor, setFactor] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, string> } | null>(null);
  const [saved, setSaved] = useState<Mapping | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;
  const cp = cpSel || data?.counterparty_tenant_id || "";

  const save = async () => {
    if (busy || !offer) return;
    setBusy("save");
    setErr(null);
    setOfflineTry(false);
    try {
      const r = await send<{
        mapping?: Mapping;
        detail?: string;
        extra?: Record<string, string>;
      }>(() =>
        api.POST("/api/market/link/items", {
          body: {
            counterparty_tenant_id: cp,
            item_id: itemId,
            offer_id: offer.offer_id,
            unit_code: unitCode,
            factor_milli: factor ? String(Math.round(Number(factor) * 1000)) : "",
          } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.mapping) {
        setSaved(r.body.mapping);
        setOffer(null);
        setFactor("");
        await srv.reload();
        return;
      }
      setErr({ code: r.body?.detail ?? "server_error", extra: r.body?.extra ?? {} });
    } finally {
      setBusy("");
    }
  };

  const act = async (m: Mapping, action: "confirm" | "remove") => {
    if (busy) return;
    setBusy(`${action}:${m.id}`);
    setOfflineTry(false);
    try {
      const r = await send<unknown>(() =>
        api.POST("/api/market/link/items/{mapping_id}/{action}", {
          params: { path: { mapping_id: m.id, action } },
          body: {} as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok") await srv.reload();
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    err?.code === "factor_required"
      ? "validation_error"
      : saved
        ? "success"
        : data && data.review_count > 0
          ? "conflict"
          : (net ?? (data ? "ready" : "loading"));
  const item = data?.items.find((i) => i.item_id === itemId) ?? null;
  const unitName = item
    ? unitCode === item.base_unit_code || !unitCode
      ? item.base_unit_name
      : (item.units.find((u) => u.code === unitCode)?.name ?? item.base_unit_name)
    : "";

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "مطابقة الأصناف والوحدات — التحويل مؤكَّد أو لا يكون")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "صنفك وصنف المورد كيانان مستقلّان لكلٍّ ملكيته. المطابقة تربط بينهما بمعامل تحويل صريح، ولا نُخمّن أن «كرتونة» عنده = «كرتونة» عندك.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "validation_error" && err ? (
        <StateView state="validation_error" title={tx(T, "وحدتان لا تتطابقان")}>
          <AppText variant="secondary">
            {tx(T, "مطابقة صنفٍ يُباع بالكرتون بصنفٍ يُخزَّن بالكيس بلا معامل بينهما.")}
          </AppText>
          <AppText variant="note" muted>
            «{err.extra.offer_unit_name ?? tx(T, "كرتون")} {tx(T, "= كم")}{" "}
            {err.extra.unit_name ?? tx(T, "كيساً")}
            {tx(T, "؟»")}
          </AppText>
        </StateView>
      ) : null}
      {err && err.code !== "factor_required" ? (
        <StateView state="partial" title={tx(T, "لم تُحفظ المطابقة")}>
          <AppText variant="secondary">
            {err.code === "not_linked" ? tx(T, "اربط الطرف أولاً.") : err.code}
          </AppText>
        </StateView>
      ) : null}
      {state === "success" && data ? (
        <StateView state="success" title={tx(T, "طوبقت الأصناف")}>
          <AppText variant="secondary">
            <ItemsWord n={data.matched_count} /> {tx(T, "مطابَقاً و")}
            {data.unmapped_offers.length === 0 ? (
              tx(T, "لا شيء")
            ) : (
              <ItemsWord n={data.unmapped_offers.length} />
            )}{" "}
            {tx(T, "بلا مقابل. و")}
            {data.unmapped_offers.length === 3 ? tx(T, "الثلاثة") : tx(T, "الباقي")}{" "}
            {tx(T, "لا تمنع العمل — تُنشأ عند أول استلام.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "المطابقة تُراجَع")}</AppText>{" "}
            {tx(T, "· قابلة للتعديل دائماً، وتغييرها لا يمسّ مستنداً مضى — كمعامل التحويل تماماً.")}
          </AppText>
          <Button label={tx(T, "التالي")} variant="secondary" onPress={() => setSaved(null)} />
        </StateView>
      ) : null}
      {state === "conflict" && data ? (
        <StateView state="conflict" title={tx(T, "تغيّر تعريف صنف المورد — راجع المطابقة")}>
          <AppText variant="secondary">
            <M>{data.review_count}</M>{" "}
            {data.review_count === 1 ? tx(T, "مطابقة موقوفة") : tx(T, "مطابقات موقوفة")}{" "}
            {tx(T, "حتى تراجعها — لا نُمرّرها بافتراض أنها كما كانت.")}
          </AppText>
        </StateView>
      ) : null}

      {data ? (
        <>
          {data.counterparties.length > 1 ? (
            <ChipRow>
              {data.counterparties.map((c) => (
                <NodeChip
                  key={c.tenant_id}
                  on={cp === c.tenant_id}
                  onPress={() => setCpSel(c.tenant_id)}
                >
                  {c.name}
                </NodeChip>
              ))}
            </ChipRow>
          ) : null}
          {data.counterparties.length === 0 ? (
            <StateView state="empty" title={tx(T, "لا منشأة مربوطة بعد")}>
              <AppText variant="secondary">{tx(T, "المطابقة تبدأ بعد ربط الطرف.")}</AppText>
            </StateView>
          ) : null}

          <GroupedList title={tx(T, "المطابقات")}>
            {data.mappings.map((m) => (
              <View key={m.id}>
                <Row
                  title={
                    <>
                      {m.item_name} — {m.unit_name}
                    </>
                  }
                  sub={
                    <>
                      {tx(T, "صنف المورد ووحدته")}: {m.offer_name} —{" "}
                      {m.offer_pack_label || m.offer_unit_name}
                      {"\n"}
                      {tx(T, "معامل التحويل")}: <FactorCell m={m} />
                    </>
                  }
                  trailing={
                    <StateWord
                      state={
                        m.status === "matched"
                          ? "success"
                          : m.status === "needs_review"
                            ? "conflict"
                            : "partial"
                      }
                      label={m.status_label}
                    />
                  }
                  last={false}
                />
                <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                  {m.status === "needs_review" ? (
                    <Button
                      label={tx(T, "راجعتها — ثبّت المطابقة")}
                      variant="secondary"
                      loading={busy === `confirm:${m.id}`}
                      onPress={() => void act(m, "confirm")}
                    />
                  ) : null}
                  <Button
                    label={tx(T, "إزالة")}
                    variant="quiet"
                    loading={busy === `remove:${m.id}`}
                    onPress={() => void act(m, "remove")}
                  />
                </View>
              </View>
            ))}
            {data.mappings.length === 0 ? <Row title={tx(T, "لا مطابقات بعد.")} dim last /> : null}
          </GroupedList>
          <Note>
            <AppText variant="bodyStrong">{tx(T, "الملكية تبقى داخلية.")}</AppText>{" "}
            {tx(
              T,
              "تعديل المورد لاسم صنفه أو تغليفه لا يعيد كتابة صنفك ولا اسمه في دفترك. تظهر لك ملاحظة «تغيّر تعريف صنف المورد — راجع المطابقة» ويبقى القرار لك.",
            )}
          </Note>

          {data.unmapped_offers.length ? (
            <>
              <Heading>
                {tx(T, "أصناف المورد بلا مقابل —")} <M>{data.unmapped_offers.length}</M>
              </Heading>
              <GroupedList>
                {data.unmapped_offers.map((o, i) => (
                  <Row
                    key={o.offer_id}
                    title={o.public_name}
                    sub={o.pack_label || o.unit_name}
                    trailing={
                      !o.defined ? (
                        <StateWord state="partial" label={tx(T, "ناقص تعريف")} />
                      ) : undefined
                    }
                    onPress={() => {
                      setOffer(o);
                      setErr(null);
                      setSaved(null);
                    }}
                    last={i === data.unmapped_offers.length - 1}
                  />
                ))}
              </GroupedList>
            </>
          ) : null}

          {offer ? (
            <>
              <Heading>
                {tx(T, "مطابقة «")}
                {offer.public_name}» ({offer.pack_label || offer.unit_name})
              </Heading>
              <Note strong>{tx(T, "صنفك")}</Note>
              <ChipRow>
                {data.items.map((i) => (
                  <NodeChip
                    key={i.item_id}
                    on={itemId === i.item_id}
                    onPress={() => {
                      setItemId(i.item_id);
                      setUnitCode(i.base_unit_code);
                    }}
                  >
                    {i.name}
                  </NodeChip>
                ))}
              </ChipRow>
              {item ? (
                <>
                  <Note strong>{tx(T, "وحدتك")}</Note>
                  <ChipRow>
                    {[{ code: item.base_unit_code, name: item.base_unit_name }, ...item.units].map(
                      (u) => (
                        <NodeChip
                          key={u.code}
                          on={unitCode === u.code}
                          onPress={() => setUnitCode(u.code)}
                        >
                          {u.name}
                        </NodeChip>
                      ),
                    )}
                  </ChipRow>
                </>
              ) : null}
              <TextField
                label={`${offer.unit_name || tx(T, "وحدة المورد")} ${tx(T, "الواحدة = كم من")} ${unitName || tx(T, "وحدتك")}${tx(T, "؟")}`}
                mono
                keyboardType="decimal-pad"
                value={factor}
                onChangeText={setFactor}
                hint={tx(T, "لا يُخمَّن من الاسم — اكتبه أنت.")}
              />
              <Stack>
                <Button
                  label={tx(T, "ثبّت المطابقة")}
                  financial
                  loading={busy === "save"}
                  onPress={() => void save()}
                  disabledReason={itemId ? undefined : tx(T, "اختر صنفك")}
                />
                <Button label={tx(T, "إلغاء")} variant="quiet" onPress={() => setOffer(null)} />
              </Stack>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
