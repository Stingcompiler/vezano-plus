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
import { FileSaveHost, installDownloads } from "./platform/file-save";
import { MenuEvents } from "./platform/menu-events";
import { ShortcutRunner } from "./platform/shortcut-runner";
import { DeskNotifications, CloseGuard } from "./screens/desk-notifications";
import { DeskPrinters } from "./screens/desk-printers";
import { DeskSetup } from "./screens/desk-setup";
import { DeskShortcuts } from "./screens/desk-shortcuts";
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
      <CloseGuard />
      <FileSaveHost />
      <ShortcutRunner />
      <MenuEvents />
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
      // شاشات الحاسوب وحده (DESK-01…05) — لا مقابل لها في الويب
      { path: "/desktop/setup", element: <DeskSetup /> },
      { path: "/desktop/printers", element: <DeskPrinters /> },
      { path: "/desktop/shortcuts", element: <DeskShortcuts /> },
      { path: "/desktop/notifications", element: <DeskNotifications /> },
      { path: "*", element: <PageHost mod={NotFound} /> },
    ],
  },
]);

if (inTauri) {
  document.documentElement.dataset.os = detectOs(navigator.userAgent);
  installExternalLinks();
}
// اعتراض التنزيل (DESK-04): داخل Tauri دائماً؛ وفي التطوير متاح للمواصفات بطلبها (`__stingDesk.downloads`)
if (inTauri || import.meta.env.DEV) installDownloads();

// خطاف Next في التطوير (`window.next.router`) تستعمله مواصفات الويب للتنقّل بلا إعادة تحميل — نفسه هنا
if (import.meta.env.DEV) {
  (window as unknown as { next: unknown }).next = {
    router: { push: (href: string) => void router.navigate(href) },
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
