"use client";

import {
  bankReferenceUsed,
  type LocalParty,
  type LocalReceipt,
  type LocalShift,
  readLocalParties,
  readOpenShift,
  readPendingSupplierPayments,
  type ReceiptMethod,
  saveReceiptLocally,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  Frame,
  Notice,
  PrintDoc,
  printDocument,
  RadioGroupField,
  Receipt,
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
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { readHomeCache } from "@/features/home/home-cache";
import { parseAmount, today } from "@/features/pos/use-sale";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { docTitle } from "@/lib/print/doc-title";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

type State =
  "ready" | "validation_error" | "saving" | "saved_local" | "success" | "permission_denied";

const REF_USED_TEXT = "مرجع تحويل لا يُستهلك مرتين";

/**
 * «دفع لمورد» — سند صرف (PTY-06 بجهة المورد؛ مراجعة الأطراف 2026-11-20، المرحلة ٣ — 0005 §٢٨٤):
 * §٧.٢ «دفع لمورد: نقد صادر، مدين يخفض له علينا». يخفض «له علينا» تراكمياً دون توزيع على مستندات
 * (§٧.١، القرار د-٢)؛ النقد يخرج من صندوق الوردية المفتوحة كالسحب؛ التحويل الصادر أثره فوري لأنك
 * أرسلته (لا «مطابق» — ذاك لما يصلنا). الصلاحية كصلاحية الردّ: يُخرج نقداً فللمدير والمالك.
 */
export function SupplierPaymentClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [party, setParty] = useState<LocalParty | null | undefined>(undefined);
  const [pending, setPending] = useState(0n);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [method, setMethod] = useState<ReceiptMethod>("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [refUsed, setRefUsed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<LocalReceipt | null>(null);
  const [shop, setShop] = useState("");
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    void readHomeCache().then((c) => setShop(c?.summary.tenant_name ?? ""));
    // «ادفع الآن» من مستند شراء معتمد يمرّر مبلغه بالوحدة الصغرى (0005 §٢٨٥)؛ يُعدَّل قبل الحفظ
    const minor = new URLSearchParams(window.location.search).get("amount");
    if (minor && /^[0-9]+$/.test(minor)) setAmount(formatMinor(minor).replace(/,/g, ""));
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}/pay`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [parties, s, c, pend] = await Promise.all([
        readLocalParties(storage),
        readOpenShift(storage),
        readShiftContext(storage, app),
        readPendingSupplierPayments(storage, partyId),
      ]);
      const p = parties.find((x) => x.id === partyId) ?? null;
      setParty(p && p.is_supplier ? p : null);
      setShift(s);
      setCtx(c);
      setPending(pend.signedMinor);
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (party === null) router.replace(`/parties/${partyId}`);
  }, [party, partyId, router]);

  useEffect(() => {
    if (method !== "bank" || !reference.trim()) {
      setRefUsed(false);
      return;
    }
    void bankReferenceUsed(getStorage(), reference).then(setRefUsed);
  }, [method, reference]);

  const canPay =
    ctx?.roleCode === "owner" || ctx?.roleName === "مالك" || ctx?.roleCode === "manager";
  const owedRaw = (party as (LocalParty & { supplier_owed_minor?: string }) | null | undefined)
    ?.supplier_owed_minor;
  const serverOwed = owedRaw ? BigInt(owedRaw) : null;
  const before = (serverOwed ?? 0n) + pending;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n) errors["amount"] = "مبلغ موجب";
  if (method === "bank" && !reference.trim()) errors["reference"] = "مرجع التحويل — إلزامي";
  const refDuplicate = method === "bank" && refUsed;
  if (refDuplicate) errors["reference"] = REF_USED_TEXT;
  const invalid = Object.keys(errors).length > 0;
  const after = before - (amountMinor && amountMinor > 0n ? amountMinor : 0n);

  const state: State =
    !canPay && ctx
      ? "permission_denied"
      : phase === "saving"
        ? "saving"
        : phase === "saved"
          ? push === "synced"
            ? "success"
            : "saved_local"
          : attempted && invalid
            ? "validation_error"
            : "ready";

  const commit = async () => {
    if (!party || !shift || !ctx || !canPay || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    if (!ids.current)
      ids.current = { operationId: crypto.randomUUID(), receiptId: crypto.randomUUID() };
    const { receipt } = await saveReceiptLocally(getStorage(), {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      partyId: party.id,
      partyName: party.name,
      partyOperationId: party.operation_id,
      kind: "payment",
      method,
      amountMinor: (amountMinor ?? 0n).toString(),
      reference,
      reason: note,
      shift,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      businessDate: shift.business_date || today(),
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

  const methodText = (m: ReceiptMethod) => (m === "cash" ? "نقداً" : "تحويل بنكي");

  return (
    <Frame title="الموردون" nav={<AppNav currentId="suppliers" />} footer={null}>
      <div className="pos pos--wide pos--cols" data-screen="PTY-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">دفع لمورد — سند صرف</h2>
            <span className="cat-head__hint">
              يخفّض ما له علينا. النقد يخرج من صندوق الوردية المفتوحة.
            </span>
          </div>
          {party ? (
            <div className="acc-card__body">
              {state === "permission_denied" ? (
                <Notice kind="locked" title="الدفع للمورد للمدير والمالك">
                  <p className="acc-lead">
                    الدفع يُخرج نقداً من الصندوق، فصلاحيته كصلاحية ردّ المبلغ.
                  </p>
                </Notice>
              ) : null}

              {phase !== "saved" && state !== "permission_denied" ? (
                <>
                  <h3 className="pos-credit__title">دفع إلى {party.name}</h3>
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">له علينا الآن</span>
                      <span className="shift-facts__v sting-mono">
                        {serverOwed === null && pending === 0n
                          ? "—"
                          : formatMinor(before.toString())}
                      </span>
                    </div>
                  </div>
                  {pending !== 0n && serverOwed !== null ? (
                    <p className="acc-choice__note">
                      خادمي <span className="sting-mono">{formatMinor(serverOwed.toString())}</span>{" "}
                      − معلّق هذا الجهاز{" "}
                      <span className="sting-mono">{formatMinor((-pending).toString())}</span> ={" "}
                      <span className="sting-mono">{formatMinor(before.toString())}</span>
                    </p>
                  ) : null}
                  <TextField
                    label="المبلغ المدفوع"
                    mono
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    error={attempted ? errors["amount"] : undefined}
                    required
                  />
                  <RadioGroupField
                    label="الوسيلة"
                    name="sp-method"
                    value={method}
                    onChange={(v) => setMethod(v as ReceiptMethod)}
                    options={[
                      { value: "cash", label: "نقداً" },
                      { value: "bank", label: "تحويل بنكي" },
                    ]}
                  />
                  {method === "bank" ? (
                    <TextField
                      label="مرجع التحويل — إلزامي"
                      mono
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      error={attempted ? errors["reference"] : undefined}
                      required
                    />
                  ) : null}
                  <TextField
                    label="ملاحظة"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">
                        <strong>له علينا بعد الدفع</strong>
                      </span>
                      <span className="shift-facts__v sting-mono">
                        {serverOwed === null && pending === 0n
                          ? "—"
                          : formatMinor(after.toString())}
                      </span>
                    </div>
                  </div>
                  <p className="acc-choice__note">
                    {method === "cash"
                      ? "النقد يخرج من صندوق الوردية المفتوحة فوراً ويظهر في «الوردية»."
                      : "التحويل الصادر يخفّض ما له علينا فوراً — أرسلته أنت."}
                  </p>
                  {state === "validation_error" && refDuplicate ? (
                    <Notice kind="error" title={REF_USED_TEXT}>
                      <p className="acc-lead">
                        المرجع <span className="sting-mono">{reference.trim()}</span> مسجَّل على سند
                        أو فاتورة أخرى على هذا الجهاز.
                      </p>
                    </Notice>
                  ) : null}
                  <div className="cat-form__actions">
                    <Button
                      financial
                      pos
                      onClick={() => void commit()}
                      loading={phase === "saving"}
                      disabledReason={
                        !shift
                          ? "لا وردية مفتوحة — النقد يخرج من صندوق الوردية"
                          : attempted && invalid
                            ? "أكمل الحقول المطلوبة"
                            : undefined
                      }
                    >
                      تسجيل الدفع وطباعة سند صرف
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/parties/${party.id}/supplier-statement`)}
                    >
                      كشف حساب المورد
                    </Button>
                  </div>
                </>
              ) : null}

              {state === "saving" ? (
                <Notice kind="info" title="جارٍ الحفظ">
                  <p className="acc-lead">يُحفظ السند ثم يُطبع.</p>
                </Notice>
              ) : null}

              {phase === "saved" && saved ? (
                <>
                  {state === "success" ? (
                    <Notice kind="success" title="سُجّل الدفع">
                      <p className="acc-lead">
                        سند صرف <span className="sting-mono">{saved.receipt_number}</span> · رقم
                        نهائي وطباعة جاهزة.
                      </p>
                      <p className="acc-choice__note">
                        <strong>لا يُحذف</strong> · التصحيح بسند عكس يشير إليه.
                      </p>
                    </Notice>
                  ) : (
                    <Notice kind="offline" title="سُجّل بلا اتصال">
                      <p className="acc-lead">
                        الدفع محفوظ على الجهاز ويُرفع عند الاتصال. ما له علينا يُحدَّث محلياً.
                      </p>
                    </Notice>
                  )}
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">السند</span>
                      <span className="shift-facts__v sting-mono">{saved.receipt_number}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">المبلغ</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(saved.amount_minor)}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">الوسيلة</span>
                      <span className="shift-facts__v">{methodText(saved.method)}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">له علينا بعد الدفع</span>
                      <span className="shift-facts__v sting-mono">
                        {serverOwed === null && pending === 0n
                          ? "—"
                          : formatMinor(after.toString())}
                      </span>
                    </div>
                  </div>
                  <SyncIndicator
                    state={!online ? "offline" : push === "synced" ? "synced" : "pending_sync"}
                    lastServerAt={push === "synced" ? hhmm(new Date().toISOString()) : null}
                    pendingCount={push === "synced" ? 0 : 1}
                    pendingLabel={(n) =>
                      n === 1
                        ? "عملية واحدة معلقة من هذا الجهاز"
                        : `${n} عمليات معلقة من هذا الجهاز`
                    }
                  />
                  <PrintDoc title={docTitle("سند صرف", saved.receipt_number, shop)} screen="hidden">
                    <Receipt
                      shopName={shop || "—"}
                      title="سند صرف"
                      number={saved.receipt_number}
                      dateLabel={`${saved.business_date} ${hhmm(saved.occurred_at)}`}
                      lines={[
                        { label: "إلى", value: saved.party_name },
                        { label: "الوسيلة", value: methodText(saved.method) },
                        ...(saved.reference
                          ? [{ label: "المرجع", value: saved.reference, mono: true }]
                          : []),
                        ...(saved.reason ? [{ label: "ملاحظة", value: saved.reason }] : []),
                        {
                          label: "المبلغ",
                          value: formatMinor(saved.amount_minor),
                          mono: true,
                          strong: true,
                        },
                      ]}
                      footer={<span>{saved.user_name}</span>}
                    />
                  </PrintDoc>
                  <div className="cat-form__actions">
                    <Button onClick={() => printDocument()} pos>
                      اطبع
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/parties/${party.id}/supplier-statement`)}
                    >
                      كشف حساب المورد
                    </Button>
                    <Button variant="quiet" onClick={() => router.push("/parties/suppliers")}>
                      الموردون
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
