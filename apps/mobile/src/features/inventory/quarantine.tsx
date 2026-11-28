import { formatMinor, formatQty } from "@sting/app-core";
import { type LocalItem, readLocalItems, storeBalances } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { Block, M, UnitChips } from "./common";
import { parseQtyInput, type UnitOption, unitOptions } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-13";
type State =
  | "loading"
  | "ready"
  | "empty"
  | "validation_error"
  | "permission_denied"
  | "success"
  | "offline"
  | "server_error";
type Action = "release" | "write_off";

interface QuarantineData {
  readonly item_name: string;
  readonly quarantine_milli: string;
  readonly balance_milli: string;
  readonly documents: readonly { readonly id: string; readonly number: string }[];
  readonly can_release: boolean;
  readonly can_return: boolean;
}

/**
 * INV-13 — الحجر (I-06، 0005 §٢٩٥؛ نظير الويب): «أعد إلى المتاح» بسبب، و«أهلك» بحدّ الهالك، و«أرجع
 * للمورد» مرتجع شراء يخرج من الحجر لا من المتاح (على آخر مستند شراء معتمد فيه الصنف). أونلاين.
 */
export function QuarantineScreen({ itemId }: { itemId: string }) {
  const router = useRouter();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [item, setItem] = useState<LocalItem | null>(null);
  const [data, setData] = useState<QuarantineData | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [qty, setQty] = useState("1");
  const [unitKey, setUnitKey] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<{ cap: string; value: string } | null>(null);
  const [done, setDone] = useState<Action | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: d, response } = await api.GET("/api/inventory/items/{item_id}/quarantine", {
        params: {
          path: { item_id: itemId },
          query: ctx?.branchId ? { branch_id: ctx.branchId } : {},
        },
      });
      const body = d as unknown as QuarantineData | undefined;
      if (!response.ok || !body) return setFailed(true);
      setFailed(false);
      setOffline(false);
      setData(body);
    } catch {
      setOffline(true);
    }
  }, [api, itemId, ctx?.branchId]);

  useEffect(() => {
    void (async () => {
      const items = await readLocalItems(await getStorage());
      setItem(items.find((i) => i.id === itemId) ?? null);
    })();
  }, [itemId]);
  useEffect(() => {
    void load();
  }, [load]);

  const units: UnitOption[] = item ? unitOptions(item) : [];
  const unit = units.find((u) => u.key === unitKey) ?? units[0];
  const factor = unit ? BigInt(unit.factorMilli || "0") : 1000n;
  const q = parseQtyInput(qty);
  const base = q !== null && factor > 0n ? (q * factor) / 1000n : null;
  const held = data ? BigInt(data.quarantine_milli) : 0n;
  const exceeds = base !== null && base > held;
  const dp = item?.base_unit_decimal_places ?? 0;
  const unitName = item?.base_unit_name ?? "";

  const errors: Record<string, string> = {};
  if (q === null || q <= 0n) errors["qty"] = tx(T, "الكمية");
  else if (exceeds) errors["qty"] = tx(T, "فوق ما في الحجر");
  if (!reason.trim()) errors["reason"] = tx(T, "السبب — إلزامي");
  const invalid = Object.keys(errors).length > 0;

  const state: State =
    offline && !data
      ? "offline"
      : failed && !data
        ? "server_error"
        : !data
          ? "loading"
          : done
            ? "success"
            : denied
              ? "permission_denied"
              : held === 0n
                ? "empty"
                : attempted && invalid
                  ? "validation_error"
                  : "ready";

  const act = async (action: Action) => {
    if (!data || busy) return;
    setAttempted(true);
    setDenied(null);
    if (invalid) return;
    setBusy(true);
    try {
      const {
        data: out,
        error,
        response,
      } = await api.POST("/api/inventory/items/{item_id}/quarantine", {
        params: { path: { item_id: itemId } },
        body: {
          branch_id: ctx?.branchId ?? "",
          unit_code: unit?.code ?? "",
          unit_name: unit?.name ?? "",
          factor_milli: unit?.factorMilli ?? "1000",
          qty_milli: (q ?? 0n).toString(),
          action,
          reason: reason.trim(),
        } as never,
      });
      if (response.status === 403) {
        const e = error as { cap_minor?: string; value_minor?: string } | undefined;
        return setDenied({ cap: e?.cap_minor ?? "", value: e?.value_minor ?? "" });
      }
      const body = out as unknown as QuarantineData | undefined;
      if (!response.ok || !body) return;
      // رصيد الجهاز يتبع الخادم: الإعادة تزيد المتاح للبيع
      await storeBalances(await getStorage(), new Date().toISOString(), [
        { item_id: itemId, qty_milli: body.balance_milli },
      ]);
      setData(body);
      setDone(action);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const toSupplier = data?.documents[0];

  return (
    <Screen
      screenId={T}
      state={state}
      title={`${tx(T, "الحجر")}${data ? ` — ${data.item_name}` : ""}`}
    >
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "التالف المحجور قد يُرتجع للمورد. إهلاكه يُفقد حقّ المطالبة.")}
      </AppText>
      {state === "offline" || (offline && data) ? (
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
        <StateView state="loading" title={tx(T, "جارٍ التحميل")}>
          {null}
        </StateView>
      ) : null}
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
      {state === "success" && done ? (
        <StateView
          state="success"
          title={done === "release" ? tx(T, "أُعيد إلى المتاح") : tx(T, "سُجّل الهالك")}
        >
          {null}
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا شيء في الحجر")}>
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="quiet"
            onPress={() => router.push("/inventory")}
          />
        </StateView>
      ) : null}

      {data ? (
        <GroupedList>
          <ListRow
            title={tx(T, "في الحجر")}
            trailing={
              <AppText>
                <M>{formatQty(held, dp)}</M> {unitName}
              </AppText>
            }
          />
          <ListRow
            title={tx(T, "المتاح للبيع")}
            last
            trailing={
              <AppText>
                <M>{formatQty(data.balance_milli, dp)}</M> {unitName}
              </AppText>
            }
          />
        </GroupedList>
      ) : null}

      {data && held > 0n && !done ? (
        <>
          <Block>
            <TextField
              label={tx(T, "الكمية")}
              mono
              keyboardType="decimal-pad"
              value={qty}
              onChangeText={(v) => {
                setQty(v);
                setDenied(null);
              }}
              error={attempted ? errors["qty"] : undefined}
              required
            />
            {units.length > 1 ? (
              <>
                <AppText variant="bodyStrong">{tx(T, "الوحدة")}</AppText>
                <UnitChips
                  options={units}
                  value={unit?.key ?? ""}
                  labelOf={(u) => u.name}
                  onChange={setUnitKey}
                />
              </>
            ) : null}
            <TextField
              label={tx(T, "السبب — إلزامي")}
              value={reason}
              onChangeText={setReason}
              error={attempted ? errors["reason"] : undefined}
              required
            />
          </Block>
          <View style={{ gap: SPACE["2"] }}>
            <Button
              label={tx(T, "أعد إلى المتاح")}
              financial
              loading={busy}
              disabledReason={data.can_release ? undefined : tx(T, "للمالك والمدير")}
              onPress={() => void act("release")}
            />
            <Button
              label={tx(T, "أرجع للمورد")}
              variant="secondary"
              disabledReason={
                !data.can_return
                  ? tx(T, "للمالك والمدير")
                  : toSupplier
                    ? undefined
                    : tx(T, "لا مستند شراء معتمد لهذا الصنف")
              }
              onPress={() =>
                toSupplier
                  ? router.push({
                      pathname: "/purchasing/documents/[id]/return",
                      params: { id: toSupplier.id, from: "quarantine" },
                    })
                  : undefined
              }
            />
            <Button
              label={tx(T, "أهلك")}
              variant="secondary"
              loading={busy}
              onPress={() => void act("write_off")}
            />
          </View>
        </>
      ) : null}
      {data ? (
        <Button
          label={tx(T, "سجل حركة الصنف")}
          variant="quiet"
          onPress={() =>
            router.push({
              pathname: "/inventory/items/[id]",
              params: { id: itemId, branch: ctx?.branchId ?? "" },
            })
          }
        />
      ) : null}
    </Screen>
  );
}
