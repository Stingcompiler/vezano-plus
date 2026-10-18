/**
 * وجهة ما بعد تجهيز الجهاز: منشأة أُنشئت للتوّ على هذا الهاتف تكمل إلى معالج البدء (ACC-10) مرة
 * واحدة، وما سواها إلى الرئيسية. في الذاكرة عمداً: إن أُغلق التطبيق قبلها فالمعالج في «المزيد» لاحقاً
 * والرئيسية تعمل بدونه — لا شيء يُشترط لبدء البيع.
 */
let freshOrg = false;

export function markFreshOrg(): void {
  freshOrg = true;
}

/** إلى الرئيسية، ومعالج البدء فوقها لمنشأة جديدة — فالرجوع منه يعود إلى الرئيسية. */
export function goAfterSetup(router: { replace: (h: never) => void; push: (h: never) => void }) {
  router.replace("/" as never);
  if (freshOrg) {
    freshOrg = false;
    router.push("/onboarding" as never);
  }
}
