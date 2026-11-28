"use client";

import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
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

type State = "loading" | "ready" | "empty" | "offline" | "server_error";

interface SessionRow {
  readonly id: string;
  readonly session_number: string;
  readonly status: "closed" | "adjusted";
  readonly user_name: string;
  readonly counted_items: number;
  readonly total_items: number;
  readonly closed_at: string;
}

/**
 * INV-14 — جلسات الجرد (I-10، 0005 §٢٩٥؛ بلا إطار مرسوم): الجرد الذي يعدّه أمين المخزن يجده المدير
 * هنا — كل جلسة بمن عدّها ومتى، و«جرد ينتظر التسوية» حتى تُسوّى في «مراجعة الفروق». أونلاين.
 */
export function CountSessionsClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Fcount%2Fsessions");
      return;
    }
    if (!navigator.onLine) return;
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/inventory/count-sessions", {});
        const body = data as unknown as { sessions: SessionRow[] } | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setRows(body.sessions);
      } catch {
        setFailed(true);
      }
    })();
  }, [router, online]);

  const state: State =
    !online && rows === null
      ? "offline"
      : failed && rows === null
        ? "server_error"
        : rows === null
          ? "loading"
          : rows.length === 0
            ? "empty"
            : "ready";
  const waiting = (rows ?? []).filter((r) => r.status === "closed").length;

  const columns = [
    {
      key: "number",
      header: "الجلسة",
      render: (r: SessionRow) => (
        <div>
          <Button
            variant="quiet"
            className="shift-row__open"
            onClick={() => router.push(`/inventory/count/${r.id}/review`)}
          >
            <span className="sting-mono">{r.session_number}</span>
          </Button>
          <div className="acc-choice__note">{r.user_name}</div>
        </div>
      ),
    },
    {
      key: "counted",
      header: "المعدود",
      render: (r: SessionRow) => (
        <>
          <span className="sting-mono">{r.counted_items}</span> من{" "}
          <span className="sting-mono">{r.total_items}</span>
        </>
      ),
    },
    {
      key: "closed",
      header: "أُغلقت",
      render: (r: SessionRow) => (
        <>
          <DayLabel iso={r.closed_at} now={new Date()} />{" "}
          <span className="sting-mono">{hhmm(r.closed_at)}</span>
        </>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r: SessionRow) =>
        r.status === "closed" ? (
          <Status state="stale" label="جرد ينتظر التسوية" dot={false} />
        ) : (
          <Status state="synced" label="سُوّيت" dot={false} />
        ),
    },
  ];

  return (
    <Frame title="المخزون" nav={<PosNav currentId="inventory" />} footer={null}>
      <div className="pos" data-screen="INV-14" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">جلسات الجرد</h2>
            <span className="cat-head__hint">
              جرد ينتظر التسوية <span className="sting-mono">{waiting}</span>
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
            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا جلسات جرد"
                action={<Button onClick={() => router.push("/inventory/count")}>جلسة جرد</Button>}
              />
            ) : null}
            {state !== "offline" ? (
              <Table
                caption="جلسات الجرد"
                columns={columns}
                rows={rows ?? []}
                rowKey={(r) => r.id}
                loading={state === "loading" ? 3 : undefined}
                onOpenRow={(r) => router.push(`/inventory/count/${r.id}/review`)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
