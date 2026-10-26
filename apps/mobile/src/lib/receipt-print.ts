import { formatMinorShort, formatQty } from "@sting/app-core";
import { type LocalSale, unitDisplay } from "@sting/sync-core";
import { tx } from "@sting/texts";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export interface ReceiptLine {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}

/** سطور الإيصال من البيع المحفوظ — الكميات والمبالغ لاتينية؛ نظير `receiptLines` في الويب. */
export function receiptLines(sale: LocalSale): ReceiptLine[] {
  const lines: ReceiptLine[] = sale.lines.map((l) => ({
    label: `${l.item_name} — ${formatQty(l.qty_milli, l.decimal_places as 0 | 1 | 2 | 3)
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "")} ${unitDisplay(l.unit_code)}`,
    value: formatMinorShort(l.line_total_minor),
  }));
  if (BigInt(sale.discount_minor) > 0n)
    lines.push({ label: "خصم", value: `−${formatMinorShort(sale.discount_minor)}` });
  lines.push({ label: "الإجمالي", value: formatMinorShort(sale.total_minor), strong: true });
  if (BigInt(sale.cash_minor) > 0n)
    lines.push({ label: "نقداً", value: formatMinorShort(sale.cash_minor) });
  if (BigInt(sale.credit_minor) > 0n)
    lines.push({ label: `آجل — ${sale.party_name}`, value: formatMinorShort(sale.credit_minor) });
  if (BigInt(sale.bank_minor) > 0n)
    lines.push({
      label: "تحويل بنكي — مسجَّل غير مطابق",
      value: formatMinorShort(sale.bank_minor),
    });
  return lines;
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** إيصال HTML بخط النظام واتجاه RTL، وسم «نسخة» لكل طبعة بعد الأولى و«محفوظ على الجهاز» حتى التأكيد. */
export function receiptHtml(opts: {
  shop: string;
  sale: LocalSale;
  copy: boolean;
  localOnly: boolean;
}): string {
  const rows = receiptLines(opts.sale)
    .map(
      (l) =>
        `<tr><td${l.strong ? ' style="font-weight:700"' : ""}>${esc(l.label)}</td><td dir="ltr" style="text-align:left;font-family:monospace${l.strong ? ";font-weight:700" : ""}">${esc(l.value)}</td></tr>`,
    )
    .join("");
  return `<html dir="rtl" lang="ar"><body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;max-width:380px">
<h2 style="text-align:center;margin:0">${esc(opts.shop || "—")}</h2>
<p style="text-align:center;margin:4px 0">${tx("POS-08", "فاتورة")} <span dir="ltr" style="font-family:monospace">${esc(opts.sale.invoice_number)}</span>${opts.copy ? ` — ${tx("POS-08", "نسخة")}` : ""}</p>
<table style="width:100%;border-collapse:collapse">${rows}</table>
${opts.localOnly ? `<p style="text-align:center;font-size:12px">${tx("POS-08", "محفوظ على الجهاز")}</p>` : ""}
</body></html>`;
}

/** يطبع عبر نظام الهاتف (AirPrint / خدمة الطباعة في أندرويد). يعيد false إن ألغى المستخدم أو فشل. */
export async function printReceipt(html: string): Promise<boolean> {
  try {
    await Print.printAsync({ html });
    return true;
  } catch {
    return false;
  }
}

/** مشاركة الإيصال ملف PDF (واتساب، بريد، حفظ). */
export async function shareReceipt(html: string): Promise<boolean> {
  try {
    const { uri } = await Print.printToFileAsync({ html });
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
    return true;
  } catch {
    return false;
  }
}
