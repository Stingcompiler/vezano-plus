"use client";

import { Button, Notice, RadioGroupField, Status, SwitchField, TextAreaField } from "@sting/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";

import { DayLabel } from "@/features/pos/invoices-client";
import { api } from "@/lib/api";
import { APP_VERSION } from "@/lib/diagnostics";
import { useOnline } from "@/lib/online";
import { pushHost } from "@/lib/pwa";
import { getStorage } from "@/lib/storage";

import { FEEDBACK_TEXT_MAX, type FeedbackDraft, type FeedbackRow, feedbackKinds } from "./feedback";

/** الطابور المحلي: ما كُتب بلا اتصال يُرسل حين يعود (0005 §٢٦٣). */
export const FEEDBACK_OUTBOX_META = "feedback.outbox";

type SectionState =
  "loading" | "ready" | "empty" | "validation_error" | "saved_local" | "success" | "offline";

async function readOutbox(): Promise<FeedbackDraft[]> {
  const raw = await getStorage().read((tx) => tx.getMeta(FEEDBACK_OUTBOX_META));
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as FeedbackDraft[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: readonly FeedbackDraft[]): Promise<void> {
  await getStorage().transaction((tx) => tx.putMeta(FEEDBACK_OUTBOX_META, JSON.stringify(items)));
}

type SendResult = { ok: true; row: FeedbackRow } | { ok: false; code: string; retry: boolean };

async function sendOne(d: FeedbackDraft): Promise<SendResult> {
  try {
    const { data, error, response } = await api().POST("/api/support/feedback", { body: d });
    if (response.ok && data) return { ok: true, row: data as unknown as FeedbackRow };
    const code = (error as { detail?: unknown } | undefined)?.detail;
    // 400/429: الخادم رفضها نهائياً — لا تُعاد. 5xx: تبقى في الطابور.
    return {
      ok: false,
      code: typeof code === "string" ? code : "server_error",
      retry: response.status >= 500,
    };
  } catch {
    return { ok: false, code: "offline", retry: true };
  }
}

const ERRORS: Record<string, string> = {
  text_required: "اكتب ملاحظتك أولاً.",
  text_too_long: "النص أطول من 1000 حرف.",
  rate_limited: "بلغت حدّ الملاحظات اليوم — جرّب غداً.",
  kind_invalid: "اختر نوع الملاحظة.",
};

/**
 * «ملاحظاتك» في SYS-11 (0005 §٢٦٣): أي دور يرسل اقتراحاً أو مشكلة أو رأياً إلى فريق فيزانو، ويرى
 * في «ملاحظاتي» حالتها وردّ الفريق. لا بيانات منشأة؛ الخادم يُخفي ما يشبه رقم هاتف. بلا اتصال تُحفظ
 * على الجهاز (`saved_local`) وتُرسل عند عودته.
 */
export function FeedbackSection({ screen = "SYS-11" }: { readonly screen?: string }) {
  const online = useOnline();
  const [kind, setKind] = useState("suggestion");
  const [text, setText] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<FeedbackRow | null>(null);
  const [savedLocal, setSavedLocal] = useState(false);
  const [items, setItems] = useState<FeedbackRow[] | null>(null);
  const [pending, setPending] = useState<FeedbackDraft[]>([]);
  const flushing = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data, response } = await api().GET("/api/support/feedback");
      if (!response.ok || !data) return;
      const body = data as unknown as { items: FeedbackRow[]; unseen: number };
      setItems(body.items);
      if (body.unseen > 0) void api().POST("/api/support/feedback/seen");
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const queue = await readOutbox();
      const keep: FeedbackDraft[] = [];
      let delivered = false;
      for (const d of queue) {
        const r = await sendOne(d);
        if (r.ok) delivered = true;
        else if (r.retry) keep.push(d);
      }
      if (keep.length !== queue.length) await writeOutbox(keep);
      setPending(keep);
      if (delivered) await load();
    } finally {
      flushing.current = false;
    }
  }, [load]);

  useEffect(() => {
    void (async () => {
      setPending(await readOutbox());
      await load();
      await flush();
    })();
  }, [load, flush]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  const submit = async () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError(ERRORS.text_required ?? null);
      return;
    }
    if (trimmed.length > FEEDBACK_TEXT_MAX) {
      setError(ERRORS.text_too_long ?? null);
      return;
    }
    setBusy(true);
    setError(null);
    setSent(null);
    setSavedLocal(false);
    const draft: FeedbackDraft = {
      client_id: crypto.randomUUID(),
      kind,
      text: trimmed,
      contact_ok: contactOk,
      screen,
      platform: pushHost() === "desktop_app" ? "desktop" : "web",
      app_version: APP_VERSION,
      created_at: new Date().toISOString(),
    };
    try {
      const r = await sendOne(draft);
      if (r.ok) {
        setSent(r.row);
        setText("");
        await load();
        return;
      }
      if (r.retry) {
        const queue = [...(await readOutbox()), draft];
        await writeOutbox(queue);
        setPending(queue);
        setSavedLocal(true);
        setText("");
        return;
      }
      setError(ERRORS[r.code] ?? "لم تُقبل الملاحظة — راجع النص وأعد الإرسال.");
    } finally {
      setBusy(false);
    }
  };

  const state: SectionState =
    items === null && online
      ? "loading"
      : error
        ? "validation_error"
        : savedLocal
          ? "saved_local"
          : sent
            ? "success"
            : !online
              ? "offline"
              : (items?.length ?? 0) + pending.length === 0
                ? "empty"
                : "ready";

  return (
    <section
      id="feedback"
      className="c-card sys-feedback"
      data-state={state}
      aria-labelledby="feedback-title"
    >
      <div className="cat-head">
        <h2 id="feedback-title" className="cat-head__title">
          ملاحظاتك
        </h2>
        <span className="cat-head__hint">اقتراح أو مشكلة أو رأي — تصل إلى فريق فيزانو مباشرة.</span>
      </div>
      <div className="acc-card__body">
        <div className="sys-feedback__form">
          {sent ? (
            <Notice kind="success" title="وصلت ملاحظتك">
              <p className="acc-lead">
                المرجع: <span className="sting-mono">{sent.reference}</span> · ستجد ردّ الفريق هنا
                في «ملاحظاتي».
              </p>
            </Notice>
          ) : null}
          {savedLocal ? (
            <Status
              state="saved_local"
              label="حُفظت الملاحظة على الجهاز — تُرسل عند عودة الاتصال"
            />
          ) : null}
          <RadioGroupField
            label="نوع الملاحظة"
            name="feedback-kind"
            value={kind}
            onChange={setKind}
            options={feedbackKinds}
          />
          <TextAreaField
            label="ملاحظتك"
            hint="لا تكتب أسماء زبائنك أو أرقامهم — أي رقم هاتف يُخفى تلقائياً."
            value={text}
            maxLength={FEEDBACK_TEXT_MAX}
            rows={4}
            error={error ?? undefined}
            onChange={(ev) => {
              setText(ev.target.value);
              if (error) setError(null);
            }}
          />
          <SwitchField
            label="يمكن للفريق التواصل معي"
            checked={contactOk}
            onChange={setContactOk}
          />
          <div className="cat-form__actions">
            <Button pos onClick={() => void submit()} loading={busy}>
              أرسل الملاحظة
            </Button>
          </div>
        </div>
        <div className="sys-feedback__mine">
          <h3 className="cat-head__title">ملاحظاتي</h3>
          {state === "loading" ? <Status state="loading" /> : null}
          {state === "empty" ? (
            <Notice kind="empty" title="لا ملاحظات بعد">
              <p className="acc-lead">ما ترسله يظهر هنا مع حالته وردّ الفريق.</p>
            </Notice>
          ) : null}
          <ul className="sys-feedback__list" aria-label="ملاحظاتي">
            {pending.map((d) => (
              <li key={d.client_id} className="c-card sys-feedback__item">
                <div className="sys-feedback__meta">
                  <Status state="pending_sync" label="بانتظار الإرسال" />
                  <span className="acc-choice__note">
                    <DayLabel iso={d.created_at} now={new Date()} />
                  </span>
                </div>
                <p className="sys-feedback__text">{d.text}</p>
              </li>
            ))}
            {(items ?? []).map((f) => (
              <li key={f.id} className="c-card sys-feedback__item c-enter">
                <div className="sys-feedback__meta">
                  <span className="sys-feedback__kind">{f.kind_label}</span>
                  <Status state={statusState(f.status)} label={f.status_label} />
                  {f.unseen ? <span className="sys-feedback__new">ردّ جديد</span> : null}
                  <span className="acc-choice__note">
                    <span className="sting-mono">{f.reference}</span> ·{" "}
                    <DayLabel iso={f.created_at} now={new Date()} />
                  </span>
                </div>
                <p className="sys-feedback__text">{f.text}</p>
                {f.reply ? (
                  <div className="sys-feedback__reply">
                    <span className="sys-explain__k">ردّ فريق فيزانو</span>
                    <p>{f.reply}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function statusState(s: FeedbackRow["status"]): "pending_sync" | "success" | "stale" | "ready" {
  if (s === "done") return "success";
  if (s === "declined") return "stale";
  if (s === "studying") return "pending_sync";
  return "ready";
}
