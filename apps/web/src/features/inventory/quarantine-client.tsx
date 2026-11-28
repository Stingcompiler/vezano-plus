"use client";

import { type LocalItem, readLocalItems, storeBalances } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  SelectField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import "@/features/inventory/inventory.css";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

import { parseQtyInput, type UnitOption, unitOptions } from "./units";

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
 * INV-13 — الحجر (I-06، 0005 §٢٩٥؛ بلا إطار مرسوم): التالف المحجور لا يبقى في الحجر إلى الأبد —
 * «أعد إلى المتاح» بسبب، و«أهلك» بحدّ الهالك، و«أرجع للمورد» مرتجع شراء يخرج من الحجر لا من المتاح
 * (على آخر مستند شراء معتمد فيه الصنف، بسعره). الحدّ ما في الحجر؛ السبب إلزامي. أونلاين.
 */
export function QuarantineClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [item, setItem] = useState<LocalItem | null>(null);
  const [data, setData] = useState<QuarantineData | null>(null);
  const [failed, setFailed] = useState(false);
  const [qty, setQty] = useState("1");
  const [unitKey, setUnitKey] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<{ cap: string; value: string } | null>(null);
  const [done, setDone] = useState<Action | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(
    async (branchId: string) => {
      try {
        const { data, response } = await api().GET("/api/inventory/items/{item_id}/quarantine", {
          params: { path: { item_id: itemId }, query: branchId ? { branch_id: branchId } : {} },
        });
        const body = data as unknown as QuarantineData | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setData(body);
      } catch {
        setFailed(true);
      }
    },
    [itemId],
  );

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/inventory/items/${itemId}/quarantine`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [c, items] = await Promise.all([
        readShiftContext(storage, app),
        readLocalItems(storage),
      ]);
      setCtx(c);
      setItem(items.find((i) => i.id === itemId) ?? null);
      if (navigator.onLine) await load(c?.branchId ?? "");
    })();
  }, [router, itemId, online, load]);

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
  if (q === null || q <= 0n) errors["qty"] = "الكمية";
  else if (exceeds) errors["qty"] = "فوق ما في الحجر";
  if (!reason.trim()) errors["reason"] = "السبب — إلزامي";
  const invalid = Object.keys(errors).length > 0;

  const state: State =
    !online && !data
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
      } = await api().POST("/api/inventory/items/{item_id}/quarantine", {
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
        setDenied({ cap: e?.cap_minor ?? "", value: e?.value_minor ?? "" });
        return;
      }
      const body = out as unknown as QuarantineData | undefined;
      if (!response.ok || !body) {
        if (response.status >= 500) setFailed(true);
        return;
      }
      // رصيد الجهاز يتبع الخادم: الإعادة تزيد المتاح للبيع
      await storeBalances(getStorage(), new Date().toISOString(), [
        { item_id: itemId, qty_milli: body.balance_milli },
      ]);
      setData(body);
      setDone(action);
    } finally {
      setBusy(false);
    }
  };

  const toSupplier = data?.documents[0];

  return (
    <Frame title="المخزون" nav={<PosNav currentId="inventory" />} footer={null}>
      <div className="pos" data-screen="INV-13" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الحجر{data ? <> — {data.item_name}</> : null}</h2>
            <span className="cat-head__hint">
              التالف المحجور قد يُرتجع للمورد. إهلاكه يُفقد حقّ المطالبة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "offline" ? (
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">يحتاج اتصالاً</p>
              </Notice>
            ) : null}
            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر التحميل. أعد المحاولة." />
            ) : null}
            {state === "loading" ? <Notice kind="info" title="جارٍ التحميل" /> : null}
            {state === "permission_denied" && denied ? (
              <Notice kind="locked" title="الهالك بحدٍّ مالي">
                <p className="acc-lead">
                  أمين المخزن يُهلك حتى حدٍّ معرَّف في «الأدوار والصلاحيات»، وما فوقه يحتاج اعتماد
                  المالك.
                </p>
                {denied.cap ? (
                  <p className="acc-choice__note">
                    الحدّ <span className="sting-mono">{formatMinor(denied.cap)}</span> · القيمة{" "}
                    <span className="sting-mono">{formatMinor(denied.value)}</span>
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "success" && done ? (
              <Notice
                kind="success"
                title={done === "release" ? "أُعيد إلى المتاح" : "سُجّل الهالك"}
              />
            ) : null}
            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا شيء في الحجر"
                action={
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                }
              />
            ) : null}

            {data ? (
              <div className="shift-facts">
                <div>
                  <span className="shift-facts__k">في الحجر</span>
                  <span className="shift-facts__v">
                    <span className="sting-mono">{formatQty(held, dp)}</span> {unitName}
                  </span>
                </div>
                <div>
                  <span className="shift-facts__k">المتاح للبيع</span>
                  <span className="shift-facts__v">
                    <span className="sting-mono">{formatQty(data.balance_milli, dp)}</span>{" "}
                    {unitName}
                  </span>
                </div>
              </div>
            ) : null}

            {data && held > 0n && !done ? (
              <>
                <div className="inv-line">
                  <TextField
                    label="الكمية"
                    mono
                    value={qty}
                    onChange={(e) => {
                      setQty(e.target.value);
                      setDenied(null);
                    }}
                    error={attempted ? errors["qty"] : undefined}
                    required
                  />
                  {units.length > 1 ? (
                    <SelectField
                      label="الوحدة"
                      value={unit?.key ?? ""}
                      onChange={(e) => setUnitKey(e.target.value)}
                      options={units.map((u) => ({ value: u.key, label: u.name }))}
                    />
                  ) : null}
                </div>
                <TextField
                  label="السبب — إلزامي"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={attempted ? errors["reason"] : undefined}
                  required
                />
                <div className="inv-actions3">
                  <Button
                    financial
                    pos
                    onClick={() => void act("release")}
                    loading={busy}
                    disabledReason={data.can_release ? undefined : "للمالك والمدير"}
                  >
                    أعد إلى المتاح
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      toSupplier
                        ? router.push(
                            `/purchasing/documents/${toSupplier.id}/return?from=quarantine`,
                          )
                        : undefined
                    }
                    disabledReason={
                      !data.can_return
                        ? "للمالك والمدير"
                        : toSupplier
                          ? undefined
                          : "لا مستند شراء معتمد لهذا الصنف"
                    }
                  >
                    أرجع للمورد
                  </Button>
                  <Button variant="secondary" onClick={() => void act("write_off")} loading={busy}>
                    أهلك
                  </Button>
                </div>
              </>
            ) : null}
            {data ? (
              <div className="cat-form__actions">
                <Button
                  variant="quiet"
                  onClick={() =>
                    router.push(`/inventory/items/${itemId}?branch=${ctx?.branchId ?? ""}`)
                  }
                >
                  سجل حركة الصنف
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
