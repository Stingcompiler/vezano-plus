/**
 * سطر اكتمال البيانات في التقارير (فحص 2026-10-17 F08): «0 أجهزة من 0 زامنت» يوحي بنجاح لا وجود له.
 * بلا أي جهاز مسجّل يقول ذلك صراحةً؛ وإلا العدد كما كان.
 * FIX-10 (0005 §١٨٤): شارة واحدة تحسم «هل الرقم نهائي؟»، وجمع الأجهزة بصيغته («جهازان» لا «2 أجهزة»).
 */
import { hhmm } from "@/features/home/format";
import { Count, DEVICES } from "@/lib/count";

export function DevicesSynced({ synced, total }: { synced: number; total: number }) {
  if (total === 0) return <>لا جهاز بيع مسجّل بعد — يمتلئ التقرير حين يبيع أول جهاز</>;
  return (
    <>
      <Count n={synced} {...DEVICES} /> من <span className="sting-mono">{total}</span> زامنت
    </>
  );
}

/** «بيانات مكتملة حتى 11:05» حين زامنت كل الأجهزة، وإلا «بيانات غير مكتملة»؛ بلا جهاز: لا حكم. */
export function CompletenessBadge({
  synced,
  total,
  computedAt,
}: {
  synced: number;
  total: number;
  computedAt: string;
}) {
  if (total === 0) return null;
  const complete = synced >= total;
  return (
    <span className={`acc-tag home-kpi__note home-kpi__note--${complete ? "ok" : "warn"}`}>
      {complete ? (
        <>
          بيانات مكتملة حتى <span className="sting-mono">{hhmm(computedAt)}</span>
        </>
      ) : (
        "بيانات غير مكتملة"
      )}
    </span>
  );
}
