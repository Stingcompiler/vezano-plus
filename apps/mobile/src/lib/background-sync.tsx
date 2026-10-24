import { countPending, pushPending } from "@sting/app-core";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const PUSH_EVERY_MS = 30_000;

/**
 * الرفع التلقائي على الهاتف (كـ`BackgroundSync` في الويب، 0005 §١٧٨ B3): ما حُفظ بلا شبكة لا ينتظر
 * «محاولة رفع الآن» — يُرفع عند العودة إلى التطبيق (AppState) وكل 30 ثانية ما دام هناك معلّق، وبجلسة
 * جهاز نشطة وحدها. يحترم الوقوف بعد ثلاث أعطال خادم (الاستئناف بعده يدوي كما يعلن SYS-01).
 */
export function BackgroundSync() {
  const { state, api } = useSession();
  const live = state.status === "active" && Boolean(state.deviceId) && state.setupDone;
  const busy = useRef(false);

  useEffect(() => {
    if (!live) return;
    const tick = async () => {
      if (busy.current || AppState.currentState !== "active") return;
      busy.current = true;
      try {
        const storage = await getStorage();
        if ((await countPending(storage)) > 0) {
          await pushPending({ api, storage, requestId: newId });
        }
      } catch {
        /* الشبكة سقطت أثناء المحاولة — الدورة التالية تعيد */
      } finally {
        busy.current = false;
      }
    };
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void tick();
    });
    const timer = setInterval(() => void tick(), PUSH_EVERY_MS);
    void tick();
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [live, api]);

  return null;
}
