import { formatMinor, formatQty } from "@sting/app-core";
import { type LocalItem, readLocalItems } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";

import { ItemPicker } from "@/components/inventory/item-picker";
import { newId } from "@/lib/crypto";
import { parseAmount } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { Block, M, UnitChips } from "./common";
import { parseQtyInput, type UnitOption, unitOptions } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-03";
type State = "ready" | "validation_error" | "permission_denied" | "success";

interface LineDraft {
  readonly key: string;
  readonly itemId: string;
  readonly unitKey: string;
  readonly qty: string;
  readonly cost: string;
}
interface Opening {
  readonly id: string;
  readonly status: "submitted" | "approved";
  readonly created_by_name: string;
  readonly approved_by_name: string;
  readonly line_count: number;
  readonly value_minor: string;
}
interface OpeningsData {
  readonly branch_id: string;
  readonly can_approve: boolean;
  readonly openings: readonly Opening[];
  readonly opened_item_ids: readonly string[];
  readonly moved_item_ids: readonly string[];
}
interface ServerError {
  readonly line: number;
  readonly field: string;
  readonly code: string;
}
interface ReviewRow {
  readonly key: string;
  readonly item: string;
  readonly unit: string;
  readonly qty: string;
  readonly base: { n: string; word: string } | null;
  readonly note: ReactNode;
  readonly bad: boolean;
}

const emptyLine = (): LineDraft => ({ key: newId(), itemId: "", unitKey: "", qty: "", cost: "" });

/**
 * INV-03 — افتتاحيات المخزون (خطة الجوال M3): مستند واحد يجمع الأصناف يُراجَع قبل الاعتماد؛ التحويل
 * إلى وحدة المخزون معروض صريحاً؛ لا نقبل تقديراً؛ تُعتمد مرة واحدة لكل صنف وقبل أول حركة؛ الاعتماد
 * يُنشئ رصيداً فهو للمالك — أمين المخزن يُدخل ويرى «أُرسلت للاعتماد». أصناف الخادم تُدمج مع المحلية
 * (صنف أُنشئ للتوّ متصلاً)، و`?item=` يختار الصنف مسبقاً في السطر الأول.
 */
export function OpeningsScreen({ preselect }: { preselect?: string | undefined }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [items, setItems] = useState<LocalItem[]>([]);
  const [data, setData] = useState<OpeningsData | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerError[]>([]);
  const [submitted, setSubmitted] = useState<Opening | null>(null);
  const [approved, setApproved] = useState<Opening | null>(null);
  const [denied, setDenied] = useState(false);

  const load = async () => {
    try {
      const { data: d, response } = await api.GET("/api/inventory/openings", {});
      const body = d as unknown as OpeningsData | undefined;
      if (response.ok && body) setData(body);
    } catch {
      /* بلا اتصال: الإدخال ممكن والاعتماد أونلاين */
    }
  };

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const its = await readLocalItems(storage);
      setItems(its.filter((i) => i.is_active !== false));
      // صنف أُنشئ للتوّ متصلاً لا يكون في الإسقاط المحلي بعد — يُدمج ما يعيده الخادم (الأحدث يغلب)
      try {
        const { data: srv, response } = await api.GET("/api/catalog/items", {
          params: { query: {} },
        });
        const list = (srv as unknown as { items?: LocalItem[] } | undefined)?.items;
        if (response.ok && list) {
          const byId = new Map(its.map((i) => [i.id, i] as const));
          for (const i of list) byId.set(i.id, i);
          setItems([...byId.values()].filter((i) => i.is_active !== false));
        }
      } catch {
        /* بلا اتصال: المحلي يكفي */
      }
      if (preselect)
        setLines((ls) =>
          ls.map((l, i) => (i === 0 && !l.itemId ? { ...l, itemId: preselect } : l)),
        );
      await load();
    })();
  }, [preselect]);

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const unitOf = (ln: LineDraft): UnitOption | undefined => {
    const it = itemOf(ln.itemId);
    if (!it) return undefined;
    const opts = unitOptions(it);
    return opts.find((u) => u.key === ln.unitKey) ?? opts[0];
  };

  const opened = new Set(data?.opened_item_ids ?? []);
  const moved = new Set(data?.moved_item_ids ?? []);
  const serverLineErrors = new Map<number, ServerError[]>();
  for (const e of serverErrors)
    serverLineErrors.set(e.line, [...(serverLineErrors.get(e.line) ?? []), e]);
  const hasMovementError = serverErrors.some(
    (e) => e.code === "has_movements" || e.code === "already_opened",
  );

  const review: ReviewRow[] = lines.map((ln, i) => {
    const it = itemOf(ln.itemId);
    const u = unitOf(ln);
    const q = parseQtyInput(ln.qty);
    const srv = serverLineErrors.get(i) ?? [];
    const blank: ReviewRow = {
      key: ln.key,
      item: "—",
      unit: "—",
      qty: "—",
      base: null,
      note: null,
      bad: false,
    };
    if (!it || !u) return blank;
    const head = { key: ln.key, item: it.name, unit: u.name };
    if (ln.qty.trim() && q === null)
      return {
        ...head,
        qty: "—",
        base: null,
        bad: true,
        note: (
          <>
            {tx(T, "أُدخل «")}
            <M>{ln.qty.trim()}</M>
            {tx(
              T,
              "» — لا نقبل تقديراً في افتتاحية. نطلب رقماً أو نترك الصنف بلا افتتاحية ويُبنى رصيده من أول استلام.",
            )}
          </>
        ),
      };
    if (srv.some((e) => e.code === "has_movements" || e.code === "already_opened"))
      return {
        ...head,
        qty: q === null ? "—" : formatQty(q, u.decimalPlaces),
        base: null,
        bad: true,
        note: tx(T, "افتتاحي على صنف له حركات — الافتتاحي مرة واحدة وقبل أول حركة."),
      };
    const factor = BigInt(u.factorMilli || "0");
    if (q === null) return { ...head, qty: "—", base: null, bad: false, note: null };
    const baseDp = it.base_unit_decimal_places ?? 0;
    if (factor === 1000n)
      return {
        ...head,
        qty: formatQty(q, u.decimalPlaces),
        base: { n: formatQty(q, baseDp), word: it.base_unit_name },
        bad: false,
        note: tx(T, "وحدة الإدخال = وحدة المخزون. لا تحويل."),
      };
    const base = (q * factor) / 1000n;
    return {
      ...head,
      qty: formatQty(q, u.decimalPlaces),
      base: { n: formatQty(base, baseDp), word: it.base_unit_name },
      bad: false,
      note: (
        <>
          {tx(T, "التحويل معروض صريحاً:")}{" "}
          <M>{`${formatQty(q, u.decimalPlaces)} × ${formatQty(factor, baseDp)} = ${formatQty(base, baseDp)}`}</M>
        </>
      ),
    };
  });

  const errors: Record<string, string> = {};
  for (const ln of lines) {
    if (!ln.itemId) errors[`item:${ln.key}`] = tx(T, "الصنف");
    const q = parseQtyInput(ln.qty);
    if (q === null || q <= 0n) errors[`qty:${ln.key}`] = tx(T, "الكمية — رقم لا تقدير");
    const u = unitOf(ln);
    if (u && BigInt(u.factorMilli || "0") <= 0n)
      errors[`unit:${ln.key}`] = tx(T, "المعامل غير محدَّد");
    if (ln.cost.trim() && parseAmount(ln.cost) === null)
      errors[`cost:${ln.key}`] = tx(T, "التكلفة");
    if (opened.has(ln.itemId) || moved.has(ln.itemId))
      errors[`item:${ln.key}`] = tx(T, "افتتاحي على صنف له حركات");
  }
  const invalid = Object.keys(errors).length > 0;
  const isOwner = data?.can_approve ?? ctx?.roleCode === "owner";

  const state: State = approved
    ? "success"
    : denied || submitted
      ? "permission_denied"
      : serverErrors.length > 0 || (attempted && invalid)
        ? "validation_error"
        : "ready";

  const send = async () => {
    if (!ctx || busy) return;
    setAttempted(true);
    if (invalid) return;
    setBusy(true);
    setServerErrors([]);
    try {
      const {
        data: res,
        error,
        response,
      } = await api.POST("/api/inventory/openings", {
        body: {
          branch_id: ctx.branchId,
          lines: lines.map((ln) => {
            const it = itemOf(ln.itemId)!;
            const u = unitOf(ln)!;
            const cost = ln.cost.trim() ? parseAmount(ln.cost) : null;
            return {
              item_id: it.id,
              unit_code: u.code,
              unit_name: u.name,
              factor_milli: u.factorMilli,
              qty_milli: (parseQtyInput(ln.qty) ?? 0n).toString(),
              unit_cost_minor: cost === null ? "" : cost.toString(),
            };
          }),
        },
      });
      if (response.status === 403) return setDenied(true);
      if (response.status === 400) {
        const errs = (error as { errors?: ServerError[] } | undefined)?.errors ?? [];
        return setServerErrors(errs.length ? errs : [{ line: 0, field: "lines", code: "invalid" }]);
      }
      const body = res as unknown as { opening: Opening } | undefined;
      if (!response.ok || !body) return;
      if (body.opening.status === "approved") setApproved(body.opening);
      else setSubmitted(body.opening);
      await load();
    } catch {
      /* بلا اتصال: الاعتماد أونلاين — تبقى المسودة كما هي */
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const {
        data: res,
        error,
        response,
      } = await api.POST("/api/inventory/openings/{opening_id}/approve", {
        params: { path: { opening_id: id } },
      });
      if (response.status === 403) return setDenied(true);
      if (response.status === 400)
        return setServerErrors((error as { errors?: ServerError[] } | undefined)?.errors ?? []);
      const body = res as unknown as { opening: Opening } | undefined;
      if (response.ok && body) setApproved(body.opening);
      await load();
    } catch {
      /* بلا اتصال */
    } finally {
      setBusy(false);
    }
  };

  const update = (key: string, patch: Partial<LineDraft>) => {
    setServerErrors([]);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const pendingDocs = (data?.openings ?? []).filter((o) => o.status === "submitted");
  const filled = lines.filter((l) => l.itemId).length;
  const doc = approved ?? submitted;

  return (
    <Screen screenId={T} state={state} title={tx(T, "افتتاحية المخزون — مراجعة قبل الاعتماد")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "تُعتمد مرة واحدة لكل صنف. بعدها أي تغيير يكون جرداً أو تسوية بسبب، لا تعديل افتتاحية.",
        )}
      </AppText>

      {state === "success" && doc ? (
        <>
          <StateView state="success" title={tx(T, "سُجّلت الافتتاحيات")}>
            <AppText variant="secondary">
              {tx(T, "عدد الأصناف والكميات وقيمتها، ومستندٌ واحد يجمعها قابل للطباعة والمراجعة.")}
            </AppText>
          </StateView>
          <GroupedList>
            <View style={{ padding: SPACE["4"], gap: SPACE["2"] }}>
              <AppText>
                {tx(T, "عدد الأصناف")} <M>{doc.line_count}</M>
              </AppText>
              <AppText>
                {tx(T, "القيمة")} <M>{formatMinor(doc.value_minor)}</M>
              </AppText>
              <AppText>
                {tx(T, "المعتمد")} {doc.approved_by_name || "—"}
              </AppText>
            </View>
          </GroupedList>
          <Button
            label={tx(T, "أرصدة المخزون")}
            financial
            onPress={() => router.replace("/inventory")}
          />
        </>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "أُرسلت للاعتماد")}>
          <AppText variant="secondary">
            {tx(
              T,
              "أمين المخزن يُدخل الافتتاحيات ولا يعتمدها. الاعتماد يُنشئ رصيداً يُحسب عليه كل شيء بعده، فهو صلاحية المالك أو من فوّضه.",
            )}
          </AppText>
          {submitted ? (
            <AppText variant="note" muted>
              {tx(T, "مسودة —")} <M>{submitted.line_count}</M> {tx(T, "صنفاً ·")}{" "}
              {submitted.created_by_name}
            </AppText>
          ) : null}
        </StateView>
      ) : null}

      {state === "validation_error" && hasMovementError ? (
        <StateView state="validation_error" title={tx(T, "افتتاحي على صنف له حركات")}>
          <AppText variant="secondary">{tx(T, "الافتتاحي مرة واحدة وقبل أول حركة.")}</AppText>
          <AppText variant="note" muted>
            {tx(T, "المخرج")}{" "}
            {tx(T, "· تسوية جرد بسبب مكتوب — وهي الطريق الصحيح لتصحيح رصيد له تاريخ.")}
          </AppText>
        </StateView>
      ) : null}

      {!doc ? (
        <>
          {isOwner && pendingDocs.length > 0 ? (
            <GroupedList
              title={`${tx(T, "مسودة —")} ${
                pendingDocs.length === 1
                  ? tx(T, "مستند واحد")
                  : `${pendingDocs.length} ${tx(T, "مستندات")}`
              }`}
            >
              {pendingDocs.map((o) => (
                <View key={o.id} style={{ padding: SPACE["4"], gap: SPACE["2"] }}>
                  <AppText style={{ color: c.state.pending_sync.fg }}>
                    {tx(T, "أُرسلت للاعتماد")}
                  </AppText>
                  <AppText variant="secondary" muted>
                    <M>{o.line_count}</M> {tx(T, "صنفاً ·")} {o.created_by_name}
                  </AppText>
                  <Button
                    label={tx(T, "اعتماد")}
                    financial
                    loading={busy}
                    onPress={() => void approve(o.id)}
                  />
                </View>
              ))}
            </GroupedList>
          ) : null}

          {lines.map((ln, idx) => {
            const it = itemOf(ln.itemId);
            const u = unitOf(ln);
            return (
              <Block key={ln.key}>
                <ItemPicker
                  label={tx(T, "الصنف")}
                  items={items}
                  value={ln.itemId}
                  onChange={(id, unitKey) => update(ln.key, { itemId: id, unitKey: unitKey ?? "" })}
                  error={attempted ? errors[`item:${ln.key}`] : undefined}
                />
                {it ? (
                  <>
                    <AppText variant="bodyStrong">{tx(T, "الوحدة المُدخلة")}</AppText>
                    <UnitChips
                      options={unitOptions(it)}
                      value={u?.key ?? ""}
                      labelOf={(o) =>
                        BigInt(o.factorMilli || "0") > 0n
                          ? o.name
                          : `${o.name} ${tx(T, "— المعامل غير محدَّد")}`
                      }
                      onChange={(k) => update(ln.key, { unitKey: k })}
                    />
                    {attempted && errors[`unit:${ln.key}`] ? (
                      <AppText variant="note" style={{ color: c.danger }}>
                        {errors[`unit:${ln.key}`]}
                      </AppText>
                    ) : null}
                  </>
                ) : null}
                <TextField
                  label={tx(T, "الكمية")}
                  mono
                  keyboardType="decimal-pad"
                  value={ln.qty}
                  onChangeText={(t) => update(ln.key, { qty: t })}
                  error={attempted ? errors[`qty:${ln.key}`] : undefined}
                  required
                />
                <TextField
                  label={tx(T, "التكلفة — اختياري")}
                  mono
                  keyboardType="decimal-pad"
                  value={ln.cost}
                  onChangeText={(t) => update(ln.key, { cost: t })}
                  hint={tx(T, "يدوية — تُستبدل بأول مستند شراء حقيقي")}
                  error={attempted ? errors[`cost:${ln.key}`] : undefined}
                />
                {lines.length > 1 ? (
                  <Button
                    label={`${tx(T, "حذف السطر")} ${idx + 1}`}
                    variant="quiet"
                    onPress={() => setLines((ls) => ls.filter((l) => l.key !== ln.key))}
                  />
                ) : null}
              </Block>
            );
          })}
          <View style={{ marginBottom: SPACE["4"] }}>
            <Button
              label={tx(T, "صنف آخر")}
              variant="secondary"
              onPress={() => setLines((ls) => [...ls, emptyLine()])}
            />
          </View>

          <GroupedList
            title={`${tx(T, "المراجعة")} · ${tx(T, "مسودة —")} ${filled} ${tx(T, "صنفاً")}`}
          >
            {review.map((r) => (
              <View
                key={r.key}
                accessibilityLabel={tx(T, "مراجعة الافتتاحية")}
                style={{ padding: SPACE["4"], gap: SPACE["1"] }}
              >
                <AppText variant="bodyStrong">
                  {r.item} — {r.unit}
                </AppText>
                <AppText variant="secondary" muted>
                  {tx(T, "الكمية")} <M>{r.qty}</M>
                  {r.base ? (
                    <>
                      {" · "}
                      {tx(T, "بوحدة المخزون")} <M>{r.base.n}</M> {r.base.word}
                    </>
                  ) : null}
                </AppText>
                {r.note ? (
                  <AppText
                    variant="note"
                    style={{ color: r.bad ? c.danger : undefined }}
                    muted={!r.bad}
                  >
                    {r.note}
                  </AppText>
                ) : null}
              </View>
            ))}
          </GroupedList>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "التكلفة")}{" "}
            {tx(
              T,
              "· الافتتاحي يحمل تكلفةً تُدخَل يدوياً وتُوسم «يدوية»، وتُستبدل بأول مستند شراء حقيقي.",
            )}
          </AppText>
          <Button
            label={isOwner ? tx(T, "اعتماد الافتتاحية") : tx(T, "إرسال للاعتماد")}
            financial
            loading={busy}
            disabledReason={attempted && invalid ? tx(T, "أكمل الحقول المطلوبة") : undefined}
            onPress={() => void send()}
          />
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="quiet"
            onPress={() => router.push("/inventory")}
          />
        </>
      ) : null}
    </Screen>
  );
}
