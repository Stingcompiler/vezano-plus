import { CustomerClient } from "@/features/pos/customer-client";

/** عميل جديد من دفتر العملاء — نموذج الإنشاء نفسه (POS-04) بلا سياق البيع (فحص 2026-10-17 F12). */
export default function NewPartyPage() {
  return <CustomerClient mode="ledger" />;
}
