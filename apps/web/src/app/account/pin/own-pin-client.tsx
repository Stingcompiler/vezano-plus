"use client";

import { type DeviceVerifiers, readVerifiers, storeVerifiers } from "@sting/sync-core";
import { Button, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/acc/own-pin.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "saving" | "success" | "server_error" | "offline";

/** طول الرمز — كما يعلنه الخادم (`PIN_LENGTH` في `core/auth/pin_views.py`). */
const PIN_LENGTH = 6;
const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

const TEXT = {
  pinError: "اكتب ستة أرقام بالضبط — أرقام فقط، بلا حروف ولا مسافات.",
  mismatch: "الرمزان مختلفان — أعد كتابة الرمز نفسه.",
  passwordMissing: "اكتب كلمة مرور دخولك لتأكيد أنك صاحب الحساب.",
  passwordInvalid: "كلمة المرور غير صحيحة — اكتب كلمة مرور دخولك إلى فيزانو بلص.",
};

/**
 * الأرقام العربية والفارسية تُقبل وتُحفظ لاتينية — لوحة مفاتيح الجوال العربية تكتبها هكذا.
 * كلتا السلسلتين تبدأ عند حدّ 16 (U+0660، U+06F0)، فالخانة الدنيا هي الرقم.
 */
const latinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

function detailOf(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error && typeof error.detail === "string")
    return error.detail;
  return "";
}

/** أين وصل الرمز بعد حفظه: نُزّل إلى هذا الجهاز الآن، أو يصل إلى الأجهزة عند اتصالها التالي. */
type Reach = "device" | "later" | "later_no_device";

interface Errors {
  readonly pin?: string | undefined;
  readonly confirm?: string | undefined;
  readonly password?: string | undefined;
}

/**
 * رمز PIN للقفل المحلي (ACC-07) — المستخدم يضبطه بنفسه بعد تأكيد كلمة مروره (0005 §١٧٤). قبله كان
 * الرمز يُضبط في البذر وحده، فالقفل لكل حساب حقيقي «لا رمز PIN محفوظ على هذا الجهاز».
 * - الحفظ خادمي لا محلي: كلمة المرور تُتحقَّق على الخادم، والمتحقق ينزل منه إلى أجهزة الفرع — فلا
 *   `saved_local`، والنجاح بعد تأكيد الخادم وحده؛ بلا اتصال يُقال ذلك ويُعطَّل الحفظ بسببه.
 * - متصفح مجهَّز بجلسة جهاز: تُعاد قراءة متحققات الجهاز وتُخزَّن فوراً فيعمل القفل بلا اتصال.
 */
export function OwnPinClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reach, setReach] = useState<Reach | null>(null);

  useEffect(() => {
    if (!app.tokens && !app.expired) router.replace("/login?next=%2Faccount%2Fpin");
  }, [app.tokens, app.expired, router]);

  /** بعد الحفظ: جلسة جهاز → متحققات الفرع من الخادم إلى المخزن المحلي؛ وإلا يصل عند الاتصال. */
  const refreshDevice = async (): Promise<Reach> => {
    const storage = getStorage();
    if (app.device) {
      try {
        const { data, response } = await api().GET("/api/devices/verifiers");
        if (response.ok && data) {
          const fresh: DeviceVerifiers = { ...data, fetched_at: new Date().toISOString() };
          await storeVerifiers(storage, fresh);
          if (fresh.verifiers.some((v) => v.user_id === app.session.userId)) return "device";
        }
      } catch {
        /* تعذّر التنزيل الآن: يصل عند الاتصال التالي */
      }
    }
    const local = await readVerifiers(storage).catch(() => null);
    return local ? "later" : "later_no_device";
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !online) return;
    const found: Errors = {
      pin: PIN_PATTERN.test(pin) ? undefined : TEXT.pinError,
      confirm: PIN_PATTERN.test(pin) && confirm !== pin ? TEXT.mismatch : undefined,
      password: password ? undefined : TEXT.passwordMissing,
    };
    setErrors(found);
    setFailed(false);
    setReach(null);
    if (found.pin || found.confirm || found.password) return;
    setBusy(true);
    try {
      const { error, response } = await api().POST("/api/account/pin", {
        body: { pin, password },
      });
      if (response.ok) {
        setReach(await refreshDevice());
        setPin("");
        setConfirm("");
        setPassword("");
        return;
      }
      const detail = detailOf(error);
      if (response.status === 403 && detail === "password_invalid") {
        setErrors({ password: TEXT.passwordInvalid });
        setPassword("");
        return;
      }
      if (response.status === 400 && detail === "pin_invalid") {
        setErrors({ pin: TEXT.pinError });
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const invalid = Boolean(errors.pin || errors.confirm || errors.password);
  // بلا اتصال يتقدّم على خطأ الخادم: السبب الحاضر هو الاتصال، وإعادة المحاولة تنتظره
  const state: State = busy
    ? "saving"
    : reach
      ? "success"
      : !online
        ? "offline"
        : failed
          ? "server_error"
          : invalid
            ? "validation_error"
            : "ready";

  return (
    <Frame title="رمز PIN" nav={<AppNav currentId="pin" />} footer={null}>
      <div className="acc-page" data-screen="ACC-PIN" data-state={state}>
        <form
          className="own-pin c-card c-card--hero c-enter"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          <div className="own-pin__head">
            <h2 className="own-pin__title">رمز PIN للقفل</h2>
            <p className="acc-lead">
              القفل المحلي يُفتح برمز من <span className="sting-mono">{PIN_LENGTH}</span> أرقام بدل
              كلمة المرور، ويعمل بلا اتصال. لا يُحفظ الرمز نفسه بل بصمةٌ منه، تصل إلى أجهزة فرعك.
            </p>
          </div>

          {state === "success" ? (
            <Notice kind="success" title="حُفظ رمزك">
              {reach === "device" ? (
                <>
                  <p className="acc-lead">
                    نُزّل إلى هذا الجهاز — القفل يُفتح به الآن، ولو بلا اتصال.
                  </p>
                  <div className="acc-links">
                    <Button
                      variant="secondary"
                      onClick={() => router.push("/lock?next=%2Faccount%2Fpin")}
                    >
                      جرّب القفل
                    </Button>
                  </div>
                </>
              ) : (
                <p className="acc-lead">
                  يصل إلى أجهزة فرعك المجهَّزة عند اتصالها التالي.
                  {reach === "later_no_device"
                    ? " هذا المتصفح لم يُجهَّز جهازاً، فلا قفل عليه قبل تجهيزه."
                    : null}
                </p>
              )}
            </Notice>
          ) : null}

          {state === "server_error" ? (
            <Notice kind="error" title="تعذّر حفظ الرمز">
              <p className="acc-lead">لم يتغيّر رمزك. أعد المحاولة بعد قليل.</p>
            </Notice>
          ) : null}

          {state === "offline" ? (
            <Notice kind="offline" title="ضبط الرمز يحتاج اتصالاً">
              <p className="acc-lead">
                كلمة المرور تُتحقَّق على الخادم، والرمز يصل منه إلى أجهزة فرعك. القفل الحالي يبقى
                كما هو حتى تتصل.
              </p>
            </Notice>
          ) : null}

          <div className="own-pin__fields">
            <TextField
              label="الرمز الجديد"
              kind="password"
              mono
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_LENGTH}
              hint="أرقام فقط. اختر رمزاً لا يعرفه غيرك."
              value={pin}
              error={errors.pin}
              onChange={(e) => setPin(latinDigits(e.target.value))}
            />
            <TextField
              label="أعد كتابة الرمز"
              kind="password"
              mono
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_LENGTH}
              value={confirm}
              error={errors.confirm}
              onChange={(e) => setConfirm(latinDigits(e.target.value))}
            />
            <TextField
              label="كلمة المرور الحالية"
              kind="password"
              autoComplete="current-password"
              hint="تأكيد أنك صاحب الحساب — الرمز يفتح جلستك على أجهزة الفرع."
              value={password}
              error={errors.password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="own-pin__submit">
            <Button
              type="submit"
              loading={busy}
              disabledReason={!online ? "يحتاج اتصالاً" : undefined}
            >
              احفظ الرمز
            </Button>
          </div>
        </form>
      </div>
    </Frame>
  );
}
