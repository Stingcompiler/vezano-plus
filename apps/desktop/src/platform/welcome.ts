/**
 * شاشة الترحيب عند أول تشغيل (0005 §٢٥٨): تُعرض مرة واحدة لكل تثبيت، قبل الدخول.
 * الحالة في تخزين النافذة المحلي — لا تمسّ بيانات المنشأة ولا تنتقل بين الأجهزة.
 */
const KEY = "desk.welcome.seen";

export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // تخزين ممنوع: لا نعلّق المستخدم على شاشة الترحيب عند كل فتح
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* لا شيء: `welcomeSeen` تعيد true حين يُمنع التخزين */
  }
}

export type WelcomeLang = "ar" | "en";

/** نصوص الشاشة بلغتيها. العربية الأصل والافتراضية؛ الإنجليزية ترجمتها سطراً بسطر. */
export const WELCOME: Readonly<
  Record<
    WelcomeLang,
    {
      readonly title: string;
      readonly lead: string;
      readonly featuresTitle: string;
      readonly features: readonly string[];
      readonly setupTitle: string;
      readonly setup: readonly string[];
      readonly start: string;
    }
  >
> = {
  ar: {
    title: "مرحباً بك في فيزانو بلص",
    lead: "نقطة بيع ومخزون وذمم تعمل بلا إنترنت.",
    featuresTitle: "مزايا فيزانو بلص",
    features: [
      "يبيع بلا إنترنت، ويرفع العمليات حين يعود الاتصال.",
      "نقطة البيع والمخزون وذمم العملاء والوردية في مكان واحد.",
      "إيصالات تُطبع مباشرة بلا نافذة طباعة.",
      "يُعلمك بالتحديث حين تصدر نسخة جديدة، وتثبّته بنقرة.",
    ],
    setupTitle: "تهيئة الجهاز",
    setup: [
      "ادخل بحسابك المعتاد؛ الجلسة تُحفظ فلا تدخل عند كل فتح.",
      "من «الأجهزة والمزامنة ← الطابعة» اختر طابعة الإيصالات وطابعة التقارير.",
      "افتح الوردية وابدأ البيع.",
      "لا تقلق من الإغلاق: التطبيق يبقى في الخلفية ما دامت عمليات لم تُرفع.",
    ],
    start: "ابدأ",
  },
  en: {
    title: "Welcome to Vezano Plus",
    lead: "Point of sale, inventory and customer ledger that work offline.",
    featuresTitle: "What Vezano Plus does",
    features: [
      "Sells without internet and uploads your operations when the connection returns.",
      "Point of sale, inventory, customer ledger and shifts in one place.",
      "Receipts print directly, with no print dialog.",
      "Tells you when a new version is out, and installs it in one click.",
    ],
    setupTitle: "Setting up this device",
    setup: [
      "Sign in with your usual account. The session is kept, so you don't sign in every time.",
      "Under “Devices and sync → Printer”, choose the receipt printer and the report printer.",
      "Open a shift and start selling.",
      "Closing is safe: the app stays in the background while operations are still uploading.",
    ],
    start: "Get started",
  },
};
