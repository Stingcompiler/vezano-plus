import { type LocalSale, readSales } from "@sting/sync-core";

import { getStorage } from "@/lib/storage";

export type RowSync = "local" | "pending" | "synced" | "reversed";
export type Range = "today" | "week";

/** صف فاتورة: محلي (بحالة عمليته) أو خادمي — نظير `Row` في `invoices-client.tsx`. */
export interface InvoiceRow {
  readonly id: string;
  readonly number: string;
  readonly occurredAt: string;
  readonly partyName: string;
  readonly totalMinor: string;
  readonly sync: RowSync;
  readonly dateSuspect: boolean;
  readonly source: "local" | "server";
}

export interface ServerSale {
  readonly id: string;
  readonly invoice_number: string;
  readonly party_name: string;
  readonly total_minor: string;
  readonly occurred_at: string;
  readonly date_suspect: boolean;
  readonly sync_state: "synced" | "reversed";
}

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** جودة التاريخ محلياً (ACC-77): ساعة الجهاز في يوم غير يوم أعمال الوردية. */
export function localDateSuspect(s: LocalSale): boolean {
  const d = new Date(s.occurred_at);
  const bd = new Date(`${s.business_date}T00:00:00`);
  return Math.abs(dayOf(d) - dayOf(bd)) > 86_400_000;
}

export async function localInvoiceRows(): Promise<InvoiceRow[]> {
  const storage = await getStorage();
  const sales = await readSales(storage);
  const out: InvoiceRow[] = [];
  for (const s of sales) {
    const op = await storage.read((t) => t.getOperation(s.operation_id));
    const st = op?.state ?? "local";
    out.push({
      id: s.id,
      number: s.invoice_number,
      occurredAt: s.occurred_at,
      partyName: s.party_name,
      totalMinor: s.total_minor,
      sync: st === "synced" ? "synced" : st === "pending" ? "pending" : "local",
      dateSuspect: localDateSuspect(s),
      source: "local",
    });
  }
  return out;
}

export const serverInvoiceRow = (s: ServerSale): InvoiceRow => ({
  id: s.id,
  number: s.invoice_number,
  occurredAt: s.occurred_at,
  partyName: s.party_name,
  totalMinor: s.total_minor,
  sync: s.sync_state,
  dateSuspect: s.date_suspect,
  source: "server",
});

/** «اليوم» / «أمس» / تاريخ رقمي لاتيني مختصر (الكلمة عربية والرقم mono في موضع العرض). */
export function dayLabel(iso: string, now = new Date()): { word: string | null; n: string } {
  const d = new Date(iso);
  const diff = Math.round((dayOf(now) - dayOf(d)) / 86_400_000);
  if (diff === 0) return { word: "اليوم", n: "" };
  if (diff === 1) return { word: "أمس", n: "" };
  return {
    word: null,
    n: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
  };
}
