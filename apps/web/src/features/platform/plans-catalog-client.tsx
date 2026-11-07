"use client";

import {
  Button,
  formatMinor,
  Notice,
  parseMoneyInput,
  SelectField,
  Status,
  SwitchField,
  TextAreaField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/public/public.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PageTitle } from "@/features/platform/page-title";
import { PlatformFrame } from "@/features/platform/platform-nav";
import { BRANCHES, Count, DEVICES } from "@/lib/count";

type State = "loading" | "ready" | "permission_denied";

interface Plan {
  code: string;
  name: string;
  blurb: string;
  order: number;
  is_active: boolean;
  trial: boolean;
  trial_days: number;
  /** 0005 §١٧٠ — التجريبية على باقة تحدّدها إدارة المنصّة */
  trial_base_code: string;
  trial_base_name: string;
  max_branches: number;
  max_devices: number;
  max_users: number | null;
  campaign_quota: number;
  features: string[];
  price_monthly_minor: string;
  price_quarterly_minor: string;
  price_yearly_minor: string;
  addon_device_minor?: string;
  addon_user_minor?: string;
  addon_branch_minor?: string;
  next_price: {
    monthly_minor: string | null;
    quarterly_minor: string | null;
    yearly_minor: string | null;
    effective_at: string;
  } | null;
  subscribers: number;
  updated_at: string;
}
interface Change {
  id: string;
  plan_code: string;
  changes: Record<string, unknown>;
  reason: string;
  by_name: string;
  at: string;
}
interface Payload {
  plans: Plan[];
  features: string[];
  cycles: { cycle: string; label: string; days: number }[];
  changes: Change[];
  min_price_notice_days: number;
  rule: string;
}

const FEATURE_LABELS: Record<string, string> = {
  pos_core: "نقاط البيع والطباعة والجرد",
  multi_branch: "تعدّد الفروع",
  advanced_reports: "التقارير الكاملة",
  branch_compare: "مقارنة الفروع",
  market_publish: "نشر العروض واستقبال الطلبات في السوق",
  market_private_prices: "قوائم أسعار خاصة في السوق",
  campaigns: "الحملات ورسائل الزبائن",
  bulk_pricing: "التسعير الجماعي",
  cost_margin: "التكلفة والهامش",
  supplier_analytics: "تحليلات المورد المتقدّمة",
};
const ERRORS: Record<string, string> = {
  name_required: "اسم الباقة مطلوب.",
  code_invalid: "الرمز حروف لاتينية صغيرة وأرقام و_ (حتى 20).",
  code_exists: "يوجد باقة بهذا الرمز.",
  nothing_to_change: "لا تغيير.",
  pos_core_required: "نقاط البيع لا تُنزع من أي باقة — لا تتوقف بحال.",
  trial_required: "التجريبية لا تُؤرشف؛ عدّل مدتها أو باقتها الأساس.",
  trial_base_invalid: "الباقة الأساس يجب أن تكون باقة مدفوعة معروضة.",
  trial_base_in_use: "التجريبية مبنية على هذه الباقة — غيّر أساس التجريبية قبل أرشفتها.",
  trial_derived: "ميزات التجريبية وحدودها من باقتها الأساس — غيّر الأساس لا القيم.",
  trial_single: "تجريبية واحدة على المنصّة.",
  trial_only: "المدة والباقة الأساس للتجريبية وحدها.",
  features_invalid: "خاصية غير معروفة.",
  notice_too_short: "السعر الجديد يحتاج إشعاراً 30 يوماً على الأقل — اختر تاريخاً أبعد.",
  effective_at_invalid: "تاريخ السريان غير صالح.",
  price_required: "أدخل سعراً واحداً على الأقل.",
};

const money = (minor: string) => formatMinor(minor);
const toMinor = (text: string) => parseMoneyInput(text) ?? "0";
const When = ({ iso }: { iso: string }) => {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

type Draft = {
  code: string;
  name: string;
  blurb: string;
  order: string;
  is_active: boolean;
  trial: boolean;
  trial_days: string;
  trial_base_code: string;
  max_branches: string;
  max_devices: string;
  max_users: string;
  campaign_quota: string;
  features: string[];
  monthly: string;
  quarterly: string;
  yearly: string;
  addon_device: string;
  addon_user: string;
  addon_branch: string;
  reason: string;
};
const EMPTY: Draft = {
  code: "",
  name: "",
  blurb: "",
  order: "0",
  is_active: true,
  trial: false,
  trial_days: "30",
  trial_base_code: "",
  max_branches: "1",
  max_devices: "3",
  max_users: "",
  campaign_quota: "0",
  features: ["pos_core"],
  monthly: "0.00",
  quarterly: "0.00",
  yearly: "0.00",
  addon_device: "0.00",
  addon_user: "0.00",
  addon_branch: "0.00",
  reason: "",
};
const fromPlan = (p: Plan): Draft => ({
  code: p.code,
  name: p.name,
  blurb: p.blurb,
  order: String(p.order),
  is_active: p.is_active,
  trial: p.trial,
  trial_days: String(p.trial_days),
  trial_base_code: p.trial_base_code,
  max_branches: String(p.max_branches),
  max_devices: String(p.max_devices),
  max_users: p.max_users === null ? "" : String(p.max_users),
  campaign_quota: String(p.campaign_quota),
  features: p.features,
  monthly: money(p.price_monthly_minor),
  quarterly: money(p.price_quarterly_minor),
  yearly: money(p.price_yearly_minor),
  addon_device: money(p.addon_device_minor ?? "0"),
  addon_user: money(p.addon_user_minor ?? "0"),
  addon_branch: money(p.addon_branch_minor ?? "0"),
  reason: "",
});

/** PLT-16 — كتالوج الباقات والتسعير: ما تراه الصفحة العامة وORG-06 يُحرَّر هنا بسبب وسجل. */
export function PlansCatalogClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [priceFor, setPriceFor] = useState("");
  const [nextMonthly, setNextMonthly] = useState("");
  const [nextYearly, setNextYearly] = useState("");
  // فحص 2026-10-17 VP06: الدورات الثلاث كلها — كان الربعي غائباً عن السعر المقبل
  const [nextQuarterly, setNextQuarterly] = useState("");
  const [effective, setEffective] = useState("");
  // أقرب تاريخ يقبله الخادم: الآن + مهلة الإشعار، ويوم زائد لأن التاريخ يُرسل منتصف ليلته (UTC)
  const minEffective = data
    ? new Date(Date.now() + (data.min_price_notice_days + 1) * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : "";
  // §٢١٢: التاريخ بصيغة الحقل نفسه (يوم/شهر/سنة) معزولاً اتجاهياً — ISO داخل نص عربي يُقرأ معكوساً
  const minEffectiveShown = minEffective
    ? `\u2066${minEffective.split("-").reverse().join("/")}\u2069`
    : "";
  const [priceReason, setPriceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data: d, response } = await platformApi().GET("/api/platform/plans");
    if (response.status === 403 || response.status === 401) {
      setDenied(true);
      return;
    }
    const b = d as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  // §٢١٢: فتح نموذج يأتي به إلى المرئي — لا يبقى تحت باقات أخرى بعيداً عن نقرة «عدّل»
  useEffect(() => {
    if (!editing && !priceFor) return;
    const f = document.querySelector<HTMLElement>(".plt-plan-form");
    (f?.closest<HTMLElement>(".plt-plan") ?? f)?.scrollIntoView({ block: "start" });
  }, [editing, priceFor]);

  const fail = (code: string, status: number) =>
    setError(ERRORS[code] ?? `تعذّر التنفيذ (${code || status})`);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // 0005 §١٧٠ — التجريبية تُرسل الاسم والترتيب والمدة والأساس فقط؛ الباقة المدفوعة بلا حقول التجريبية
  const body = () =>
    draft.trial
      ? {
          name: draft.name,
          order: Number(draft.order || 0),
          trial_days: Number(draft.trial_days || 30),
          trial_base_code: draft.trial_base_code,
          reason: draft.reason,
        }
      : paidBody();
  const paidBody = () => ({
    name: draft.name,
    blurb: draft.blurb,
    order: Number(draft.order || 0),
    is_active: draft.is_active,
    max_branches: Number(draft.max_branches || 1),
    max_devices: Number(draft.max_devices || 1),
    max_users: draft.max_users.trim() === "" ? null : Number(draft.max_users),
    campaign_quota: Number(draft.campaign_quota || 0),
    features: draft.features,
    price_monthly_minor: Number(toMinor(draft.monthly)),
    price_quarterly_minor: Number(toMinor(draft.quarterly)),
    price_yearly_minor: Number(toMinor(draft.yearly)),
    addon_device_minor: Number(toMinor(draft.addon_device)),
    addon_user_minor: Number(toMinor(draft.addon_user)),
    addon_branch_minor: Number(toMinor(draft.addon_branch)),
    reason: draft.reason,
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setDone("");
    setBusy(true);
    try {
      const r =
        editing === "new"
          ? await platformApi().POST("/api/platform/plans", {
              body: { code: draft.code.trim().toLowerCase(), ...body() } as never,
            })
          : await platformApi().POST("/api/platform/plans/{code}/{action}", {
              params: { path: { code: editing, action: "update" } },
              body: body() as never,
            });
      const b = (r.data ?? r.error) as unknown as Payload | { detail?: string } | undefined;
      if (r.response.ok && b && "plans" in b) {
        setData(b);
        setDone(editing === "new" ? `أُنشئت الباقة «${draft.name}»` : `حُفظت «${draft.name}»`);
        setEditing("");
      } else fail((b as { detail?: string } | undefined)?.detail ?? "", r.response.status);
    } finally {
      setBusy(false);
    }
  };

  const schedule = async (code: string, clear = false) => {
    setError("");
    setDone("");
    setBusy(true);
    try {
      const r = await platformApi().POST("/api/platform/plans/{code}/{action}", {
        params: { path: { code, action: "price" } },
        body: (clear
          ? { clear: true, reason: priceReason }
          : {
              monthly_minor: nextMonthly.trim() ? Number(toMinor(nextMonthly)) : null,
              quarterly_minor: nextQuarterly.trim() ? Number(toMinor(nextQuarterly)) : null,
              yearly_minor: nextYearly.trim() ? Number(toMinor(nextYearly)) : null,
              effective_at: effective ? new Date(effective).toISOString() : "",
              reason: priceReason,
            }) as never,
      });
      const b = (r.data ?? r.error) as unknown as Payload | { detail?: string } | undefined;
      if (r.response.ok && b && "plans" in b) {
        setData(b);
        setDone(clear ? "أُلغي السعر المقبل" : "جُدول السعر الجديد بتاريخ سريانه");
        setPriceFor("");
        setNextMonthly("");
        setNextQuarterly("");
        setNextYearly("");
        setEffective("");
        setPriceReason("");
      } else fail((b as { detail?: string } | undefined)?.detail ?? "", r.response.status);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied ? "permission_denied" : data ? "ready" : "loading";

  const baseOptions = (data?.plans ?? []).filter((p) => !p.trial && p.is_active);
  const trialForm = (
    <form className="plt-ops plt-plan-form" onSubmit={(e) => void save(e)} noValidate>
      <div className="plt-ops__fields plt-ops__fields--3">
        <SelectField
          label="الباقة الأساس"
          hint="ميزاتها وحدودها هي ما يجرّبه التاجر"
          value={draft.trial_base_code}
          onChange={(e) => set("trial_base_code", e.target.value)}
          options={baseOptions.map((p) => ({ value: p.code, label: p.name }))}
        />
        <TextField
          label="أيام التجريبية"
          mono
          inputMode="numeric"
          hint="للمنشآت الجديدة — التجارب القائمة تبقى على تاريخ انتهائها"
          value={draft.trial_days}
          onChange={(e) => set("trial_days", e.target.value)}
        />
        <TextField label="الاسم" value={draft.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <TextAreaField
        label="سبب التغيير"
        hint="يُسجَّل باسمك في سجل الكتالوج"
        rows={2}
        value={draft.reason}
        onChange={(e) => set("reason", e.target.value)}
      />
      <div className="acc-actions plt-ops-row plt-plan-form__actions">
        <Button type="submit" loading={busy}>
          احفظ
        </Button>
        <Button variant="quiet" onClick={() => setEditing("")}>
          إلغاء
        </Button>
        {error ? <Status state="validation_error" label={error} /> : null}
      </div>
    </form>
  );

  const form = (
    <form className="plt-ops plt-plan-form" onSubmit={(e) => void save(e)} noValidate>
      {editing === "new" ? <h3 className="plt-plan-form__title">باقة جديدة</h3> : null}
      <fieldset className="plt-group">
        <legend>معلومات الباقة</legend>
        <div className={`plt-ops__fields plt-ops__fields--${editing === "new" ? "3" : "2"}`}>
          {editing === "new" ? (
            <TextField
              label="الرمز"
              mono
              hint="لاتيني صغير — لا يتغيّر بعد الإنشاء"
              value={draft.code}
              onChange={(e) => set("code", e.target.value)}
            />
          ) : null}
          <TextField
            label="الاسم"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <TextField
            label="الترتيب"
            mono
            inputMode="numeric"
            value={draft.order}
            onChange={(e) => set("order", e.target.value)}
          />
        </div>
        <TextAreaField
          label="الوصف"
          rows={2}
          value={draft.blurb}
          onChange={(e) => set("blurb", e.target.value)}
        />
      </fieldset>
      <fieldset className="plt-group">
        <legend>
          أسعار الدورات <span className="plt-group__unit">ج.س</span>
        </legend>
        <div className="plt-ops__fields plt-ops__fields--3">
          <TextField
            label="السعر الشهري"
            mono
            inputMode="decimal"
            value={draft.monthly}
            onChange={(e) => set("monthly", e.target.value)}
          />
          <TextField
            label="السعر الربعي"
            mono
            inputMode="decimal"
            hint="0 = الدورة غير معروضة"
            value={draft.quarterly}
            onChange={(e) => set("quarterly", e.target.value)}
          />
          <TextField
            label="السعر السنوي"
            mono
            inputMode="decimal"
            hint="0 = الدورة غير معروضة"
            value={draft.yearly}
            onChange={(e) => set("yearly", e.target.value)}
          />
        </div>
      </fieldset>
      {/* 0005 §١١٦ — أسعار الإضافات الشهرية للوحدة؛ §٢١٢: ثلاثة أعمدة متساوية */}
      <fieldset className="plt-group">
        <legend>
          أسعار الإضافات شهرياً <span className="plt-group__unit">ج.س للوحدة</span>
        </legend>
        <div className="plt-ops__fields plt-ops__fields--3">
          <TextField
            label="جهاز إضافي / شهر"
            mono
            inputMode="decimal"
            hint="0 = غير معروضة"
            value={draft.addon_device}
            onChange={(e) => set("addon_device", e.target.value)}
          />
          <TextField
            label="مستخدم إضافي / شهر"
            mono
            inputMode="decimal"
            hint="0 = غير معروضة"
            value={draft.addon_user}
            onChange={(e) => set("addon_user", e.target.value)}
          />
          <TextField
            label="فرع إضافي / شهر"
            mono
            inputMode="decimal"
            hint="0 = غير معروضة"
            value={draft.addon_branch}
            onChange={(e) => set("addon_branch", e.target.value)}
          />
        </div>
      </fieldset>
      <fieldset className="plt-group">
        <legend>الحدود</legend>
        <div className="plt-ops__fields plt-ops__fields--4">
          <TextField
            label="الفروع"
            mono
            inputMode="numeric"
            value={draft.max_branches}
            onChange={(e) => set("max_branches", e.target.value)}
          />
          <TextField
            label="الأجهزة"
            mono
            inputMode="numeric"
            value={draft.max_devices}
            onChange={(e) => set("max_devices", e.target.value)}
          />
          <TextField
            label="المستخدمون"
            mono
            inputMode="numeric"
            hint="فارغ = بلا حدّ"
            value={draft.max_users}
            onChange={(e) => set("max_users", e.target.value)}
          />
          <TextField
            label="رسائل الحملات شهرياً"
            mono
            inputMode="numeric"
            value={draft.campaign_quota}
            onChange={(e) => set("campaign_quota", e.target.value)}
          />
        </div>
      </fieldset>
      <fieldset className="plt-features">
        <legend>الخصائص</legend>
        {(data?.features ?? []).map((f) => (
          <label key={f} className="plt-features__item">
            <input
              type="checkbox"
              checked={draft.features.includes(f)}
              disabled={f === "pos_core"}
              onChange={(e) =>
                set(
                  "features",
                  e.target.checked ? [...draft.features, f] : draft.features.filter((x) => x !== f),
                )
              }
            />
            <span>{FEATURE_LABELS[f] ?? f}</span>
          </label>
        ))}
      </fieldset>
      <div className="plt-ops__fields plt-ops__fields--3">
        <SwitchField
          label="معروضة"
          hint="غير المعروضة تختفي من الصفحة العامة والدفع ولا تكسر اشتراكاً قائماً"
          checked={draft.is_active}
          onChange={(v) => set("is_active", v)}
        />
      </div>
      <TextAreaField
        label="سبب التغيير"
        hint="يُسجَّل باسمك في سجل الكتالوج"
        rows={2}
        value={draft.reason}
        onChange={(e) => set("reason", e.target.value)}
      />
      <div className="acc-actions plt-ops-row plt-plan-form__actions">
        <Button type="submit" loading={busy}>
          {editing === "new" ? "أنشئ الباقة" : "احفظ"}
        </Button>
        <Button variant="quiet" onClick={() => setEditing("")}>
          إلغاء
        </Button>
        {error ? <Status state="validation_error" label={error} /> : null}
      </div>
    </form>
  );

  return (
    <PlatformFrame current="plans">
      <div className="sys plt-frame" data-screen="PLT-16" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <div className="plt-head-row">
              <h2 className="cat-head__title">
                <PageTitle text="الباقات والتسعير — ما تراه الصفحة العامة يُحرَّر هنا" />
              </h2>
              {/* §٢١٢: الإنشاء قرب عنوان القائمة لا بعد آخر باقة */}
              {data && editing !== "new" ? (
                <Button
                  onClick={() => {
                    setEditing("new");
                    setPriceFor("");
                    setDraft(EMPTY);
                    setError("");
                  }}
                >
                  باقة جديدة
                </Button>
              ) : null}
            </div>
            <span className="cat-head__hint">
              الاسم والسعر لكل دورة والحدود والخصائص لكل باقة، بسبب مسجَّل. تغيير السعر يمسّ
              التجديدات القادمة فقط، والسعر المعلن يُجدول بتاريخ سريان.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الكتالوج">
                <p className="acc-lead">الباقات كما تُعرض للمشتري والمستأجر، مع عدد المشتركين.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="مساحة المشغّل فقط">
                <p className="acc-lead">الكتالوج يُحرَّر بصفة مشغّل.</p>
              </Notice>
            ) : null}
            {done ? <Status state="success" label={done} /> : null}
            {data ? (
              <>
                {editing === "new" ? form : null}
                <ul className="plt-plans">
                  {data.plans.map((p) => (
                    <li key={p.code} className="plt-plan c-card" data-active={p.is_active}>
                      <div className="plt-plan__top">
                        {/* §٢١٢: حالة النشر مع اسم الباقة لا في الطرف الآخر */}
                        <strong className="plt-plan__name">{p.name}</strong>
                        <span className="plt-badge">{p.code}</span>
                        <Status
                          state={p.is_active ? "success" : "expired"}
                          label={p.is_active ? "معروضة" : "مؤرشفة"}
                        />
                      </div>
                      {p.trial ? (
                        <div className="plt-plan__prices">
                          <span>
                            مجاناً · <span className="sting-mono">{p.trial_days}</span> يوماً ·
                            بميزات «{p.trial_base_name || "—"}»
                          </span>
                        </div>
                      ) : (
                        // §٢١٢: ثلاثة مواضع ثابتة بالعملة — الدورة غير المعروضة تُعلن لا تختفي
                        <dl className="plt-plan__cycles">
                          {(
                            [
                              ["شهري", p.price_monthly_minor],
                              ["ربعي", p.price_quarterly_minor],
                              ["سنوي", p.price_yearly_minor],
                            ] as const
                          ).map(([label, v]) => (
                            <div key={label} className="plt-plan__cycle">
                              <dt>{label}</dt>
                              <dd>
                                {v === "0" && label !== "شهري" ? (
                                  <span className="plt-plan__off">غير معروضة</span>
                                ) : (
                                  <>
                                    <span className="sting-mono">{money(v)}</span>{" "}
                                    <small>ج.س</small>
                                  </>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <ul className="plt-plan__limits">
                        <li>
                          <Count n={p.max_branches} {...BRANCHES} />
                        </li>
                        <li>
                          <Count n={p.max_devices} {...DEVICES} />
                        </li>
                        <li>
                          {p.max_users === null ? (
                            "مستخدمون بلا حدّ"
                          ) : (
                            <>
                              <span className="sting-mono">{p.max_users}</span> مستخدمين
                            </>
                          )}
                        </li>
                        <li>
                          <span className="sting-mono">{p.features.length}</span> خصائص
                        </li>
                        <li>
                          <span className="sting-mono">{p.subscribers}</span> مشترك
                        </li>
                      </ul>
                      {p.next_price ? (
                        <p className="plt-plan__next">
                          <strong>سعر مقبل</strong> · من <When iso={p.next_price.effective_at} />
                          {p.next_price.monthly_minor ? (
                            <>
                              {" "}
                              · شهري{" "}
                              <span className="sting-mono">
                                {money(p.next_price.monthly_minor)}
                              </span>
                            </>
                          ) : null}
                          {p.next_price.quarterly_minor ? (
                            <>
                              {" "}
                              · ربعي{" "}
                              <span className="sting-mono">
                                {money(p.next_price.quarterly_minor)}
                              </span>
                            </>
                          ) : null}
                          {p.next_price.yearly_minor ? (
                            <>
                              {" "}
                              · سنوي{" "}
                              <span className="sting-mono">{money(p.next_price.yearly_minor)}</span>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {editing === p.code ? (
                        p.trial ? (
                          trialForm
                        ) : (
                          form
                        )
                      ) : priceFor === p.code ? (
                        <div className="plt-ops plt-plan-form">
                          {/* §٢١٢: الإرشاد فوق مجموعة الأسعار، والسعر الحالي بجانب كل حقل للمقارنة */}
                          <fieldset className="plt-group">
                            <legend>
                              الأسعار الجديدة <span className="plt-group__unit">ج.س</span>
                            </legend>
                            <p className="plt-group__note">
                              اكتب سعراً جديداً لدورة واحدة على الأقل؛ الفارغ يبقى على سعره.
                            </p>
                            <div className="plt-ops__fields plt-ops__fields--3">
                              <TextField
                                label="الشهري الجديد"
                                mono
                                inputMode="decimal"
                                hint={`الحالي ${money(p.price_monthly_minor)}`}
                                value={nextMonthly}
                                onChange={(e) => setNextMonthly(e.target.value)}
                              />
                              <TextField
                                label="الربعي الجديد"
                                mono
                                inputMode="decimal"
                                hint={`الحالي ${money(p.price_quarterly_minor)}`}
                                value={nextQuarterly}
                                onChange={(e) => setNextQuarterly(e.target.value)}
                              />
                              <TextField
                                label="السنوي الجديد"
                                mono
                                inputMode="decimal"
                                hint={`الحالي ${money(p.price_yearly_minor)}`}
                                value={nextYearly}
                                onChange={(e) => setNextYearly(e.target.value)}
                              />
                            </div>
                          </fieldset>
                          <div className="plt-ops__fields plt-ops__fields--even">
                            <TextField
                              label="تاريخ السريان"
                              type="date"
                              mono
                              hint={`بعد ${data.min_price_notice_days} يوماً على الأقل — إشعار الشروط · أقربه ${minEffectiveShown}`}
                              min={minEffective}
                              error={
                                effective && effective < minEffective
                                  ? `أقرب تاريخ مسموح ${minEffectiveShown} — إشعار ${data.min_price_notice_days} يوماً`
                                  : undefined
                              }
                              value={effective}
                              onChange={(e) => setEffective(e.target.value)}
                            />
                            <TextAreaField
                              label="السبب"
                              rows={2}
                              value={priceReason}
                              onChange={(e) => setPriceReason(e.target.value)}
                            />
                          </div>
                          <div className="acc-actions plt-ops-row">
                            <Button
                              loading={busy}
                              onClick={() => void schedule(p.code)}
                              disabledReason={
                                !nextMonthly.trim() && !nextQuarterly.trim() && !nextYearly.trim()
                                  ? "اكتب سعراً جديداً لدورة واحدة على الأقل"
                                  : !effective
                                    ? "اختر تاريخ السريان"
                                    : effective < minEffective
                                      ? "تاريخ السريان أقرب من مهلة الإشعار"
                                      : undefined
                              }
                            >
                              جدوِل السعر
                            </Button>
                            {p.next_price ? (
                              <Button
                                variant="secondary"
                                loading={busy}
                                onClick={() => void schedule(p.code, true)}
                              >
                                ألغِ السعر المقبل
                              </Button>
                            ) : null}
                            <Button variant="quiet" onClick={() => setPriceFor("")}>
                              إلغاء
                            </Button>
                            {error ? <Status state="validation_error" label={error} /> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="acc-actions plt-ops-row">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setEditing(p.code);
                              setPriceFor("");
                              setDraft(fromPlan(p));
                              setError("");
                            }}
                          >
                            عدّل
                          </Button>
                          {!p.trial ? (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setPriceFor(p.code);
                                setEditing("");
                                setError("");
                              }}
                            >
                              سعر مقبل بتاريخ
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                <h3 className="cat-head__title">سجل التغييرات</h3>
                {data.changes.length ? (
                  <ol className="pb-timeline plt-timeline">
                    {data.changes.map((ch) => (
                      <li key={ch.id} className="pb-timeline__item">
                        <span className="pb-timeline__dot" aria-hidden="true" />
                        <span className="pb-timeline__at">
                          <When iso={ch.at} />
                        </span>
                        <span className="pb-timeline__text">
                          <strong>{ch.plan_code}</strong> ·{" "}
                          <span className="sting-mono plt-change">
                            {JSON.stringify(ch.changes)}
                          </span>
                          {ch.reason ? <div className="cus-sub">{ch.reason}</div> : null}
                          <div className="cus-sub">بواسطة {ch.by_name}</div>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="acc-choice__note">لا تغييرات على الباقات بعد.</p>
                )}
                <p className="acc-choice__note">{data.rule}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
