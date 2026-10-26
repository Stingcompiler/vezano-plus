import type { StoragePort } from "@sting/platform";
import { type TextOf, tx } from "@sting/texts";

/**
 * مشترك الكتالوج على الجوال: صياغة أخطاء بطاقة الصنف (نظير `features/catalog/item-errors.ts` في
 * الويب بالنصوص حرفياً)، قراءة المعامل، الأشهر، وذاكرة آخر ردّ خادمي صالح للشاشات الخادمية.
 * الأرقام في أجزاء `{ n }` تُرسم بخط mono (القاعدة 2).
 */

export type Part = string | { readonly n: string };

export interface ServerFieldError {
  readonly field: string;
  readonly code: string;
  readonly limit?: number | string | undefined;
  readonly actual?: number | string | undefined;
  readonly barcode?: string | undefined;
  readonly owner_item_id?: string | undefined;
  readonly owner_item_name?: string | undefined;
  readonly owner_unit_name?: string | undefined;
}

export interface ItemFieldError {
  readonly key: string;
  readonly field: string;
  readonly msg: string;
  readonly why: readonly Part[];
  readonly fix: string;
  readonly link?: { readonly id: string; readonly label: string } | undefined;
}

const E = "shared:features/catalog/item-errors.ts" as const;
const t = <T extends TextOf<typeof E>>(s: T): T => tx(E, s);

export const FIELD_LABELS: Record<string, string> = {
  name: t("اسم الصنف"),
  base_unit_id: t("الوحدة الأساسية"),
  units: t("وحدة أكبر وتحويلها"),
  factor_milli: t("المعامل"),
  unit_id: t("الوحدة"),
  barcode: t("الباركود"),
  sale_price_minor: t("سعر البيع"),
  image_data_url: t("صورة الصنف"),
};

const n = (v: number | string | undefined) => String(v ?? "");

export function describeError(e: ServerFieldError): ItemFieldError {
  const field = FIELD_LABELS[e.field] ?? e.field;
  const base = { key: e.field, field };
  switch (e.code) {
    case "required":
      if (e.field === "base_unit_id")
        return {
          ...base,
          msg: t("لم تُحدَّد"),
          why: [
            t(
              "بلا وحدة أساسية لا يعرف النظام معنى «5» في المخزون ولا في الفاتورة: خمسة أكياس أم خمسة كراتين أم خمسة كيلوات. وهي الحقل الوحيد الذي لا يُعدَّل بعد أول حركة، لأن تعديلها يعيد تفسير كل رصيد وكل فاتورة مضت.",
            ),
          ],
          fix: t("اختر الوحدة التي يُعدّ بها الصنف في الرفّ، لا التي يُشترى بها من المورد."),
        };
      return { ...base, msg: t("لم يُحدَّد"), why: [], fix: `${t("اكتب")} ${field}.` };
    case "barcode_taken":
      return {
        ...base,
        msg: t("مستخدم في صنف آخر"),
        why: [
          t("الرقم"),
          " ",
          { n: n(e.barcode) },
          " ",
          t("مسجّل على «"),
          e.owner_item_name ?? "",
          t(
            "». مسحُه على الميزان سيفتح ذاك لا هذا، والفرق يظهر في الجرد بعد شهر لا في البيع الآن.",
          ),
        ],
        fix: t(
          "افتح الصنف الآخر وتحقّق، أو اترك الباركود فارغاً — الصنف يُباع بالبحث بالاسم ريثما يُضبط.",
        ),
        link: e.owner_item_id ? { id: e.owner_item_id, label: e.owner_item_name ?? "" } : undefined,
      };
    case "too_long":
      return {
        ...base,
        msg: t("أطول من الحدّ"),
        why: [
          t("الحدّ"),
          " ",
          { n: n(e.limit) },
          " ",
          t("حرفاً وما كتبتَه"),
          " ",
          { n: n(e.actual) },
          ".",
        ],
        fix: t("اختصر النص ليقع ضمن الحدّ."),
      };
    case "out_of_range":
      return {
        ...base,
        msg: t("خارج الحدّ"),
        why: [t("القيمة"), " ", { n: n(e.actual) }, " ", t("والحدّ"), " ", { n: n(e.limit) }, "."],
        fix: t("اكتب قيمة ضمن الحدّ."),
      };
    case "not_a_number":
      return {
        ...base,
        msg: t("ليس رقماً مقبولاً"),
        why: [],
        fix: t("اكتب رقماً صحيحاً موجباً بأرقام لاتينية."),
      };
    case "same_as_base":
      return {
        ...base,
        msg: t("هي الوحدة الأساسية نفسها"),
        why: [],
        fix: t("اختر وحدة أكبر غير الوحدة الأساسية."),
      };
    case "duplicate_unit":
      return { ...base, msg: t("مكرّرة"), why: [], fix: t("هذه الوحدة مسجّلة للصنف من قبل.") };
    case "same_as_unit":
      return {
        ...base,
        msg: t("مسجّلة وحدةً أكبر لهذا الصنف"),
        why: [],
        fix: t("احذف الوحدة الأكبر أولاً أو اختر وحدة أساسية أخرى."),
      };
    case "locked_after_movement":
      return {
        ...base,
        msg: t("لا تتغيّر بعد أول حركة"),
        why: [t("للصنف"), " ", { n: n(e.actual) }, " ", t("حركة مسجّلة.")],
        fix: t("أنشئ صنفاً جديداً بالوحدة المطلوبة."),
      };
    case "not_an_image":
      return { ...base, msg: t("ليس صورة"), why: [], fix: t("اختر ملف صورة.") };
    case "unit_not_found":
      return { ...base, msg: t("غير موجودة"), why: [], fix: t("اختر وحدة من القائمة.") };
    default:
      return { ...base, msg: e.code, why: [], fix: "" };
  }
}

/** عنوان لوحة الأخطاء بالعدد. */
export function errorsTitle(count: number): string {
  if (count === 2) return t("خطآن يمنعان الحفظ");
  if (count === 1) return t("خطأ يمنع الحفظ");
  return t("أخطاء تمنع الحفظ");
}

/** أخطاء 400 من الخادم (`{ errors: [...] }`) ← أخطاء الحقول المصاغة. */
export function describeServerErrors(error: unknown): ItemFieldError[] {
  return ((error as { errors?: ServerFieldError[] } | undefined)?.errors ?? []).map(describeError);
}

/** أرقام عربية ← لاتينية ثم معامل بثلاث منازل كحد أقصى ← أجزاء ألف (BigInt كنص). */
export function parseFactorInput(text: string): string | null {
  const latin = text.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(latin);
  if (!m) return null;
  return (BigInt(m[1] ?? "0") * 1000n + BigInt((m[2] ?? "").padEnd(3, "0"))).toString();
}

/** المعامل المخزَّن بالألف ← نص بلا أصفار زائدة («12»، «0.5»). */
export function factorText(milli: string): string {
  const v = BigInt(milli);
  const whole = v / 1000n;
  const frac = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** الأشهر بنصها الحرفي في الويب (CAT-03 وCAT-04 تشتركان فيها)؛ الشاشة تمرّر الاسم عبر `tx` بمفتاحها. */
export const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;
export type MonthWord = (typeof MONTHS)[number];
export function monthWord(index: number): MonthWord {
  return MONTHS[index] ?? MONTHS[0];
}

/** ذاكرة آخر ردّ خادمي صالح (القاعدة 7): تُعرض بحالة «بلا اتصال» حين تفشل الشبكة. */
export async function readCache<T>(storage: StoragePort, key: string): Promise<T | null> {
  try {
    const raw = await storage.read((tr) => tr.getMeta(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export async function writeCache(storage: StoragePort, key: string, value: unknown): Promise<void> {
  await storage.transaction((tr) => tr.putMeta(key, JSON.stringify(value))).catch(() => undefined);
}

/** بطاقة الصنف كما يعيدها الخادم (`catalog/items/{id}`) — الاستجابة غير موصوفة في العقد. */
export interface ItemCard {
  readonly id: string;
  readonly name: string;
  readonly group_id: string;
  readonly base_unit_id: string;
  readonly base_unit_name: string;
  readonly units: readonly {
    readonly id: string;
    readonly unit_id: string;
    readonly name: string;
    readonly factor_milli: string;
    readonly barcode: string;
  }[];
  readonly barcode: string;
  readonly sale_price_minor: string;
  readonly image_data_url: string;
  readonly base_unit_locked: boolean;
}
export interface UnitRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly is_base: boolean;
  readonly decimal_places: number;
}
export interface GroupRef {
  readonly id: string;
  readonly name: string;
}
