/**
 * نصوص الجوال وحده — لا مقابل لها في الويب (تبويب «المزيد»، شاشة «لم تُبنَ بعد»، وشاشات NAT
 * الأصلية لاحقاً). قليلة عمداً، وكل نص هنا قرار مكتوب في 0005 §١٦٦. ما له مقابل في الويب يُؤخذ
 * من `tx` لا من هنا.
 */
export const MOBILE_TEXTS = {
  more: "المزيد",
  notBuiltTitle: "لم تُبنَ هذه الشاشة على الجوال بعد",
  notBuiltBody: "افتحها على الويب — الحساب نفسه والبيانات نفسها.",
  openWeb: "افتح على الويب",
  // ضبط PIN بعد تجهيز الجهاز (0005 §١٧٣) — لا مقابل في الويب بعد: الويب لم يكن يضبط PIN إطلاقاً
  pinSetTitle: "اختر رمز PIN",
  pinSetBody:
    "ستة أرقام تفتح التطبيق بعد الخمول وبلا شبكة. لا يُحفظ الرمز نصاً، ويصل إلى أجهزة فرعك.",
  pinField: "الرمز",
  pinConfirm: "تأكيد الرمز",
  pinSave: "احفظ الرمز",
  pinInvalid: "الرمز ستة أرقام.",
  pinMismatch: "الرمزان غير متطابقين.",
  pinPasswordInvalid: "كلمة المرور غير صحيحة.",
  pinLater: "لاحقاً — أدخل بكلمة المرور",
  lockChecking: "جارٍ التحقق من الرمز",
} as const;

export type MobileTextKey = keyof typeof MOBILE_TEXTS;

export function mtx(key: MobileTextKey): string {
  return MOBILE_TEXTS[key];
}
