"use client";

import {
  Button,
  Frame,
  Notice,
  RadioGroupField,
  Status,
  TextAreaField,
  TextField,
} from "@sting/ui-web";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/sys/sys.css";
import "./public.css";
import "./demo-track.css";
import { postJson } from "@/features/public/demo-api";
import { PublicFooter } from "@/features/public/public-footer";
import { PublicHeader } from "@/features/public/public-header";

const TEXT_MAX = 600;

const ERRORS: Record<string, string> = {
  text_required: "اكتب ملاحظتك أولاً.",
  text_too_long: "النص أطول من 600 حرف.",
  email_invalid: "البريد غير صحيح — أو اتركه فارغاً.",
  shop_unknown: "لم نعرف المحل — افتح هذه الصفحة من صفحة المحل نفسها.",
  rate_limited: "أرسلت ملاحظات كثيرة الآن — جرّب بعد ساعة.",
  kind_invalid: "اختر نوع الملاحظة.",
};

/**
 * PUB-07 — «أرسل ملاحظة» (0005 §٢٦٦): زائر بلا حساب يرسل اقتراحاً للمنصة أو مشكلة في الموقع أو ملاحظة
 * عن محل (من صفحة المحل `?shop=`). **خاصة بفريق فيزانو** — لا تُنشر ولا تُرسل إلى المحل. البريد اختياري
 * للردّ. حقل `website` فخّ مخفي عن البشر.
 */
export function PublicFeedbackClient() {
  const params = useSearchParams();
  const shop = (params.get("shop") ?? "").trim().toLowerCase();
  const [kind, setKind] = useState(shop ? "shop" : "platform");
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const kinds = [
    { value: "platform", label: "اقتراح للمنصة" },
    { value: "site", label: "مشكلة في الموقع" },
    ...(shop ? [{ value: "shop", label: "ملاحظة عن هذا المحل" }] : []),
  ];

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) return setErr(ERRORS.text_required ?? null);
    if (trimmed.length > TEXT_MAX) return setErr(ERRORS.text_too_long ?? null);
    setBusy(true);
    setErr(null);
    setFailed(false);
    try {
      const r = await postJson<{ reference: string }>("/api/public/feedback", {
        kind,
        text: trimmed,
        email: email.trim(),
        shop: kind === "shop" ? shop : "",
        page: shop ? `/portal/${shop}` : "/feedback",
        website: trap,
      });
      const body = r.body as { reference?: string; detail?: string };
      if (r.ok && body.reference) {
        setReference(body.reference);
        setText("");
        return;
      }
      if (r.status >= 500) setFailed(true);
      else setErr(ERRORS[body.detail ?? ""] ?? "لم تُقبل الملاحظة — راجع النص وأعد الإرسال.");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const state = reference
    ? "success"
    : failed
      ? "server_error"
      : err
        ? "validation_error"
        : "ready";

  return (
    <Frame
      title="فيزانو بلص"
      back={false}
      chrome={<PublicHeader cta="login" />}
      footer={<PublicFooter inFrame compact />}
    >
      <div className="sys pub dt" data-screen="PUB-07" data-state={state}>
        <form
          className="dt__card c-card c-card--hero"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          <div className="dt__head">
            <span className="dt__kicker">ملاحظات الجمهور</span>
            <h1 className="dt__title">أرسل ملاحظة</h1>
            <p className="dt__lead">
              اقتراح للمنصة أو مشكلة في الموقع أو ملاحظة عن محل — تصل إلى فريق فيزانو وحده، ولا
              تُنشر.
            </p>
          </div>

          {reference ? (
            <Notice kind="success" title="وصلت ملاحظتك">
              <p className="acc-lead">
                المرجع: <span className="sting-mono">{reference}</span> · شكراً لك. إن تركت بريدك
                فقد يردّ عليك الفريق.
              </p>
            </Notice>
          ) : (
            <>
              {failed ? (
                <Notice kind="error" title="لم تُرسل الملاحظة">
                  <p className="acc-lead">تعذّر الوصول إلى الخادم — أعد المحاولة بعد قليل.</p>
                </Notice>
              ) : null}
              <RadioGroupField
                label="نوع الملاحظة"
                name="public-feedback-kind"
                value={kind}
                onChange={setKind}
                options={kinds}
              />
              <TextAreaField
                label="ملاحظتك"
                hint="لا تكتب أرقام هواتف أو روابط — تُحذف تلقائياً."
                value={text}
                maxLength={TEXT_MAX}
                rows={5}
                error={err ?? undefined}
                onChange={(ev) => {
                  setText(ev.target.value);
                  if (err) setErr(null);
                }}
              />
              <TextField
                label="بريدك (اختياري)"
                hint="للردّ عليك فقط — لا نرسل إليه شيئاً آخر."
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
              <div className="pub-trap" aria-hidden="true">
                <label>
                  website
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={trap}
                    onChange={(ev) => setTrap(ev.target.value)}
                  />
                </label>
              </div>
              <div className="acc-actions">
                <Button type="submit" pos loading={busy}>
                  أرسل الملاحظة
                </Button>
              </div>
            </>
          )}
          {state === "success" ? (
            <Status state="success" label="خاصة بفريق فيزانو — لا تُنشر ولا تُرسل إلى المحل" />
          ) : null}
        </form>
      </div>
    </Frame>
  );
}
