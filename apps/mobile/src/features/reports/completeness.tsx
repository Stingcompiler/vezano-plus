import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";

import { CountText, N, StatusWord } from "@/components/reports/ui";

import { DEVICES } from "./texts";

const F = "shared:features/reports/completeness.tsx";

export interface NotSynced {
  readonly device_name: string;
  readonly branch_name: string;
  readonly last_seen_at: string;
  readonly pending: number;
}
export interface Completeness {
  readonly devices_total: number;
  readonly devices_synced: number;
  readonly pending_ops: number;
  readonly not_synced: readonly NotSynced[];
  readonly complete: boolean;
}

/** «جهازان من 3 زامنت» — بلا جهاز مسجَّل: يقولها صراحةً (فحص F08). */
export function DevicesSynced({ synced, total }: { synced: number; total: number }) {
  if (total === 0) return <>{tx(F, "لا جهاز بيع مسجّل بعد — يمتلئ التقرير حين يبيع أول جهاز")}</>;
  return (
    <>
      <CountText n={synced} forms={DEVICES} /> {tx(F, "من")} <N>{total}</N> {tx(F, "زامنت")}
    </>
  );
}

/** شارة واحدة تحسم «هل الرقم نهائي؟» (FIX-10)؛ بلا جهاز: لا حكم. */
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
  return synced >= total ? (
    <StatusWord state="synced">
      {tx(F, "بيانات مكتملة حتى")} <N>{hhmm(computedAt)}</N>
    </StatusWord>
  ) : (
    <StatusWord state="pending_sync">{tx(F, "بيانات غير مكتملة")}</StatusWord>
  );
}
