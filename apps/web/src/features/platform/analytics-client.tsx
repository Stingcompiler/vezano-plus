"use client";

import { Button, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./platform.css";
import "./analytics.css";
import { operatorToken } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";
import { apiBaseUrl } from "@/lib/api";

interface Row {
  key: string;
  visitors: number;
  views: number;
}
interface Report {
  range: { days: number; from: string; to: string };
  totals: { views: number; visitors: number; prev_views: number; prev_visitors: number };
  daily: { day: string; views: number; visitors: number }[];
  countries: Row[];
  pages: Row[];
  sources: Row[];
  devices: Row[];
  funnel: { key: string; label: string; value: number }[];
  geo_ready: boolean;
  retention_days: number;
}

const RANGES = [7, 30, 90] as const;
const DEVICE: Record<string, string> = { mobile: "هاتف", tablet: "لوحي", desktop: "حاسوب" };
const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["ar"], { type: "region" })
    : null;

const countryLabel = (code: string) => {
  if (code === "*") return "دول أخرى";
  if (!code) return "غير معروفة";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};
const pageLabel = (p: string) => (p === "*" ? "صفحات أخرى" : p);
const sourceLabel = (s: string) => (s === "*" ? "مصادر أخرى" : s || "مباشر");
const deviceLabel = (d: string) => DEVICE[d] ?? d;
/** «11-08» — الشهر واليوم بأرقام لاتينية داخل `.sting-mono` */
const shortDay = (iso: string) => iso.slice(5);
const storesWord = (n: number) =>
  n === 1
    ? "متجر جديد"
    : n === 2
      ? "متجران جديدان"
      : n >= 3 && n <= 10
        ? "متاجر جديدة"
        : "متجراً جديداً";
const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";

/** الفرق عن الفترة السابقة بنصّ صريح لا بلون وحده */
function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0) return <>{now > 0 ? "لا زيارات في الفترة السابقة" : "لا تغيير"}</>;
  const change = Math.round(((now - before) / before) * 100);
  return (
    <>
      {change === 0 ? "مثل" : change > 0 ? "أكثر من" : "أقل من"} الفترة السابقة{" "}
      {change === 0 ? null : <span className="sting-mono">{Math.abs(change)}%</span>} (
      <span className="sting-mono">{before}</span>)
    </>
  );
}

function Ranked({
  title,
  rows,
  label,
  empty,
}: {
  title: string;
  rows: Row[];
  label: (key: string) => string;
  empty: string;
}) {
  const top = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <section className="plt-ana__list" aria-label={title}>
      <h3 className="plt-ana__sub">{title}</h3>
      {rows.length === 0 ? (
        <p className="acc-choice__note">{empty}</p>
      ) : (
        <ol className="plt-ana__rows">
          {rows.map((r) => (
            <li key={r.key || "_"} className="plt-ana__row">
              <span className="plt-ana__name" title={label(r.key)}>
                {label(r.key)}
              </span>
              <span className="plt-ana__value sting-mono">{r.visitors}</span>
              <span className="plt-ana__track" aria-hidden="true">
                <span
                  className="plt-ana__fill"
                  style={{ inlineSize: `${(r.visitors / top) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** PLT-19 — تحليلات زوار الموقع العام (0005 §٢١٩). */
export function AnalyticsClient() {
  const router = useRouter();
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [data, setData] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = operatorToken();
    if (!token) {
      router.replace("/platform/login");
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/platform/analytics?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        router.replace("/platform/login");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Report);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [days, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const state = failed
    ? "server_error"
    : loading || !data
      ? "loading"
      : data.totals.views === 0
        ? "empty"
        : "ready";
  const t = data?.totals;
  const peak = Math.max(1, ...(data?.daily.map((d) => d.visitors) ?? [1]));
  const stores = data?.funnel.find((f) => f.key === "stores")?.value ?? 0;
  const funnelTop = Math.max(1, data?.funnel[0]?.value ?? 1);

  return (
    <PlatformFrame current="analytics">
      <div className="sys sys--wide plt-frame plt-ana" data-screen="PLT-19" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">زوار الموقع العام</h2>
            <span className="cat-head__hint">
              عدّ بلا كوكيز ولا هوية: الزائر يُعدّ مرة في اليوم، ومن طلب «عدم التتبّع» لا يُعدّ.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="plt-ana__ranges" role="group" aria-label="المدّة">
              {RANGES.map((r) => (
                <Button
                  key={r}
                  variant={days === r ? "primary" : "secondary"}
                  aria-pressed={days === r}
                  onClick={() => setDays(r)}
                >
                  آخر <span className="sting-mono">{r}</span> {r <= 10 ? "أيام" : "يوماً"}
                </Button>
              ))}
            </div>

            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر تحميل التحليلات">
                <div className="acc-links">
                  <Button variant="secondary" onClick={() => void load()}>
                    أعد المحاولة
                  </Button>
                </div>
              </Notice>
            ) : null}
            {state === "loading" ? <p className="acc-choice__note">جارٍ التحميل…</p> : null}
            {state === "empty" && data ? (
              <Notice kind="info" title="لا زيارات في هذه المدّة">
                <p className="acc-lead">
                  العدّ يبدأ من أول زيارة لصفحة عامة بعد هذا الإصدار. جرّب مدّة أطول.
                </p>
              </Notice>
            ) : null}
            {data && !data.geo_ready ? (
              <Notice kind="warning" title="قاعدة الدول غير محمَّلة">
                <p className="acc-lead">
                  تظهر الدولة «غير معروفة» حتى يُنزَّل ملفها مع النشر التالي. العدّ نفسه مستمر.
                </p>
              </Notice>
            ) : null}

            {state === "ready" && data && t ? (
              <>
                <div className="plt-kpis">
                  <div className="plt-kpi">
                    <span className="plt-kpi__label">الزوار</span>
                    <span className="plt-kpi__value sting-mono">{t.visitors}</span>
                    <span className="plt-kpi__note">
                      <Delta now={t.visitors} before={t.prev_visitors} />
                    </span>
                    {/* البصمة تتجدّد يومياً (لا تتبّع عبر الأيام): من زار ثلاثة أيام يُعدّ ثلاث مرات */}
                    <span className="plt-kpi__note">يُعدّ الزائر مرة في كل يوم يزور فيه</span>
                  </div>
                  <div className="plt-kpi">
                    <span className="plt-kpi__label">الصفحات المفتوحة</span>
                    <span className="plt-kpi__value sting-mono">{t.views}</span>
                    <span className="plt-kpi__note">
                      <Delta now={t.views} before={t.prev_views} />
                    </span>
                  </div>
                  <div className="plt-kpi">
                    <span className="plt-kpi__label">من زائر إلى متجر</span>
                    <span className="plt-kpi__value sting-mono">{pct(stores, t.visitors)}</span>
                    <span className="plt-kpi__note">
                      <span className="sting-mono">{stores}</span> {storesWord(stores)} في المدّة
                    </span>
                  </div>
                </div>

                <section className="plt-ana__chart" aria-label="الزوار يومياً">
                  <h3 className="plt-ana__sub">الزوار يومياً</h3>
                  <ol className="plt-ana__bars" data-days={data.range.days}>
                    {data.daily.map((d) => (
                      <li
                        key={d.day}
                        className="plt-ana__bar"
                        aria-label={`${d.day}: ${d.visitors} زائراً، ${d.views} صفحة`}
                      >
                        <span
                          className="plt-ana__col"
                          style={{ blockSize: `${(d.visitors / peak) * 100}%` }}
                        />
                        <span className="plt-ana__tip" aria-hidden="true">
                          <span className="sting-mono">{shortDay(d.day)}</span>
                          <span>
                            <span className="sting-mono">{d.visitors}</span> زائراً ·{" "}
                            <span className="sting-mono">{d.views}</span> صفحة
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="plt-ana__axis">
                    <span className="sting-mono">{shortDay(data.range.from)}</span>
                    <span>
                      الأعلى <span className="sting-mono">{peak}</span>
                    </span>
                    <span className="sting-mono">{shortDay(data.range.to)}</span>
                  </div>
                  <details className="plt-ana__table">
                    <summary>عرض الأرقام جدولاً</summary>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">اليوم</th>
                          <th scope="col">الزوار</th>
                          <th scope="col">الصفحات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.daily.map((d) => (
                          <tr key={d.day}>
                            <td className="sting-mono">{d.day}</td>
                            <td className="sting-mono">{d.visitors}</td>
                            <td className="sting-mono">{d.views}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </section>

                <section className="plt-ana__list" aria-label="مسار التحويل">
                  <h3 className="plt-ana__sub">مسار التحويل</h3>
                  <p className="acc-choice__note">
                    النسبة الصغيرة من الخطوة السابقة. والخطوتان الأخيرتان من سجلّ المتاجر
                    والإيصالات، لا من الزيارات: تشملان متاجر سُجّلت من الجوال أو أنشأها المشغّل، فقد
                    تتجاوز نسبتهما ما يوحي به الموقع وحده. التاجر والمشغّل الداخلان بجلستيهما وصفحات
                    الدخول لا تُعدّ زيارات.
                  </p>
                  <ol className="plt-ana__rows">
                    {data.funnel.map((f, i) => (
                      <li key={f.key} className="plt-ana__row">
                        <span className="plt-ana__name">{f.label}</span>
                        <span className="plt-ana__value">
                          <span className="sting-mono">{f.value}</span>
                          {i > 0 ? (
                            <span className="plt-ana__rate sting-mono">
                              {pct(f.value, data.funnel[i - 1]?.value ?? 0)}
                            </span>
                          ) : null}
                        </span>
                        <span className="plt-ana__track" aria-hidden="true">
                          <span
                            className="plt-ana__fill"
                            style={{ inlineSize: `${Math.min(100, (f.value / funnelTop) * 100)}%` }}
                          />
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                <div className="plt-ana__grid">
                  <Ranked
                    title="الدول"
                    rows={data.countries}
                    label={countryLabel}
                    empty="لا دول بعد."
                  />
                  <Ranked
                    title="الصفحات"
                    rows={data.pages}
                    label={pageLabel}
                    empty="لا صفحات بعد."
                  />
                  <Ranked
                    title="المصادر"
                    rows={data.sources}
                    label={sourceLabel}
                    empty="لا مصادر بعد."
                  />
                  <Ranked
                    title="الأجهزة"
                    rows={data.devices}
                    label={deviceLabel}
                    empty="لا أجهزة بعد."
                  />
                </div>
              </>
            ) : null}

            <p className="acc-choice__note plt-ana__foot">
              تُحذف السجلات بعد <span className="sting-mono">{data?.retention_days ?? 400}</span>{" "}
              يوماً. تحديد الدولة:{" "}
              <a href="https://db-ip.com" target="_blank" rel="noreferrer">
                IP Geolocation by DB-IP
              </a>
            </p>
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
