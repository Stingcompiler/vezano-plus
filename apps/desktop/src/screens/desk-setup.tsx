import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { AppNav } from "@/features/home/app-nav";
import { countLocalPending } from "@/features/home/home-cache";
import { hasDeviceRegistration } from "@/lib/device-session";

import { native, type UpdateCheck } from "../platform/native";
import { loadChoice } from "../platform/print-queue";
import "./desk.css";

/**
 * DESK-01 إعداد أول تشغيل وتحديث (37-D29 ready/loading/success · 09-D5 server_error).
 * ثلاث خطوات لا يمنع أيٌّ منها البيع لو أُجّل؛ وفحص التحديث لا يتجاوز ثانيتين ثم يُكمل في الخلفية.
 * ربط الجهاز بالمنشأة في هذا النظام بالدخول (ACC-05) لا برمز — فحالة «رمز الربط غير صالح» تغطّيها
 * حالات ACC-05 نفسها (0005 §٢٠٨).
 */
const BOOT_LIMIT_MS = 2000;

export function DeskSetup() {
  const navigate = useNavigate();
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [linked, setLinked] = useState(false);
  const [printer, setPrinter] = useState(false);
  const [pending, setPending] = useState(0);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let alive = true;
    const limit = setTimeout(() => alive && setChecking(false), BOOT_LIMIT_MS);
    void native.checkUpdate().then((u) => {
      if (!alive) return;
      setUpdate(u);
      setChecking(false);
    });
    void hasDeviceRegistration().then((r) => alive && setLinked(r));
    void loadChoice().then((c) => alive && setPrinter(Boolean(c?.receipts)));
    void countLocalPending().then((n) => alive && setPending(n));
    return () => {
      alive = false;
      clearTimeout(limit);
    };
  }, []);

  const ready = linked && printer;
  const state = checking
    ? "loading"
    : update?.status === "unsupported"
      ? "server_error"
      : ready
        ? "success"
        : "ready";

  return (
    <Frame title="إعداد أول تشغيل وتحديث" nav={<AppNav currentId="update" />} footer={null}>
      <div className="desk" data-screen="DESK-01" data-state={state}>
        {state === "loading" ? (
          <Notice kind="info" title="جارٍ التحقق من التحديثات">
            فحصٌ سريع عند الإقلاع، ولا يحجب الواجهة.
          </Notice>
        ) : null}
        {update?.status === "unsupported" ? (
          <>
            <Notice kind="error" title={`التحديث ${update.next} لا يمكن تثبيته على هذا الجهاز`}>
              يتطلب نظاماً أحدث من المثبَّت هنا. نسختك الحالية{" "}
              <span className="sting-mono">{update.current}</span> تعمل ولن نوقفها.
            </Notice>
            <dl className="c-card desk__rows desk__facts">
              <div>
                <dt>نسختك الحالية</dt>
                <dd className="sting-mono">{update.current}</dd>
              </div>
              <div>
                <dt>النسخة الجديدة</dt>
                <dd className="sting-mono">{update.next}</dd>
              </div>
              <div>
                <dt>يتطلب نظاماً</dt>
                <dd>أحدث من المثبَّت</dd>
              </div>
              <div>
                <dt>حالة المزامنة على {update.current}</dt>
                <dd>مدعومة</dd>
              </div>
            </dl>
            <Notice kind="warning" title="نسختك تستمر في العمل والمزامنة.">
              لو توقف دعم بروتوكول المزامنة لهذه النسخة مستقبلاً سنخبرك قبل شهر على الأقل، وسيبقى
              تصدير نسخة محلية متاحاً في كل الحالات.
            </Notice>
            <div className="desk__actions">
              <Button
                variant="primary"
                onClick={() => setUpdate({ status: "none", current: update.current })}
              >
                {`متابعة على ${update.current}`}
              </Button>
            </div>
          </>
        ) : null}
        {update?.status === "available" ? (
          <Notice
            kind="info"
            title="التحديث التلقائي مُعلن"
            action={
              // لا تحديث فوق معلّق لم يُرفع — كما في SYS-09 على الويب (الترحيل قد يحتاج تدخّلاً)
              <Button
                variant="primary"
                loading={installing}
                disabledReason={pending > 0 ? "حدّث بعد رفع المعلّق" : undefined}
                onClick={() => {
                  setInstalling(true);
                  void native.installUpdate().finally(() => setInstalling(false));
                }}
              >
                تحديث التطبيق
              </Button>
            }
          >
            يُعلَن هنا مع إمكان تأجيله. تطبيقٌ يُحدّث نفسه في منتصف يوم بيعٍ مزدحم عدوٌّ لا خادم.{" "}
            <span className="sting-mono">{update.next}</span>
          </Notice>
        ) : null}
        {state === "success" ? (
          <Notice kind="success" title="الجهاز جاهز">
            موصولٌ بالمنشأة والفرع، والطابعة مختارة، والاختصارات مفعّلة.
          </Notice>
        ) : null}
        {state !== "server_error" ? (
          <section className="c-card">
            <div className="desk__head">
              <div>
                <h2 className="desk__title">أول تشغيل</h2>
                <p className="desk__sub">
                  ثلاث خطوات: الاتصال بالمنشأة، ثم الطابعة، ثم الاختصارات. ولا شيء منها يمنع البيع
                  لو أُجّل.
                </p>
              </div>
            </div>
            <ul className="desk__rows">
              {(
                [
                  ["الاتصال بالمنشأة", linked, "/setup-device"],
                  ["الطابعة", printer, "/desktop/printers"],
                  ["الاختصارات", true, "/desktop/shortcuts"],
                ] as const
              ).map(([label, done, href]) => (
                <li key={label}>
                  <strong>{label}</strong>
                  {done ? (
                    <Status state="success" label="جاهز" />
                  ) : (
                    <Button variant="secondary" onClick={() => void navigate(href)}>
                      {label}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {state === "success" ? (
          <div className="desk__actions">
            <Button variant="primary" onClick={() => void navigate("/desktop/printers")}>
              اطبع إيصالاً تجريبياً
            </Button>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}
