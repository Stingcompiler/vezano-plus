"use client";

import {
  cartTotals,
  discardHeldCart,
  type HeldCart,
  readHeldCarts,
  resumeHeldCart,
} from "@sting/sync-core";
import { Button, Dialog, formatMinor, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/approvals/approvals.css";
import { hhmm } from "@/features/home/format";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

import { PosNav } from "./pos-nav";

type State = "loading" | "ready" | "empty";

/**
 * POS-13 — المعلّقات (S-03؛ 0005 §٢٩٣؛ غير مرسومة): ما عُلّق بـ«تعليق الفاتورة» على هذا الجهاز بسلته
 * وخصمه وعميله. «استئناف» يعيدها سلةً ويُخرجها من القائمة؛ «حذف المعلّقة» بتأكيد. على الجهاز وحده بلا
 * مزامنة (القرار د-٣).
 */
export function HeldClient() {
  const router = useRouter();
  const app = useApp();
  const [held, setHeld] = useState<HeldCart[] | null>(null);
  const [cartBusy, setCartBusy] = useState(false);
  const [confirm, setConfirm] = useState<HeldCart | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Fheld");
      return;
    }
    void readHeldCarts(getStorage()).then(setHeld);
  }, [router]);

  const resume = async (h: HeldCart) => {
    const out = await resumeHeldCart(getStorage(), h.id);
    if (out.ok) {
      router.push("/pos");
      return;
    }
    if (out.reason === "cart_not_empty") setCartBusy(true);
    setHeld(await readHeldCarts(getStorage()));
  };

  const discard = async () => {
    if (!confirm) return;
    await discardHeldCart(getStorage(), confirm.id);
    setConfirm(null);
    setHeld(await readHeldCarts(getStorage()));
  };

  const state: State = held === null ? "loading" : held.length === 0 ? "empty" : "ready";

  return (
    <Frame title="نقطة البيع" nav={<PosNav currentId="pos" />} footer={null}>
      <div className="pos pos--wide" data-screen="POS-13" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">المعلّقات</h2>
            <span className="cat-head__hint">على هذا الجهاز وحده</span>
          </div>
          <div className="acc-card__body">
            {state === "empty" ? (
              <Notice kind="empty" title="لا فواتير معلّقة على هذا الجهاز.">
                <div className="acc-actions">
                  <Button onClick={() => router.push("/pos")}>نقطة البيع</Button>
                </div>
              </Notice>
            ) : null}
            {cartBusy ? (
              <Notice kind="warning" title="السلة ليست فارغة">
                <p className="acc-lead">علّق السلة الحالية أو ألغها، ثم استأنف.</p>
              </Notice>
            ) : null}
            {held && held.length > 0 ? (
              <ul className="apr-list">
                {held.map((h) => {
                  const t = cartTotals(h.lines, h.discount);
                  return (
                    <li key={h.id} className="c-card apr-item">
                      <div className="apr-item__head">
                        <h3 className="apr-item__title">
                          {h.label || h.customer?.name || "فاتورة معلّقة"}
                        </h3>
                        <strong className="sting-mono">
                          {formatMinor(t.totalMinor.toString())}
                        </strong>
                      </div>
                      <p className="acc-choice__note">
                        عُلّقت <span className="sting-mono">{hhmm(h.held_at)}</span> · الأسطر{" "}
                        <span className="sting-mono">{t.lineCount}</span>
                        {h.customer ? <> · {h.customer.name}</> : null}
                        {t.discountMinor > 0n ? (
                          <>
                            {" "}
                            · خصم{" "}
                            <span className="sting-mono">
                              {formatMinor(t.discountMinor.toString())}
                            </span>
                          </>
                        ) : null}
                      </p>
                      <div className="apr-item__actions">
                        <Button pos onClick={() => void resume(h)}>
                          استئناف
                        </Button>
                        <Button variant="secondary" pos onClick={() => setConfirm(h)}>
                          حذف المعلّقة
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
      <Dialog
        open={confirm !== null}
        title="حذف المعلّقة"
        kind="danger"
        onClose={() => setConfirm(null)}
        primaryLabel="حذف المعلّقة"
        onPrimary={() => void discard()}
        cancelLabel="تراجع"
      >
        <p className="acc-lead">تُحذف من هذا الجهاز ولا تعود.</p>
      </Dialog>
    </Frame>
  );
}
