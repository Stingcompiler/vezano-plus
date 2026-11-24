/**
 * قرار الصلاحية من مصفوفة الأدوار على الجهاز — نظير `backend/core/permissions.py` حرفاً بحرف
 * (مراجعة 2026-11-22 O-01؛ 0005 §٢٩٢). الخادم يرسل خلايا دور المستخدم (`permissions`) مع الرئيسية
 * وسياق الوردية، فتقرّر الشاشة ما يقرّره الخادم ولو بلا اتصال. والدالة نفسها تصلح لفحص العمليات
 * المرفوعة بلا اتصال (المرحلة ٢: تُقبل وتُوسم).
 */

export const PERMISSION_KEYS = [
  "sell",
  "discount",
  "refund",
  "view_receivables",
  "record_payment",
  "close_short",
  "stock_adjust",
  "campaign_create",
  "campaign_approve",
  "purchase_approve",
  "market_publish",
  "cost_margin_view",
  "conflict_review",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type CellValue =
  "yes" | "no" | "unlimited" | "limit" | "branch" | "own_customer" | "cash_only" | "propose";

/** خلية كما يرسلها الخادم: `limit_minor` نصّ بالوحدة الصغرى أو null. */
export interface PermissionCell {
  readonly value: string;
  readonly limit_minor: string | null;
  readonly period: string;
}
export type RoleRules = Readonly<Partial<Record<PermissionKey, PermissionCell>>>;

export type DenialReason =
  | "role_forbidden"
  | "over_limit"
  | "other_branch"
  | "cash_only"
  | "own_customer_only"
  | "propose_only";

export interface PermissionDecision {
  readonly key: PermissionKey;
  readonly allowed: boolean;
  readonly reason: DenialReason | "";
  readonly value: string;
  /** الحدّ المالي إن كانت الخلية «حد مالي»؛ null = بلا حدّ. */
  readonly limitMinor: bigint | null;
  /** «نعم» أو «بلا حد». */
  readonly unrestricted: boolean;
}

const y = (): PermissionCell => ({ value: "yes", limit_minor: null, period: "" });
const n = (): PermissionCell => ({ value: "no", limit_minor: null, period: "" });
const c = (value: CellValue): PermissionCell => ({ value, limit_minor: null, period: "" });
const lim = (minor: number): PermissionCell => ({
  value: "limit",
  limit_minor: String(minor),
  period: "per_op",
});

/**
 * الافتراض المبذور لكل دور (`core/org.py` PERMISSIONS) — يُستعمل فقط إن كان سياق الجهاز المخزَّن
 * أقدم من هذا الإصدار ولا يحمل `permissions` بعد؛ أول اتصال يستبدله بما قاله الخادم.
 */
export const DEFAULT_ROLE_RULES: Readonly<Record<string, RoleRules>> = {
  manager: {
    sell: y(),
    discount: lim(20000),
    refund: y(),
    view_receivables: c("branch"),
    record_payment: y(),
    close_short: lim(30000),
    stock_adjust: c("branch"),
    campaign_create: y(),
    campaign_approve: n(),
    purchase_approve: lim(300000),
    market_publish: n(),
    cost_margin_view: y(),
    conflict_review: n(),
  },
  cashier: {
    sell: y(),
    discount: lim(1000),
    refund: lim(50000),
    view_receivables: c("own_customer"),
    record_payment: c("cash_only"),
    close_short: lim(5000),
    stock_adjust: n(),
    campaign_create: n(),
    campaign_approve: n(),
    purchase_approve: n(),
    market_publish: n(),
    cost_margin_view: n(),
    conflict_review: n(),
  },
  storekeeper: {
    sell: n(),
    discount: n(),
    refund: n(),
    view_receivables: n(),
    record_payment: n(),
    close_short: n(),
    stock_adjust: c("propose"),
    campaign_create: n(),
    campaign_approve: n(),
    purchase_approve: n(),
    market_publish: n(),
    cost_margin_view: n(),
    conflict_review: n(),
  },
};

export interface DecideOptions {
  readonly amountMinor?: bigint | undefined;
  /** فرع الشيء المعني، وفرع المستخدم — «فرعه» يسمح حين يتساويان. */
  readonly branchId?: string | undefined;
  readonly ownBranchId?: string | undefined;
  readonly method?: "cash" | "bank" | undefined;
}

/**
 * خلية مفتاح لدور: من الخادم، وإلا الافتراض المبذور للدور؛ المالك «نعم» دائماً. سياق قديم بلا خلايا
 * ولا دور معروف لا يُمنع به شيء كان مسموحاً قبله — الخادم يحكم عند الرفع (المرحلة ٢).
 */
export function cellOf(
  rules: RoleRules | undefined,
  key: PermissionKey,
  roleCode: string | undefined,
): PermissionCell {
  if (roleCode === "owner") return y();
  if (rules) return rules[key] ?? n();
  return DEFAULT_ROLE_RULES[roleCode ?? ""]?.[key] ?? y();
}

/** قرار خلية — نظير `decide_cell` في الخادم. */
export function decideCell(
  key: PermissionKey,
  cell: PermissionCell,
  opts: DecideOptions = {},
): PermissionDecision {
  const value = cell.value;
  const out = (
    allowed: boolean,
    reason: DenialReason | "" = "",
    limitMinor: bigint | null = null,
  ): PermissionDecision => ({
    key,
    allowed,
    reason,
    value,
    limitMinor,
    unrestricted: allowed && (value === "yes" || value === "unlimited"),
  });
  if (value === "yes" || value === "unlimited") return out(true);
  if (value === "limit") {
    const cap = BigInt(cell.limit_minor ?? "0");
    // الحدّ المالي يُمارَس في فرع المستخدم؛ «نعم» و«بلا حد» وحدهما يشملان كل الفروع
    if (opts.branchId !== undefined && opts.branchId !== opts.ownBranchId)
      return out(false, "other_branch");
    if (opts.amountMinor !== undefined && opts.amountMinor > cap)
      return out(false, "over_limit", cap);
    return out(true, "", cap);
  }
  if (value === "branch") {
    if (opts.branchId !== undefined && opts.branchId !== opts.ownBranchId)
      return out(false, "other_branch");
    return out(true);
  }
  if (value === "cash_only") {
    if (opts.method !== undefined && opts.method !== "cash") return out(false, "cash_only");
    return out(true);
  }
  if (value === "own_customer") return out(false, "own_customer_only");
  if (value === "propose") return out(false, "propose_only");
  return out(false, "role_forbidden");
}

/** هل يحقّ لهذا الدور هذا الفعل؟ — بالقاعدة نفسها التي يقرّر بها الخادم. */
export function decidePermission(
  rules: RoleRules | undefined,
  roleCode: string | undefined,
  key: PermissionKey,
  opts: DecideOptions = {},
): PermissionDecision {
  return decideCell(key, cellOf(rules, key, roleCode), opts);
}
