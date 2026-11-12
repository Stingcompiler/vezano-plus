"use client";

import { Button, Notice, RadioGroupField, Status, SwitchField, TextAreaField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";
import { PlatformPager, pageQuery, type PageInfo } from "@/features/platform/paging";

type Filter = "open" | "new" | "studying" | "done" | "declined" | "all";
type FbStatus = "new" | "studying" | "done" | "declined";
type Source = "merchant" | "public";

interface Item {
  id: string;
  source: Source;
  tenant_id: string;
  tenant_name: string;
  reference: string;
  kind: string;
  kind_label: string;
  text: string;
  contact_ok: boolean;
  contact_email: string;
  from_name: string;
  screen: string;
  platform: string;
  app_version: string;
  status: FbStatus;
  status_label: string;
  reply: string;
  updated_by_name: string;
  updated_at: string;
  created_at: string;
  has_attachment?: boolean;
  attachment_name?: string;
  emailed_at?: string;
}
interface Payload {
  page?: PageInfo;
  filter: Filter;
  kind: string;
  counts: Record<FbStatus, number>;
  items: Item[];
  new: Record<Source, number>;
  summary?: Record<Source, Record<string, number>>;
}

const FILTERS: readonly (readonly [Filter, string])[] = [
  ["open", "مفتوحة"],
  ["new", "جديدة"],
  ["studying", "قيد الدراسة"],
  ["done", "نُفّذت"],
  ["declined", "لن تُنفّذ"],
  ["all", "الكل"],
];
const KINDS: Record<Source, readonly (readonly [string, string])[]> = {
  merchant: [
    ["", "كل الأنواع"],
    ["suggestion", "اقتراح"],
    ["problem", "مشكلة"],
    ["opinion", "رأي"],
  ],
  // 0005 §٢٦٦: ملاحظات الزوار — خاصة بالفريق
  public: [
    ["", "كل الأنواع"],
    ["platform", "اقتراح للمنصة"],
    ["site", "مشكلة في الموقع"],
    ["shop", "ملاحظة عن محل"],
  ],
};
const SOURCES: readonly (readonly [Source, string])[] = [
  ["merchant", "التجار"],
  ["public", "الزوار"],
];
const STATUS_OPTIONS = [
  { value: "new", label: "جديدة" },
  { value: "studying", label: "قيد الدراسة" },
  { value: "done", label: "نُفّذت" },
  { value: "declined", label: "لن تُنفّذ" },
] as const;
const PLATFORM: Record<string, string> = {
  web: "الويب",
  mobile: "الجوال",
  desktop: "الحاسوب",
  public: "الموقع العام",
};

const ERRORS: Record<string, string> = {
  unchanged: "لم يتغيّر شيء — غيّر الحالة أو اكتب ردّاً.",
  no_email: "لم يترك الزائر بريداً.",
  reply_required: "اكتب الردّ قبل إرساله إلى البريد.",
  reply_too_long: "الردّ أطول من 600 حرف.",
  not_found: "الملاحظة لم تعد موجودة.",
  status_invalid: "اختر الحالة.",
};

const tone = (s: FbStatus) =>
  s === "done"
    ? "success"
    : s === "declined"
      ? "stale"
      : s === "studying"
        ? "pending_sync"
        : "ready";

/**
 * PLT-21 — «الملاحظات» (0005 §٢٦٤): اقتراحات التجار ومشكلاتهم وآراؤهم من «ملاحظاتك» في SYS-11 (الويب
 * والحاسوب والجوال). الحالة والردّ يكتبهما المشغّل باسمه ويصلان المرسل في «ملاحظاتي» مع تنبيه لجهازه.
 * لا بيانات دفتر؛ ما يشبه رقم هاتف أُخفي قبل الحفظ.
 */
export function FeedbackClient() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("merchant");
  const [filter, setFilter] = useState<Filter>("open");
  const [kind, setKind] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [status, setStatus] = useState<FbStatus>("studying");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  // 0005 §٢٦٧: الردّ إلى بريد الزائر، ونتيجة الإرسال، ولقطة شاشة التاجر
  const [emailReply, setEmailReply] = useState(false);
  const [emailResult, setEmailResult] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter, kind, source]);
  // إشعار ملاحظة زائر يفتح `?source=public`
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("source") === "public") setSource("public");
  }, []);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    try {
      const { data: d, response } = await platformApi().GET("/api/platform/feedback", {
        params: { query: { status: filter, kind, source, ...pageQuery(page) } },
      });
      if (response.ok && d) {
        setData(d as unknown as Payload);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [router, filter, kind, source, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (f: Item) => {
    setOpen(f);
    setStatus(f.status === "new" ? "studying" : f.status);
    setReply(f.reply);
    setErr("");
    setSaved(false);
    setEmailReply(false);
    setEmailResult("");
    setShot(null);
    if (f.source === "merchant" && f.has_attachment) {
      void platformApi()
        .GET("/api/platform/feedback/{tenant_id}/{feedback_id}/attachment", {
          params: { path: { tenant_id: f.tenant_id, feedback_id: f.id } },
        })
        .then(({ data: a, response }) => {
          const url = (a as { data_url?: string } | undefined)?.data_url;
          if (response.ok && url?.startsWith("data:image/")) setShot(url);
        })
        .catch(() => undefined);
    }
  };

  const save = async () => {
    if (!open || busy) return;
    setBusy(true);
    setErr("");
    setSaved(false);
    try {
      const res =
        open.source === "public"
          ? await platformApi().POST("/api/platform/feedback/public/{feedback_id}", {
              params: { path: { feedback_id: open.id } },
              body: { status, reply, email_reply: emailReply } as never,
            })
          : await platformApi().POST("/api/platform/feedback/{tenant_id}/{feedback_id}", {
              params: { path: { tenant_id: open.tenant_id, feedback_id: open.id } },
              body: { status, reply } as never,
            });
      const b = (res.data ?? res.error) as unknown as
        (Item & { detail?: string; email?: string }) | undefined;
      if (res.response.ok && b) {
        setOpen(b);
        setSaved(true);
        setEmailResult(b.email ?? "");
        setEmailReply(false);
        await load();
      } else setErr(ERRORS[b?.detail ?? ""] ?? "تعذّر الحفظ. أعد المحاولة.");
    } catch {
      setErr("تعذّر الحفظ. أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  };

  const state = failed
    ? "server_error"
    : data === null
      ? "loading"
      : data.items.length
        ? "ready"
        : "empty";

  const count = (f: Filter): number | null => {
    if (!data) return null;
    if (f === "open") return data.counts.new + data.counts.studying;
    if (f === "all") return null;
    return data.counts[f];
  };

  return (
    <PlatformFrame current="feedback">
      <div className="sys sys--wide plt-frame" data-screen="PLT-21" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الملاحظات</h2>
            <span className="cat-head__hint">
              {source === "public"
                ? "ملاحظات زوار الموقع وصفحات المحلات — خاصة بالفريق، لا تُنشر ولا تُرسل إلى المحل."
                : "اقتراحات التجار ومشكلاتهم وآراؤهم من تطبيقاتهم — الردّ يصل المرسل في «ملاحظاتي»."}
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-chips" role="group" aria-label="المصدر">
              {SOURCES.map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  className={`pos-chip${source === code ? " pos-chip--on" : ""}`}
                  aria-pressed={source === code}
                  onClick={() => {
                    setSource(code);
                    setKind("");
                    setOpen(null);
                  }}
                >
                  {label}
                  {data?.new ? (
                    <>
                      {" "}
                      · <span className="sting-mono">{data.new[code]}</span>
                    </>
                  ) : null}
                </button>
              ))}
            </div>
            {data?.summary ? (
              <p className="acc-choice__note plt-fb-summary">
                آخر 30 يوماً:{" "}
                {KINDS[source]
                  .filter(([code]) => code)
                  .map(([code, label], i) => (
                    <span key={code}>
                      {i ? " · " : ""}
                      {label}{" "}
                      <span className="sting-mono">{data.summary?.[source]?.[code] ?? 0}</span>
                    </span>
                  ))}
              </p>
            ) : null}
            <div className="pos-chips" role="group" aria-label="الحالة">
              {FILTERS.map(([code, label]) => {
                const n = count(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className={`pos-chip${filter === code ? " pos-chip--on" : ""}`}
                    aria-pressed={filter === code}
                    onClick={() => {
                      setFilter(code);
                      setOpen(null);
                    }}
                  >
                    {label}
                    {n !== null ? (
                      <>
                        {" "}
                        · <span className="sting-mono">{n}</span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="pos-chips" role="group" aria-label="النوع">
              {KINDS[source].map(([code, label]) => (
                <button
                  key={code || "all"}
                  type="button"
                  className={`pos-chip${kind === code ? " pos-chip--on" : ""}`}
                  aria-pressed={kind === code}
                  onClick={() => {
                    setKind(code);
                    setOpen(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر تحميل الملاحظات">
                <div className="acc-links">
                  <Button onClick={() => void load()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا ملاحظات هنا">
                <p className="acc-lead">
                  {source === "public"
                    ? "تصل هنا ملاحظات الزوار من «أرسل ملاحظة» في الموقع العام وصفحات المحلات."
                    : "تصل هنا الملاحظات حين يرسلها مستخدم منشأة من «ملاحظاتك» في «الدعم والتشخيص»."}
                </p>
              </Notice>
            ) : null}

            <ul id="plt-feedback-list" className="plt-notices" aria-label="الملاحظات">
              {data?.items.map((f) => (
                <li
                  key={f.id}
                  className={`plt-notice${f.status === "new" ? " plt-notice--new" : ""}`}
                >
                  <div className="plt-notice__main">
                    <div className="plt-notice__title">
                      {f.kind_label} · {f.tenant_name || "—"} ·{" "}
                      <span className="sting-mono">{f.reference}</span>
                    </div>
                    <div className="acc-choice__note">
                      من {f.source === "public" ? "زائر" : f.from_name || "—"} ·{" "}
                      {PLATFORM[f.platform] ?? "—"}
                      {f.screen ? (
                        <>
                          {" "}
                          · <span className="sting-mono">{f.screen}</span>
                        </>
                      ) : null}{" "}
                      · {dayMonth(f.created_at).day} {dayMonth(f.created_at).month}{" "}
                      <span className="sting-mono">{hhmm(f.created_at)}</span>
                      {f.contact_ok ? " · يقبل التواصل" : ""}
                    </div>
                    <div className="acc-lead sys-feedback__text">{f.text}</div>
                  </div>
                  <div className="plt-notice__actions">
                    <Status state={tone(f.status)} label={f.status_label} />
                    <Button variant="secondary" onClick={() => show(f)}>
                      افتح
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <PlatformPager info={data?.page} onPage={setPage} anchorId="plt-feedback-list" />

            {open ? (
              <section className="plt-msg" aria-label="تفاصيل الملاحظة">
                <h3 className="cat-head__title">
                  <span className="sting-mono">{open.reference}</span> — {open.tenant_name || "—"}
                </h3>
                <p className="acc-lead sys-feedback__text">{open.text}</p>
                <p className="acc-choice__note">
                  {open.kind_label} · من {open.source === "public" ? "زائر" : open.from_name || "—"}{" "}
                  · {PLATFORM[open.platform] ?? "—"}
                  {open.app_version ? (
                    <>
                      {" "}
                      · الإصدار <span className="sting-mono">{open.app_version}</span>
                    </>
                  ) : null}
                  {open.updated_by_name ? ` · آخر تحديث: ${open.updated_by_name}` : ""}
                </p>
                {open.contact_email ? (
                  <p className="acc-choice__note">
                    بريد الزائر: <span className="sting-mono">{open.contact_email}</span>
                    {open.emailed_at ? " · أُرسل إليه ردّ" : ""}
                  </p>
                ) : null}
                {shot ? (
                  <a href={shot} target="_blank" rel="noreferrer" className="plt-fb-shot">
                    <img src={shot} alt="لقطة الشاشة المرفقة" />
                  </a>
                ) : null}
                {saved ? (
                  <Status
                    state="success"
                    label={
                      open.source === "public"
                        ? emailResult === "sent"
                          ? "حُفظ وأُرسل الردّ إلى بريد الزائر"
                          : emailResult === "not_configured"
                            ? "حُفظ — البريد غير مُعدّ على الخادم فلم يُرسل"
                            : emailResult === "failed"
                              ? "حُفظ — تعذّر إرسال البريد"
                              : "حُفظ"
                        : "حُفظ — يراه المرسل في «ملاحظاتي»"
                    }
                  />
                ) : null}
                <RadioGroupField
                  label="الحالة"
                  name="feedback-status"
                  value={status}
                  onChange={(v) => setStatus(v as FbStatus)}
                  options={STATUS_OPTIONS}
                />
                <TextAreaField
                  label={open.source === "public" ? "ملاحظة الفريق" : "ردّ الفريق"}
                  hint={
                    open.source === "public"
                      ? "داخلية ما لم تُرسلها إلى بريد الزائر"
                      : "يراه المرسل باسم «فريق فيزانو» — حتى 600 حرف"
                  }
                  rows={3}
                  maxLength={600}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                {open.source === "public" && open.contact_email ? (
                  <SwitchField
                    label="أرسل الردّ إلى بريد الزائر"
                    checked={emailReply}
                    onChange={setEmailReply}
                  />
                ) : null}
                {err ? <Status state="validation_error" label={err} /> : null}
                <div className="acc-links">
                  <Button onClick={() => void save()} loading={busy}>
                    {open.source === "public" ? "احفظ" : "احفظ وأبلغ المرسل"}
                  </Button>
                  <Button variant="quiet" onClick={() => setOpen(null)}>
                    أغلق
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
