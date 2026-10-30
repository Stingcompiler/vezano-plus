import { Button, Dialog } from "@sting/ui-web";
import { useEffect, useState } from "react";

import { native, type SaveOutcome } from "./native";
import { inTauri } from "./tauri";
import "../screens/desk.css";

/**
 * DESK-04 حوار حفظ واستعادة ملف (37-D29 ready/validation_error/success · 12-D7 server_error).
 * شاشات الويب تحفظ بـ`<a download href="blob:…">` (التقارير، النسخة الاحتياطية، السجل…). داخل Tauri
 * يُعترض ذلك هنا: حوار النظام نفسه باسم الملف المقترح، ثم النتيجة بمسارها — بلا تعديل في شاشات الويب.
 * الفشل لا يبتلع شيئاً: الملف ما زال في الذاكرة و«إعادة المحاولة» بالإعدادات نفسها.
 */
interface Pending {
  readonly name: string;
  readonly bytes: Uint8Array;
}

type View =
  | { readonly kind: "idle" }
  | { readonly kind: "result"; readonly file: Pending; readonly outcome: SaveOutcome };

const listeners = new Set<(p: Pending) => void>();
/** طلب حفظ قبل تركيب المضيف (أول رسم) يُحفظ حتى يُركَّب — لا يضيع ملف */
const early: Pending[] = [];

/** يحفظ ملفاً عبر حوار النظام ويعرض النتيجة — يستدعيه اعتراض التنزيل أو أي شاشة حاسوب. */
export function requestSave(name: string, bytes: Uint8Array): void {
  if (listeners.size === 0) early.push({ name, bytes });
  for (const l of listeners) l({ name, bytes });
}

export function installDownloads(): void {
  document.addEventListener(
    "click",
    (e) => {
      if (!shouldInterceptDownloads()) return;
      const a = (e.target as Element | null)?.closest?.("a[download]");
      if (!(a instanceof HTMLAnchorElement) || !a.href.startsWith("blob:")) return;
      e.preventDefault();
      e.stopPropagation();
      const name = a.getAttribute("download") || "vezano-export";
      void fetch(a.href)
        .then((r) => r.arrayBuffer())
        .then((buf) => requestSave(name, new Uint8Array(buf)));
    },
    true,
  );
  // الشاشات تنشئ الرابط وتنقره برمجياً (a.click()) — يمرّ بالمستمع نفسه لأنه حدث click حقيقي على المستند
  // eslint-disable-next-line @typescript-eslint/unbound-method -- يُستدعى بـcall على العنصر نفسه
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    if (
      shouldInterceptDownloads() &&
      this.hasAttribute("download") &&
      this.href.startsWith("blob:") &&
      !this.isConnected
    ) {
      document.body.appendChild(this);
      orig.call(this);
      this.remove();
      return;
    }
    orig.call(this);
  };
}

const REASON: Record<string, string> = {
  permission: "المجلد بلا إذن كتابة",
  missing: "مسار غير موجود",
  full: "قرص ممتلئ",
};

export function FileSaveHost() {
  const [view, setView] = useState<View>({ kind: "idle" });

  const run = async (file: Pending) => {
    const outcome = await native.saveFile(file.name, file.bytes);
    if (outcome.status !== "cancelled") setView({ kind: "result", file, outcome });
  };

  useEffect(() => {
    const l = (p: Pending) => void run(p);
    listeners.add(l);
    for (const p of early.splice(0)) l(p);
    return () => void listeners.delete(l);
  }, []);

  if (view.kind === "idle") return null;
  const { outcome, file } = view;
  const close = () => setView({ kind: "idle" });
  const state =
    outcome.status === "saved"
      ? "success"
      : outcome.status === "not_writable"
        ? "validation_error"
        : "server_error";

  return (
    <>
      <Dialog
        open
        kind="info"
        title={
          outcome.status === "saved"
            ? "حُفظ"
            : outcome.status === "not_writable"
              ? "الوجهة غير قابلة للكتابة"
              : "فشل حفظ الملف — وإعداداتك محفوظة"
        }
        onClose={close}
        cancelLabel="إغلاق"
      >
        <div data-screen="DESK-04" data-state={state}>
          {outcome.status === "saved" ? (
            <>
              <p>المسار كاملاً و«افتح المجلّد». الملف الذي لا يُعرف مكانه ضائعٌ فعلياً.</p>
              <p dir="ltr" className="desk__path">
                {outcome.path}
              </p>
              <Button variant="secondary" onClick={() => void native.revealFile(outcome.path)}>
                افتح المجلّد
              </Button>
            </>
          ) : outcome.status === "not_writable" ? (
            <>
              <p>مجلّد للقراءة فقط أو ملف مفتوح في برنامج آخر. {REASON[outcome.reason] ?? ""}</p>
              <p>ما كتبته لم يُفقد: التقرير ما زال معروضاً ومعدّاً للحفظ.</p>
              <Button variant="primary" onClick={() => void run(file)}>
                اختيار مجلد آخر
              </Button>
            </>
          ) : outcome.status === "failed" ? (
            <>
              <p>لم نفقد شيئاً من اختياراتك. {REASON[outcome.reason] ?? ""}</p>
              <Button variant="primary" onClick={() => void run(file)}>
                إعادة المحاولة
              </Button>
            </>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

/** في المتصفح (المواصفات) يُفعَّل الاعتراض بطلب صريح من المواصفة — كي لا يتغيّر سلوك تنزيل الويب */
export const shouldInterceptDownloads = () => inTauri || Boolean(window.__stingDesk?.downloads);
