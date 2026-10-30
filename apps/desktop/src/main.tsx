import "@sting/design/fonts.css";
import "@/app/fonts.generated.css";
import "@sting/ui-web/styles.css";
import "./fonts.css";

import { StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, useLocation } from "react-router";

import { Providers } from "@/app/providers";

import * as NotFound from "@/app/not-found";

import { PageHost } from "./page-host";
import { DesktopRoot } from "./platform/desktop-root";
import { installExternalLinks } from "./platform/external-links";
import { detectOs, inTauri } from "./platform/tauri";
import { ROUTES } from "./generated/routes";

/** Next يعيد التمرير إلى الأعلى عند كل انتقال — السلوك نفسه هنا. */
function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** جذر الويب (`app/layout.tsx`) بلا Next: المزوّدون أنفسهم حول كل شاشة. */
function Root() {
  return (
    <Providers>
      <ScrollTop />
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </Providers>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      ...ROUTES.map((r) => ({
        path: r.path,
        element: r.path === "/" && inTauri ? <DesktopRoot /> : <PageHost mod={r.mod} />,
      })),
      { path: "*", element: <PageHost mod={NotFound} /> },
    ],
  },
]);

if (inTauri) {
  document.documentElement.dataset.os = detectOs(navigator.userAgent);
  installExternalLinks();
}

// خطاف Next في التطوير (`window.next.router`) تستعمله مواصفات الويب للتنقّل بلا إعادة تحميل — نفسه هنا
if (process.env.NODE_ENV !== "production") {
  (window as unknown as { next: unknown }).next = {
    router: { push: (href: string) => void router.navigate(href) },
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
