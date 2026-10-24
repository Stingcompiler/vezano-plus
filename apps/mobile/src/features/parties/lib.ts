import type { LocalParty, ServerParty } from "@sting/sync-core";

/** ردّ `GET /api/parties/list`. */
export interface ListData {
  readonly kind: "customers" | "suppliers";
  readonly can_see_balances: boolean;
  readonly role_name: string;
  readonly as_of: string;
  readonly rows: readonly ServerParty[];
  readonly summary: {
    readonly count: number;
    readonly total_due_minor?: string;
    readonly total_owed_minor: string;
  };
}

/** بطاقة الطرف كما يعيدها `GET /api/parties/{party_id}`. */
export interface Card {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly aliases: readonly string[];
  readonly note: string;
  readonly credit_limit_minor: string;
  readonly is_customer: boolean;
  readonly is_supplier: boolean;
  readonly balance_minor: string;
  readonly supplier_owed_minor: string;
  readonly last_movement_at: string;
  readonly can_edit: boolean;
  readonly can_open_balance: boolean;
  readonly has_movements: boolean;
  readonly opening_balances: readonly { readonly side: string; readonly amount_minor: string }[];
  readonly potential_duplicates: readonly {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly balance_minor: string;
  }[];
}

/** صف الشاشة: الرصيد المركّب «خادمي X + معلّق على جهازك Y = Z» (ACC-02). */
export interface PartyRow {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly phone: string;
  readonly serverMinor: bigint | null;
  readonly pendingMinor: bigint;
  readonly pendingCount: number;
  readonly dueMinor: bigint | null;
  readonly limitMinor: bigint;
  readonly lastAt: string;
  readonly bothRoles: boolean;
}

export function toRow(
  p: LocalParty & { aliases?: readonly string[]; last_movement_at?: string },
  pending: { pendingMinor: bigint; count: number } | undefined,
): PartyRow {
  const server =
    p.balance_minor === "" || p.balance_minor === undefined ? null : BigInt(p.balance_minor);
  const pendingMinor = pending?.pendingMinor ?? 0n;
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    phone: p.phone,
    serverMinor: server,
    pendingMinor,
    pendingCount: pending?.count ?? 0,
    dueMinor: server === null ? (pendingMinor > 0n ? pendingMinor : null) : server + pendingMinor,
    limitMinor: BigInt(p.credit_limit_minor || "0"),
    lastAt: p.last_movement_at || p.last_sale_at || "",
    bothRoles: Boolean(p.is_customer && p.is_supplier),
  };
}

/** رمز خطأ خادمي من جسم 400 `{ errors: [{ field, code }] }`. */
export function firstError(body: unknown): { field: string; code: string } | undefined {
  return (body as { errors?: { field: string; code: string }[] } | undefined)?.errors?.[0];
}

/** رابط مطلق من مسار نسبي يعيده الخادم (`/api/parties/exports/<token>`). */
export function absoluteUrl(path: string, base: string): string {
  return new URL(path, base).toString();
}
