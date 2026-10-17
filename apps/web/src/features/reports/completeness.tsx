/**
 * سطر اكتمال البيانات في التقارير (فحص 2026-10-17 F08): «0 أجهزة من 0 زامنت» يوحي بنجاح لا وجود له.
 * بلا أي جهاز مسجّل يقول ذلك صراحةً؛ وإلا العدد كما كان.
 */
export function DevicesSynced({ synced, total }: { synced: number; total: number }) {
  if (total === 0) return <>لا جهاز بيع مسجّل بعد — يمتلئ التقرير حين يبيع أول جهاز</>;
  return (
    <>
      <span className="sting-mono">{synced}</span> أجهزة من{" "}
      <span className="sting-mono">{total}</span> زامنت
    </>
  );
}
