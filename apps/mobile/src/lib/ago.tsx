import { agoParts } from "@sting/app-core";
import { tx } from "@sting/texts";
import { FONT } from "@sting/ui-native";
import { Text } from "react-native";

const F = "shared:features/sys/sys-format.tsx";

/** «قبل 14 دقيقة» كالويب (`sys-format.tsx`): الرقم mono في Text مستقل والمعدود عربي بجانبه. */
export function Ago({ iso }: { iso: string }) {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  let n: number;
  let word: string;
  if (ms < 60_000) {
    n = Math.max(1, Math.floor(ms / 1000));
    word = tx(F, "ثانية");
  } else {
    const p = agoParts(iso);
    n = p.n;
    word =
      p.unit === "minute" ? tx(F, "دقيقة") : p.unit === "hour" ? tx(F, "ساعة") : tx(F, "يوماً");
  }
  return (
    <Text>
      <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(n)}</Text> {word}
    </Text>
  );
}

/** «ERR-SYNC-409 · dev POS-1» — سطر الدعم كالويب، بلا JSON ولا أثر مكدّس. */
export function supportLine(parts: { status?: number | undefined; devicePrefix?: string | null }) {
  const bits = [`ERR-SYNC-${parts.status ? String(parts.status) : "0000"}`];
  if (parts.devicePrefix) bits.push(`dev ${parts.devicePrefix}`);
  return bits.join(" · ");
}
