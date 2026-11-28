"use client";

import { Button, formatQty, Frame, Notice, Status, Table } from "@sting/ui-web";
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
import { DayLabel } from "@/features/pos/invoices-client";
import { PosNav } from "@/features/pos/pos-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "loading" | "ready" | "empty" | "offline" | "server_error" | "permission_denied";

export interface ReceiptView {
  readonly id: string;
  readonly receipt_number: string;
  readonly branch_name: string;
  readonly supplier_name: string;
  readonly reference: string;
  readonly user_name: string;
  readonly occurred_at: string;
  readonly order_id: string;
  readonly order_number: string;
  readonly lines: readonly {
    readonly id: string;
    readonly item_name: string;
    readonly unit_name: string;
    readonly qty_milli: string;
  }[];
  readonly document: {
    readonly id: string;
    readonly number: string;
    readonly status: string;
    readonly status_label: string;
  } | null;
  readonly can_convert: boolean;
}

/** «4 كرتونة» — الكمية بوحدة الاستلام؛ الكسور تُعرض حين تقع. */
const qty = (milli: string) => formatQty(milli, BigInt(milli || "0") % 1000n === 0n ? 0 : 3);

/** «حوّل إلى مستند شراء» (I-02، 0005 §٢٩٥) — يعيد المستند المربوط بالاستلام أو ينشئه. */
async function convertReceipt(id: string): Promise<string | null> {
  const { data, response } = await api().POST("/api/inventory/receipts/{receipt_id}/document", {
    params: { path: { receipt_id: id } },
  });
  const body = data as unknown as { document: { id: string } } | undefined;
  return response.ok && body ? body.document.id : null;
}

/**
 * INV-12 — الاستلامات (I-02، 0005 §٢٩٥؛ بلا إطار مرسوم): ما استلمه أمين المخزن ودخل المخزون، بمستند
 * شرائه أو «بلا مستند شراء». المدير يحوّله إلى مستند شراء فتُضاف الأسعار والذمّة بلا مخزون ثانٍ.
 * المالك والمدير وأمين المخزن؛ أمين المخزن يرى ولا يحوّل. أونلاين.
 */
export function ReceiptsClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [scope, setScope] = useState<"unpriced" | "all">("unpriced");
  const [data, setData] = useState<{
    receipts: ReceiptView[];
    unpriced_count: number;
    can_convert: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Freceipts");
      return;
    }
    if (!navigator.onLine) return;
    setFailed(false);
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/inventory/receipts", {
          params: { query: { scope } },
        });
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        const body = data as unknown as
          { receipts: ReceiptView[]; unpriced_count: number; can_convert: boolean } | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
      } catch {
        setFailed(true);
      }
    })();
  }, [router, scope, online]);

  const rows = data?.receipts ?? [];
  const state: State = denied
    ? "permission_denied"
    : !online && !data
      ? "offline"
      : failed
        ? "server_error"
        : !data
          ? "loading"
          : rows.length === 0
            ? "empty"
            : "ready";

  const columns = [
    {
      key: "number",
      header: "الاستلام",
      render: (r: ReceiptView) => (
        <div>
          <Button
            variant="quiet"
            className="shift-row__open"
            onClick={() => router.push(`/inventory/receipts/${r.id}`)}
          >
            <span className="sting-mono">{r.receipt_number}</span>
          </Button>
          <div className="acc-choice__note">
            {r.supplier_name} · {r.user_name}
          </div>
        </div>
      ),
    },
    {
      key: "at",
      header: "استُلم",
      render: (r: ReceiptView) => (
        <>
          <DayLabel iso={r.occurred_at} now={new Date()} />{" "}
          <span className="sting-mono">{hhmm(r.occurred_at)}</span>
        </>
      ),
    },
    {
      key: "doc",
      header: "مستند الشراء",
      render: (r: ReceiptView) =>
        r.document ? (
          <>
            <span className="sting-mono">{r.document.number}</span>{" "}
            <Status
              state={r.document.status === "approved" ? "synced" : "pending_sync"}
              label={r.document.status_label}
              dot={false}
            />
          </>
        ) : (
          <Status state="stale" label="بلا مستند شراء" dot={false} />
        ),
    },
  ];

  return (
    <Frame title="المخزون" nav={<PosNav currentId="inventory" />} footer={null}>
      <div className="pos" data-screen="INV-12" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الاستلامات</h2>
            <span className="cat-head__hint">
              الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__foot">
              <span className="acc-choice__note">
                بلا مستند شراء <span className="sting-mono">{data?.unpriced_count ?? 0}</span>
              </span>
              <span className="pty-actions">
                <Button
                  variant={scope === "unpriced" ? "primary" : "secondary"}
                  onClick={() => setScope("unpriced")}
                >
                  بلا مستند شراء
                </Button>
                <Button
                  variant={scope === "all" ? "primary" : "secondary"}
                  onClick={() => setScope("all")}
                >
                  كل الاستلامات
                </Button>
              </span>
            </div>
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الاستلامات للمالك والمدير وأمين المخزن" />
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">يحتاج اتصالاً</p>
              </Notice>
            ) : null}
            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر التحميل. أعد المحاولة." />
            ) : null}
            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا استلامات بلا مستند شراء"
                action={
                  <Button onClick={() => router.push("/inventory/receive")}>استلام بضاعة</Button>
                }
              />
            ) : null}
            {state !== "permission_denied" && state !== "offline" ? (
              <Table
                caption="الاستلامات"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                loading={state === "loading" ? 3 : undefined}
                onOpenRow={(r) => router.push(`/inventory/receipts/${r.id}`)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}

/**
 * INV-11 — استلام مسجَّل (I-02، 0005 §٢٩٥؛ بلا إطار مرسوم): ما كتبه أمين المخزن كما كتبه —
 * المورد والمرجع والكميات وأمر الشراء — و«حوّل إلى مستند شراء» للمالك والمدير. الاستلام لا يُعدَّل.
 */
export function ReceiptClient({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [rc, setRc] = useState<ReceiptView | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [convertFailed, setConvertFailed] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/inventory/receipts/${receiptId}`)}`);
      return;
    }
    if (!navigator.onLine) return;
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/inventory/receipts/{receipt_id}", {
          params: { path: { receipt_id: receiptId } },
        });
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        if (response.status === 404) {
          router.replace("/inventory/receipts");
          return;
        }
        const body = data as unknown as { receipt: ReceiptView } | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setRc(body.receipt);
      } catch {
        setFailed(true);
      }
    })();
  }, [router, receiptId, online]);

  const convert = async () => {
    if (!rc || busy) return;
    setBusy(true);
    setConvertFailed(false);
    try {
      const id = await convertReceipt(rc.id);
      if (id) router.push(`/purchasing/documents/${id}`);
      else setConvertFailed(true);
    } catch {
      setConvertFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : !online && !rc
      ? "offline"
      : failed || convertFailed
        ? "server_error"
        : !rc
          ? "loading"
          : "ready";

  return (
    <Frame title="المخزون" nav={<PosNav currentId="inventory" />} footer={null}>
      <div className="pos" data-screen="INV-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              استلام {rc ? <span className="sting-mono">{rc.receipt_number}</span> : null}
            </h2>
            <span className="cat-head__hint">الاستلام يُدخل المخزون فقط.</span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الاستلامات للمالك والمدير وأمين المخزن" />
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">يحتاج اتصالاً</p>
              </Notice>
            ) : null}
            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر التحميل. أعد المحاولة." />
            ) : null}
            {state === "loading" ? <Notice kind="info" title="جارٍ التحميل" /> : null}
            {rc ? (
              <>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">المورد</span>
                    <span className="shift-facts__v">{rc.supplier_name}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">مرجع المستند</span>
                    <span className="shift-facts__v">{rc.reference}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المسؤول</span>
                    <span className="shift-facts__v">
                      {rc.user_name} · <DayLabel iso={rc.occurred_at} now={new Date()} />{" "}
                      <span className="sting-mono">{hhmm(rc.occurred_at)}</span>
                    </span>
                  </div>
                  {rc.order_number ? (
                    <div>
                      <span className="shift-facts__k">أمر الشراء</span>
                      <span className="shift-facts__v sting-mono">{rc.order_number}</span>
                    </div>
                  ) : null}
                  {rc.lines.map((ln) => (
                    <div key={ln.id}>
                      <span className="shift-facts__k">{ln.item_name}</span>
                      <span className="shift-facts__v">
                        <span className="sting-mono">{qty(ln.qty_milli)}</span> {ln.unit_name}
                      </span>
                    </div>
                  ))}
                </div>
                {rc.document ? (
                  <Notice
                    kind={rc.document.status === "approved" ? "success" : "info"}
                    title={
                      <>
                        مستند شراء <span className="sting-mono">{rc.document.number}</span> —{" "}
                        {rc.document.status_label}
                      </>
                    }
                    action={
                      <Button
                        pos
                        onClick={() => router.push(`/purchasing/documents/${rc.document?.id}`)}
                      >
                        افتح مستند الشراء
                      </Button>
                    }
                  >
                    <p className="acc-lead">
                      <strong>المخزون</strong> · دخل من الاستلام{" "}
                      <span className="sting-mono">{rc.receipt_number}</span> — لا يدخل مرة ثانية.
                    </p>
                  </Notice>
                ) : (
                  <Notice kind="warning" title="بلا مستند شراء">
                    <p className="acc-lead">
                      الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.
                    </p>
                  </Notice>
                )}
                <div className="cat-form__actions">
                  {!rc.document && rc.can_convert ? (
                    <Button financial pos onClick={() => void convert()} loading={busy}>
                      حوّل إلى مستند شراء
                    </Button>
                  ) : null}
                  {!rc.document && !rc.can_convert ? (
                    <p className="acc-choice__note">الاعتماد للمالك والمحاسب</p>
                  ) : null}
                  <Button variant="quiet" onClick={() => router.push("/inventory/receipts")}>
                    الاستلامات
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
