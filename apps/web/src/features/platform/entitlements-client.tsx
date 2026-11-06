"use client";

import { Button, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface Row {
  feature: string;
  label: string;
  note: string;
  kind: "limit" | "toggle" | "conditional" | "quota";
  kind_label: string;
}
interface Cell {
  feature: string;
  enabled: boolean;
  overridden: boolean;
  changed_by_name: string;
  changed_at: string;
  limit: number | null;
  quota: number | null;
}
interface Plan {
  code: string;
  name: string;
  cells: Cell[];
}
interface Flag {
  key: string;
  scope_kind: "plan" | "env";
  scope: string;
  enabled: boolean;
  note: string;
  changed_by_name: string;
  changed_at: string;
}
interface Payload {
  rows: Row[];
  plans: Plan[];
  /** 0005 §١٧٠ — التجريبية بلا عمود: ترث استحقاقات باقتها الأساس */
  trial_base_name?: string;
  flags: Flag[];
}
interface Saved {
  plan_code: string;
  plan_name: string;
  feature: string;
  feature_label: string;
  enabled: boolean;
  changed_by_name: string;
  changed_at: string;
}

/** الإطار يسمّي الميزة في جملة النجاح باسمها القصير («قوائم أسعار خاصة») لا باسم الصفّ. */
const SHORT: Record<string, string> = {
  market_private_prices: "قوائم أسعار خاصة",
  market_publish: "أدوات البائع",
  campaigns: "حملات التسويق",
};
const KIND_STATE = {
  limit: "synced",
  toggle: "success",
  conditional: "stale",
  quota: "saved_local",
} as const;
const planWord = (name: string) =>
  name.startsWith("فرع")
    ? `لباقة ${name === "فرعان" ? "الفرعين" : name === "فرع واحد" ? "الفرع الواحد" : name}`
    : `لباقة ${name}`;

/** PLT-12 — إدارة الاستحقاقات وإعدادات التشغيل (26-D19): على مستوى الباقة — لا تجاوز عام يكسر عزل المستأجرين. */
export function EntitlementsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [flagScopeKind, setFlagScopeKind] = useState<"" | "plan" | "env">("");
  const [flagScope, setFlagScope] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/entitlements");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const toggle = async (plan: Plan, cell: Cell, extra: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(`${plan.code}:${cell.feature}`);
    setErr("");
    try {
      const r = await platformApi().POST("/api/platform/entitlements", {
        body: {
          plan_code: plan.code,
          feature: cell.feature,
          enabled: !cell.enabled,
          ...extra,
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        (Payload & { saved: Saved }) | { detail?: string } | undefined;
      if (r.response.ok && b && "saved" in b) {
        setSaved(b.saved);
        setData(b);
        return;
      }
      setErr((b as { detail?: string } | undefined)?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const saveFlag = async () => {
    if (busy) return;
    setBusy("flag");
    setErr("");
    try {
      const r = await platformApi().POST("/api/platform/flags", {
        body: { key: flagKey, scope_kind: flagScopeKind, scope: flagScope, enabled: true } as never,
      });
      const b = (r.data ?? r.error) as unknown as Payload | { detail?: string } | undefined;
      if (r.response.ok && b && "flags" in b) {
        setData(b);
        setFlagKey("");
        setFlagScopeKind("");
        setFlagScope("");
        return;
      }
      setErr((b as { detail?: string } | undefined)?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const state: State =
    err === "no_global_override"
      ? "permission_denied"
      : err === "scope_required"
        ? "validation_error"
        : saved
          ? "success"
          : "ready";

  return (
    <PlatformFrame current="entitlements">
      <div className="sys mp cus plt-frame" data-screen="PLT-12" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              إدارة الاستحقاقات وإعدادات التشغيل — لا تجاوز عام يكسر عزل المستأجرين
            </h2>
            <span className="cat-head__hint">
              يُدير المشغّل استحقاقات الباقات وأعلام التشغيل، لكن لا يوجد مفتاح «طبّق على الجميع»
              يخترق حدود مستأجر واحد أو يفتح بيانات عبرهم.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="لا «تجاوز عام» على المستأجرين"
                action={<Button onClick={() => setErr("")}>فهمت</Button>}
              >
                <p className="acc-lead">
                  أي إجراء يطال أكثر من مستأجر واحد بضغطة — تفعيل ميزة للجميع، أو قراءة عبر الدفاتر
                  — محجوب بنيوياً. التغيير يُطبَّق على تعريف الباقة، ثم يرثه كل مستأجر ضمن حدوده. لا
                  باب خلفي يفتح مستأجراً من داخل آخر.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="علم تشغيل بلا نطاق واضح">
                <p className="acc-lead">
                  نمنع الحفظ ونطالب بالنطاق صراحةً، لأن علماً بلا نطاق قد يتسرّب إلى الجميع.
                </p>
              </Notice>
            ) : null}
            {err && !["no_global_override", "scope_required"].includes(err) ? (
              <Notice kind="warning" title="لم يُحفظ">
                <p className="acc-lead">
                  {err === "feature_invalid" ? "حدّ الفروع صلب لكل باقة — ليس علماً يُبدَّل." : err}
                </p>
              </Notice>
            ) : null}
            {state === "success" && saved ? (
              <Notice
                kind="success"
                title="حُفظ التغيير على مستوى الباقة"
                action={<Button onClick={() => setSaved(null)}>التالي</Button>}
              >
                <p className="acc-lead">
                  {saved.enabled ? "فُعّلت" : "أُوقفت"} «
                  {SHORT[saved.feature] ?? saved.feature_label}» {planWord(saved.plan_name)}. الأثر
                  يُسجَّل باسم المشغّل ووقته، والمستأجرون على الباقة يرثونها في تحديثهم القادم —
                  كلٌّ داخل حدوده.
                </p>
                <p className="acc-choice__note">
                  {saved.changed_by_name} ·{" "}
                  <span className="sting-mono">{hhmm(saved.changed_at)}</span>
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="acc-actions">
                  <Status state="synced" label="عزل المستأجرين" />
                </div>
                <h3 className="cat-head__title">استحقاقات الباقات</h3>
                <p className="acc-choice__note">
                  ما تفتحه كل باقة — يُطبَّق على مستوى الباقة لا فوق مستأجر بعينه
                </p>
                {data.trial_base_name ? (
                  <p className="acc-choice__note">
                    التجريبية تتبع استحقاقات باقة «{data.trial_base_name}» — تُغيَّر الباقة الأساس
                    من «الباقات والتسعير».
                  </p>
                ) : null}
                {/* §٢١٢: مصفوفة — الخصائص صفوف والباقات أعمدة؛ كل خانة حالتها بكلمتها، والنقر يحفظ فوراً */}
                <p className="acc-choice__note plt-ent__how">
                  النقر على خانة يحفظ التغيير لتلك الباقة فوراً ويُسجَّل باسمك.
                </p>
                <div
                  className="plt-ent"
                  style={{ "--plt-ent-plans": data.plans.length } as CSSProperties}
                >
                  <div className="plt-ent__head" aria-hidden="true">
                    <span>الخاصية</span>
                    <span className="plt-ent__cells">
                      {data.plans.map((p) => (
                        <span key={p.code}>{p.name}</span>
                      ))}
                    </span>
                  </div>
                  <ul className="plt-ent__rows">
                    {data.rows.map((r) => {
                      const recent = data.plans
                        .map((p) => ({ p, c: p.cells.find((c) => c.feature === r.feature) }))
                        .filter((x) => x.c?.overridden)
                        .sort((a, b) => (a.c!.changed_at < b.c!.changed_at ? 1 : -1))[0];
                      return (
                        <li key={r.feature} className="plt-ent__row">
                          <div className="plt-ent__feature">
                            <strong>{r.label}</strong>
                            <div className="cus-sub">
                              {recent && recent.c
                                ? `${recent.c.enabled ? "فُعّلت" : "أُوقفت"} ${planWord(recent.p.name)} للتوّ`
                                : r.note}
                            </div>
                            <Status state={KIND_STATE[r.kind]} label={r.kind_label} />
                          </div>
                          {r.kind !== "limit" ? (
                            <div className="plt-ent__cells" role="group" aria-label={r.label}>
                              {data.plans.map((p) => {
                                const c = p.cells.find((x) => x.feature === r.feature)!;
                                const justSaved =
                                  saved?.plan_code === p.code && saved.feature === r.feature;
                                return (
                                  <button
                                    key={p.code}
                                    type="button"
                                    className="plt-ent__switch"
                                    aria-pressed={c.enabled}
                                    aria-busy={busy === `${p.code}:${c.feature}` || undefined}
                                    onClick={() => void toggle(p, c)}
                                  >
                                    <span className="plt-ent__plan">{p.name}</span>
                                    <span className="plt-ent__track" aria-hidden="true" />
                                    <span className="plt-ent__state" aria-hidden="true">
                                      {c.enabled ? "مفعّلة" : "موقوفة"}
                                      {r.kind === "quota" && c.quota !== null ? (
                                        <>
                                          {" · "}
                                          <span className="sting-mono">{c.quota}</span>
                                        </>
                                      ) : null}
                                      {justSaved ? " · حُفظ" : ""}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="plt-ent__cells">
                              {data.plans.map((p) => (
                                <span key={p.code} className="plt-ent__limit">
                                  <span className="plt-ent__plan">{p.name}</span>
                                  <span className="sting-mono">
                                    {p.cells.find((x) => x.feature === r.feature)?.limit ?? "—"}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <h3 className="cat-head__title">أعلام التشغيل</h3>
                <p className="acc-choice__note">
                  علمٌ بلا نطاق قد يتسرّب إلى الجميع — النطاق باقة أو بيئة صراحةً.
                </p>
                {/* §٢١٢: نموذج محدود العرض — المفتاح ونوع النطاق وقيمته مجموعة واحدة */}
                <fieldset className="plt-flag-form">
                  <legend className="visually-hidden">علم تشغيل جديد</legend>
                  <TextField
                    label="مفتاح العلم"
                    mono
                    value={flagKey}
                    onChange={(e) => setFlagKey(e.target.value)}
                  />
                  <div className="plt-flag-form__scope">
                    <span className="plt-flag-form__label">نوع النطاق</span>
                    <div className="pos-chips" role="group" aria-label="نطاق العلم">
                      {(
                        [
                          ["plan", "باقة"],
                          ["env", "بيئة"],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={flagScopeKind === k}
                          className={`pos-chip${flagScopeKind === k ? " pos-chip--on" : ""}`}
                          onClick={() => setFlagScopeKind(k)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <TextField
                    label="النطاق (رمز الباقة أو اسم البيئة)"
                    mono
                    value={flagScope}
                    onChange={(e) => setFlagScope(e.target.value)}
                  />
                  <div className="acc-actions plt-flag-form__save">
                    <Button
                      loading={busy === "flag"}
                      onClick={() => void saveFlag()}
                      disabledReason={flagKey.trim() ? undefined : "اكتب مفتاح العلم"}
                    >
                      حفظ العلم
                    </Button>
                  </div>
                </fieldset>
                {data.flags.length ? (
                  <ul className="plt-flags">
                    {data.flags.map((f) => (
                      <li key={`${f.key}:${f.scope_kind}:${f.scope}`} className="plt-flags__row">
                        <strong className="sting-mono">{f.key}</strong>
                        <span className="plt-flags__scope">
                          {f.scope_kind === "plan" ? "باقة" : "بيئة"}{" "}
                          <span className="sting-mono">{f.scope}</span>
                        </span>
                        <span className="plt-flags__by">{f.changed_by_name}</span>
                        <Status
                          state={f.enabled ? "success" : "expired"}
                          label={f.enabled ? "مفعّل" : "موقوف"}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
