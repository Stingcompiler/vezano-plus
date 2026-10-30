import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { inTauri } from "./tauri";

/** عنصر من قائمة ماك الأصلية (src-tauri/src/menu.rs) ← الشاشة نفسها داخل التطبيق */
export function MenuEvents() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | null = null;
    void listen<string>("desk://navigate", (e) => void navigate(e.payload)).then((u) => (off = u));
    return () => off?.();
  }, [navigate]);
  return null;
}
