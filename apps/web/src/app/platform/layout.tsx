import type { ReactNode } from "react";

import { OperatorGate } from "@/features/platform/operator-gate";

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <OperatorGate>{children}</OperatorGate>;
}
