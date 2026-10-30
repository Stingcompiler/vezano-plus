import { Navigate } from "react-router";

import { HomeClient } from "@/features/home/home-client";
import { useApp } from "@/lib/app-context";

/** جذر التطبيق داخل Tauri: الرئيسية لمن له جلسة، وإلا الدخول — لا صفحة الهبوط التسويقية (الخطة §٣). */
export function DesktopRoot() {
  const app = useApp();
  if ((app.tokens || app.expired) && app.session.tenantId) return <HomeClient />;
  if (app.restoring) return <div className="restore-gate" aria-busy="true" data-restoring="" />;
  return <Navigate to="/login" replace />;
}
