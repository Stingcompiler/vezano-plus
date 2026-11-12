import { Suspense } from "react";

import { LabelsClient } from "@/features/catalog/labels-client";

/** CAT-07 — ملصقات الأصناف (0005 §٢٧٠؛ لا إطار مرسوم). */
export default function LabelsPage() {
  return (
    <Suspense fallback={null}>
      <LabelsClient />
    </Suspense>
  );
}
