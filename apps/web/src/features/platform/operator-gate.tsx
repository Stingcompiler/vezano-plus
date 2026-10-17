"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { operatorToken, resumeOperator } from "@/features/platform/operator-session";

/**
 * حاجز مساحة المشغّل (0005 §١٦٨ — فحص 2026-10-17 VP01): بلا رمز في الذاكرة (إعادة تحميل أو رابط
 * مباشر) يُستأنف من الـCookie قبل تركيب الصفحة؛ فشل الاستئناف وحده يقود إلى الدخول بوجهة العودة.
 */
export function OperatorGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/platform/login";
  const [ready, setReady] = useState(() => isLogin || Boolean(operatorToken()));
  useEffect(() => {
    if (ready || isLogin) return;
    let alive = true;
    void resumeOperator().then((ok) => {
      if (!alive) return;
      if (ok) setReady(true);
      else {
        const here = `${location.pathname}${location.search}`;
        router.replace(`/platform/login?next=${encodeURIComponent(here)}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [ready, isLogin, router]);
  if (!ready && !isLogin) return <div className="restore-gate" aria-busy="true" data-restoring="" />;
  return <>{children}</>;
}
