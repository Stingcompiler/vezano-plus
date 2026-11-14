"use client";

import {
  Button,
  Notice,
  RadioGroupField,
  Status,
  SwitchField,
  TextAreaField,
  Upload,
} from "@sting/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";

import { DayLabel } from "@/features/pos/invoices-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { APP_VERSION } from "@/lib/diagnostics";
import { useOnline } from "@/lib/online";
import { pushHost } from "@/lib/pwa";
import { getStorage } from "@/lib/storage";

import { FEEDBACK_TEXT_MAX, type FeedbackDraft, type FeedbackRow, feedbackKinds } from "./feedback";

/** الطابور المحلي: ما كُتب بلا اتصال يُرسل حين يعود (0005 §٢٦٤). */
export const FEEDBACK_OUTBOX_META = "feedback.outbox";

type SectionState =
  | "loading"
  | "ready"
  | "empty"
  | "validation_error"
  | "saved_local"
  | "success"
  | "offline"
  | "server_error";

function parseOutbox(raw: string | null | undefined): FeedbackDraft[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as FeedbackDraft[]) : [];
  } catch {
    return [];
  }
}

async function readOutbox(): Promise<FeedbackDraft[]> {
  return parseOutbox(await getStorage().read((tx) => tx.getMeta(FEEDBACK_OUTBOX_META)));
}

/**
 * تعديل الطابور في معاملة واحدة (قراءة ثم كتابة): إرسال جارٍ وحفظ مسودة جديدة في اللحظة نفسها كان
 * أحدهما يكتب فوق الآخر فتضيع المسودة (0005 §٢٧٤).
 */
async function updateOutbox(
  change: (queue: FeedbackDraft[]) => FeedbackDraft[],
): Promise<FeedbackDraft[]> {
  return getStorage().transaction(async (tx) => {
    const next = change(parseOutbox(await tx.getMeta(FEEDBACK_OUTBOX_META)));
    await tx.putMeta(FEEDBACK_OUTBOX_META, JSON.stringify(next));
    return next;
  });
}

/**
 * `retry`: تُحفظ في الطابور عند الإرسال (بلا اتصال، 5xx، جلسة انتهت). `hold`: تبقى في الطابور عند
 * إعادة المحاولة — ومعها 429 (حدّ اليوم يزول غداً). ما عداهما رفض نهائي (0005 §٢٧٣).
 */
type SendResult =
  | { ok: true; row: FeedbackRow }
  | { ok: false; code: string; retry: boolean; hold: boolean; auth: boolean };

const AUTH = [401, 403];

/** الطابور للجهاز كله؛ كل مسودة تحمل صاحبها فلا تُرسل ولا تُعرض إلا له (0005 §٢٧٣). */
const ownedBy = (d: FeedbackDraft, userId: string | null) => !d.user_id || d.user_id === userId;

async function sendOne(d: FeedbackDraft): Promise<SendResult> {
  try {
    // صاحب المسودة للطابور المحلي وحده — لا يخرج من الجهاز
    const { user_id: _owner, ...body } = d;
    void _owner;
    const { data, error, response } = await api().POST("/api/support/feedback", { body });
    if (response.ok && data) return { ok: true, row: data as unknown as FeedbackRow };
    const code = (error as { detail?: unknown } | undefined)?.detail;
    const auth = AUTH.includes(response.status);
    const retry = response.status >= 500 || response.status === 408 || auth;
    return {
      ok: false,
      code: typeof code === "string" ? code : "server_error",
      retry,
      hold: retry || response.status === 429,
      auth,
    };
  } catch {
    return { ok: false, code: "offline", retry: true, hold: true, auth: false };
  }
}

/** 0005 §٢٦٧: لقطة شاشة اختيارية — صورة حتى 1.5 ميغابايت. */
const SHOT_MAX = 1.5 * 1024 * 1024;
const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

const ERRORS: Record<string, string> = {
  attachment_invalid: "اللقطة صورة PNG أو JPEG أو WebP حتى 1.5 ميغابايت.",
  text_required: "اكتب ملاحظتك أولاً.",
  text_too_long: "النص أطول من 1000 حرف.",
  rate_limited: "بلغت حدّ الملاحظات اليوم — جرّب غداً.",
  kind_invalid: "اختر نوع الملاحظة.",
};

/**
 * «ملاحظاتك» في SYS-11 (0005 §٢٦٤): أي دور يرسل اقتراحاً أو مشكلة أو رأياً إلى فريق فيزانو، ويرى
 * في «ملاحظاتي» حالتها وردّ الفريق. لا بيانات منشأة؛ الخادم يُخفي ما يشبه رقم هاتف. بلا اتصال تُحفظ
 * على الجهاز (`saved_local`) وتُرسل عند عودته.
 */
export function FeedbackSection({ screen = "SYS-11" }: { readonly screen?: string }) {
  const online = useOnline();
  const userId = useApp().session.userId;
  const [kind, setKind] = useState("suggestion");
  const [text, setText] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [shot, setShot] = useState<{ name: string; size: number; dataUrl: string } | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<FeedbackRow | null>(null);
  const [savedLocal, setSavedLocal] = useState(false);
  const [items, setItems] = useState<FeedbackRow[] | null>(null);
  const [pending, setPending] = useState<FeedbackDraft[]>([]);
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  failedRef.current = failed;
  const flushing = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data, response } = await api().GET("/api/support/feedback");
      if (!response.ok || !data) {
        // ردّ فاشل من الخادم: لا يبقى القسم «جارٍ التحميل» إلى الأبد
        setFailed(true);
        setItems((prev) => prev ?? []);
        return;
      }
      setFailed(false);
      const body = data as unknown as { items: FeedbackRow[]; unseen: number };
      setItems(body.items);
      if (body.unseen > 0) void api().POST("/api/support/feedback/seen");
    } catch {
      // تعذّر الوصول إلى الخادم والمتصفح يقول «متصل»: خطأ يُعاد، لا «لا ملاحظات بعد» (0005 §٢٧٤)
      setFailed(true);
      setItems((prev) => prev ?? []);
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const queue = await readOutbox();
      // ما خرج من الطابور: وصل، أو رفضه الخادم نهائياً
      const gone = new Set<string>();
      let delivered = false;
      for (const d of queue) {
        // مسودة مستخدم آخر على الجهاز نفسه تنتظر صاحبها
        if (!ownedBy(d, userId)) continue;
        const r = await sendOne(d);
        if (r.ok) {
          delivered = true;
          gone.add(d.client_id);
        } else if (!r.hold) gone.add(d.client_id);
        // بعد رفض الجلسة لا يُرسل ما بعدها
        else if (r.auth) break;
      }
      const left = gone.size
        ? await updateOutbox((q) => q.filter((d) => !gone.has(d.client_id)))
        : await readOutbox();
      setPending(left.filter((d) => ownedBy(d, userId)));
      if (delivered) await load();
    } finally {
      flushing.current = false;
    }
  }, [load, userId]);

  useEffect(() => {
    void (async () => {
      setPending((await readOutbox()).filter((d) => ownedBy(d, userId)));
      await load();
      await flush();
    })();
  }, [load, flush, userId]);

  useEffect(() => {
    if (!online) return;
    // عاد الاتصال: قائمة فشل تحميلها تُعاد مع إرسال الطابور
    if (failedRef.current) void load();
    void flush();
  }, [online, flush, load]);

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
      attachment: shot?.dataUrl ?? "",
      attachment_name: shot?.name ?? "",
      ...(userId ? { user_id: userId } : {}),
    };
    try {
      const r = await sendOne(draft);
      if (r.ok) {
        setSent(r.row);
        setText("");
        setShot(null);
        await load();
        return;
      }
      if (r.retry) {
        const queue = await updateOutbox((q) => [...q, draft]);
        setPending(queue.filter((d) => ownedBy(d, userId)));
        setSavedLocal(true);
        setText("");
        setShot(null);
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
              : failed
                ? "server_error"
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
          <Upload
            label="لقطة شاشة (اختياري)"
            accept={SHOT_TYPES.join(",")}
            constraintsText="صورة PNG أو JPEG أو WebP حتى 1.5 ميغابايت — قد تُظهر أسماء أو مبالغ، فراجعها قبل الإرسال؛ يراها فريق فيزانو وحده."
            items={
              shot
                ? [
                    {
                      id: "shot",
                      name: shot.name,
                      sizeLabel: `${Math.ceil(shot.size / 1024)} KB`,
                    },
                  ]
                : []
            }
            onFiles={(fs) => {
              const f = fs[0];
              if (!f) return;
              if (!SHOT_TYPES.includes(f.type) || f.size > SHOT_MAX) {
                setShot(null);
                setShotError(ERRORS.attachment_invalid ?? null);
                return;
              }
              setShotError(null);
              void readDataUrl(f).then((dataUrl) =>
                setShot({ name: f.name.slice(0, 120), size: f.size, dataUrl }),
              );
            }}
            onRemove={() => setShot(null)}
            error={shotError ?? undefined}
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
          {failed && online ? (
            <div className="acc-links">
              <Status state="server_error" />
              <Button variant="quiet" onClick={() => void load()}>
                أعد المحاولة
              </Button>
            </div>
          ) : null}
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
                {f.has_attachment ? <span className="acc-choice__note">مع لقطة شاشة</span> : null}
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
