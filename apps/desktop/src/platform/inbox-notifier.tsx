import { useEffect } from "react";

import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

import { type InboxItem, nextRound, readSeen, writeSeen } from "./inbox-notify";
import { native } from "./native";
import { inTauri } from "./tauri";

/** دقيقة بين الجولات: تنبيه تشغيلي لا محادثة فورية، وطلب واحد خفيف لكل جولة. */
const POLL_MS = 60_000;

/**
 * يتابع الوارد ما دام التطبيق يعمل والجلسة قائمة والشبكة متاحة، ويُظهر إشعار نظام للجديد (DESK-05).
 * يُركَّب مرة في جذر التطبيق. داخل Tauri دائماً؛ وفي المتصفح (المواصفات) بطلب صريح `__stingDesk.inbox`
 * حتى لا يزيد طلباً على مواصفات الويب.
 */
export function InboxNotifier() {
  const app = useApp();
  const online = useOnline();
  const tenantId = app.session.tenantId ?? "";
  const signedIn = Boolean(app.tokens) && tenantId !== "";

  useEffect(() => {
    const fake = window.__stingDesk?.inbox;
    if (!(inTauri || fake) || !signedIn || !online) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        if ((await native.notifyPermission()) !== "granted") return;
        const { data, response } = await api().GET("/api/notifications", {
          params: { query: {} },
        });
        if (stopped || !response.ok || !data) return;
        const items = (data as unknown as { items?: InboxItem[] }).items ?? [];
        const round = nextRound(items, readSeen(tenantId), { focused: document.hasFocus() });
        writeSeen(tenantId, round.seen);
        for (const n of round.notify) await native.notify(n.title, n.body);
      } catch {
        /* جولة فاشلة (شبكة، خادم): التالية تعيد — لا إشعار عن الفشل نفسه */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), fake?.pollMs ?? POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [signedIn, online, tenantId]);

  return null;
}
