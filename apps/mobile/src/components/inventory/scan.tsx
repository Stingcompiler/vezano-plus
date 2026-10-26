import type { LocalItem } from "@sting/sync-core";
import { useCallback, useEffect, useRef, useState } from "react";

import { BarcodeScanner } from "@/components/barcode-scanner";

/** باركود → صنف (الأساسي أو باركود وحدة) مع مفتاح الوحدة المطابقة إن كان من باركود وحدة. */
export function matchBarcode(
  items: readonly LocalItem[],
  code: string,
): { item: LocalItem; unitKey?: string } | null {
  const c = code.trim();
  if (!c) return null;
  for (const item of items) {
    if (item.barcode === c) return { item };
    const u = item.units.find((x) => x.barcode === c);
    if (u) return { item, unitKey: `unit:${u.id ?? u.unit_id}` };
  }
  return null;
}

/**
 * مسح الباركود لشاشات المخزون (INV-04/05/09): ورقة NAT-01 نفسها؛ في الوضع التتابعي تُعاد فتحها بعد كل
 * قراءة حتى يضغط المستخدم «إغلاق» — المسح أثناء المشي بين الرفوف لا يطلب نقرة لكل صنف.
 */
export function useBarcodeScan(onCode: (code: string) => void, sequential = false) {
  const [open, setOpen] = useState(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const start = useCallback(() => setOpen(true), []);
  const element = (
    <BarcodeScanner
      open={open}
      onScan={(code) => {
        again.current = sequential;
        onCode(code);
      }}
      onClose={() => {
        setOpen(false);
        if (again.current) {
          again.current = false;
          timer.current = setTimeout(() => setOpen(true), 700);
        }
      }}
    />
  );
  return { start, element };
}
