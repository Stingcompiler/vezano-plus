"use client";

import {
  type CartDiscount,
  type CartDraft,
  cartTotals,
  checkDiscount,
  type DiscountCaps,
  type DiscountCheck,
  type PinVerifierRow,
  readCartDraft,
  requestDiscountOverride,
  writeCartDraft,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/approvals/approvals.css";
import { ApproverPin } from "@/features/approvals/approver-pin";
import { ApprovalOutcome, useApprovalStatus } from "@/features/approvals/use-approval";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PosNav } from "./pos-nav";

type State = "ready" | "validation_error" | "permission_denied";

/** طلب الاعتماد المرسل إلى «طلبات تنتظرك» يبقى معروفاً إن غادر الكاشير الشاشة وعاد (0005 §٢٩٣). */
const PENDING_META = "pos.discount_request";
interface PendingRequest {
  readonly request_id: string;
  readonly discount: CartDiscount;
}

/** سقوف افتراضية حين لم يقل الخادم شيئاً بعد (كاشير — G-09 مؤقتاً). */
const DEFAULT_CAPS: DiscountCaps = {
  per_op_minor: "1000",
  daily_minor: "5000",
  percent: 10,
  used_today_minor: "0",
};

/** «8.00» ↔ 800 بالوحدة الصغرى؛ الأرقام العربية تُقبل. */
function parseAmount(text: string): string | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".");
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) return null;
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"))).toString();
}

/**
 * POS-03 — خصم وتجاوز سعر (03-D2 ready/permission_denied · 42-D34 validation_error): حدّ التفويض
 * وسبب وهوية المنفّذ. سقف الدور معلن قبل الكتابة؛ ما يتجاوزه لا يُرفض صامتاً بل يُعرض الحدّ والفارق
 * والمسار: «طلب اعتماد من مدير الفرع» حدثُ تجاوز يُنسب للكاشير ويُراجع عند الاتصال (§٧.٤)، أو
 * «تخفيض الخصم» إلى الحدّ. الفاتورة محفوظة في السلة ولن تُفقد.
 */
export function DiscountClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [mode, setMode] = useState<CartDiscount["mode"]>("amount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<DiscountCheck | null>(null);
  const [requested, setRequested] = useState(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const decision = useApprovalStatus("discount", pending?.request_id ?? null);
  const opIds = useRef({ operationId: "", requestId: "" });
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Fdiscount");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [d, c, rawPending] = await Promise.all([
        readCartDraft(storage),
        readShiftContext(storage, app),
        storage.read((tx) => tx.getMeta(PENDING_META)),
      ]);
      setDraft(d);
      setCtx(c);
      const p = rawPending ? (JSON.parse(rawPending) as PendingRequest) : null;
      if (p && d.lines.length) {
        setPending(p);
        setRequested(true);
        setMode(p.discount.mode);
        setValue(
          p.discount.mode === "amount" ? formatMinor(p.discount.value, 2, false) : p.discount.value,
        );
        setReason(p.discount.reason);
      }
      if (d.discount) {
        setMode(d.discount.mode);
        setValue(
          d.discount.mode === "amount" ? formatMinor(d.discount.value, 2, false) : d.discount.value,
        );
        setReason(d.discount.reason);
      }
    })();
  }, [router]);

  const caps = ctx?.discountCaps ?? DEFAULT_CAPS;
  const totals = draft ? cartTotals(draft.lines) : null;
  const subtotal = totals?.subtotalMinor ?? 0n;
  const unlimited =
    !caps.forbidden && caps.per_op_minor === "0" && caps.daily_minor === "0" && caps.percent === 0;

  const current = (): CartDiscount | null => {
    const raw =
      mode === "amount"
        ? parseAmount(value)
        : /^(0|[1-9][0-9]*)$/.test(value.trim()) && Number(value) <= 100
          ? value.trim()
          : null;
    return raw === null ? null : { mode, value: raw, reason: reason.trim() };
  };

  const apply = async () => {
    const d = current();
    if (!draft || !d) {
      setCheck({ ok: false, reason: "invalid", cap: "", minor: 0n });
      return;
    }
    const result = checkDiscount(d, caps, subtotal);
    setCheck(result);
    if (!result.ok) return;
    await writeCartDraft(getStorage(), { ...draft, discount: d });
    router.push("/pos");
  };

  const reduce = async () => {
    if (!check || check.ok || !draft) return;
    const capped: CartDiscount = { mode, value: check.cap, reason: reason.trim() };
    await writeCartDraft(getStorage(), { ...draft, discount: capped });
    router.push("/pos");
  };

  const requestApproval = async () => {
    const d = current();
    if (!d || !check || check.ok || busy) return;
    setBusy(true);
    try {
      // طلب رُفض: طلب جديد بهوية جديدة
      if (!opIds.current.operationId || decision?.status === "rejected")
        opIds.current = { operationId: crypto.randomUUID(), requestId: crypto.randomUUID() };
      await requestDiscountOverride(getStorage(), {
        ...opIds.current,
        branchId: ctx?.branchId ?? appRef.current.session.branchId ?? "",
        discount: d,
        cap: check.cap,
        cartTotalMinor: subtotal.toString(),
        discountMinor: check.minor.toString(),
        occurredAt: new Date().toISOString(),
      });
      const p: PendingRequest = { request_id: opIds.current.requestId, discount: d };
      await getStorage().transaction((tx) => tx.putMeta(PENDING_META, JSON.stringify(p)));
      setPending(p);
      setRequested(true);
      if (online) void pushPending();
    } finally {
      setBusy(false);
    }
  };

  /** مدير حاضر اعتمد برمزه: الطلب يُسجَّل معتمداً باسمه والخصم يدخل السلة (0005 §٢٩٣). */
  const approvedOnSpot = async (approver: PinVerifierRow) => {
    const d = current();
    if (!d || !check || check.ok || !draft) return;
    const ids = { operationId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    await requestDiscountOverride(getStorage(), {
      ...ids,
      branchId: ctx?.branchId ?? appRef.current.session.branchId ?? "",
      discount: d,
      cap: check.cap,
      cartTotalMinor: subtotal.toString(),
      discountMinor: check.minor.toString(),
      occurredAt: new Date().toISOString(),
      pinApproval: { approverUserId: approver.user_id, verifierVersion: approver.version },
    });
    await writeCartDraft(getStorage(), {
      ...draft,
      discount: {
        ...d,
        approval: {
          request_id: ids.requestId,
          approved_by_user_id: approver.user_id,
          approved_by_name: approver.display_name,
          via: "pin",
        },
      },
    });
    if (online) void pushPending();
    router.push("/pos");
  };

  /** الطلب وافق عليه المالك أو المدير من «طلبات تنتظرك»: الخصم المطلوب يدخل السلة باسمه. */
  const applyApproved = async () => {
    if (!pending || !draft || decision?.status !== "approved") return;
    await writeCartDraft(getStorage(), {
      ...draft,
      discount: {
        ...pending.discount,
        approval: {
          request_id: pending.request_id,
          approved_by_user_id: decision.decided_by_user_id,
          approved_by_name: decision.decided_by_name,
          via: "inbox",
        },
      },
    });
    await getStorage().transaction((tx) => tx.putMeta(PENDING_META, ""));
    router.push("/pos");
  };

  const state: State =
    check && !check.ok
      ? check.reason === "over_op" || check.reason === "over_daily" || check.reason === "forbidden"
        ? "permission_denied"
        : "validation_error"
      : "ready";
  const capText = check && !check.ok ? check.cap : "";
  // «٪» حرف عربي — خارج mono دائماً
  const capShown =
    mode === "amount" ? (
      <span className="sting-mono">{formatMinor(capText || "0")}</span>
    ) : (
      <>
        <span className="sting-mono">{capText}</span>٪
      </>
    );
  const requestedValue =
    mode === "amount" ? (
      <span className="sting-mono">{formatMinor(parseAmount(value) ?? "0")}</span>
    ) : (
      <>
        <span className="sting-mono">{value}</span>٪
      </>
    );

  return (
    <Frame title="نقطة البيع" nav={<PosNav currentId="pos" />} footer={null}>
      <div className="pos pos--wide pos--cols" data-screen="POS-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">خصم على الفاتورة</h2>
            {totals ? (
              <span className="cat-head__hint">
                الإجمالي <span className="sting-mono">{formatMinor(subtotal.toString())}</span>
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {draft && draft.lines.length === 0 ? (
              <Notice
                kind="empty"
                title="السلة فارغة"
                action={<Button onClick={() => router.push("/pos")}>نقطة البيع</Button>}
              >
                <p className="acc-lead">فاتورة جديدة — لم تُحفظ</p>
              </Notice>
            ) : null}

            <div className="pos-chips" role="group" aria-label="نوع الخصم">
              {(
                [
                  ["amount", "مبلغ"],
                  ["percent", "نسبة"],
                ] as const
              ).map(([m, t]) => (
                <button
                  key={m}
                  type="button"
                  className={`pos-chip${mode === m ? " pos-chip--on" : ""}`}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setCheck(null);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="cat-price__field">
              <TextField
                label="قيمة الخصم"
                mono
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setCheck(null);
                }}
                error={
                  check && !check.ok && check.reason === "invalid"
                    ? "اكتب مبلغاً موجباً بأرقام لاتينية."
                    : undefined
                }
                required
              />
            </div>
            <TextField
              label="السبب — إلزامي"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />

            {state === "permission_denied" && check && !check.ok && check.reason === "forbidden" ? (
              <Notice kind="locked" title="الخصم ليس من صلاحية دورك">
                <p className="acc-lead">
                  يحتاج اعتماد مدير الفرع أو المالك. الفاتورة محفوظة في السلة ولن تُفقد.
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" && check && !check.ok && check.reason !== "forbidden" ? (
              <Notice
                kind="locked"
                title={check.reason === "over_op" ? "يتجاوز حدّك للعملية" : "يتجاوز حدّك اليومي"}
              >
                <p className="acc-lead">
                  {check.reason === "over_op" ? (
                    <>
                      حدّك {capShown} والمطلوب {requestedValue}.
                    </>
                  ) : (
                    <>
                      حدّك <span className="sting-mono">{formatMinor(check.cap)}</span> يومياً
                      والمستخدَم اليوم{" "}
                      <span className="sting-mono">{formatMinor(caps.used_today_minor)}</span>.
                    </>
                  )}{" "}
                  يحتاج اعتماد مدير الفرع أو المالك. الفاتورة محفوظة في السلة ولن تُفقد.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" &&
            check &&
            !check.ok &&
            check.reason === "over_percent" ? (
              <Notice kind="error" title="خصم يتجاوز سقف الدور">
                <p className="acc-lead">
                  سقفك <span className="sting-mono">{check.cap}</span>٪ — يحتاج هذا الخصم تفويض مدير
                  الفرع
                </p>
              </Notice>
            ) : null}

            {requested ? (
              <Notice kind="info" title="طلب اعتماد من مدير الفرع">
                <p className="acc-lead">طلب تفويضٍ يسجَّل باسم من وافق.</p>
                <ApprovalOutcome item={decision} />
                {decision?.status === "approved" ? (
                  <div className="acc-actions">
                    <Button financial onClick={() => void applyApproved()}>
                      طبّق الخصم المعتمد
                    </Button>
                  </div>
                ) : null}
              </Notice>
            ) : null}

            {pinOpen && check && !check.ok && check.reason !== "invalid" && ctx ? (
              <ApproverPin
                request={{
                  kind: "discount",
                  amountMinor: check.minor,
                  branchId: ctx.branchId,
                  requesterId: ctx.userId,
                }}
                onApproved={approvedOnSpot}
              />
            ) : null}

            {!unlimited && !caps.forbidden ? (
              <p className="cat-saving__note">
                حدّك كـ<strong>{ctx?.roleName || "كاشير"}</strong>:{" "}
                <span className="sting-mono">{formatMinor(caps.per_op_minor)}</span> للعملية ·{" "}
                <span className="sting-mono">{formatMinor(caps.daily_minor)}</span> يومياً.
                المستخدَم اليوم{" "}
                <span className="sting-mono">{formatMinor(caps.used_today_minor)}</span>.
                <br />
                القيم تجريبية — تُضبط في مصفوفة الأدوار.
              </p>
            ) : null}

            <div className="cat-form__actions">
              {check && !check.ok && check.reason !== "invalid" ? (
                <>
                  <Button
                    financial
                    onClick={() => void requestApproval()}
                    loading={busy}
                    disabledReason={
                      requested && decision?.status !== "rejected"
                        ? "طلب تفويضٍ يسجَّل باسم من وافق"
                        : !reason.trim()
                          ? "السبب — إلزامي"
                          : undefined
                    }
                  >
                    طلب اعتماد من مدير الفرع
                  </Button>
                  {!pinOpen ? (
                    <Button
                      variant="secondary"
                      onClick={() => setPinOpen(true)}
                      disabledReason={!reason.trim() ? "السبب — إلزامي" : undefined}
                    >
                      اعتماد مدير حاضر
                    </Button>
                  ) : null}
                  {check.reason !== "forbidden" ? (
                    <Button variant="secondary" onClick={() => void reduce()}>
                      تخفيض الخصم إلى {capShown}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  financial
                  onClick={() => void apply()}
                  disabledReason={
                    !draft?.lines.length
                      ? "السلة فارغة"
                      : !reason.trim()
                        ? "السبب — إلزامي"
                        : undefined
                  }
                >
                  تطبيق الخصم
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
