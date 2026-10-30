import type { StateCode } from "@sting/design";

/**
 * خريطة الاختصارات (DESK-03، 09-D5): لا إجراء مالي بضربة مفتاح واحدة — الخصم تركيبة طويلة وحوار وسبب،
 * والمرتجع والإلغاء بلا مفتاح إطلاقاً. ما يحجزه النظام (الطباعة، الإغلاق، الإنهاء) لا يُربط بشيء لأن
 * التطبيق لا يملك تجاوزه فيعمل المفتاح «أحياناً».
 */
export type ActionId = "search" | "qty" | "checkout" | "discount" | "return" | "payment";

export interface ShortcutAction {
  readonly id: ActionId;
  readonly act: string;
  readonly confirm: string;
  readonly state: StateCode;
  readonly note: string;
  /** null = لا مفتاح لهذا الإجراء ولا يُضاف */
  readonly key: ((mod: string) => string) | null;
  readonly editable: boolean;
}

export const ACTIONS: readonly ShortcutAction[] = [
  {
    id: "search",
    act: "بحث عن صنف",
    confirm: "بلا تأكيد",
    state: "success",
    note: "إجراء قراءة لا يغيّر شيئاً.",
    key: () => "F2",
    editable: true,
  },
  {
    id: "qty",
    act: "إضافة كمية",
    confirm: "بلا تأكيد",
    state: "success",
    note: "قابل للتراجع قبل الإتمام.",
    key: () => "F4",
    editable: true,
  },
  {
    id: "checkout",
    act: "إتمام البيع",
    confirm: "شاشة إتمام",
    state: "stale",
    note: "يفتح شاشة الدفع ولا ينهي البيع مباشرة.",
    key: (m) => `${m}+Enter`,
    editable: true,
  },
  {
    id: "discount",
    act: "خصم على العملية",
    confirm: "حوار + سبب",
    state: "stale",
    note: "تركيبة طويلة عن قصد، وتخضع لسقف الدور في ORG-02.",
    key: (m) => `${m}+Shift+D`,
    editable: false,
  },
  {
    id: "return",
    act: "مرتجع أو إلغاء فاتورة",
    confirm: "لا اختصار",
    state: "permission_denied",
    note: "لا مفتاح لهذا الإجراء إطلاقاً. يُنفَّذ من القائمة بخطوتين وسبب مكتوب.",
    key: null,
    editable: false,
  },
];

/** ما يحجزه النظام — `mod` هو ⌘ في ماك وCtrl في غيره */
export const systemReserved = (mod: string): readonly string[] => [
  `${mod}+P`,
  `${mod}+W`,
  `${mod}+Q`,
  `${mod}+H`,
  `${mod}+M`,
  "Alt+F4",
];

export type Bindings = Partial<Record<ActionId, string>>;

export type Check =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "taken"; readonly owner: string }
  | { readonly ok: false; readonly kind: "system" };

export function defaultBindings(mod: string): Bindings {
  const b: Bindings = {};
  for (const a of ACTIONS) if (a.key) b[a.id] = a.key(mod);
  return b;
}

/** هل يُقبل ربط `combo` بالإجراء `id`؟ المحجوز للنظام يُرفض صراحةً، والمستخدم يُسمّى مالكه. */
export function checkBinding(id: ActionId, combo: string, bindings: Bindings, mod: string): Check {
  if (systemReserved(mod).includes(combo)) return { ok: false, kind: "system" };
  for (const a of ACTIONS) {
    if (a.id !== id && bindings[a.id] === combo) return { ok: false, kind: "taken", owner: a.act };
  }
  return { ok: true };
}

/** ضغطة لوحة المفاتيح بصيغة الخريطة: «⌘+Shift+D»، «F2» */
export function comboOf(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  mod: string,
): string {
  const parts: string[] = [];
  if (mod === "⌘" ? e.metaKey : e.ctrlKey) parts.push(mod);
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!["Meta", "Control", "Shift", "Alt"].includes(k)) parts.push(k);
  return parts.join("+");
}
