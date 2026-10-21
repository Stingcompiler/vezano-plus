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
  // نصّ إطار ACC-05 حُذف من الويب في مراجعة التصميم (#200) والجوال ما زال يحتاجه لحالة الرفض
  deviceDenied: "صلاحية مرفوضة",
  // صيغ عدّ الفروع كما في الويب (`lib/count.tsx`) — حُذف «فروع ·» من إطار HOME-01 (#201) فصارت للجوال
  branchesOne: "فرع واحد",
  branchesTwo: "فرعان",
  branchesFew: "فروع",
  branchesMany: "فرعاً",
  // NAT-04 — التحديث والنسخة الاحتياطية والأسرار (شاشة أصلية بلا مقابل في الويب؛ 0005 §١٨٨)
  deviceTitle: "الجهاز والنسخة",
  deviceVersion: "إصدار التطبيق",
  deviceBackupTitle: "نسخة احتياطية محلية",
  deviceBackupBody: "تصدّر العمليات التي لم تُرفع بعد إلى ملف تحفظه أو ترسله. لا تحتاج اتصالاً.",
  deviceBackupAction: "صدّر نسخة محلية",
  deviceBackupDone: "عملية محفوظة محلياً",
  deviceUpdateTitle: "التحديث",
  deviceUpdateBlocked: "لا يُطبَّق تحديث قبل رفع العمليات المعلّقة — ارفعها أولاً.",
  deviceUpdateOk: "لا شيء معلّق: التحديث آمن حين يصل.",
  deviceSecretsTitle: "الأسرار على هذا الجهاز",
  deviceSecretsBody: "رمز تجديد الجهاز واعتماد التسجيل في المخزن الآمن للنظام لا في قاعدة البيانات.",
  deviceSignOut: "اخرج وامحُ رمز الجهاز",
  pinMismatch: "الرمزان غير متطابقين.",
  pinPasswordInvalid: "كلمة المرور غير صحيحة.",
  pinLater: "لاحقاً — أدخل بكلمة المرور",
  lockChecking: "جارٍ التحقق من الرمز",
} as const;

export type MobileTextKey = keyof typeof MOBILE_TEXTS;

export function mtx(key: MobileTextKey): string {
  return MOBILE_TEXTS[key];
}
