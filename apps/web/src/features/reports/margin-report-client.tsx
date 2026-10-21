"use client";

import { Button, formatMinor, Frame, Notice, PhaseLocked, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./reports.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "permission_denied" | "phase_locked";
type RangeKey = "today" | "7d" | "30d";

interface Row {
  id: string;
  name: string;
  sales_minor: string;
  cost_minor: string;
  margin_minor: string;
  margin_bp: number;
}

interface Payload {
  state: "phase_locked" | "empty" | "ready";
  scope: "all" | "branch";
  branch_compare: boolean;
  range: { key: string; start: string; end: string; label: string };
  policy: string;
  policy_label: string;
  computed_at: string;
  sales_by_branch: { id: string; name: string; sales_minor: string }[];
  rows: Row[];
  groups: Row[];
  missing: {
    uncosted_items: number;
    sold_items: number;
    top_uncosted: { item_id: string; name: string; sales_minor: string }[];
  } | null;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`pos-chip${on ? " pos-chip--on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;

/** طرق التكلفة التي يقبلها الخادم (`COST_POLICIES`)؛ «الوارد أولاً» غير مدعومة بعد فلا تُعرض. */
const POLICIES = [
  {
    code: "last_purchase",
    label: "آخر سعر شراء",
    note: "تُحتسب تكلفة الوحدة المباعة بآخر سعر شراء مسجَّل للصنف — الأبسط، وتتأثر الأرقام بآخر فاتورة مورد.",
  },
  {
    code: "weighted_average",
    label: "المتوسط المرجَّح",
    note: "تُحتسب بمتوسط أسعار الشراء مرجَّحاً بالكميات — الأثبت حين تتغيّر أسعار الموردين.",
  },
] as const;

const LOCK_EXPLANATION =
  "ليس نقص صلاحية ولا عطلاً. حساب الهامش يحتاج قراراً لم يُتخذ بعد: كيف تُحتسب تكلفة الوحدة المباعة — بآخر سعر شراء، أم بالمتوسط المرجّح، أم بالوارد أولاً صادر أولاً. الثلاثة تعطي أرقام ربح مختلفة للبضاعة نفسها.";

/**
 * REP-05 — الهامش ومقارنة الفروع (07-D3 phase_locked · 16-D11 empty · 36-D28 ready/
 * permission_denied): مشروط بسياسة تكلفة معتمدة — قرار G-03، وحالة phase_locked العملية. ACC-90.
 * بلا سياسة: تخطيط معتمد ببيانات معطَّلة وعمود المبيعات دقيق؛ بسياسة وأصناف بلا تكلفة: نمتنع عن
 * الرقم بدل تخمينه؛ الشاشة كلها محجوبة لغير المالك — تبقى في القائمة بقفل ظاهر.
 */
export function MarginReportClient() {
  const router = useRouter();
  const app = useApp();
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  // 0005 §١٨٩: تفعيل الهامش باعتماد طريقة التكلفة من الشاشة نفسها (كان الزرّ بلا فعل ولا شاشة للقرار)
  const [choosing, setChoosing] = useState(false);
  const [policy, setPolicy] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const fetchServer = useCallback(async () => {
    try {
      const { data, error, response } = await api().GET("/api/reports/margin", {
        params: { query: { range } },
      });
      if (response.status === 403) {
        const e = error as unknown as { role_name?: string } | undefined;
        setDenied(e?.role_name ?? "");
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (response.ok && body) setData(body);
    } catch {
      /* بلا اتصال: لا حالة stale مرسومة — تبقى الشاشة كما كانت */
    }
  }, [range]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Freports%2Fmargin");
      return;
    }
  }, [router]);

  useEffect(() => {
    void fetchServer();
  }, [fetchServer]);

  const activate = async () => {
    if (!policy || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const cur = await api().GET("/api/org/settings", {});
      const version = (cur.data as unknown as { version?: number } | undefined)?.version;
      if (!cur.response.ok || version === undefined) {
        setSaveError(cur.response.status === 403 ? "owner" : "load");
        return;
      }
      const { response } = await api().PUT("/api/org/settings", {
        body: { version, cost_policy: policy },
      });
      if (response.status === 403) {
        setSaveError("owner");
        return;
      }
      if (response.status === 409) {
        setSaveError("conflict");
        return;
      }
      if (!response.ok) {
        setSaveError("server");
        return;
      }
      setChoosing(false);
      await fetchServer();
    } catch {
      setSaveError("offline");
    } finally {
      setSaving(false);
    }
  };

  const p = data;
  const state: State | null = denied !== null ? "permission_denied" : p ? p.state : null;
  const salesTotal = p ? p.sales_by_branch.reduce((a, b) => a + BigInt(b.sales_minor), 0n) : 0n;

  return (
    <Frame title="التقارير" nav={<AppNav currentId="reports-margin" />} footer={null}>
      <div className="sys sys--wide rep" data-screen="REP-05" data-state={state ?? undefined}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الهامش ومقارنة الفروع</h2>
            <span className="cat-head__hint">
              مشروط بسياسة تكلفة معتمدة، ويبقى مقفلاً حتى تُعتمد.
            </span>
          </div>
          <div className="acc-card__body">
            {state !== "permission_denied" ? (
              <div className="pos-inv__filters">
                <div className="pos-chips" role="group" aria-label="المدى">
                  <Chip on={range === "today"} onClick={() => setRange("today")}>
                    اليوم
                  </Chip>
                  <Chip on={range === "7d"} onClick={() => setRange("7d")}>
                    آخر 7 أيام
                  </Chip>
                  <Chip on={range === "30d"} onClick={() => setRange("30d")}>
                    آخر 30 يوماً
                  </Chip>
                </div>
              </div>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="locked" title="الشاشة كلها محجوبة">
                <p className="acc-lead">
                  كما في «التكلفة والهامش»: من يرى الهامش يرى التكلفة بالطرح.
                </p>
                {denied ? <p className="acc-lead">دورك: {denied}.</p> : null}
              </Notice>
            ) : null}

            {state === "phase_locked" && p ? (
              <PhaseLocked
                kind="conditional"
                explanation={LOCK_EXPLANATION}
                onActivate={() => setChoosing(true)}
                activateLabel="اختر طريقة التكلفة"
              >
                <Notice kind="info" title="هذا التقرير مصمَّم ولا يعمل الآن">
                  <p className="acc-lead">{LOCK_EXPLANATION}</p>
                </Notice>
                <h3 className="cat-head__title">
                  ما سيعرضه عند التفعيل — تخطيط معتمد ببيانات معطَّلة
                </h3>
                <Table
                  caption="الهامش بالفرع"
                  columns={[
                    { key: "b", header: "الفرع", render: (r) => r.name },
                    {
                      key: "s",
                      header: "المبيعات",
                      mono: true,
                      render: (r) => formatMinor(r.sales_minor),
                    },
                    { key: "c", header: "التكلفة", render: () => "تحتاج سياسة" },
                    { key: "m", header: "الهامش", render: () => "تحتاج سياسة" },
                  ]}
                  rows={p.sales_by_branch}
                  rowKey={(r) => r.id}
                />
                <p className="acc-choice__note">
                  عمود المبيعات دقيق ومتاح الآن في{" "}
                  <Button variant="quiet" onClick={() => router.push("/reports")}>
                    تقرير المبيعات
                  </Button>
                  . الممتنع هو التكلفة والهامش وحدهما — ولن يظهرا برقم تقريبي.
                </p>
                <p className="acc-choice__note">
                  <strong>ما الذي تحتاجه سياسة التكلفة</strong> · اختيار طريقة التكلفة (آخر شراء أم
                  متوسط مرجَّح) — قرار يُسجَّل مرة ويُطبَّق على الكل. تسجيل تكلفة الشراء للأصناف —
                  تُلتقط تلقائياً من فواتير الموردين بعد اليوم.
                </p>
              </PhaseLocked>
            ) : null}

            {state === "phase_locked" && p && choosing ? (
              <Notice kind="info" title="اعتمد طريقة حساب التكلفة">
                <p className="acc-lead">
                  قرار يُسجَّل مرة ويُطبَّق على كل الأصناف والفروع، ويُكتب في رأس التقرير. الاعتماد
                  للمالك وحده.
                </p>
                <div className="pos-chips" role="group" aria-label="طريقة التكلفة">
                  {POLICIES.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      className={`pos-chip${policy === o.code ? " pos-chip--on" : ""}`}
                      aria-pressed={policy === o.code}
                      onClick={() => setPolicy(o.code)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {POLICIES.filter((o) => o.code === policy).map((o) => (
                  <p key={o.code} className="acc-choice__note">
                    {o.note}
                  </p>
                ))}
                {saveError ? (
                  <p className="acc-choice__note" role="alert">
                    {saveError === "owner"
                      ? "الاعتماد للمالك وحده."
                      : saveError === "conflict"
                        ? "تغيّرت الإعدادات من جهة أخرى — أعد المحاولة."
                        : saveError === "offline"
                          ? "الاعتماد يحتاج اتصالاً."
                          : "تعذّر الاعتماد. أعد المحاولة بعد قليل."}
                  </p>
                ) : null}
                <div className="acc-links">
                  <Button
                    onClick={() => void activate()}
                    loading={saving}
                    disabledReason={policy ? undefined : "اختر طريقة التكلفة أولاً"}
                  >
                    اعتمد الطريقة وفعّل الهامش
                  </Button>
                  <Button variant="quiet" onClick={() => setChoosing(false)}>
                    إلغاء
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "empty" && p && p.missing ? (
              <>
                <Notice kind="empty" title="تقرير الهامش — غير متاح بعد">
                  <p className="acc-lead">بلا تكلفة مسجَّلة لا يوجد هامش.</p>
                  <p className="acc-lead">
                    الهامش = البيع ناقص التكلفة. تكلفة{" "}
                    <span className="sting-mono">{p.missing.uncosted_items}</span> صنفاً من{" "}
                    <span className="sting-mono">{p.missing.sold_items}</span> غير مسجَّلة، فأي رقم
                    نعرضه الآن سيكون مبنياً على أصناف بلا تكلفة — ويبدو دقيقاً وهو ليس كذلك.
                  </p>
                  <p className="acc-choice__note">
                    <strong>ما يلزم لتشغيله</strong> · ابدأ بإدخال تكاليف الأصناف الأكثر مبيعاً:{" "}
                    {p.missing.top_uncosted.map((i) => i.name).join("، ")}. تسجيل تكلفة الشراء
                    للأصناف — تُلتقط تلقائياً من فواتير الموردين بعد اليوم. السياسة المعتمدة:{" "}
                    {p.policy_label}.
                  </p>
                  {!p.branch_compare ? (
                    <p className="acc-choice__note">
                      الباقة الحالية لا تشمل مقارنة الفروع؛ الهامش لفرع واحد متاح فور اكتمال
                      التكاليف.
                    </p>
                  ) : null}
                </Notice>
                <div className="cat-form__actions">
                  <Button onClick={() => router.push("/inventory/receive")}>
                    ابدأ بإدخال تكاليف الأصناف الأكثر مبيعاً
                  </Button>
                </div>
              </>
            ) : null}

            {state === "ready" && p ? (
              <>
                <section className="rep-head" aria-label="وقت السياسة">
                  <h3 className="cat-head__title">الهامش بالفرع والمجموعة</h3>
                  <p className="acc-choice__note">
                    <strong>وقت السياسة</strong> · التكلفة {p.policy_label}، ومكتوبٌ في رأس التقرير
                    أيّ سياسة وُلّد بها. {p.range.label} · حُسب في{" "}
                    <span className="sting-mono">{hhmm(p.computed_at)}</span> · المبيعات{" "}
                    <span className="sting-mono">{formatMinor(salesTotal)}</span>
                  </p>
                </section>
                <Table
                  caption="الهامش بالفرع"
                  columns={[
                    { key: "b", header: "الفرع", render: (r) => r.name },
                    {
                      key: "s",
                      header: "المبيعات",
                      mono: true,
                      render: (r) => formatMinor(r.sales_minor),
                    },
                    {
                      key: "c",
                      header: "التكلفة",
                      mono: true,
                      render: (r) => formatMinor(r.cost_minor),
                    },
                    {
                      key: "m",
                      header: "الهامش",
                      render: (r) => (
                        <span>
                          <span className="sting-mono">{formatMinor(r.margin_minor)}</span> ·{" "}
                          <span className="sting-mono">{pct(r.margin_bp)}</span>
                        </span>
                      ),
                    },
                  ]}
                  rows={p.rows}
                  rowKey={(r) => r.id || r.name}
                />
                {!p.branch_compare ? (
                  <p className="acc-choice__note">
                    الباقة الحالية لا تشمل مقارنة الفروع؛ الهامش لفرع واحد متاح فور اكتمال التكاليف.
                  </p>
                ) : null}
                <Table
                  caption="الهامش بالمجموعة"
                  columns={[
                    { key: "g", header: "المجموعة", render: (r) => r.name },
                    {
                      key: "s",
                      header: "المبيعات",
                      mono: true,
                      render: (r) => formatMinor(r.sales_minor),
                    },
                    {
                      key: "c",
                      header: "التكلفة",
                      mono: true,
                      render: (r) => formatMinor(r.cost_minor),
                    },
                    {
                      key: "m",
                      header: "الهامش",
                      render: (r) => (
                        <span>
                          <span className="sting-mono">{formatMinor(r.margin_minor)}</span> ·{" "}
                          <span className="sting-mono">{pct(r.margin_bp)}</span>
                        </span>
                      ),
                    },
                  ]}
                  rows={p.groups}
                  rowKey={(r) => r.name}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
