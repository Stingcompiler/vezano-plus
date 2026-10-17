"use client";

import { Button, Notice, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./platform.css";
import { hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

interface Entry {
  id: string;
  at: string;
  operator_id: string;
  operator_name: string;
  tenant_id: string;
  tenant_name: string;
  action: string;
  action_label: string;
  detail: string;
  ticket_ref: string;
}
interface Payload {
  entries: Entry[];
  next_before: string;
  operators: { id: string; name: string }[];
  categories: { code: string; label: string }[];
  filters: { operator: string; category: string; tenant: string };
}
type State = "loading" | "ready" | "empty" | "server_error";

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d ?? ""}/${m ?? ""}/${y ?? ""}`;
};

/** فحص 2026-10-17 VP13 — سجل تدقيق المشغّلين: كل فعل مشغّل عبر الوحدات، بالمشغّل والفئة والمستأجر. */
export function AuditClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<Entry[]>([]);
  const [failed, setFailed] = useState(false);
  const [operator, setOperator] = useState("");
  const [category, setCategory] = useState("");
  const [tenant, setTenant] = useState<{ id: string; name: string } | null>(null);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback(
    async (before: string) => {
      const { data: b, response } = await platformApi().GET("/api/platform/audit", {
        params: {
          query: { operator, category, tenant: tenant?.id ?? "", before } as never,
        },
      });
      const p = b as unknown as Payload | undefined;
      if (!response.ok || !p) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setData(p);
      setRows((prev) => (before ? [...prev, ...p.entries] : p.entries));
    },
    [operator, category, tenant],
  );

  useEffect(() => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    void fetchPage("").catch(() => setFailed(true));
  }, [fetchPage, router]);

  const state: State = failed
    ? "server_error"
    : !data
      ? "loading"
      : rows.length
        ? "ready"
        : "empty";
  const filtered = Boolean(operator || category || tenant);

  const columns = [
    {
      key: "at",
      header: "الوقت",
      render: (e: Entry) => (
        <span className="sting-mono">
          {day(e.at)} {hhmm(e.at)}
        </span>
      ),
    },
    { key: "operator", header: "المشغّل", render: (e: Entry) => e.operator_name },
    {
      key: "action",
      header: "الفعل",
      render: (e: Entry) => (
        <>
          <strong>{e.action_label}</strong>
          {e.detail ? <div className="mp-check__hint">{e.detail}</div> : null}
          {e.ticket_ref ? (
            <div className="mp-check__hint">
              تذكرة <span className="sting-mono">{e.ticket_ref}</span>
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: "tenant",
      header: "المستأجر",
      render: (e: Entry) =>
        e.tenant_id ? (
          <button
            type="button"
            className="plt-audit__tenant"
            onClick={() => setTenant({ id: e.tenant_id, name: e.tenant_name })}
          >
            {e.tenant_name}
          </button>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <PlatformFrame current="audit">
      <div className="sys mp cus plt-frame" data-screen="PLT-AUDIT" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">سجل التدقيق</h2>
            <span className="cat-head__hint">
              كل فعل مشغّل: الدخول، فتح سجلات المستأجرين، قرارات الدفع والتحقّق، تغييرات الباقات
              والتشغيل. السجل للقراءة فقط.
            </span>
          </div>
          <div className="acc-card__body">
            {data ? (
              <div className="plt-audit__filters">
                <label className="c-field">
                  <span className="c-field__label">المشغّل</span>
                  <select
                    className="c-field__input"
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                  >
                    <option value="">الكل</option>
                    {data.operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="c-field">
                  <span className="c-field__label">الفئة</span>
                  <select
                    className="c-field__input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">الكل</option>
                    {data.categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                {tenant ? (
                  <div className="plt-audit__chip">
                    المستأجر: <strong>{tenant.name}</strong>
                    <Button variant="quiet" onClick={() => setTenant(null)}>
                      إزالة
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {state === "loading" ? <Notice kind="info" title="جلب سجل التدقيق" /> : null}
            {state === "server_error" ? (
              <Notice
                kind="error"
                title="تعذّر جلب سجل التدقيق"
                action={<Button onClick={() => void fetchPage("")}>أعد المحاولة</Button>}
              />
            ) : null}

            {data && !failed ? (
              <Table
                caption="سجل التدقيق"
                columns={columns}
                rows={rows}
                rowKey={(e) => e.id}
                empty={
                  filtered ? (
                    <Notice
                      kind="empty"
                      title="لا أفعال تطابق التصفية"
                      action={
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setOperator("");
                            setCategory("");
                            setTenant(null);
                          }}
                        >
                          أزل التصفية
                        </Button>
                      }
                    />
                  ) : (
                    <Notice kind="empty" title="لا أفعال مسجّلة بعد">
                      <p className="acc-lead">تظهر هنا أفعال المشغّلين فور حدوثها.</p>
                    </Notice>
                  )
                }
              />
            ) : null}
            {data?.next_before && !failed ? (
              <div className="acc-actions">
                <Button
                  variant="quiet"
                  loading={more}
                  onClick={() => {
                    setMore(true);
                    void fetchPage(data.next_before).finally(() => setMore(false));
                  }}
                >
                  أقدم
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
