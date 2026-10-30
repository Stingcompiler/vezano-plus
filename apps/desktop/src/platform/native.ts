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
}

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
  // المحدِّث الموقَّع يصل في ط٦ (مفتاح التوقيع ومصدر الإصدارات) — حتى ذلك لا تحديث يُعلَن
  checkUpdate: () => Promise.resolve({ status: "none", current: APP_VERSION }),
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
