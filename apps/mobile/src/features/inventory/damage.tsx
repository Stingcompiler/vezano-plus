import { formatMinor, formatQty } from "@sting/app-core";
import { type LocalItem, readLocalBalances, readLocalItems, storeBalances } from "@sting/sync-core";
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
import { useEffect, useState } from "react";

import { Stepper } from "@/components/inventory/stepper";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { Block, M, UnitChips, Wrap } from "./common";
import { INV_TEXTS } from "./texts";
import { parseQtyInput, type UnitOption, unitOptions } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-07";
type State = "ready" | "validation_error" | "permission_denied" | "success";
type Destination = "quarantine" | "write_off";

interface Damage {
  readonly damage_number: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly unit_name: string;
  readonly destination: Destination;
  readonly reason: string;
  readonly value_minor: string;
}

/**
 * INV-07 — هالك وحجر تالف (خطة الجوال M3): التالف لا يدخل المتاح للبيع (ACC-10) — الحجر يخرج من المتاح
 * ويبقى في المخزون الفعلي موسوماً (قد يُرتجع للمورد)، والهالك خروج نهائي؛ الحدّ من الرصيد ولو كان خاطئاً
 * (تصحيحه بالجرد لا بالهالك)؛ الهالك بحدٍّ مالي لغير المالك (403)؛ السبب إلزامي. يُسجَّل على الخادم.
 */
export function DamageScreen({ itemId }: { itemId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [item, setItem] = useState<LocalItem | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [qty, setQty] = useState("1");
  const [unitKey, setUnitKey] = useState("");
  const [destination, setDestination] = useState<Destination>("quarantine");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [denied, setDenied] = useState<{ cap: string; value: string } | null>(null);
  const [serverBalance, setServerBalance] = useState<bigint | null>(null);
  const [done, setDone] = useState<Damage | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [items, balances] = await Promise.all([
        readLocalItems(storage),
        readLocalBalances(storage),
      ]);
      setItem(items.find((i) => i.id === itemId) ?? null);
      const b = balances.get(itemId);
      setBalance(b ? BigInt(b.qty_milli) : null);
    })();
  }, [itemId]);

  useEffect(() => {
    if (item === null) router.replace("/inventory");
  }, [item, router]);

  const units: UnitOption[] = item ? unitOptions(item) : [];
  const unit = units.find((u) => u.key === unitKey) ?? units[0];
  const q = parseQtyInput(qty);
  const factor = unit ? BigInt(unit.factorMilli || "0") : 0n;
  const base = q !== null && factor > 0n ? (q * factor) / 1000n : null;
  const available = serverBalance ?? balance;
  const after = available !== null && base !== null ? available - base : null;
  const exceeds = after !== null && after < 0n;
  const dp = item?.base_unit_decimal_places ?? 0;

  const errors: Record<string, string> = {};
  if (q === null || q <= 0n) errors["qty"] = tx(T, "الكمية");
  else if (exceeds) errors["qty"] = tx(T, "هالك يتجاوز الرصيد");
  if (unit && factor <= 0n) errors["unit"] = tx(T, "المعامل غير محدَّد");
  if (!reason.trim()) errors["reason"] = tx(T, "السبب — إلزامي");
  const invalid = Object.keys(errors).length > 0;

  const state: State = done
    ? "success"
    : denied
      ? "permission_denied"
      : (attempted && invalid) || (exceeds && q !== null)
        ? "validation_error"
        : "ready";

  const submit = async () => {
    if (!item || !ctx || !unit || busy) return;
    setAttempted(true);
    if (invalid) return;
    setBusy(true);
    setOffline(false);
    try {
      const { data, error, response } = await api.POST("/api/inventory/items/{item_id}/damage", {
        params: { path: { item_id: item.id } },
        body: {
          branch_id: ctx.branchId,
          unit_code: unit.code,
          unit_name: unit.name,
          factor_milli: unit.factorMilli,
          qty_milli: (q ?? 0n).toString(),
          destination,
          reason: reason.trim(),
        },
      });
      if (response.status === 403) {
        const e = error as { cap_minor?: string; value_minor?: string } | undefined;
        return setDenied({ cap: e?.cap_minor ?? "", value: e?.value_minor ?? "" });
      }
      if (response.status === 400) {
        const errs =
          (error as { errors?: { code: string; balance_milli?: string }[] } | undefined)?.errors ??
          [];
        const ex = errs.find((e) => e.code === "exceeds_balance");
        if (ex?.balance_milli) setServerBalance(BigInt(ex.balance_milli));
        return;
      }
      const body = data as unknown as
        { damage: Damage; balance_milli: string; quarantine_milli: string } | undefined;
      if (!response.ok || !body) return;
      // رصيد الجهاز يتبع الخادم فوراً — التالف لا يدخل المتاح للبيع
      await storeBalances(await getStorage(), new Date().toISOString(), [
        { item_id: item.id, qty_milli: body.balance_milli },
      ]);
      setBalance(BigInt(body.balance_milli));
      setDone(body.damage);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const step = (dir: 1 | -1) => {
    const next = (q ?? 0n) + BigInt(dir) * 1000n;
    if (next < 0n) return;
    setQty(formatQty(next, unit?.decimalPlaces ?? 0));
    setDenied(null);
  };
  const toMovements = () =>
    router.push({
      pathname: "/inventory/items/[id]",
      params: { id: itemId, branch: ctx?.branchId ?? "" },
    });

  return (
    <Screen
      screenId={T}
      state={item === undefined ? "loading" : state}
      title={`${tx(T, "تسجيل تالف")}${item ? ` — ${item.name}` : ""}`}
    >
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "التالف لا يدخل المتاح للبيع.")}
      </AppText>

      {state === "permission_denied" && denied ? (
        <StateView state="permission_denied" title={tx(T, "الهالك بحدٍّ مالي")}>
          <AppText variant="secondary">
            {tx(
              T,
              "أمين المخزن يُهلك حتى حدٍّ معرَّف في «الأدوار والصلاحيات»، وما فوقه يحتاج اعتماد المالك.",
            )}
          </AppText>
          {denied.cap ? (
            <AppText variant="note" muted>
              {tx(T, "الحدّ")} <M>{formatMinor(denied.cap)}</M> {tx(T, "· القيمة")}{" "}
              <M>{formatMinor(denied.value)}</M>
            </AppText>
          ) : null}
        </StateView>
      ) : null}
      {state === "validation_error" && exceeds ? (
        <StateView state="validation_error" title={tx(T, "هالك يتجاوز الرصيد")}>
          <AppText variant="secondary">
            {tx(T, "إهلاك")} <M>{base === null ? "—" : formatQty(base, dp)}</M> {tx(T, "والرصيد")}{" "}
            <M>{available === null ? "—" : formatQty(available, dp)}</M>.
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "الحدّ من الرصيد")} {tx(T, "· ولو كان الرصيد خاطئاً. تصحيحه بالجرد لا بالهالك.")}
          </AppText>
        </StateView>
      ) : null}
      {offline ? (
        <StateView state="offline" title={tx(T, "تسجيل التالف")}>
          <AppText variant="secondary">{INV_TEXTS.needsServer}</AppText>
        </StateView>
      ) : null}

      {state === "success" && done && item ? (
        <>
          <StateView state="success" title={tx(T, "سُجّل الهالك")}>
            <AppText variant="secondary">
              {tx(
                T,
                "الكمية والسبب المصنَّف والوجهة: هالكٌ يُخرج، أو حجرٌ يبقى في المخزون موسوماً غير قابل للبيع.",
              )}
            </AppText>
            <AppText variant="note" muted>
              {tx(T, "الحجر ليس هالكاً")}{" "}
              {tx(T, "· التالف المحجور قد يُرتجع للمورد. إهلاكه يُفقد حقّ المطالبة.")}
            </AppText>
          </StateView>
          <GroupedList>
            <ListRow title={tx(T, "المستند")} trailing={<M>{done.damage_number}</M>} />
            <ListRow
              title={tx(T, "الكمية")}
              trailing={
                <AppText>
                  <M>{formatQty(done.qty_milli, unit?.decimalPlaces ?? 0)}</M> {done.unit_name}
                </AppText>
              }
            />
            <ListRow
              title={tx(T, "الوجهة")}
              trailing={
                <AppText>
                  {done.destination === "quarantine"
                    ? tx(T, "حجر — قابل للمراجعة")
                    : tx(T, "هالك — خروج نهائي")}
                </AppText>
              }
            />
            <ListRow title={tx(T, "السبب")} trailing={<AppText>{done.reason}</AppText>} />
            <ListRow
              title={tx(T, "المتاح للبيع بعد التسجيل")}
              last
              trailing={<M>{balance === null ? "—" : formatQty(balance, dp)}</M>}
            />
          </GroupedList>
          <Button label={tx(T, "سجل حركة الصنف")} financial onPress={toMovements} />
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="quiet"
            onPress={() => router.push("/inventory")}
          />
        </>
      ) : null}

      {item && !done ? (
        <>
          <Block>
            <AppText variant="bodyStrong">{tx(T, "الكمية")}</AppText>
            <Stepper
              value={qty}
              onChangeText={(t) => {
                setQty(t);
                setDenied(null);
              }}
              onStep={step}
              inputLabel={tx(T, "الكمية")}
              minusLabel={tx(T, "نقص")}
              plusLabel={tx(T, "زيادة")}
            />
            {attempted && errors["qty"] && !exceeds ? (
              <AppText variant="note" style={{ color: c.danger }}>
                {errors["qty"]}
              </AppText>
            ) : null}
            <AppText variant="bodyStrong" style={{ marginTop: SPACE["2"] }}>
              {tx(T, "الوحدة")}
            </AppText>
            <UnitChips
              options={units}
              value={unit?.key ?? ""}
              labelOf={(u) =>
                BigInt(u.factorMilli || "0") > 0n
                  ? u.name
                  : `${u.name} ${tx(T, "— المعامل غير محدَّد")}`
              }
              onChange={setUnitKey}
            />
            {attempted && errors["unit"] ? (
              <AppText variant="note" style={{ color: c.danger }}>
                {errors["unit"]}
              </AppText>
            ) : null}
            <AppText variant="bodyStrong" style={{ marginTop: SPACE["2"] }}>
              {tx(T, "الوجهة")}
            </AppText>
            <Wrap>
              <Chip
                label={tx(T, "حجر — قابل للمراجعة")}
                on={destination === "quarantine"}
                onPress={() => {
                  setDestination("quarantine");
                  setDenied(null);
                }}
              />
              <Chip
                label={tx(T, "هالك — خروج نهائي")}
                on={destination === "write_off"}
                onPress={() => {
                  setDestination("write_off");
                  setDenied(null);
                }}
              />
            </Wrap>
            <AppText variant="note" muted>
              {destination === "quarantine"
                ? tx(T, "يخرج من المتاح للبيع ويبقى في المخزون الفعلي")
                : tx(T, "يخرج من المخزون بالكامل ولا يعود")}
            </AppText>
            <TextField
              label={tx(T, "السبب — إلزامي")}
              value={reason}
              onChangeText={setReason}
              error={attempted ? errors["reason"] : undefined}
              required
            />
            <AppText variant="secondary" muted>
              {tx(T, "المتاح للبيع بعد التسجيل")}{" "}
              <AppText style={{ color: exceeds ? c.danger : undefined }}>
                <M>{after === null ? "—" : formatQty(after, dp)}</M>
              </AppText>
            </AppText>
          </Block>
          <Button
            label={tx(T, "تسجيل التالف")}
            financial
            loading={busy}
            disabledReason={
              exceeds
                ? tx(T, "الحدّ من الرصيد")
                : attempted && invalid
                  ? tx(T, "أكمل الحقول المطلوبة")
                  : undefined
            }
            onPress={() => void submit()}
          />
          <Button label={tx(T, "سجل حركة الصنف")} variant="quiet" onPress={toMovements} />
        </>
      ) : null}
    </Screen>
  );
}
