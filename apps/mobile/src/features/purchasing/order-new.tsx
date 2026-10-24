import { formatMinor, formatQty } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, Screen, SPACE, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { SelectField } from "@/components/catalog/select-field";
import { Block, Head, Lead, M, Note, Notice, Strong } from "@/components/purchasing/parts";
import { useSession } from "@/lib/session";

import { toMilli, useServerView } from "./lib";
import type { OrdersPayload } from "./orders";
import { PUR_TEXTS } from "./texts";

const T = "PUR-02";
type State = Extract<StateCode, "ready" | "validation_error" | "saving" | "success" | "offline">;

interface ItemOpt {
  id: string;
  name: string;
  base_unit_code: string;
  base_unit_name: string;
  base_unit_decimal_places: 0 | 1 | 2 | 3;
  units: { code: string; name: string; factor_milli: string }[];
}
interface Draft {
  key: number;
  item_id: string;
  unit_code: string;
  qty: string;
}
interface PreviewLine {
  item_id: string;
  base_qty_milli: string;
  base_unit_name: string;
  base_decimal_places: 0 | 1 | 2 | 3;
  balance_milli: string;
  days_of_stock: number | null;
  est_total_minor: string;
}
interface LineError {
  line: number;
  code: string;
  item_name?: string;
  qty_milli?: string;
}
interface Preview {
  lines: PreviewLine[];
  errors: LineError[];
  estimated_total_minor: string;
  estimated_partial: boolean;
}
interface Order {
  id: string;
  number: string;
  status: string;
  status_label: string;
}

const daysWord = (n: number) =>
  n === 1 ? (
    tx(T, "يوم واحد")
  ) : n === 2 ? (
    tx(T, "يومين")
  ) : (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "أيام") : tx(T, "يوماً")}
    </>
  );

/**
 * PUR-02 — إنشاء أمر شراء: الوحدة التي تشتري بها لا التي تبيع بها؛ المجموع تقديري؛ كمية بلا وحدة أو
 * مورد لا يورّد الصنف يُسأل عنهما قبل الحفظ والسطر الخاطئ وحده يُعلَّم؛ الحفظ والإرسال فعلان منفصلان.
 * الحفظ يحتاج الخادم (كالويب) — بلا شبكة تُعرض الحالة offline ولا يُخزَّن شيء.
 */
export function OrderNewScreen() {
  const router = useRouter();
  const { api } = useSession();
  const ordersView = useServerView<OrdersPayload>("orders.open.", () =>
    api.GET("/api/inventory/purchasing/orders", { params: { query: { scope: "open" } } }),
  );
  const itemsView = useServerView<{ items: ItemOpt[] }>("catalog_items", () =>
    api.GET("/api/catalog/items", { params: { query: {} } }),
  );
  const suppliers = ordersView.data?.suppliers ?? [];
  const items = itemsView.data?.items ?? [];
  const denied =
    ordersView.denied !== null || (ordersView.data ? !ordersView.data.can_create : false);

  const [supplier, setSupplier] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([{ key: 1, item_id: "", unit_code: "", qty: "" }]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "sending">("idle");
  const [saved, setSaved] = useState<Order | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [netFail, setNetFail] = useState(false);
  const supplierId = supplier || suppliers[0]?.id || "";

  const lines = useCallback(
    () =>
      drafts
        .filter((d) => d.item_id)
        .map((d) => ({
          item_id: d.item_id,
          unit_code: d.unit_code,
          qty_milli: d.qty ? String(toMilli(d.qty)) : "0",
        })),
    [drafts],
  );

  const previewNow = useCallback(async (): Promise<Preview | null> => {
    if (!supplierId) return null;
    const { data, response } = await api.POST("/api/inventory/purchasing/orders/preview", {
      body: { supplier_id: supplierId, lines: lines(), confirmed } as never,
    });
    const p = data as unknown as Preview | undefined;
    if (response.ok && p) {
      setPreview(p);
      return p;
    }
    return null;
  }, [api, supplierId, lines, confirmed]);

  const previewRef = useRef(previewNow);
  previewRef.current = previewNow;
  useEffect(() => {
    const t = setTimeout(() => void previewRef.current().catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [supplierId, drafts, confirmed]);

  const setDraft = (key: number, patch: Partial<Draft>) => {
    setAttempted(false);
    setConfirmed(false);
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const addLine = () =>
    setDrafts((ds) => [
      ...ds,
      { key: (ds.at(-1)?.key ?? 0) + 1, item_id: "", unit_code: "", qty: "" },
    ]);

  const sendOf = async (id: string): Promise<Order | undefined> => {
    const s = await api.POST("/api/inventory/purchasing/orders/{order_id}/{action}", {
      params: { path: { order_id: id, action: "send" } },
      body: {} as never,
    });
    const ok = s.data as unknown as { order?: Order } | undefined;
    const bad = s.error as unknown as { extra?: { order?: Order } } | undefined;
    const sb = ok ?? bad?.extra;
    return sb?.order;
  };

  const save = async () => {
    if (phase !== "idle") return;
    setAttempted(true);
    setNetFail(false);
    try {
      // نسأل قبل الحفظ لا بعده: معاينة طازجة بما كُتب الآن
      const fresh = await previewNow().catch(() => null);
      if ((fresh ?? preview)?.errors.length) return;
      setPhase("saving");
      const { data, response } = await api.POST("/api/inventory/purchasing/orders", {
        body: { supplier_id: supplierId, lines: lines(), confirmed } as never,
      });
      const body = data as unknown as { order: Order } | undefined;
      if (!response.ok || !body) return;
      setPhase("sending");
      setSaved((await sendOf(body.order.id)) ?? body.order);
    } catch {
      setNetFail(true);
    } finally {
      setPhase("idle");
    }
  };

  const resend = async () => {
    if (!saved) return;
    setPhase("sending");
    try {
      const o = await sendOf(saved.id);
      if (o) setSaved(o);
    } catch {
      setNetFail(true);
    } finally {
      setPhase("idle");
    }
  };

  const errors = preview?.errors ?? [];
  const errorAt = (i: number) => errors.find((e) => e.line === i);
  const state: State =
    phase !== "idle"
      ? "saving"
      : saved
        ? "success"
        : netFail
          ? "offline"
          : attempted && errors.length
            ? "validation_error"
            : "ready";
  const itemOf = (id: string) => items.find((i) => i.id === id);
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? "";
  const lineIndex = (key: number) =>
    drafts.filter((d) => d.item_id).findIndex((d) => d.key === key);
  const reason = !supplierId
    ? tx(T, "اختر المورد")
    : lines().length === 0
      ? tx(T, "أضف صنفاً واحداً على الأقل")
      : undefined;

  return (
    <Screen screenId={T} state={state} title={tx(T, "المشتريات")}>
      <Head
        title={tx(T, "إنشاء أمر شراء — الوحدة التي تشتري بها لا التي تبيع بها")}
        hint={tx(
          T,
          "تطلب كراتين وتبيع أكياساً. الأمر يُكتب بوحدة الشراء ويُعرض معه المكافئ بوحدة البيع، فلا يصل عشرة أضعاف ما أردت.",
        )}
      />
      {denied ? (
        <Notice state="permission_denied" title={tx(T, "الإنشاء للمالك والمحاسب")}>
          <Lead>{tx(T, "الإنشاء والإلغاء التزام مالي — أمين المخزن يرى ولا يُنشئ.")}</Lead>
        </Notice>
      ) : null}

      {state === "saving" ? (
        <Notice state="saving" title={tx(T, "جارٍ الحفظ والإرسال")}>
          <Lead>
            {tx(
              T,
              "الحفظ والإرسال فعلان منفصلان يظهران منفصلين: يُحفظ الأمر أولاً، ثم يُرسل للمورد.",
            )}
            {phase === "saving"
              ? ` ${tx(T, "— يُحفظ الآن.")}`
              : ` ${tx(T, "— حُفظ، ويُرسل الآن.")}`}
          </Lead>
          <Lead>
            <Strong>{tx(T, "لو فشل الإرسال")}</Strong>{" "}
            {tx(T, "· الأمر محفوظ ومُعلَّم «لم يُرسل» مع زرّ إعادة.")}
          </Lead>
          <Note>
            {tx(T, "الأزرار معطّلة والصفحة لا تُغادَر — والإلغاء متاح قبل الإرسال لا بعده.")}
          </Note>
        </Notice>
      ) : null}

      {state === "offline" ? <Notice state="offline" title={PUR_TEXTS.needsServer} /> : null}

      {saved ? (
        <Notice
          state={saved.status === "unsent" ? "server_error" : "success"}
          title={
            saved.status === "unsent" ? (
              <>
                {tx(T, "حُفظ الأمر")} <M>{saved.number}</M> {tx(T, "ولم يُرسل")}
              </>
            ) : (
              <>
                {tx(T, "أُرسل الأمر")} <M>{saved.number}</M>
              </>
            )
          }
          action={
            saved.status === "unsent" ? (
              <Button
                label={tx(T, "أعد الإرسال")}
                financial
                loading={phase !== "idle"}
                onPress={() => void resend()}
              />
            ) : (
              <Button
                label={tx(T, "تابع الأمر")}
                financial
                onPress={() =>
                  router.push({ pathname: "/purchasing/orders/[id]", params: { id: saved.id } })
                }
              />
            )
          }
        >
          <Lead>
            {saved.status === "unsent"
              ? tx(T, "الأمر محفوظ ومُعلَّم «لم يُرسل» مع زرّ إعادة.")
              : tx(T, "الأمر محفوظ ومُرسل. لم يتحرّك مخزون ولا ذمّة.")}
          </Lead>
          <Lead>
            <Strong>{tx(T, "ما تغيّر")}</Strong>{" "}
            {tx(T, "· أمر مفتوح في «أوامر الشراء» ينتظر الاستلام.")}
          </Lead>
          <Lead>
            <Strong>{tx(T, "ما لم يتغيّر")}</Strong>{" "}
            {tx(T, "· الرصيد والتكلفة والذمّة كما كانت. تتحرّك عند اعتماد مستند الشراء.")}
          </Lead>
        </Notice>
      ) : null}

      {state === "validation_error" ? (
        <Notice state="validation_error" title={tx(T, "كمية بلا وحدة شراء")}>
          {errors.map((e) => (
            <View key={`${e.line}-${e.code}`} style={{ gap: SPACE["2"] }}>
              {e.code === "unit_required" ? (
                <Lead>
                  {tx(T, "صنف")} {e.item_name ? `«${e.item_name}»` : ""} {tx(T, "أُضيف بكمية")}{" "}
                  <M>{formatQty(e.qty_milli ?? "0", 0)}</M> {tx(T, "ولم تُختر وحدته.")}{" "}
                  <Strong>{tx(T, "الوحدة")}</Strong> · <M>{formatQty(e.qty_milli ?? "0", 0)}</M>{" "}
                  {tx(T, "ماذا: كيساً أم كرتوناً. الفرق عشرة أضعاف، ويظهر يوم الاستلام لا اليوم.")}
                </Lead>
              ) : e.code === "supplier_mismatch" ? (
                <>
                  <Lead>
                    <Strong>{tx(T, "المورد")}</Strong> · «{supplierName}
                    {tx(T, "» لا يورّد")} {e.item_name}
                    {tx(T, ". لا نمنع — قد يكون توريداً جديداً — لكن نسأل قبل الحفظ لا بعده.")}
                  </Lead>
                  <Button
                    label={tx(T, "نعم، توريد جديد")}
                    variant="secondary"
                    onPress={() => setConfirmed(true)}
                  />
                </>
              ) : e.code === "qty_required" ? (
                <Lead>
                  {tx(T, "الكمية مطلوبة لـ")}
                  {e.item_name ?? tx(T, "الصنف")}.
                </Lead>
              ) : (
                <Lead>{tx(T, "سطر غير صالح.")}</Lead>
              )}
            </View>
          ))}
          <Note>{tx(T, "السطر الخاطئ وحده يُعلَّم؛ السطور الصحيحة تبقى كما كُتبت.")}</Note>
        </Notice>
      ) : null}

      {!denied && !saved ? (
        <>
          <AppText variant="section" muted style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "أمر جديد")}
            {supplierName ? ` — ${supplierName}` : ""}
          </AppText>
          <SelectField
            label={tx(T, "المورد")}
            value={supplierId}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(v) => {
              setSupplier(v);
              setConfirmed(false);
              setAttempted(false);
            }}
          />
          {drafts.map((d) => {
            const it = itemOf(d.item_id);
            const idx = lineIndex(d.key);
            const err = idx >= 0 ? errorAt(idx) : undefined;
            const pl = idx >= 0 ? preview?.lines.find((l) => l.item_id === d.item_id) : undefined;
            return (
              <Block key={d.key}>
                <SelectField
                  label={tx(T, "الصنف")}
                  value={d.item_id}
                  searchLabel={PUR_TEXTS.searchHint}
                  onChange={(v) => setDraft(d.key, { item_id: v, unit_code: "" })}
                  options={[
                    { value: "", label: tx(T, "— اختر —") },
                    ...items.map((i) => ({ value: i.id, label: i.name })),
                  ]}
                />
                {pl && pl.balance_milli ? (
                  <Note>
                    {tx(T, "رصيد")} <M>{formatQty(pl.balance_milli, pl.base_decimal_places)}</M>{" "}
                    {pl.base_unit_name}
                    {pl.days_of_stock !== null ? (
                      <>
                        {" "}
                        {tx(T, "· يكفي")} {daysWord(pl.days_of_stock)}
                      </>
                    ) : null}
                  </Note>
                ) : null}
                <TextField
                  label={tx(T, "الكمية")}
                  mono
                  keyboardType="decimal-pad"
                  value={d.qty}
                  onChangeText={(v) => setDraft(d.key, { qty: v })}
                  error={
                    err?.code === "qty_required" && attempted ? tx(T, "الكمية مطلوبة") : undefined
                  }
                />
                <SelectField
                  label={tx(T, "وحدة الشراء")}
                  value={d.unit_code}
                  onChange={(v) => setDraft(d.key, { unit_code: v })}
                  error={
                    err?.code === "unit_required" && attempted ? tx(T, "اختر الوحدة") : undefined
                  }
                  options={[
                    { value: "", label: tx(T, "— الوحدة —") },
                    ...(it
                      ? [
                          ...it.units.map((u) => ({ value: u.code, label: u.name })),
                          { value: it.base_unit_code, label: it.base_unit_name },
                        ]
                      : []),
                  ]}
                />
                <AppText variant="secondary" muted>
                  {tx(T, "المكافئ بوحدة البيع")}{" "}
                  {pl ? (
                    <>
                      <M>{`= ${formatQty(pl.base_qty_milli, pl.base_decimal_places)}`}</M>{" "}
                      {pl.base_unit_name}
                    </>
                  ) : (
                    "—"
                  )}
                </AppText>
                <AppText variant="secondary" muted>
                  {tx(T, "سعر تقديري")}{" "}
                  <M>{pl?.est_total_minor ? formatMinor(pl.est_total_minor) : "—"}</M>
                </AppText>
              </Block>
            );
          })}
          <View style={{ marginBottom: SPACE["4"] }}>
            <Button label={tx(T, "أضف صنفاً")} variant="secondary" onPress={addLine} />
          </View>
          <Lead>
            <Strong>{tx(T, "تقديري")}</Strong> ·{" "}
            <M>
              {preview?.estimated_total_minor ? formatMinor(preview.estimated_total_minor) : "—"}
            </M>
            {preview?.estimated_partial ? ` ${tx(T, "(صنف بلا سعر شراء معروف)")}` : ""}
          </Lead>
          <Note>
            {tx(
              T,
              "المجموع تقديري من آخر أسعار الشراء. الفاتورة قد تخالفه، والتكلفة تتبع الفاتورة لا هذا الرقم.",
            )}
          </Note>
          <View style={{ gap: SPACE["3"], marginTop: SPACE["2"] }}>
            <Button
              label={tx(T, "حفظ وإرسال")}
              financial
              loading={phase !== "idle"}
              disabledReason={reason}
              onPress={() => void save()}
            />
            <Button
              label={tx(T, "إلغاء")}
              variant="secondary"
              onPress={() => router.push("/purchasing/orders")}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
