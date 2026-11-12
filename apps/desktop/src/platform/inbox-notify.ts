/**
 * إشعارات النظام من الوارد (DESK-05 «مفتوح في الخلفية» · 0005 §٢٥٦): لا Web Push داخل Tauri، فالتطبيق
 * يتابع الوارد وهو يعمل ويُظهر إشعار نظام لما وصل جديداً والنافذة ليست في المقدمة.
 * هذا الملف منطقٌ خالص يُختبر بلا Tauri؛ التشغيل في `inbox-notifier.tsx`.
 */
export interface InboxItem {
  readonly id: string;
  readonly kind: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
}

export interface NotifyText {
  readonly title: string;
  readonly body: string;
}

/**
 * عنوان ثابت لكل فئة — بلا أسماء ولا مبالغ (ACC-113). مرآة `CATEGORY_PUSH` في
 * `backend/core/push_dispatch.py`: ما يظهر على شاشة قفل الحاسوب كما يظهر على الهاتف.
 */
export const CATEGORY_TEXT: Readonly<Record<string, NotifyText>> = {
  operational: { title: "فيزانو بلص — تنبيه تشغيلي", body: "أمر في متجرك يحتاج نظرك." },
  account: { title: "فيزانو بلص — حسابك", body: "تحديث في اشتراكك أو حسابك." },
  marketing: { title: "فيزانو بلص", body: "جديد من المنصة." },
};

/** إعلان المنصة نصّ كتبه المشغّل للمتاجر كلها فلا سرّ فيه — يظهر كما هو (كالخادم). */
export function textOf(item: InboxItem): NotifyText {
  if (item.kind === "platform_announcement")
    return { title: `فيزانو بلص — ${item.title}`.slice(0, 120), body: item.body.slice(0, 240) };
  return CATEGORY_TEXT[item.category] ?? CATEGORY_TEXT["operational"]!;
}

/** ما نتذكّره من معرّفات — يكفي صفحات الوارد الأخيرة ولا يكبر بلا حدّ. */
export const SEEN_CAP = 300;
/** إشعارات الجولة الواحدة: النصوص ثابتة لكل فئة فتُجمع المكرّرات، ولا نُغرق الشاشة. */
export const MAX_PER_ROUND = 4;

export interface Round {
  readonly notify: readonly NotifyText[];
  readonly seen: readonly string[];
}

/**
 * جولة متابعة: ما الجديد غير المقروء منذ آخر جولة؟
 * - `seen === null`: أول جولة لهذه المنشأة على هذا الجهاز — خطّ أساس بلا إشعار (لا نُفرغ الوارد القديم).
 * - النافذة في المقدمة تُشعَر أيضاً (0005 §٢٦٨): كان الإشعار يُحجب حينها، فلم يرَ من يعمل داخل التطبيق
 *   شيئاً — ووعدُ DESK-05 «التطبيق مفتوح: إشعار فوراً» لم يكن له تنبيه آخر.
 */
export function nextRound(items: readonly InboxItem[], seen: readonly string[] | null): Round {
  const ids = items.map((i) => i.id);
  if (seen === null) return { notify: [], seen: ids.slice(-SEEN_CAP) };
  const known = new Set(seen);
  const fresh = items.filter((i) => !known.has(i.id));
  const nextSeen = [...seen, ...fresh.map((i) => i.id)].slice(-SEEN_CAP);
  const notify: NotifyText[] = [];
  for (const item of fresh) {
    if (item.read) continue;
    const t = textOf(item);
    if (!notify.some((n) => n.title === t.title && n.body === t.body)) notify.push(t);
  }
  return { notify: notify.slice(0, MAX_PER_ROUND), seen: nextSeen };
}

const KEY = (tenantId: string) => `desk.notify.seen.${tenantId}`;

export function readSeen(tenantId: string): string[] | null {
  try {
    const raw = localStorage.getItem(KEY(tenantId));
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function writeSeen(tenantId: string, seen: readonly string[]): void {
  try {
    localStorage.setItem(KEY(tenantId), JSON.stringify(seen));
  } catch {
    /* تخزين ممنوع: الجولة التالية خطّ أساس من جديد — لا إشعار مكرّر ولا عطل */
  }
}
