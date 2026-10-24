/** أشكال ردود `/api/market/orders*` كما يقرؤها الويب (الحقول المطلوبة للعرض فقط). */

export interface Order {
  id: string;
  op_id: string;
  number: number;
  number_label: string;
  kind: "order" | "quote";
  kind_label: string;
  status: string;
  status_label: string;
  version: number;
  supplier_tenant_id: string;
  supplier_name: string;
  currency: string;
  lines: {
    offer_id: string;
    public_name: string;
    pack_label: string;
    unit_name: string;
    qty: number;
    price_minor: string;
  }[];
  lines_count: number;
  total_minor: string;
  delivery_to: string;
  fees_label: string;
  response_hours: number;
  deadline_at: string;
  sent_at: string;
  updated_at: string;
}

export interface OrderRow extends Order {
  no_reply: boolean;
  near_deadline: boolean;
  remaining_hours: number;
  content_line: string;
  buyer_step: string;
  supplier_step: string;
  flagged: boolean;
  list_status_label: string;
  buyer_name: string;
  shipped_percent?: number;
  remaining_cancelled?: boolean;
  cancel_reason?: string;
  reconciling?: boolean;
  restore_point?: string;
  paid_minor?: string;
}

export interface VerifiedLine {
  offer_id: string;
  seller_tenant_id?: string;
  seller_name?: string;
  public_name?: string;
  pack_label?: string;
  unit_name: string;
  qty: number;
  draft_price_minor: string;
  current_price_minor: string;
  changed: boolean;
  expired: boolean;
  status: "confirmed" | "expired" | "withdrawn";
  confirmed_at?: string;
  valid_until?: string;
  min_order_qty: number | null;
  short: number;
  fees_decided?: boolean;
  fees_label?: string;
  currency?: string;
  supplier_suspended?: boolean;
}

export interface VersionLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  qty_requested: number;
  qty_confirmed: number | null;
  price_minor: string;
  increase_reason: string;
}

export interface Version {
  id: string;
  number: number;
  kind: "request" | "quote" | "revision";
  kind_label: string;
  author_side: "buyer" | "supplier";
  lines: VersionLine[];
  delivery_fee_minor: string;
  delivery_days: number | null;
  valid_until: string;
  rejected_at: string;
  note: string;
  summary: string;
  draft: boolean;
  sent_at: string;
  accepted_at: string;
  is_agreement: boolean;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  kind: string;
  side: string;
  title: string;
  detail: string;
  ref_label: string;
  at: string;
}

export interface LadderRow {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested: number;
  confirmed: number | null;
  shipped: number;
  received: number;
  gap: number;
  price_minor: string;
  status: string;
}

export interface Detail {
  order: OrderRow;
  side: "buyer" | "supplier";
  versions: Version[];
  events: OrderEvent[];
  agreed_version: number | null;
  latest_version: number;
  conflict: boolean;
  partial: boolean;
  ladder: LadderRow[];
  received_value_minor: string;
  gap_value_minor: string;
  ladder_rule: string;
  open_disputes?: string[];
}
