/** السطور من `@sting/app-core` (مشتركة مع الجوال)؛ العرض بخط mono هنا. */
import { planLines, type PlanLike } from "@sting/app-core";

export { planLines, type PlanLike };

/**
 * تقرير الموقع العام 2026-11-07: سطر نفيٍ («بلا نشر في السوق») كان يحمل ✓ المزايا المشمولة فيُقرأ
 * مشمولاً عند المسح السريع. سطر النفي يُعلَّم `excluded` فيُرسم بعلامة «—» كخانة «لا» في جدول المقارنة،
 * ويأتي بعد المشمول. نصّه كما كتبه المشغّل.
 */
export const isExcluded = (line: string) => /^(بلا|لا|دون|بدون)\s/.test(line.trim());

export function planItems(p: PlanLike): { line: string; excluded: boolean }[] {
  const all = planLines(p).map((line) => ({ line, excluded: isExcluded(line) }));
  return [...all.filter((x) => !x.excluded), ...all.filter((x) => x.excluded)];
}

/** السطر برقمه الأول بخط mono (القاعدة 2): «3 أجهزة» → <mono>3</mono> أجهزة. */
export function PlanLine({ line }: { line: string }) {
  const m = /^(\d+)(\s.*)?$/.exec(line);
  if (!m) return <>{line}</>;
  return (
    <>
      <span className="sting-mono">{m[1]}</span>
      {m[2] ?? ""}
    </>
  );
}
