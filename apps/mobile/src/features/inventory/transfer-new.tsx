import { formatQty, pushPending } from "@sting/app-core";
import {
  type LocalItem,
  type LocalTransfer,
  readLocalBalances,
  readLocalItems,
  saveTransferLocally,
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
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import {
  activeOnly,
  Block,
  M,
  type Phase,
  type PushResult,
  pushKind,
  UnitChips,
  Wrap,
} from "./common";
import { INV_TEXTS } from "./texts";
import { TransferCard, type TransferView } from "./transfer-card";
import { parseQtyInput, type UnitOption, unitOptions } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-09";
type State = "ready" | "validation_error" | "saving" | "saved_local" | "success" | "partial";

interface LineDraft {
  readonly key: string;
  readonly itemId: string;
  readonly unitKey: string;
  readonly qty: string;
}
interface Row {
  readonly key: string;
  readonly item: LocalItem | undefined;
  readonly unit: UnitOption | undefined;
  readonly qtyMilli: bigint | null;
  readonly baseMilli: bigint | null;
  readonly availableMilli: bigint | null;
  readonly exceedsBy: bigint;
}
const emptyLine = (): LineDraft => ({ key: newId(), itemId: "", unitKey: "", qty: "" });

/**
 * INV-09 — إنشاء وإرسال تحويل (خطة الجوال M3): مستند خروج يخصم من المُرسل ولا يضيف للمستقبِل — «في
 * الطريق» طور ثالث حقيقي حتى استلام مستقلّ (INV-10)؛ لا نسمح بتحويل ما ليس موجوداً حتى لو كان في
 * الطريق إلى المصدر؛ الأصناف بالمسح بالكاميرا تتابعياً؛ يُحفظ محلياً (`saveTransferLocally`) ثم يُعلَم
 * الفرع المستقبل بالمزامنة. `?id=` يعرض تحويلاً قائماً ببطاقته.
 */
export function TransferNewScreen({ viewId }: { viewId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [items, setItems] = useState<LocalItem[]>([]);
  const [balances, setBalances] = useState<Map<string, { qty_milli: string }>>(new Map());
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [toId, setToId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [push, setPush] = useState<PushResult>("none");
  const [saved, setSaved] = useState<LocalTransfer | null>(null);
  const [viewed, setViewed] = useState<TransferView | null>(null);
  const [missed, setMissed] = useState(false);
  const ids = useRef<{ operationId: string; transferId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [its, bal] = await Promise.all([readLocalItems(storage), readLocalBalances(storage)]);
      setItems(activeOnly(its));
      setBalances(bal);
      try {
        const { data, response } = await api.GET("/api/inventory/transfers", {});
        const body = data as unknown as { branches: { id: string; name: string }[] } | undefined;
        if (response.ok && body) setBranches(body.branches);
      } catch {
        /* بلا اتصال: الإرسال محلياً يحتاج وجهة معروفة */
      }
      if (viewId) {
        try {
          const { data, response } = await api.GET("/api/inventory/transfers/{transfer_id}", {
            params: { path: { transfer_id: viewId } },
          });
          const body = data as unknown as { transfer: TransferView } | undefined;
          if (response.ok && body) setViewed(body.transfer);
        } catch {
          /* يبقى نموذج الإنشاء */
        }
      }
    })();
  }, [api, viewId]);

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

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const rows: Row[] = lines.map((ln) => {
    const item = itemOf(ln.itemId);
    const opts = item ? unitOptions(item) : [];
    const unit = opts.find((u) => u.key === ln.unitKey) ?? opts[0];
    const q = parseQtyInput(ln.qty);
    const factor = unit ? BigInt(unit.factorMilli || "0") : 0n;
    const base = q !== null && factor > 0n ? (q * factor) / 1000n : null;
    const b = item ? balances.get(item.id) : undefined;
    const available = b ? BigInt(b.qty_milli) : null;
    const exceedsBy =
      base !== null && available !== null && base > available ? base - available : 0n;
    return {
      key: ln.key,
      item,
      unit,
      qtyMilli: q,
      baseMilli: base,
      availableMilli: available,
      exceedsBy,
    };
  });
  const anyExceeds = rows.some((r) => r.exceedsBy > 0n);
  const errors: Record<string, string> = {};
  if (!toId) errors["to"] = tx(T, "إلى");
  if (ctx && toId === ctx.branchId) errors["to"] = tx(T, "فرع آخر");
  for (const r of rows) {
    if (!r.item) errors[`item:${r.key}`] = tx(T, "الصنف");
    if (r.qtyMilli === null || r.qtyMilli <= 0n) errors[`qty:${r.key}`] = tx(T, "كمية التحويل");
    if (r.unit && BigInt(r.unit.factorMilli || "0") <= 0n)
      errors[`unit:${r.key}`] = tx(T, "المعامل غير محدَّد");
    if (r.exceedsBy > 0n) errors[`qty:${r.key}`] = tx(T, "يتجاوز المتاح");
  }
  const invalid = Object.keys(errors).length > 0;
  const totalBase = rows.reduce((a, r) => a + (r.baseMilli ?? 0n), 0n);
  const toName = branches.find((b) => b.id === toId)?.name ?? "";

  const state: State = viewed
    ? viewed.status === "partially_received"
      ? "partial"
      : "ready"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? push === "synced"
          ? "success"
          : "saved_local"
        : anyExceeds || (attempted && invalid)
          ? "validation_error"
          : "ready";

  const send = async () => {
    if (!ctx || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    ids.current ??= { operationId: newId(), transferId: newId() };
    const storage = await getStorage();
    const { transfer } = await saveTransferLocally(storage, {
      operationId: ids.current.operationId,
      transferId: ids.current.transferId,
      branchFromId: ctx.branchId,
      branchFromName: ctx.branchName,
      branchToId: toId,
      branchToName: toName,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      lines: rows.map((r) => ({
        lineId: newId(),
        movementId: newId(),
        itemId: r.item!.id,
        itemName: r.item!.name,
        unitCode: r.unit!.code,
        unitName: r.unit!.name,
        factorMilli: r.unit!.factorMilli,
        qtyMilli: (r.qtyMilli ?? 0n).toString(),
        availableMilli: (r.availableMilli ?? 0n).toString(),
      })),
      sentAt: new Date().toISOString(),
    });
    setSaved(transfer);
    try {
      setPush(pushKind(await pushPending({ api, storage, requestId: newId })));
    } catch {
      setPush("pending");
    } finally {
      setPhase("saved");
    }
  };

  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const toList = () => router.push("/inventory/transfers");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "إنشاء وإرسال تحويل — البضاعة في الطريق ليست في أي فرع")}
    >
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "مستند خروج يخصم من المُرسل ولا يضيف للمستقبِل. الكمية تصبح «في الطريق» حتى استلام مستقلّ — بلا زيادة مزدوجة.",
        )}
      </AppText>

      {viewed ? (
        <>
          <TransferCard t={viewed} pending={false} />
          <Button label={tx(T, "قائمة التحويلات")} variant="quiet" onPress={toList} />
        </>
      ) : null}

      {!viewed && phase !== "saved" ? (
        <>
          <Block>
            <AppText variant="secondary" muted>
              {tx(T, "من")}
            </AppText>
            <AppText variant="bodyStrong">{ctx?.branchName ?? "—"}</AppText>
            <AppText variant="bodyStrong" style={{ marginTop: SPACE["2"] }}>
              {tx(T, "إلى")} *
            </AppText>
            <Wrap>
              {branches
                .filter((b) => b.id !== ctx?.branchId)
                .map((b) => (
                  <Chip
                    key={b.id}
                    label={b.name}
                    on={b.id === toId}
                    onPress={() => setToId(b.id)}
                  />
                ))}
            </Wrap>
            {attempted && errors["to"] ? (
              <AppText variant="note" style={{ color: c.danger }}>
                {errors["to"]}
              </AppText>
            ) : null}
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

          <AppText variant="section" muted style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "سطور التحويل")}
          </AppText>
          {rows.map((r, idx) => {
            const ln = lines.find((l) => l.key === r.key)!;
            const dp = r.item?.base_unit_decimal_places ?? 0;
            return (
              <Block key={r.key}>
                <ItemPicker
                  label={tx(T, "الصنف")}
                  items={items}
                  value={ln.itemId}
                  onChange={(id, unitKey) => update(r.key, { itemId: id, unitKey: unitKey ?? "" })}
                  error={attempted ? errors[`item:${r.key}`] : undefined}
                />
                {r.item ? (
                  <>
                    <AppText variant="bodyStrong">{tx(T, "الوحدة")}</AppText>
                    <UnitChips
                      options={unitOptions(r.item)}
                      value={r.unit?.key ?? ""}
                      labelOf={(u) => u.name}
                      onChange={(k) => update(r.key, { unitKey: k })}
                    />
                    {attempted && errors[`unit:${r.key}`] ? (
                      <AppText variant="note" style={{ color: c.danger }}>
                        {errors[`unit:${r.key}`]}
                      </AppText>
                    ) : null}
                  </>
                ) : null}
                <AppText variant="secondary" muted>
                  {tx(T, "متاح بالمصدر")}{" "}
                  <M>
                    {r.item && r.availableMilli !== null ? formatQty(r.availableMilli, dp) : "—"}
                  </M>
                </AppText>
                <TextField
                  label={tx(T, "كمية التحويل")}
                  mono
                  keyboardType="decimal-pad"
                  value={ln.qty}
                  onChangeText={(t) => update(r.key, { qty: t })}
                  error={attempted && !r.exceedsBy ? errors[`qty:${r.key}`] : undefined}
                />
                {r.item && r.baseMilli !== null && r.availableMilli !== null ? (
                  r.exceedsBy > 0n ? (
                    <AppText variant="note" style={{ color: c.danger }}>
                      {tx(T, "يتجاوز المتاح بـ")}
                      <M>{formatQty(r.exceedsBy, dp)}</M>
                      {tx(T, ". الأقصى")} <M>{formatQty(r.availableMilli, dp)}</M>{" "}
                      {tx(T, "— الإرسال موقوف.")}
                    </AppText>
                  ) : (
                    <AppText variant="note" muted>
                      {tx(T, "ضمن المتاح.")}
                    </AppText>
                  )
                ) : null}
                {lines.length > 1 ? (
                  <Button
                    label={`${tx("INV-04", "حذف السطر")} ${idx + 1}`}
                    variant="quiet"
                    onPress={() => setLines((ls) => ls.filter((l) => l.key !== r.key))}
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
          {anyExceeds ? (
            <StateView state="validation_error" title={tx(T, "طُلب تحويل أكثر من المتاح")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "لا نسمح بتحويل ما ليس موجوداً حتى لو كان في الطريق إلى المصدر — البضاعة تُحوَّل بعد وصولها لا قبله.",
                )}
              </AppText>
            </StateView>
          ) : null}
          <GroupedList title={tx(T, "أثر الإرسال")}>
            <ListRow
              title={ctx?.branchName ?? tx(T, "المصدر")}
              trailing={
                <AppText style={{ color: c.danger }}>
                  <M>{`−${formatQty(totalBase, 0)}`}</M>
                </AppText>
              }
            />
            <ListRow title={tx(T, "في الطريق")} trailing={<M>{`+${formatQty(totalBase, 0)}`}</M>} />
            <ListRow
              title={toName || tx(T, "إلى")}
              last
              trailing={
                <AppText>
                  <M>0</M> {tx(T, "— حتى الاستلام")}
                </AppText>
              }
            />
          </GroupedList>
          <Button
            label={tx(T, "إرسال التحويل")}
            financial
            loading={phase === "saving"}
            disabledReason={
              anyExceeds
                ? tx(T, "الإرسال موقوف")
                : attempted && invalid
                  ? tx(T, "أكمل الحقول المطلوبة")
                  : undefined
            }
            onPress={() => void send()}
          />
          <Button label={tx(T, "قائمة التحويلات")} variant="quiet" onPress={toList} />
        </>
      ) : null}

      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "جارٍ الإرسال")}>
          <AppText variant="secondary">
            {tx(T, "الحفظ والإرسال فعلان: يُحفظ التحويل ثم يُعلَم الفرع المستقبل.")}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "لو فشل الإعلام")}{" "}
            {tx(
              T,
              "· التحويل محفوظ ومُعلَّم «لم يُعلَم» بزرّ إعادة. البضاعة قد خرجت فعلاً من الرفّ.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {phase === "saved" && saved ? (
        <>
          {state === "success" ? (
            <StateView
              state="success"
              title={`${tx(T, "أُرسل — مستند خروج")} ${saved.transfer_number}`}
            >
              <AppText variant="secondary">
                {tx(
                  T,
                  "يُطبع مع الشحنة ويُطابق عند الاستلام. الفرق إن وُجد يُحسم في ساق استلام مستقلّة لا بتعديل هذا المستند.",
                )}
              </AppText>
            </StateView>
          ) : (
            <StateView state="saved_local" title={tx(T, "محفوظ محلياً")}>
              <AppText variant="secondary">
                {tx(T, "المخزن بلا شبكة. التحويل محفوظ وخرج من رصيد المصدر محلياً.")}
              </AppText>
              <AppText variant="note" muted>
                {tx(T, "الفرع المستقبل لا يعلم")} {tx(T, "· حتى تعود الشبكة.")}
              </AppText>
              {push === "failed" ? (
                <Button
                  label={tx(T, "لم يُعلَم — إعادة")}
                  variant="secondary"
                  onPress={() =>
                    void getStorage()
                      .then((storage) => pushPending({ api, storage, requestId: newId }))
                      .then((o) => setPush(pushKind(o)))
                      .catch(() => setPush("failed"))
                  }
                />
              ) : null}
            </StateView>
          )}
          <TransferCard
            t={{
              ...saved,
              late: false,
            }}
            pending={push !== "synced"}
          />
          {push !== "synced" ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "عملية واحدة معلقة من هذا الجهاز")}
            </AppText>
          ) : null}
          <Button label={tx(T, "قائمة التحويلات")} financial onPress={toList} />
        </>
      ) : null}
    </Screen>
  );
}
