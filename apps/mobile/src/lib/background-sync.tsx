import { countPending, pushPending } from "@sting/app-core";
import type { TransportFailure } from "@sting/sync-core";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage, wipeLocalStorage } from "@/lib/storage";

const PUSH_EVERY_MS = 30_000;

/**
 * الوقوف بإشارة من الخادم (§٩.٣): المحو عن بُعد يُنفَّذ على الهاتف كما يُنفَّذ في الويب — كان الرفع
 * يتجاهل `device_wiped`، فيبقى الدفتر على هاتف أقرّ المالك فقده ويُفتح بالرمز دون اتصال
 * (مراجعة 2026-11-10 ع-١٣). يمحو الملف المحلي ثم ينسى اعتماد الجهاز والجلسة.
 */
export async function onPushHalt(
  failure: Exclude<TransportFailure, { kind: "transient" }>,
  deps: { wipe: () => Promise<void>; forgetDevice: () => Promise<void> },
): Promise<void> {
  if (failure.kind === "auth" && failure.detail === "device_wiped") {
    await deps.wipe();
    await deps.forgetDevice();
  }
}

/**
 * الرفع التلقائي على الهاتف (كـ`BackgroundSync` في الويب، 0005 §١٧٨ B3): ما حُفظ بلا شبكة لا ينتظر
 * «محاولة رفع الآن» — يُرفع عند العودة إلى التطبيق (AppState) وكل 30 ثانية ما دام هناك معلّق، وبجلسة
 * جهاز نشطة وحدها. يحترم الوقوف بعد ثلاث أعطال خادم (الاستئناف بعده يدوي كما يعلن SYS-01).
 */
export function BackgroundSync() {
  const { state, api, forgetDevice } = useSession();
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
          await pushPending({
            api,
            storage,
            requestId: newId,
            onHalt: (failure) => onPushHalt(failure, { wipe: wipeLocalStorage, forgetDevice }),
          });
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
  }, [live, api, forgetDevice]);

  return null;
}
