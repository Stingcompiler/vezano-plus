/**
 * اسم عرض الوحدة (FIX-07 · 0005 §١٨٣). معرّف الوحدة في البيانات لاتيني (`piece`)، والمستخدم يقرأ
 * عربياً: الكتالوج يعرض «حبة» بينما كانت السلة والفاتورة تعرضان `piece`. القاموس للعرض فقط — لا
 * يمسّ المعرّفات ولا معاملات التحويل المخزّنة؛ وحدة غير معروفة (كتبها المالك بنفسه) تبقى كما هي.
 */
const UNIT_AR: Readonly<Record<string, string>> = {
  piece: "حبة",
  carton: "كرتونة",
  kg: "كيلو",
  g: "غرام",
  l: "لتر",
  ml: "مل",
  m: "متر",
  box: "علبة",
  pack: "عبوة",
  bag: "كيس",
  dozen: "دزينة",
};

export function unitDisplay(code: string): string {
  return UNIT_AR[code.trim().toLowerCase()] ?? code;
}
