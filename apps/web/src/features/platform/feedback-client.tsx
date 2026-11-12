"use client";

import { Button, Notice, RadioGroupField, Status, TextAreaField } from "@sting/ui-web";
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

interface Item {
  id: string;
  tenant_id: string;
  tenant_name: string;
  reference: string;
  kind: "suggestion" | "problem" | "opinion";
  kind_label: string;
  text: string;
  contact_ok: boolean;
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
}
interface Payload {
  page?: PageInfo;
  filter: Filter;
  kind: string;
  counts: Record<FbStatus, number>;
  items: Item[];
}

const FILTERS: readonly (readonly [Filter, string])[] = [
  ["open", "مفتوحة"],
  ["new", "جديدة"],
  ["studying", "قيد الدراسة"],
  ["done", "نُفّذت"],
  ["declined", "لن تُنفّذ"],
  ["all", "الكل"],
];
const KINDS: readonly (readonly [string, string])[] = [
  ["", "كل الأنواع"],
  ["suggestion", "اقتراح"],
  ["problem", "مشكلة"],
  ["opinion", "رأي"],
];
const STATUS_OPTIONS = [
  { value: "new", label: "جديدة" },
  { value: "studying", label: "قيد الدراسة" },
  { value: "done", label: "نُفّذت" },
  { value: "declined", label: "لن تُنفّذ" },
] as const;
const PLATFORM: Record<string, string> = { web: "الويب", mobile: "الجوال", desktop: "الحاسوب" };

const ERRORS: Record<string, string> = {
  unchanged: "لم يتغيّر شيء — غيّر الحالة أو اكتب ردّاً.",
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
  const [filter, setFilter] = useState<Filter>("open");
  const [kind, setKind] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [status, setStatus] = useState<FbStatus>("studying");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter, kind]);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    try {
      const { data: d, response } = await platformApi().GET("/api/platform/feedback", {
        params: { query: { status: filter, kind, ...pageQuery(page) } },
      });
      if (response.ok && d) {
        setData(d as unknown as Payload);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [router, filter, kind, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (f: Item) => {
    setOpen(f);
    setStatus(f.status === "new" ? "studying" : f.status);
    setReply(f.reply);
    setErr("");
    setSaved(false);
  };

  const save = async () => {
    if (!open || busy) return;
    setBusy(true);
    setErr("");
    setSaved(false);
    try {
      const res = await platformApi().POST("/api/platform/feedback/{tenant_id}/{feedback_id}", {
        params: { path: { tenant_id: open.tenant_id, feedback_id: open.id } },
        body: { status, reply } as never,
      });
      const b = (res.data ?? res.error) as unknown as (Item & { detail?: string }) | undefined;
      if (res.response.ok && b) {
        setOpen(b);
        setSaved(true);
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
              اقتراحات التجار ومشكلاتهم وآراؤهم من تطبيقاتهم — الردّ يصل المرسل في «ملاحظاتي».
            </span>
          </div>
          <div className="acc-card__body">
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
              {KINDS.map(([code, label]) => (
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
                  تصل هنا الملاحظات حين يرسلها مستخدم منشأة من «ملاحظاتك» في «الدعم والتشخيص».
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
                      من {f.from_name || "—"} · {PLATFORM[f.platform] ?? "—"}
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
                  {open.kind_label} · من {open.from_name || "—"} · {PLATFORM[open.platform] ?? "—"}
                  {open.app_version ? (
                    <>
                      {" "}
                      · الإصدار <span className="sting-mono">{open.app_version}</span>
                    </>
                  ) : null}
                  {open.updated_by_name ? ` · آخر تحديث: ${open.updated_by_name}` : ""}
                </p>
                {saved ? <Status state="success" label="حُفظ — يراه المرسل في «ملاحظاتي»" /> : null}
                <RadioGroupField
                  label="الحالة"
                  name="feedback-status"
                  value={status}
                  onChange={(v) => setStatus(v as FbStatus)}
                  options={STATUS_OPTIONS}
                />
                <TextAreaField
                  label="ردّ الفريق"
                  hint="يراه المرسل باسم «فريق فيزانو» — حتى 600 حرف"
                  rows={3}
                  maxLength={600}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                {err ? <Status state="validation_error" label={err} /> : null}
                <div className="acc-links">
                  <Button onClick={() => void save()} loading={busy}>
                    احفظ وأبلغ المرسل
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
