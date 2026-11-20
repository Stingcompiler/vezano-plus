"use client";

import { type LocalReceipt, readLocalParties, readPendingSupplierPayments } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
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
import { DayLabel } from "@/features/pos/invoices-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State =
  "ready" | "loading" | "empty" | "stale" | "pending_sync" | "offline" | "permission_denied";
type Range = "30" | "all";

interface ServerRow {
  readonly doc: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
  readonly branch_id: string;
  readonly info: boolean;
  readonly source_party: string;
}

interface SupplierStatement {
  readonly side: "supplier";
  readonly party: { readonly id: string; readonly name: string; readonly phone: string };
  readonly rows: readonly ServerRow[];
  readonly owed_minor: string;
  readonly hidden_other_branch: number;
  readonly last_payment_at: string;
  readonly as_of: string;
  readonly scope: "all" | "branch";
  readonly branch_names: Record<string, string>;
}

interface Row {
  readonly id: string;
  readonly doc: string;
  readonly at: string;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly branch: string;
  readonly pending: boolean;
  readonly opening: boolean;
  readonly correctable: boolean;
}

const cacheKey = (id: string) => `parties.supplier-statement.${id}`;

/**
 * «كشف حساب المورد» (PTY-05 بجهة المورد؛ مراجعة الأطراف 2026-11-20، المرحلة ٣ — 0005 §٢٨٤): كشف
 * متتابع لـ«له علينا» من كل الحركات — الافتتاحي ومستندات الشراء المعتمدة في «له»، والمرتجعات
 * المقبولة وسندات الصرف في «عليه» (العمودان بمعناهما في كشف العميل نفسه — §٧.١ لا يبدّل الاتجاه
 * بحسب الشاشة). سندات الصرف من هذا الجهاز التي لم تُغطَّ تُلحق موسومة «معلّق — هذا الجهاز».
 */
export function SupplierStatementClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [name, setName] = useState("");
  const [data, setData] = useState<SupplierStatement | null>(null);
  const [cached, setCached] = useState<SupplierStatement | null>(null);
  const [pending, setPending] = useState<{ signed: bigint; rows: LocalReceipt[] }>({
    signed: 0n,
    rows: [],
  });
  const [range, setRange] = useState<Range>("30");
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;
  const appRouter = useRef(router);
  appRouter.current = router;
  const now = new Date();

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}/supplier-statement`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [parties, pend, raw] = await Promise.all([
        readLocalParties(storage),
        readPendingSupplierPayments(storage, partyId),
        storage.read((tx) => tx.getMeta(cacheKey(partyId))),
      ]);
      const local = parties.find((p) => p.id === partyId);
      if (local && !local.is_supplier) {
        router.replace(`/parties/${partyId}`);
        return;
      }
      if (local) setName(local.name);
      setPending({ signed: pend.signedMinor, rows: pend.rows });
      if (raw) setCached(JSON.parse(raw) as SupplierStatement);
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    setFetching(true);
    setFailed(false);
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}/statement", {
          params: { path: { party_id: partyId }, query: { range, side: "supplier" } },
        });
        if (!alive) return;
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        if (response.status === 404) {
          appRouter.current.replace(`/parties/${partyId}`);
          return;
        }
        const body = data as unknown as SupplierStatement | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        setName(body.party.name);
        await getStorage().transaction((tx) => tx.putMeta(cacheKey(partyId), JSON.stringify(body)));
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [online, partyId, range]);

  const server = data ?? cached;
  const serverIds = new Set((server?.rows ?? []).map((r) => r.doc_id));
  const serverOwed = server ? BigInt(server.owed_minor) : null;
  const pendingRows = pending.rows.filter((r) => !serverIds.has(r.id));
  const pendingSigned = pendingRows.reduce((acc, r) => acc - BigInt(r.amount_minor), 0n);
  const owed = serverOwed === null ? null : serverOwed + pendingSigned;
  let running = serverOwed ?? 0n;
  const rows: Row[] = [
    ...(server?.rows ?? []).map((r) => ({
      id: r.doc_id,
      doc: r.doc,
      at: r.occurred_at,
      label: r.label + (r.source_party ? ` · المصدر — ${r.source_party}` : ""),
      debit: r.debit_minor,
      credit: r.credit_minor,
      balance: r.balance_minor,
      branch: server?.branch_names[r.branch_id] ?? "",
      pending: false,
      opening: r.kind === "opening",
      correctable: r.kind === "payment" && server?.scope === "all",
    })),
    ...pendingRows.map((r) => {
      running -= BigInt(r.amount_minor);
      return {
        id: r.id,
        doc: r.receipt_number,
        at: r.occurred_at,
        label: r.method === "cash" ? "دفع نقدي" : "دفع بتحويل بنكي",
        debit: r.amount_minor,
        credit: "",
        balance: serverOwed === null ? "" : running.toString(),
        branch: "",
        pending: true,
        opening: false,
        correctable: false,
      };
    }),
  ];

  const state: State = denied
    ? "permission_denied"
    : !online
      ? "offline"
      : failed && server
        ? "stale"
        : (fetching && data === null) || (!server && !failed)
          ? "loading"
          : pendingRows.length > 0
            ? "pending_sync"
            : rows.length === 0
              ? "empty"
              : "ready";

  const columns = [
    {
      key: "doc",
      header: "التاريخ والمستند",
      render: (r: Row) => (
        <div>
          <div className="sting-mono">{r.doc}</div>
          <div className="acc-choice__note">
            <DayLabel iso={r.at} now={now} /> <span className="sting-mono">{hhmm(r.at)}</span>
          </div>
        </div>
      ),
    },
    {
      key: "label",
      header: "البيان",
      render: (r: Row) => (
        <div className="shift-status">
          <span>{r.label}</span>
          <Status
            state={r.pending ? "pending_sync" : r.opening ? "empty" : "synced"}
            label={r.pending ? "معلّق — هذا الجهاز" : r.opening ? "رصيد افتتاحي" : "مؤكد"}
            dot={false}
          />
          {r.correctable ? (
            <Button
              variant="quiet"
              onClick={() => router.push(`/parties/receipts/${r.id}/correct`)}
            >
              تصحيح حركة
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      key: "debit",
      header: "عليه",
      mono: true,
      render: (r: Row) => (r.debit ? formatMinor(r.debit) : "—"),
    },
    {
      key: "credit",
      header: "له",
      mono: true,
      render: (r: Row) => (r.credit ? formatMinor(r.credit) : "—"),
    },
    {
      key: "balance",
      header: "له علينا",
      mono: true,
      render: (r: Row) => (r.balance ? formatMinor(r.balance) : "—"),
    },
    { key: "branch", header: "الفرع", render: (r: Row) => r.branch || "—" },
  ];

  return (
    <Frame title="الموردون" nav={<AppNav currentId="suppliers" />} footer={null}>
      <div className="pos pos--wide" data-screen="PTY-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">كشف حساب المورد — {name || "—"}</h2>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="كشف المورد لمن يرى المال">
                <p className="acc-lead">
                  ما للمورد على المنشأة صورة مالية: للمالك والمدير. أمين المخزن يرى اسمه ليستلم منه.
                </p>
              </Notice>
            ) : (
              <>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">له علينا الآن</span>
                    <span className="shift-facts__v sting-mono">
                      {owed === null ? "—" : formatMinor(owed.toString())}
                    </span>
                  </div>
                </div>
                {pendingSigned !== 0n && serverOwed !== null ? (
                  <p className="acc-choice__note">
                    خادمي <span className="sting-mono">{formatMinor(serverOwed.toString())}</span> −
                    معلّق هذا الجهاز{" "}
                    <span className="sting-mono">{formatMinor((-pendingSigned).toString())}</span> ={" "}
                    <span className="sting-mono">{formatMinor((owed ?? 0n).toString())}</span>
                  </p>
                ) : null}
                <p className="acc-choice__note">
                  {server?.last_payment_at ? (
                    <>
                      آخر دفع <DayLabel iso={server.last_payment_at} now={now} />
                    </>
                  ) : (
                    "لا يوجد دفع مسجَّل"
                  )}
                  {server ? (
                    <>
                      {" · "}آخر تحديث خادمي{" "}
                      <span className="sting-mono">{hhmm(server.as_of)}</span>
                    </>
                  ) : null}
                </p>
                <div className="pos-inv__filters">
                  <div className="pos-chips" role="group" aria-label="المدى">
                    {(
                      [
                        ["30", "آخر 30 يوماً"],
                        ["all", "كل الحركات"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`pos-chip${range === id ? " pos-chip--on" : ""}`}
                        aria-pressed={range === id}
                        onClick={() => setRange(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="pty-actions">
                    <Button onClick={() => router.push(`/parties/${partyId}/pay`)}>
                      دفع لمورد
                    </Button>
                    <Button variant="quiet" onClick={() => router.push(`/parties/${partyId}`)}>
                      بطاقة الطرف
                    </Button>
                  </div>
                </div>

                {state === "loading" ? (
                  <Notice kind="info" title="جارٍ الحساب">
                    <p className="acc-lead">الكشف يُحسب من كل الحركات ولا يُقرأ جاهزاً.</p>
                  </Notice>
                ) : null}
                {state === "offline" ? (
                  <Notice kind="offline" title="كشف محلي">
                    <p className="acc-lead">من آخر نسخة على الجهاز ومعه ما لم يُرفع موسوماً.</p>
                  </Notice>
                ) : null}
                {state === "stale" ? (
                  <Notice kind="warning" title="كشفٌ من آخر مطابقة">
                    <p className="acc-lead">الخادم لم يردّ — الأرقام من آخر نسخة بوقتها.</p>
                  </Notice>
                ) : null}
                {state === "empty" ? (
                  <Notice kind="empty" title="لا حركات مع هذا المورد">
                    <p className="acc-lead">
                      الذمّة تنشأ من مستند شراء معتمد أو رصيد افتتاحي، وتنقص بسند صرف أو مرتجع.
                    </p>
                  </Notice>
                ) : null}
                {server && server.hidden_other_branch > 0 ? (
                  <p className="acc-choice__note">
                    <span className="sting-mono">{server.hidden_other_branch}</span> حركات في فروع
                    أخرى داخلة في الرصيد دون تفاصيلها.
                  </p>
                ) : null}

                <Table
                  caption="كشف حساب المورد"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  loading={state === "loading" && rows.length === 0 ? 3 : undefined}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
