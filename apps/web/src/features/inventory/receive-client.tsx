"use client";

import {
  baseQtyMilli,
  createPartyLocally,
  type LocalGoodsReceipt,
  type LocalItem,
  readLocalItems,
  readLocalParties,
  saveGoodsReceiptLocally,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  SelectField,
  SyncIndicator,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import "@/features/inventory/inventory.css";
import { hhmm } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { parseAmount, today } from "@/features/pos/use-sale";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { parseQtyInput, type UnitOption, unitOptions } from "./units";

type State = "ready" | "validation_error" | "saving" | "saved_local" | "success";

interface LineDraft {
  readonly key: string;
  readonly itemId: string;
  readonly unitKey: string;
  readonly qty: string;
  readonly cost: string;
}

/** أمر شراء مفتوح يُستلم عليه (I-02، 0005 §٢٩٥) — كمياته بلا أسعار لأمين المخزن. */
interface OpenOrder {
  readonly id: string;
  readonly number: string;
  readonly items_summary: string;
  readonly branch_id: string;
  readonly supplier_name: string;
  readonly lines: readonly {
    readonly item_id: string;
    readonly unit_code: string;
    readonly factor_milli: string;
    readonly base_qty_milli: string;
    readonly received_base_qty_milli: string;
  }[];
}

const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  itemId: "",
  unitKey: "",
  qty: "",
  cost: "",
});

/**
 * INV-04 — استلام بضاعة (28-D21 ready/saved_local · 40-D32 validation_error/saving/success): المورد
 * والمرجع والكمية مطلوبة والتكلفة اختيارية — لا نفرض وحدة تكلفة (§٣.٣)؛ الكمية بوحدة معرَّفة
 * بمعاملها المعلن والتحويل إلى وحدة المخزون صريح — لا تخمين؛ يُحفظ محلياً أولاً ثم يُرفع (§١٤.٢)؛
 * المسار التالي واحد: «استلام آخر».
 */
export function ReceiveClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; op?: string }[]>([]);
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<LocalGoodsReceipt | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [canConvert, setCanConvert] = useState(false);
  const [converting, setConverting] = useState(false);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);
  const newSupplierIds = useRef<{ operationId: string; partyId: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Freceive");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [c, its, parties] = await Promise.all([
        readShiftContext(storage, app),
        readLocalItems(storage),
        readLocalParties(storage),
      ]);
      setCtx(c);
      setItems(its.filter((i) => i.is_active !== false));
      setSuppliers(
        parties
          .filter((p) => p.is_supplier && p.is_active !== false)
          .map((p) => ({
            id: p.id,
            name: p.name,
            ...(p.operation_id ? { op: p.operation_id } : {}),
          })),
      );
      // الأوامر المفتوحة للفرع — بالشبكة وحدها؛ بلا شبكة يُستلم بلا أمر كما كان
      if (!navigator.onLine) return;
      try {
        const { data, response } = await api().GET("/api/inventory/purchasing/orders", {
          params: { query: { scope: "open" } },
        });
        const body = data as unknown as { orders: OpenOrder[]; can_create: boolean } | undefined;
        if (!response.ok || !body) return;
        setOrders(body.orders.filter((o) => !c?.branchId || o.branch_id === c.branchId));
        setCanConvert(body.can_create);
      } catch {
        /* بلا أوامر — الاستلام لا ينتظرها */
      }
    })();
  }, [router]);

  /** اختيار أمر يملأ المورد والباقي من سطوره بوحدة الأمر — يُعدَّل بما وصل فعلاً. */
  const pickOrder = (id: string) => {
    setOrderId(id);
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    setSupplier(o.supplier_name);
    newSupplierIds.current = null;
    const next = o.lines
      .map((ol) => {
        const rest = BigInt(ol.base_qty_milli) - BigInt(ol.received_base_qty_milli);
        const it = items.find((i) => i.id === ol.item_id);
        if (!it || rest <= 0n) return null;
        const u = unitOptions(it).find((x) => x.code === ol.unit_code);
        const factor = BigInt(u?.factorMilli || "1000") || 1000n;
        return {
          ...emptyLine(),
          itemId: it.id,
          unitKey: u?.key ?? "",
          qty: formatQty((rest * 1000n) / factor, u?.decimalPlaces ?? 0).replace(/,/g, ""),
        };
      })
      .filter((x): x is LineDraft => x !== null);
    if (next.length) setLines(next);
  };

  /** «حوّل إلى مستند شراء» — للمالك والمدير بعد رفع الاستلام: الأسعار والذمّة بلا مخزون ثانٍ. */
  const convert = async () => {
    if (!saved || converting) return;
    setConverting(true);
    try {
      const { data, response } = await api().POST("/api/inventory/receipts/{receipt_id}/document", {
        params: { path: { receipt_id: saved.id } },
      });
      const body = data as unknown as { document: { id: string } } | undefined;
      if (response.ok && body) router.push(`/purchasing/documents/${body.document.id}`);
    } finally {
      setConverting(false);
    }
  };

  const itemOf = (id: string) => items.find((i) => i.id === id);
  const unitOf = (ln: LineDraft): UnitOption | undefined => {
    const it = itemOf(ln.itemId);
    if (!it) return undefined;
    const opts = unitOptions(it);
    return opts.find((u) => u.key === ln.unitKey) ?? opts[0];
  };

  const errors: Record<string, string> = {};
  if (!supplier.trim()) errors["supplier"] = "المورد";
  if (!reference.trim()) errors["reference"] = "مرجع المستند";
  const undefinedUnit = lines.some((ln) => {
    const u = unitOf(ln);
    return u !== undefined && BigInt(u.factorMilli || "0") <= 0n;
  });
  for (const ln of lines) {
    if (!ln.itemId) errors[`item:${ln.key}`] = "الصنف";
    const q = parseQtyInput(ln.qty);
    if (q === null || q <= 0n) errors[`qty:${ln.key}`] = "الكمية";
    const u = unitOf(ln);
    if (u && BigInt(u.factorMilli || "0") <= 0n)
      errors[`unit:${ln.key}`] = "كمية بوحدة غير معرَّفة";
    if (ln.cost.trim() && parseAmount(ln.cost) === null) errors[`cost:${ln.key}`] = "التكلفة";
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
    if (!ids.current)
      ids.current = { operationId: crypto.randomUUID(), receiptId: crypto.randomUUID() };
    let match = suppliers.find((s) => s.name === supplier.trim());
    // اسم مورد جديد يُنشئ المورد محلياً قبل الاستلام وفي العملية نفسها تبعيةً — كان يُحفظ نصّاً بلا
    // طرف فلا يظهر في «الموردون» (مراجعة الأطراف 2026-11-20، المرحلة ٢؛ 0005 §٢٨٣)
    if (!match) {
      if (!newSupplierIds.current)
        newSupplierIds.current = { operationId: crypto.randomUUID(), partyId: crypto.randomUUID() };
      const { party } = await createPartyLocally(getStorage(), {
        ...newSupplierIds.current,
        name: supplier,
        phone: "",
        role: "supplier",
        occurredAt: new Date().toISOString(),
      });
      const created = { id: party.id, name: party.name, op: newSupplierIds.current.operationId };
      // الاستلام التالي باسمه نفسه يجده في القائمة فلا يُنشئ مورداً ثانياً
      setSuppliers((prev) => [...prev, created]);
      match = created;
    }
    const { receipt } = await saveGoodsReceiptLocally(getStorage(), {
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
      ...(orderId ? { purchaseOrderId: orderId } : {}),
      lines: lines.map((ln) => {
        const it = itemOf(ln.itemId)!;
        const u = unitOf(ln)!;
        const cost = ln.cost.trim() ? parseAmount(ln.cost) : null;
        return {
          lineId: crypto.randomUUID(),
          movementId: crypto.randomUUID(),
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
    if (!online) {
      setPush("pending");
      setPhase("saved");
      return;
    }
    try {
      const out = await pushPending();
      setPush(
        out.kind === "applied" || out.kind === "idle"
          ? "synced"
          : out.kind === "retry"
            ? "failed"
            : "pending",
      );
    } catch {
      setPush("failed");
    } finally {
      setPhase("saved");
    }
  };

  const reset = () => {
    ids.current = null;
    newSupplierIds.current = null;
    setSaved(null);
    setPhase("idle");
    setPush("none");
    setAttempted(false);
    setSupplier("");
    setReference("");
    setOrderId("");
    setLines([emptyLine()]);
  };

  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Frame title="المخزون" nav={<PosNav currentId="inventory" />} footer={null}>
      <div className="pos" data-screen="INV-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">استلام بضاعة</h2>
            <span className="cat-head__hint">المورد والمرجع والكمية مطلوبة. التكلفة اختيارية.</span>
          </div>
          <div className="acc-card__body">
            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الحفظ">
                <p className="acc-lead">
                  الاستلام يُحفظ محلياً أولاً ثم يُرفع — أمين المخزن قد يعمل في مخزنٍ بلا شبكة.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && undefinedUnit ? (
              <Notice kind="error" title="كمية بوحدة غير معرَّفة">
                <p className="acc-lead">استلام «5 كراتين» وصنفٌ لا معامل كرتون له.</p>
                <p className="acc-choice__note">
                  <strong>لا تخمين</strong> · المخزون يدخل بالوحدة الأساسية. نطلب المعامل الآن أو
                  الاستلام بالوحدة الأساسية — والتخمين هنا يُدخل عشرة أضعاف.
                </p>
              </Notice>
            ) : null}

            {phase === "saved" && saved ? (
              <>
                {state === "success" ? (
                  <Notice kind="success" title="استُلمت البضاعة">
                    <p className="acc-lead">
                      الأصناف والكميات والموقع، وأثرها: المخزون زاد والتكلفة تحرّكت.
                    </p>
                  </Notice>
                ) : (
                  <Notice kind="offline" title="حُفظ على الجهاز — لم يُرفع بعد">
                    <p className="acc-lead">الاستلام يعمل بلا شبكة. الرصيد المحلي يتحدّث فوراً.</p>
                  </Notice>
                )}
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">مرجع المستند</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{saved.receipt_number}</span> · {saved.reference}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المورد</span>
                    <span className="shift-facts__v">{saved.supplier_name}</span>
                  </div>
                  {saved.lines.map((ln) => {
                    const it = itemOf(ln.item_id);
                    const dp = it
                      ? (unitOptions(it).find((o) => o.code === ln.unit_code)?.decimalPlaces ?? 0)
                      : 0;
                    return (
                      <div key={ln.id}>
                        <span className="shift-facts__k">{ln.item_name}</span>
                        <span className="shift-facts__v">
                          <span className="sting-mono">{formatQty(ln.qty_milli, dp)}</span>{" "}
                          {ln.unit_name} ={" "}
                          <span className="sting-mono">
                            {formatQty(ln.base_qty_milli, it?.base_unit_decimal_places ?? 0)}
                          </span>{" "}
                          {it?.base_unit_name ?? ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <SyncIndicator
                  state={!online ? "offline" : push === "synced" ? "synced" : "pending_sync"}
                  lastServerAt={push === "synced" ? hhmm(new Date().toISOString()) : null}
                  pendingCount={push === "synced" ? 0 : 1}
                  pendingLabel={(n) =>
                    n === 1 ? "عملية واحدة معلقة من هذا الجهاز" : `${n} عمليات معلقة من هذا الجهاز`
                  }
                />
                <div className="cat-form__actions">
                  {canConvert && push === "synced" ? (
                    <Button financial onClick={() => void convert()} loading={converting}>
                      حوّل إلى مستند شراء
                    </Button>
                  ) : null}
                  <Button pos onClick={reset}>
                    استلام آخر
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                </div>
              </>
            ) : null}

            {phase !== "saved" ? (
              <>
                {orders.length ? (
                  <SelectField
                    label="أمر الشراء — اختياري"
                    value={orderId}
                    onChange={(e) => pickOrder(e.target.value)}
                    options={[
                      { value: "", label: "بلا أمر" },
                      ...orders.map((o) => ({
                        value: o.id,
                        // بلا رقم الأمر: الأرقام اللاتينية داخل mono وحده، والخيار نصّ عادي
                        label: `${o.supplier_name} — ${o.items_summary}`,
                      })),
                    ]}
                  />
                ) : null}
                <TextField
                  label="المورد"
                  value={supplier}
                  onChange={(e) => {
                    setSupplier(e.target.value);
                    newSupplierIds.current = null;
                  }}
                  list="inv-suppliers"
                  error={attempted ? errors["supplier"] : undefined}
                  required
                />
                <datalist id="inv-suppliers">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
                {supplier.trim() && !suppliers.some((s) => s.name === supplier.trim()) ? (
                  <p className="acc-choice__note">مورد جديد — يُضاف إلى «الموردون» عند الحفظ.</p>
                ) : null}
                {/* د-١ كاملاً (0005 §٢٩٥، يحلّ محلّ نصّ §٢٨٩): الاستلام وحده يُدخل المخزون، ويُحوَّل
                    هو نفسه إلى مستند الشراء فتُضاف الأسعار والذمّة بلا مخزون ثانٍ */}
                <p className="acc-choice__note">
                  الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.
                </p>
                <TextField
                  label="مرجع المستند"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  error={attempted ? errors["reference"] : undefined}
                  required
                />
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
                    <div key={ln.key} className="inv-line">
                      <SelectField
                        label="الصنف"
                        value={ln.itemId}
                        onChange={(e) => update(ln.key, { itemId: e.target.value, unitKey: "" })}
                        options={[
                          { value: "", label: "—" },
                          ...items.map((i) => ({ value: i.id, label: i.name })),
                        ]}
                        error={attempted ? errors[`item:${ln.key}`] : undefined}
                        required
                      />
                      <SelectField
                        label="الوحدة"
                        value={u?.key ?? ""}
                        onChange={(e) => update(ln.key, { unitKey: e.target.value })}
                        options={
                          it
                            ? unitOptions(it).map((o) => ({
                                value: o.key,
                                label:
                                  BigInt(o.factorMilli || "0") > 0n
                                    ? o.name
                                    : `${o.name} — المعامل غير محدَّد`,
                              }))
                            : [{ value: "", label: "—" }]
                        }
                        error={attempted ? errors[`unit:${ln.key}`] : undefined}
                      />
                      <TextField
                        label="الكمية"
                        mono
                        value={ln.qty}
                        onChange={(e) => update(ln.key, { qty: e.target.value })}
                        error={attempted ? errors[`qty:${ln.key}`] : undefined}
                        required
                      />
                      <TextField
                        label="التكلفة — اختياري"
                        mono
                        value={ln.cost}
                        onChange={(e) => update(ln.key, { cost: e.target.value })}
                        hint="اتركه فارغاً إن لم تعرفه الآن"
                        error={attempted ? errors[`cost:${ln.key}`] : undefined}
                      />
                      <div className="shift-facts">
                        <div>
                          <span className="shift-facts__k">الكمية والوحدة</span>
                          <span className="shift-facts__v">
                            {it && u && q !== null && base !== null ? (
                              <>
                                <span className="sting-mono">{formatQty(q, u.decimalPlaces)}</span>{" "}
                                {u.name} ={" "}
                                <span className="sting-mono">
                                  {formatQty(base, it.base_unit_decimal_places ?? 0)}
                                </span>{" "}
                                {it.base_unit_name}
                                {costMinor !== null ? (
                                  <>
                                    {" "}
                                    · التكلفة{" "}
                                    <span className="sting-mono">
                                      {formatMinor(costMinor.toString())}
                                    </span>
                                  </>
                                ) : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                      </div>
                      {lines.length > 1 ? (
                        <Button
                          variant="quiet"
                          onClick={() => setLines((ls) => ls.filter((l) => l.key !== ln.key))}
                        >
                          حذف السطر {idx + 1}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                <div className="cat-form__actions">
                  <Button
                    variant="secondary"
                    onClick={() => setLines((ls) => [...ls, emptyLine()])}
                  >
                    صنف آخر
                  </Button>
                </div>
                <Notice kind="warning" title="لا نفرض وحدة تكلفة.">
                  <p className="acc-lead">
                    من يستلم كرتونة ولا يعرف سعر الحبّة يُدخل الكمية وحدها، والاستلام يكتمل. حساب
                    تكلفة الوحدة يبقى معروضاً كأمر اختياري في «التكلفة والهامش».
                  </p>
                </Notice>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void commit()}
                    loading={phase === "saving"}
                    disabledReason={
                      !ctx
                        ? "لا سياق جهاز"
                        : attempted && invalid
                          ? "أكمل الحقول المطلوبة"
                          : undefined
                    }
                  >
                    تسجيل الاستلام
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
