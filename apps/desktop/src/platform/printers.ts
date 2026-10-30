/**
 * بديل `@/lib/print/printers` في تطبيق الحاسوب: الإيصال (POS-08/11) يُرسل ESC/POS خاماً إلى طابعة
 * الإيصالات المختارة في DESK-02 — بلا حوار — والفشل يدخل طابور الطباعة بحالته وأثره (لا أثر على
 * الدفتر). بلا طابعة مختارة يبقى سلوك الويب: «system» فيطبع بحوار النظام. خارج Tauri: الويب كما هو.
 */
import { renderCanvas, toEscPos } from "@/lib/print/raster";

import * as web from "../../../web/src/lib/print/printers";
import { native, type PrintTarget } from "./native";
import { addJob, loadChoice, toBase64 } from "./print-queue";
import { inTauri } from "./tauri";

export * from "../../../web/src/lib/print/printers";

/** يُفعَّل في المتصفح بطلب المواصفة (`__stingDesk.nativePrint`) — كي لا يتغيّر سلوك مواصفات الويب */
const active = () =>
  inTauri ||
  Boolean(
    (window as unknown as { __stingDesk?: { nativePrint?: boolean } }).__stingDesk?.nativePrint,
  );

export async function printReceiptOnDevice(
  doc: web.ReceiptDoc,
): Promise<"printed" | "failed" | "unknown" | "system"> {
  if (!active()) return web.printReceiptOnDevice(doc);
  const choice = await loadChoice();
  const target: PrintTarget | null = choice?.receipts
    ? { printer: choice.receipts }
    : choice?.networkIp
      ? { address: choice.networkIp }
      : null;
  if (!target) return web.printReceiptOnDevice(doc);
  const width = await web.receiptWidth();
  const bytes = toEscPos(
    renderCanvas({
      width,
      lines: [
        { text: doc.shopName, align: "center", size: 28, bold: true },
        ...(doc.copy ? [{ text: "نسخة", align: "center" as const, bold: true }] : []),
        { text: `${doc.title} #${doc.number}`, align: "center" },
        { text: doc.dateLabel, align: "center" },
        ...doc.lines.map((l) => ({ text: l.label, value: l.value, bold: l.strong ?? false })),
        ...(doc.footer ? [{ text: doc.footer, align: "center" as const }] : []),
      ],
    }),
  );
  try {
    await native.printRaw(target, bytes);
    return "printed";
  } catch {
    await addJob({
      id: `${doc.number}-${Date.now()}`,
      name: doc.title,
      ref: doc.number,
      copy: doc.copy,
      source: doc.dateLabel,
      at: new Date().toISOString(),
      state: "failed",
      effect: "لا أثر على الدفتر.",
      bytes: toBase64(bytes),
      target,
    });
    return "failed";
  }
}
