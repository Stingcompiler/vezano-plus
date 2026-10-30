import { Button, Dialog, Frame, Notice, Status } from "@sting/ui-web";
import { useEffect, useState } from "react";

import { AppNav } from "@/features/home/app-nav";
import { countLocalPending } from "@/features/home/home-cache";
import { useOnline } from "@/lib/online";

import {
  hideWindow,
  native,
  type NotifyPermission,
  onCloseRequested,
  quitApp,
} from "../platform/native";
import "./desk.css";

/**
 * DESK-05 إشعارات وإغلاق التطبيق (37-D29 ready · 09-D5 offline · 21-D16 permission_denied).
 * الإغلاق يُصغّر ولا يُنهي ما دام معلّق لم يُرفع؛ والإنهاء الحقيقي يسأل عن المعلّق أولاً.
 */
const GUARANTEES = [
  {
    tag: "مضمون",
    state: "success",
    title: "التطبيق مفتوح",
    body: "إشعار داخل التطبيق فوراً: تعارض مزامنة، رد مورد، وردية تحتاج إقفالاً.",
  },
  {
    tag: "مضمون",
    state: "success",
    title: "مفتوح في الخلفية",
    body: "إشعار نظام يظهر فوق النوافذ الأخرى، وينقلك للشاشة المعنية عند النقر.",
  },
  {
    tag: "غير مضمون",
    state: "stale",
    title: "التطبيق مُغلق كلياً",
    body: "لا نملك مساراً مثبتاً للوصول بعد الإغلاق الكامل على كل الأنظمة. لن نقول «ستصلك إشعارات دائماً». ما ينتظرك يظهر مجموعاً عند أول فتح، وللتنبيه العاجل يبقى الهاتف هو القناة.",
  },
] as const;

export function DeskNotifications() {
  const online = useOnline();
  const [perm, setPerm] = useState<NotifyPermission | null>(null);

  useEffect(() => {
    // الإذن يُطلب مرة عند أول زيارة — والرفض حالة مرسومة لا تُكرَّر بعدها
    void native
      .notifyPermission()
      .then((p) => (p === "default" ? native.requestNotify() : p))
      .then(setPerm);
  }, []);

  const state = perm === "denied" ? "permission_denied" : !online ? "offline" : "ready";

  return (
    <Frame title="إشعارات تطبيق الحاسوب" nav={<AppNav currentId="desk-notify" />} footer={null}>
      <div className="desk" data-screen="DESK-05" data-state={state}>
        {state === "permission_denied" ? (
          <Notice kind="error" title="لا وعد بإشعار بعد الإغلاق الكامل">
            ما دام التطبيق يعمل في الخلفية تصلك تنبيهات التشغيل. بعد الإغلاق الكامل لا نضمن وصول شيء
            — نقولها قبل الإغلاق لا بعده.
          </Notice>
        ) : null}
        {state === "offline" ? (
          <Notice kind="offline" title="تحديث متعذر وإشعار بعد الإغلاق — حدود صريحة">
            نسخة النظام أقدم من المطلوب، وتطبيق مُغلق كلياً لا يستقبل. الحد يُقال بصراحة بدل وعد لا
            نملك دليله.
          </Notice>
        ) : null}
        <div className="c-card desk__head">
          <div>
            <h2 className="desk__title">الإشعارات وسلوك الإغلاق</h2>
            <p className="desk__sub">
              إشعارات النظام مفعّلة، والإغلاق يُصغّر إلى شريط المهام ولا يُنهي التطبيق ما دامت وردية
              مفتوحة.
            </p>
          </div>
        </div>
        <section className="c-card">
          <ul className="desk__rows">
            {GUARANTEES.map((g) => (
              <li key={g.title}>
                <div>
                  <strong>{g.title}</strong>
                  <p>{g.body}</p>
                </div>
                <Status state={g.state} label={g.tag} dot={false} />
              </li>
            ))}
          </ul>
        </section>
        <div className="c-card desk__pad">
          <strong>لماذا لا يُنهي</strong>
          <p className="desk__sub">
            إنهاءٌ وعليه معلّق يوقف الرفع. نُصغّر ونُبقي المزامنة تعمل — والإنهاء الحقيقي يسأل عن
            المعلّق أولاً.
          </p>
        </div>
      </div>
    </Frame>
  );
}

/**
 * زر إغلاق النافذة (داخل Tauri): بلا معلّق يُغلق؛ ومع معلّق يُسأل — أبقِه في الخلفية أو أنهِ.
 * يُركَّب مرة في جذر التطبيق.
 */
export function CloseGuard() {
  const [pending, setPending] = useState(0);
  useEffect(
    () =>
      onCloseRequested(async () => {
        const n = await countLocalPending();
        if (n === 0) return true;
        setPending(n);
        return false;
      }),
    [],
  );
  return (
    <Dialog
      open={pending > 0}
      title="لا وعد بإشعار بعد الإغلاق الكامل"
      kind="confirm"
      primaryLabel="أبقِه في الخلفية"
      onPrimary={() => {
        setPending(0);
        void hideWindow();
      }}
      // Esc والإلغاء يُبقيان النافذة كما هي — الإنهاء فعلٌ صريح لا يقع بضغطة تائهة
      onClose={() => setPending(0)}
    >
      <p>
        إنهاءٌ وعليه معلّق يوقف الرفع (<span className="sting-mono">{pending}</span>). ما دام
        التطبيق يعمل في الخلفية تصلك تنبيهات التشغيل.
      </p>
      <Button variant="danger" onClick={() => void quitApp()}>
        إغلاق
      </Button>
    </Dialog>
  );
}
