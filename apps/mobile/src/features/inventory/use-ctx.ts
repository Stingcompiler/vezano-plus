import { useEffect, useState } from "react";

import { type ShiftContext, readShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/** سياق الجهاز (الفرع والمسؤول) من التخزين المحلي — نظير `readShiftContext(storage, app)` في الويب. */
export function useDeviceContext(): { ctx: ShiftContext | null; ready: boolean } {
  const { state } = useSession();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void getStorage()
      .then((s) => readShiftContext(s, { deviceId: state.deviceId, userId: state.userId }))
      .then((c) => {
        if (!alive) return;
        setCtx(c);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [state.deviceId, state.userId]);
  return { ctx, ready };
}
