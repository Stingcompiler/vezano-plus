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
      ...ROUTES.map((r) => ({ path: r.path, element: <PageHost mod={r.mod} /> })),
      { path: "*", element: <PageHost mod={NotFound} /> },
    ],
  },
]);

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
