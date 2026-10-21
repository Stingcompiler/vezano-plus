"use client";

import { Button, Notice, Status, TextAreaField } from "@sting/ui-web";
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

type Filter = "new" | "handled" | "all";

interface Message {
  id: string;
  reference: string;
  tenant_name: string;
  from_name: string;
  app_version: string;
  note: string;
  created_at: string;
  handled: boolean;
  handled_by_name: string;
  handled_at: string;
  handled_note: string;
  payload?: Record<string, unknown>;
}
interface Payload {
  filter: Filter;
  new_count: number;
  messages: Message[];
}

const FILTERS: readonly (readonly [Filter, string])[] = [
  ["new", "جديدة"],
  ["handled", "تمّت معالجتها"],
  ["all", "الكل"],
];

const ERRORS: Record<string, string> = {
  already_handled: "عالجها زميل قبلك.",
  not_found: "الرسالة لم تعد موجودة.",
};

/**
 * PLT-16 — رسائل الدعم الواردة من المنشآت (0005 §١٩٠): ما يرسله المالك من «الدعم والتشخيص» في تطبيقه
 * (SYS-11). كانت تُخزَّن ولا شاشة للمنصة تقرؤها. التشخيص تقني فقط (لا أسماء ولا مبالغ ولا رموز)،
 * والمعالجة بملاحظة باسم المشغّل ووقته.
 */
export function MessagesClient() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("new");
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<Message | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    try {
      const { data: d, response } = await platformApi().GET("/api/platform/messages", {
        params: { query: { status: filter } },
      });
      if (response.ok && d) {
        setData(d as unknown as Payload);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [router, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = async (m: Message) => {
    setErr("");
    setNote("");
    setOpen(m);
    const { data: d, response } = await platformApi().GET("/api/platform/messages/{report_id}", {
      params: { path: { report_id: m.id } },
    });
    if (response.ok && d) setOpen(d);
  };

  const handle = async () => {
    if (!open || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await platformApi().POST("/api/platform/messages/{report_id}/handle", {
        params: { path: { report_id: open.id } },
        body: { note } as never,
      });
      const b = (res.data ?? res.error) as unknown as (Message & { detail?: string }) | undefined;
      if (res.response.ok && b) {
        setOpen(b);
        await load();
      } else setErr(ERRORS[b?.detail ?? ""] ?? "تعذّر الحفظ. أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  };

  const state = failed
    ? "server_error"
    : data === null
      ? "loading"
      : data.messages.length
        ? "ready"
        : "empty";

  return (
    <PlatformFrame current="messages">
      <div className="sys sys--wide plt-frame" data-screen="PLT-16" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الرسائل</h2>
            <span className="cat-head__hint">
              رسائل الدعم التي يرسلها المالك من تطبيقه — تشخيص تقني بلا أسماء ولا مبالغ.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-chips" role="group" aria-label="التصفية">
              {FILTERS.map(([code, label]) => (
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
                  {code === "new" && data ? (
                    <>
                      {" "}
                      · <span className="sting-mono">{data.new_count}</span>
                    </>
                  ) : null}
                </button>
              ))}
            </div>

            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر تحميل الرسائل">
                <div className="acc-links">
                  <Button onClick={() => void load()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title={filter === "new" ? "لا رسائل جديدة" : "لا رسائل هنا"}>
                <p className="acc-lead">
                  تصل هنا رسائل الدعم حين يرسلها مالك منشأة من «الدعم والتشخيص» في تطبيقه.
                </p>
              </Notice>
            ) : null}

            <ul className="plt-notices" aria-label="الرسائل">
              {data?.messages.map((m) => (
                <li key={m.id} className={`plt-notice${m.handled ? "" : " plt-notice--new"}`}>
                  <div className="plt-notice__main">
                    <div className="plt-notice__title">
                      <span className="sting-mono">{m.reference}</span> · {m.tenant_name || "—"}
                    </div>
                    <div className="acc-choice__note">
                      من {m.from_name || "—"}
                      {m.app_version ? (
                        <>
                          {" "}
                          · الإصدار <span className="sting-mono">{m.app_version}</span>
                        </>
                      ) : null}{" "}
                      · {dayMonth(m.created_at).day} {dayMonth(m.created_at).month}{" "}
                      <span className="sting-mono">{hhmm(m.created_at)}</span>
                    </div>
                    <div className="acc-lead">{m.note || "تقرير تشخيص بلا ملاحظة"}</div>
                  </div>
                  <div className="plt-notice__actions">
                    {m.handled ? <Status state="success" label="تمّت المعالجة" /> : null}
                    <Button variant="secondary" onClick={() => void show(m)}>
                      افتح
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            {open ? (
              <section className="plt-msg" aria-label="تفاصيل الرسالة">
                <h3 className="cat-head__title">
                  <span className="sting-mono">{open.reference}</span> — {open.tenant_name || "—"}
                </h3>
                <p className="acc-lead">{open.note || "تقرير تشخيص بلا ملاحظة."}</p>
                {open.payload ? (
                  <pre className="plt-msg__payload sting-mono">
                    {JSON.stringify(open.payload, null, 2)}
                  </pre>
                ) : null}
                {open.handled ? (
                  <Notice kind="success" title="تمّت المعالجة">
                    <p className="acc-lead">
                      {open.handled_by_name}
                      {open.handled_note ? ` — ${open.handled_note}` : ""}
                    </p>
                  </Notice>
                ) : (
                  <>
                    <TextAreaField
                      label="ملاحظة المعالجة"
                      hint="ما فُعل أو ما أُجيب به — تُسجَّل باسمك ووقته"
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    {err ? <Status state="validation_error" label={err} /> : null}
                    <div className="acc-links">
                      <Button onClick={() => void handle()} loading={busy}>
                        تمّت المعالجة
                      </Button>
                      <Button variant="quiet" onClick={() => setOpen(null)}>
                        أغلق
                      </Button>
                    </div>
                  </>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
