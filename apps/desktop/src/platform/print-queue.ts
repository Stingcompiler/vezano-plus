import { getStorage } from "@/lib/storage";

/**
 * طابور الطباعة المحلي (DESK-02): ما لم يُطبع بعد وما فشل. محفوظ في قاعدة الجهاز فلا يضيع بإغلاق
 * التطبيق. إعادة الطباعة نسخة موسومة لا بيع جديد (ACC-84) — الطابور لا يلمس الفواتير.
 * تملؤه الطباعة الأصلية (ط٥)؛ في المتصفح تضبطه المواصفة عبر `__stingDesk.queue`.
 */
export interface PrintJob {
  readonly id: string;
  readonly name: string;
  readonly ref: string;
  readonly copy: boolean;
  readonly source: string;
  readonly at: string;
  readonly state: "waiting" | "failed";
  readonly effect: string;
  /** البتّات المرسلة (base64) والوجهة — لإعادة الطباعة نفسها بلا إعادة بناء */
  readonly bytes?: string;
  readonly target?: import("./native").PrintTarget;
}

const KEY = "desktop.print_queue";

declare global {
  interface Window {
    __stingDeskQueue?: PrintJob[];
  }
}

export async function listQueue(): Promise<PrintJob[]> {
  if (window.__stingDeskQueue) return window.__stingDeskQueue;
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(KEY));
    return raw ? (JSON.parse(raw) as PrintJob[]) : [];
  } catch {
    return [];
  }
}

export async function saveQueue(jobs: PrintJob[]): Promise<void> {
  if (window.__stingDeskQueue) {
    window.__stingDeskQueue = jobs;
    return;
  }
  await getStorage().transaction((tx) => tx.putMeta(KEY, JSON.stringify(jobs)));
}

export async function addJob(job: PrintJob): Promise<void> {
  await saveQueue([...(await listQueue()), job]);
}

export const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function clearQueue(): Promise<void> {
  if (window.__stingDeskQueue) {
    window.__stingDeskQueue = [];
    return;
  }
  await getStorage().transaction((tx) => tx.putMeta(KEY, "[]"));
}

/** اختيار الطابعة لكل نوع مستند — لا للنظام كلّه (DESK-02 «طابعتان»). */
export interface PrinterChoice {
  readonly receipts: string;
  readonly reports: string;
  readonly networkIp: string;
}
const CHOICE = "desktop.printers";

export async function loadChoice(): Promise<PrinterChoice | null> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(CHOICE));
    return raw ? (JSON.parse(raw) as PrinterChoice) : null;
  } catch {
    return null;
  }
}

export async function saveChoice(c: PrinterChoice): Promise<void> {
  await getStorage().transaction((tx) => tx.putMeta(CHOICE, JSON.stringify(c)));
}
