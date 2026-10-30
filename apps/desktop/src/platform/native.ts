import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { inTauri } from "./tauri";

/**
 * قدرات المنصة لشاشات DESK. داخل Tauri: أوامر src-tauri وملحقاتها. في المتصفح (مواصفات Playwright على
 * بناء الحاسوب): بديل مزيّف تضبطه المواصفة عبر `window.__stingDesk` في التطوير وحده — كخطافات الويب
 * `__sting*` — فتُختبر كل حالة مرسومة بلا عتاد.
 */
export interface Printer {
  readonly name: string;
  readonly default: boolean;
}

export type SaveOutcome =
  | { readonly status: "saved"; readonly path: string }
  | { readonly status: "cancelled" }
  | { readonly status: "not_writable"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string };

export type NotifyPermission = "granted" | "denied" | "default";

export type UpdateCheck =
  | { readonly status: "none"; readonly current: string }
  | { readonly status: "available"; readonly current: string; readonly next: string }
  | { readonly status: "unsupported"; readonly current: string; readonly next: string };

export interface DesktopNative {
  listPrinters(): Promise<readonly Printer[]>;
  saveFile(suggestedName: string, bytes: Uint8Array): Promise<SaveOutcome>;
  revealFile(path: string): Promise<void>;
  notifyPermission(): Promise<NotifyPermission>;
  requestNotify(): Promise<NotifyPermission>;
  notify(title: string, body: string): Promise<void>;
  checkUpdate(): Promise<UpdateCheck>;
  /** ينزّل التحديث الموقَّع ويثبّته ثم يعيد تشغيل التطبيق */
  installUpdate(): Promise<void>;
  /** ESC/POS خام إلى طابعة النظام باسمها، أو إلى عنوان شبكي (IP[:منفذ]) */
  printRaw(target: PrintTarget, bytes: Uint8Array): Promise<void>;
}

export type PrintTarget = { readonly printer: string } | { readonly address: string };

export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

const tauriNative: DesktopNative = {
  listPrinters: () => invoke<Printer[]>("list_printers"),
  async saveFile(suggestedName, bytes) {
    const path = await save({ defaultPath: suggestedName });
    if (!path) return { status: "cancelled" };
    return invoke<SaveOutcome>("save_bytes", { path, bytes: Array.from(bytes) });
  },
  revealFile: (path) => revealItemInDir(path),
  async notifyPermission() {
    return (await isPermissionGranted()) ? "granted" : "default";
  },
  requestNotify: () => requestPermission(),
  notify(title, body) {
    sendNotification({ title, body });
    return Promise.resolve();
  },
  // المحدِّث الموقَّع (ط٦): latest.json من إصدارات GitHub، والتحقق بالمفتاح العام المبني في التطبيق.
  // بلا محدِّث مسجَّل (بناء بلا مفتاح) أو بلا شبكة: لا تحديث يُعلَن
  async checkUpdate() {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const u = await check({ timeout: 2000 });
      return u
        ? { status: "available", current: u.currentVersion, next: u.version }
        : { status: "none", current: APP_VERSION };
    } catch {
      return { status: "none", current: APP_VERSION };
    }
  },
  async installUpdate() {
    const { check } = await import("@tauri-apps/plugin-updater");
    const { relaunch } = await import("@tauri-apps/plugin-process");
    const u = await check();
    if (!u) return;
    await u.downloadAndInstall();
    await relaunch();
  },
  printRaw: (target, bytes) =>
    "printer" in target
      ? invoke<void>("print_raw", { printer: target.printer, bytes: Array.from(bytes) })
      : invoke<void>("print_network", { address: target.address, bytes: Array.from(bytes) }),
};

/** ما تضبطه المواصفة؛ القيم الافتراضية = جهاز سويّ. */
export interface DeskFake {
  printers?: Printer[];
  printersFail?: boolean;
  save?: SaveOutcome[];
  permission?: NotifyPermission;
  update?: UpdateCheck;
  updateDelayMs?: number;
  notified?: { title: string; body: string }[];
  revealed?: string[];
  /** ما أُرسل للطابعة، ونتيجة الإرسال التالي (false = فشل) */
  printed?: { target: PrintTarget; size: number }[];
  printOk?: boolean[];
  installed?: boolean;
  /** يفعّل اعتراض التنزيل (DESK-04) في المتصفح */
  downloads?: boolean;
}

declare global {
  interface Window {
    __stingDesk?: DeskFake;
  }
}

const fake = (): DeskFake => (window.__stingDesk ??= {});

const browserNative: DesktopNative = {
  listPrinters: () =>
    fake().printersFail
      ? Promise.reject(new Error("printers_failed"))
      : Promise.resolve(fake().printers ?? [{ name: "XP-80C", default: true }]),
  saveFile(suggestedName) {
    const next = fake().save?.shift();
    return Promise.resolve(
      next ?? { status: "saved", path: `/Users/me/Documents/${suggestedName}` },
    );
  },
  revealFile(path) {
    (fake().revealed ??= []).push(path);
    return Promise.resolve();
  },
  notifyPermission: () => Promise.resolve(fake().permission ?? "granted"),
  requestNotify: () => Promise.resolve(fake().permission ?? "granted"),
  notify(title, body) {
    (fake().notified ??= []).push({ title, body });
    return Promise.resolve();
  },
  installUpdate() {
    fake().installed = true;
    return Promise.resolve();
  },
  printRaw(target, bytes) {
    (fake().printed ??= []).push({ target, size: bytes.length });
    const ok = fake().printOk?.shift() ?? true;
    return ok ? Promise.resolve() : Promise.reject(new Error("printer_offline"));
  },
  checkUpdate: () =>
    new Promise((res) =>
      setTimeout(
        () => res(fake().update ?? { status: "none", current: APP_VERSION }),
        fake().updateDelayMs ?? 0,
      ),
    ),
};

export const native: DesktopNative = inTauri ? tauriNative : browserNative;

/** إغلاق النافذة (DESK-05): داخل Tauri يُعترض زر الإغلاق؛ في المتصفح لا شيء. */
export function onCloseRequested(handler: () => Promise<boolean>): () => void {
  if (!inTauri) return () => undefined;
  const win = getCurrentWindow();
  let off: (() => void) | null = null;
  void win
    .onCloseRequested(async (e) => {
      if (!(await handler())) e.preventDefault();
    })
    .then((u) => (off = u));
  return () => off?.();
}

export async function hideWindow(): Promise<void> {
  if (inTauri) await getCurrentWindow().hide();
}

export async function quitApp(): Promise<void> {
  if (inTauri) await getCurrentWindow().destroy();
}
