import { formatMinor, formatQty, pushPending } from "@sting/app-core";
import {
  baseQtyMilli,
  type LocalGoodsReceipt,
  type LocalItem,
  readLocalItems,
  readLocalParties,
  saveGoodsReceiptLocally,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ItemPicker } from "@/components/inventory/item-picker";
import { matchBarcode, useBarcodeScan } from "@/components/inventory/scan";
import { newId } from "@/lib/crypto";
import { parseAmount, today } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import {
  activeOnly,
  Block,
  M,
  type Phase,
  type PushResult,
  pushKind,
  Wrap,
  UnitChips,
} from "./common";
import { INV_TEXTS } from "./texts";
import { parseQtyInput, type UnitOption, unitOptions } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-04";
type State = "ready" | "validation_error" | "saving" | "saved_local" | "success";

interface LineDraft {
  readonly key: string;
  readonly itemId: string;
  readonly unitKey: string;
  readonly qty: string;
  readonly cost: string;
}
const emptyLine = (): LineDraft => ({ key: newId(), itemId: "", unitKey: "", qty: "", cost: "" });

/**
 * INV-04 — استلام بضاعة (خطة الجوال M3): المورد والمرجع والكمية مطلوبة والتكلفة اختيارية — لا نفرض وحدة
 * تكلفة؛ الكمية بوحدة معرَّفة بمعاملها المعلن والتحويل إلى وحدة المخزون صريح — لا تخمين؛ يُحفظ محلياً
 * أولاً ثم يُرفع (`saveGoodsReceiptLocally`)؛ المسح بالكاميرا تتابعي: كل قراءة تضيف سطراً أو تزيد كمية
 * سطر الصنف نفسه.
 */
export function ReceiveScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [items, setItems] = useState<LocalItem[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; op?: string }[]>([]);
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [push, setPush] = useState<PushResult>("none");
  const [saved, setSaved] = useState<LocalGoodsReceipt | null>(null);
  const [missed, setMissed] = useState(false);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [its, parties] = await Promise.all([
        readLocalItems(storage),
        readLocalParties(storage),
      ]);
      setItems(activeOnly(its));
      setSuppliers(
        parties
          .filter((p) => p.is_supplier && p.is_active !== false)
          .map((p) => ({
            id: p.id,
            name: p.name,
            ...(p.operation_id ? { op: p.operation_id } : {}),
          })),
      );
    })();
  }, []);

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const unitOf = (ln: LineDraft): UnitOption | undefined => {
    const it = itemOf(ln.itemId);
    if (!it) return undefined;
    const opts = unitOptions(it);
    return opts.find((u) => u.key === ln.unitKey) ?? opts[0];
  };

  // مسح تتابعي: صنف مسوح = سطر جديد بكمية 1 أو +1 على سطره الحالي
  const scan = useBarcodeScan((code) => {
    const hit = matchBarcode(items, code);
    if (!hit) return setMissed(true);
    setMissed(false);
    setLines((ls) => {
      const same = ls.find(
        (l) => l.itemId === hit.item.id && (!hit.unitKey || l.unitKey === hit.unitKey),
      );
      if (same) {
        const cur = parseQtyInput(same.qty) ?? 0n;
        return ls.map((l) => (l.key === same.key ? { ...l, qty: formatQty(cur + 1000n, 0) } : l));
      }
      const blank = ls.find((l) => !l.itemId);
      const fresh = { itemId: hit.item.id, unitKey: hit.unitKey ?? "", qty: "1" };
      return blank
        ? ls.map((l) => (l.key === blank.key ? { ...l, ...fresh } : l))
        : [...ls, { ...emptyLine(), ...fresh }];
    });
  }, true);

  const errors: Record<string, string> = {};
  if (!supplier.trim()) errors["supplier"] = tx(T, "المورد");
  if (!reference.trim()) errors["reference"] = tx(T, "مرجع المستند");
  const undefinedUnit = lines.some((ln) => {
    const u = unitOf(ln);
    return u !== undefined && BigInt(u.factorMilli || "0") <= 0n;
  });
  for (const ln of lines) {
    if (!ln.itemId) errors[`item:${ln.key}`] = tx(T, "الصنف");
    const q = parseQtyInput(ln.qty);
    if (q === null || q <= 0n) errors[`qty:${ln.key}`] = tx(T, "الكمية");
    const u = unitOf(ln);
    if (u && BigInt(u.factorMilli || "0") <= 0n)
      errors[`unit:${ln.key}`] = tx(T, "كمية بوحدة غير معرَّفة");
    if (ln.cost.trim() && parseAmount(ln.cost) === null)
      errors[`cost:${ln.key}`] = tx(T, "التكلفة");
  }
  const invalid = Object.keys(errors).length > 0;

  const state: State =
    phase === "saving"
      ? "saving"
      : phase === "saved"
        ? push === "synced"
          ? "success"
          : "saved_local"
        : attempted && invalid
          ? "validation_error"
          : "ready";

  const commit = async () => {
    if (!ctx || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    ids.current ??= { operationId: newId(), receiptId: newId() };
    const storage = await getStorage();
    const match = suppliers.find((s) => s.name === supplier.trim());
    const { receipt } = await saveGoodsReceiptLocally(storage, {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      branchId: ctx.branchId,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      partyId: match?.id,
      partyOperationId: match?.op,
      supplierName: supplier,
      reference,
      lines: lines.map((ln) => {
        const it = itemOf(ln.itemId)!;
        const u = unitOf(ln)!;
        const cost = ln.cost.trim() ? parseAmount(ln.cost) : null;
        return {
          lineId: newId(),
          movementId: newId(),
          itemId: it.id,
          itemName: it.name,
          unitCode: u.code,
          unitName: u.name,
          factorMilli: u.factorMilli,
          qtyMilli: (parseQtyInput(ln.qty) ?? 0n).toString(),
          ...(cost !== null ? { unitCostMinor: cost.toString() } : {}),
        };
      }),
      businessDate: today(),
      occurredAt: new Date().toISOString(),
    });
    setSaved(receipt);
    try {
      setPush(pushKind(await pushPending({ api, storage, requestId: newId })));
    } catch {
      setPush("pending");
    } finally {
      setPhase("saved");
    }
  };

  const reset = () => {
    ids.current = null;
    setSaved(null);
    setPhase("idle");
    setPush("none");
    setAttempted(false);
    setSupplier("");
    setReference("");
    setLines([emptyLine()]);
  };
  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const hints = supplier.trim()
    ? suppliers.filter((s) => s.name.includes(supplier.trim()) && s.name !== supplier.trim())
    : suppliers;

  return (
    <Screen screenId={T} state={state} title={tx(T, "استلام بضاعة")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "المورد والمرجع والكمية مطلوبة. التكلفة اختيارية.")}
      </AppText>

      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "جارٍ الحفظ")}>
          <AppText variant="secondary">
            {tx(T, "الاستلام يُحفظ محلياً أولاً ثم يُرفع — أمين المخزن قد يعمل في مخزنٍ بلا شبكة.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "validation_error" && undefinedUnit ? (
        <StateView state="validation_error" title={tx(T, "كمية بوحدة غير معرَّفة")}>
          <AppText variant="secondary">
            {tx(T, "استلام «5 كراتين» وصنفٌ لا معامل كرتون له.")}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "لا تخمين")}{" "}
            {tx(
              T,
              "· المخزون يدخل بالوحدة الأساسية. نطلب المعامل الآن أو الاستلام بالوحدة الأساسية — والتخمين هنا يُدخل عشرة أضعاف.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {phase === "saved" && saved ? (
        <>
          {state === "success" ? (
            <StateView state="success" title={tx(T, "استُلمت البضاعة")}>
              <AppText variant="secondary">
                {tx(T, "الأصناف والكميات والموقع، وأثرها: المخزون زاد والتكلفة تحرّكت.")}
              </AppText>
            </StateView>
          ) : (
            <StateView state="saved_local" title={tx(T, "حُفظ على الجهاز — لم يُرفع بعد")}>
              <AppText variant="secondary">
                {tx(T, "الاستلام يعمل بلا شبكة. الرصيد المحلي يتحدّث فوراً.")}
              </AppText>
            </StateView>
          )}
          <GroupedList>
            <ListRow
              title={tx(T, "مرجع المستند")}
              trailing={
                <AppText>
                  <M>{saved.receipt_number}</M> · {saved.reference}
                </AppText>
              }
            />
            <ListRow title={tx(T, "المورد")} trailing={<AppText>{saved.supplier_name}</AppText>} />
            {saved.lines.map((ln, i) => {
              const it = itemOf(ln.item_id);
              const dp = it
                ? (unitOptions(it).find((o) => o.code === ln.unit_code)?.decimalPlaces ?? 0)
                : 0;
              return (
                <ListRow
                  key={ln.id}
                  title={ln.item_name}
                  subtitle={tx(T, "الكمية والوحدة")}
                  last={i === saved.lines.length - 1}
                  trailing={
                    <AppText>
                      <M>{formatQty(ln.qty_milli, dp)}</M> {ln.unit_name} ={" "}
                      <M>{formatQty(ln.base_qty_milli, it?.base_unit_decimal_places ?? 0)}</M>{" "}
                      {it?.base_unit_name ?? ""}
                    </AppText>
                  }
                />
              );
            })}
          </GroupedList>
          {push !== "synced" ? (
            <AppText
              variant="note"
              muted
              style={{ marginBottom: SPACE["3"], color: c.state.pending_sync.fg }}
            >
              {tx(T, "عملية واحدة معلقة من هذا الجهاز")}
            </AppText>
          ) : null}
          <Button label={tx(T, "استلام آخر")} financial onPress={reset} />
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="quiet"
            onPress={() => router.push("/inventory")}
          />
        </>
      ) : null}

      {phase !== "saved" ? (
        <>
          <Block>
            <TextField
              label={tx(T, "المورد")}
              value={supplier}
              onChangeText={setSupplier}
              error={attempted ? errors["supplier"] : undefined}
              required
            />
            {hints.length > 0 ? (
              <Wrap>
                {hints.slice(0, 6).map((s) => (
                  <Chip key={s.id} label={s.name} on={false} onPress={() => setSupplier(s.name)} />
                ))}
              </Wrap>
            ) : null}
            <TextField
              label={tx(T, "مرجع المستند")}
              value={reference}
              onChangeText={setReference}
              error={attempted ? errors["reference"] : undefined}
              required
            />
          </Block>

          <View style={{ marginBottom: SPACE["3"] }}>
            <Button label={INV_TEXTS.scanItems} variant="secondary" onPress={scan.start} />
            {missed ? (
              <AppText variant="note" style={{ color: c.danger, marginTop: SPACE["1"] }}>
                {INV_TEXTS.noMatch}
              </AppText>
            ) : null}
          </View>
          {scan.element}

          {lines.map((ln, idx) => {
            const it = itemOf(ln.itemId);
            const u = unitOf(ln);
            const q = parseQtyInput(ln.qty);
            const costMinor = ln.cost.trim() ? parseAmount(ln.cost) : null;
            const base =
              it && u && q !== null && BigInt(u.factorMilli || "0") > 0n
                ? baseQtyMilli(q.toString(), u.factorMilli)
                : null;
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
                    <AppText variant="bodyStrong">{tx(T, "الوحدة")}</AppText>
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
                  hint={tx(T, "اتركه فارغاً إن لم تعرفه الآن")}
                  error={attempted ? errors[`cost:${ln.key}`] : undefined}
                />
                <AppText variant="secondary" muted>
                  {tx(T, "الكمية والوحدة")}{" "}
                  {it && u && q !== null && base !== null ? (
                    <>
                      <M>{formatQty(q, u.decimalPlaces)}</M> {u.name} ={" "}
                      <M>{formatQty(base, it.base_unit_decimal_places ?? 0)}</M> {it.base_unit_name}
                      {costMinor !== null ? (
                        <>
                          {" "}
                          {tx(T, "· التكلفة")} <M>{formatMinor(costMinor.toString())}</M>
                        </>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </AppText>
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
          <Block title={tx(T, "لا نفرض وحدة تكلفة.")}>
            <AppText variant="secondary" muted>
              {tx(
                T,
                "من يستلم كرتونة ولا يعرف سعر الحبّة يُدخل الكمية وحدها، والاستلام يكتمل. حساب تكلفة الوحدة يبقى معروضاً كأمر اختياري في «التكلفة والهامش».",
              )}
            </AppText>
          </Block>
          <Button
            label={tx(T, "تسجيل الاستلام")}
            financial
            loading={phase === "saving"}
            disabledReason={
              !ctx
                ? tx(T, "لا سياق جهاز")
                : attempted && invalid
                  ? tx(T, "أكمل الحقول المطلوبة")
                  : undefined
            }
            onPress={() => void commit()}
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
