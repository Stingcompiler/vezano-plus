"use client";

import { Button, Notice, SelectField, Status, Table, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./platform.css";
import "./directory.css";
import { agoParts } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformPager, pageQuery, type PageInfo } from "@/features/platform/paging";
import { PlatformFrame } from "@/features/platform/platform-nav";

/**
 * PLT-20 — جدول المستأجرين (0005 §٢٢٩): كل متجر في صفّ واحد بالدولة التي يعمل منها وأجهزته وفروعه
 * ومستخدميه وآخر نشاطه. حقول تشغيل لا دفاتر. الفرز والقصّ في الخادم؛ رؤوس الأعمدة تفرز.
 */

interface Row {
  id: string;
  name: string;
  country: string;
  country_at: string;
  plan_label: string;
  plan_code: string;
  status: string;
  status_label: string;
  devices_active: number;
  devices_all: number;
  branches: number;
  users: number;
  last_seen_at: string;
  created_at: string;
}
interface Payload {
  tenants: Row[];
  total: number;
  shown: number;
  devices_total: number;
  countries: { code: string; tenants: number }[];
  unknown_country: number;
  sort: string;
  desc: boolean;
  page?: PageInfo;
}
type State = "loading" | "ready" | "empty" | "permission_denied" | "server_error";

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["ar"], { type: "region" })
    : null;
export const countryName = (code: string) => {
  if (!code) return "غير معروفة بعد";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Khartoum" }) : "";

const STATUS_STATE = (s: string) =>
  s === "active"
    ? "success"
    : s === "expired"
      ? "expired"
      : s === "payment_pending" || s === "pending_approval"
        ? "stale"
        : s === "sync_late"
          ? "conflict"
          : s === "suspended"
            ? "permission_denied"
            : "saved_local";

const UNITS = {
  minute: ["دقيقة", "دقيقتين", "دقائق", "دقيقة"],
  hour: ["ساعة", "ساعتين", "ساعات", "ساعة"],
  day: ["يوم", "يومين", "أيام", "يوماً"],
} as const;

/** «قبل 3 ساعات» والعدد بأرقام mono، أو «لم يُستعمل بعد». */
function Seen({ iso }: { iso: string }) {
  if (!iso) return <span className="plt-dir__muted">لم يُستعمل بعد</span>;
  const { n, unit } = agoParts(iso);
  const [one, two, few, many] = UNITS[unit];
  if (n <= 1) return <span>قبل {one}</span>;
  if (n === 2) return <span>قبل {two}</span>;
  return (
    <span>
      قبل <span className="sting-mono">{n}</span> {n <= 10 ? few : many}
    </span>
  );
}

const devicesWord = (n: number) =>
  n === 1 ? "جهاز" : n === 2 ? "جهازان" : n <= 10 ? "أجهزة" : "جهازاً";

export function DirectoryClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "created", desc: true });
  const [page, setPage] = useState(1);
  const asked = useRef(0);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const n = ++asked.current;
    try {
      const { data: d, response } = await platformApi().GET("/api/platform/tenants/directory", {
        params: {
          query: {
            q,
            country,
            sort: sort.key,
            dir: sort.desc ? "desc" : "asc",
            ...pageQuery(page),
          },
        },
      });
      if (n !== asked.current) return; // ردّ أقدم وصل بعد أحدث
      if (response.status === 401 || response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.ok && d) {
        setData(d);
        setFailed(false);
      } else setFailed(true);
    } catch {
      if (n === asked.current) setFailed(true);
    }
  }, [router, q, country, sort, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);
  // بحث أو دولة أو فرز جديد يبدأ من الصفحة الأولى
  useEffect(() => setPage(1), [q, country, sort]);

  const state: State = denied
    ? "permission_denied"
    : failed && !data
      ? "server_error"
      : !data
        ? "loading"
        : data.shown === 0
          ? "empty"
          : "ready";

  const columns = [
    {
      key: "name",
      header: "المتجر",
      sortable: true,
      render: (t: Row) => (
        <div className="plt-dir__name">
          <strong>{t.name}</strong>
          <span className="plt-dir__muted">
            منذ <span className="sting-mono">{day(t.created_at)}</span>
          </span>
        </div>
      ),
    },
    {
      key: "country",
      header: "الدولة",
      sortable: true,
      render: (t: Row) => (
        <span className={t.country ? undefined : "plt-dir__muted"}>
          {countryName(t.country)}
          {t.country ? (
            <>
              {" "}
              <span className="sting-mono plt-dir__code">{t.country}</span>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: "plan",
      header: "الباقة والحالة",
      render: (t: Row) => (
        <div className="plt-dir__name">
          <span>{t.plan_label}</span>
          <Status state={STATUS_STATE(t.status)} label={t.status_label} />
        </div>
      ),
    },
    {
      key: "devices",
      header: "الأجهزة",
      sortable: true,
      render: (t: Row) => (
        <span>
          <span className="sting-mono">{t.devices_active}</span> {devicesWord(t.devices_active)}
          {t.devices_all > t.devices_active ? (
            <span className="plt-dir__muted">
              {" "}
              · <span className="sting-mono">{t.devices_all - t.devices_active}</span> موقوف
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "branches",
      header: "الفروع",
      sortable: true,
      render: (t: Row) => <span className="sting-mono">{t.branches}</span>,
    },
    {
      key: "users",
      header: "المستخدمون",
      sortable: true,
      render: (t: Row) => <span className="sting-mono">{t.users}</span>,
    },
    {
      key: "seen",
      header: "آخر نشاط",
      sortable: true,
      render: (t: Row) => <Seen iso={t.last_seen_at} />,
    },
  ];
  // مفتاح «created» يفرز بتاريخ التسجيل ويُعرض في عمود المتجر
  const tableSort =
    sort.key === "created"
      ? undefined
      : { key: sort.key, dir: sort.desc ? ("descending" as const) : ("ascending" as const) };

  return (
    <PlatformFrame current="directory">
      <div className="sys sys--wide plt-frame plt-dir" data-screen="PLT-20" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">جدول المستأجرين</h2>
          </div>
          <p className="acc-choice__note">
            كل متجر في صفّ: الدولة التي يعمل منها، وأجهزته وفروعه ومستخدموه، وآخر نشاط. حقول تشغيل
            لا دفاتر.
          </p>

          {state === "permission_denied" ? (
            <Notice kind="warning" title="لمشغّلي المنصة وحدهم">
              <p className="acc-lead">ادخل بحساب مشغّل لترى الجدول.</p>
            </Notice>
          ) : null}
          {state === "server_error" ? (
            <Notice kind="warning" title="تعذّر جلب الجدول">
              <p className="acc-lead">الخادم لم يردّ. أعد المحاولة بعد لحظة.</p>
              <div className="acc-actions">
                <Button variant="secondary" onClick={() => void load()}>
                  أعد المحاولة
                </Button>
              </div>
            </Notice>
          ) : null}

          {data ? (
            <p className="plt-dir__sum" aria-live="polite">
              <span className="sting-mono">{data.total}</span> متجراً ·{" "}
              <span className="sting-mono">{data.devices_total}</span> جهازاً نشطاً ·{" "}
              <span className="sting-mono">{data.countries.length}</span>{" "}
              {data.countries.length === 1 ? "دولة" : "دول"}
              {data.unknown_country ? (
                <>
                  {" "}
                  · <span className="sting-mono">{data.unknown_country}</span> بلا دولة معروفة بعد
                </>
              ) : null}
            </p>
          ) : null}

          <div className="plt-dir__filters">
            <TextField
              label="ابحث باسم المتجر أو معرِّفه"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <SelectField
              label="الدولة"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              options={[
                { value: "", label: "كل الدول" },
                ...(data?.countries ?? []).map((c) => ({
                  value: c.code,
                  label: `${countryName(c.code)} (${c.tenants})`,
                })),
                ...(data?.unknown_country ? [{ value: "unknown", label: "غير معروفة بعد" }] : []),
              ]}
            />
            <SelectField
              label="الترتيب"
              value={`${sort.key}:${sort.desc ? "desc" : "asc"}`}
              onChange={(e) => {
                const [key = "created", dir] = e.target.value.split(":");
                setSort({ key, desc: dir !== "asc" });
              }}
              options={[
                { value: "created:desc", label: "الأحدث تسجيلاً" },
                { value: "created:asc", label: "الأقدم تسجيلاً" },
                { value: "devices:desc", label: "الأكثر أجهزة" },
                { value: "seen:desc", label: "الأحدث نشاطاً" },
                { value: "name:asc", label: "الاسم" },
                { value: "country:asc", label: "الدولة" },
              ]}
            />
          </div>

          <div id="plt-dir-list">
            <Table
              caption="جدول المستأجرين"
              columns={columns}
              rows={data?.tenants ?? []}
              rowKey={(t) => t.id}
              sort={tableSort}
              onSort={(key) =>
                setSort((s) =>
                  s.key === key
                    ? { key, desc: !s.desc }
                    : { key, desc: key === "devices" || key === "seen" || key === "users" },
                )
              }
              onOpenRow={(t) => router.push(`/platform/tenants/${t.id}`)}
              loading={data ? undefined : 6}
              empty={
                <Notice kind="empty" title="لا متاجر تطابق البحث">
                  <p className="acc-lead">غيّر الدولة أو كلمة البحث.</p>
                </Notice>
              }
            />
          </div>
          <PlatformPager info={data?.page} onPage={setPage} anchorId="plt-dir-list" />
          <p className="acc-choice__note">
            الدولة من عنوان الشبكة لآخر استعمال بجلسة المتجر، تُحدَّث مرة في الساعة، والعنوان نفسه
            لا يُحفظ. «غير معروفة بعد»: لم يُستعمل الحساب منذ تفعيل هذا العمود، أو من شبكة خاصة.
          </p>
        </div>
      </div>
    </PlatformFrame>
  );
}
