import { useMemo } from "react";
import { useLocation, useNavigate, useParams as useRouteParams } from "react-router";

import { isPublicPath, openExternal, SITE, inTauri } from "../platform/tauri";

/**
 * بديل `next/navigation` فوق React Router — الشاشات المستوردة من الويب تستدعي هذه الأسماء بالتوقيعات نفسها.
 * المغطّى ما تستعمله الشاشات فعلاً (useRouter وusePathname وuseSearchParams)؛ أي استيراد آخر من Next
 * داخل `features` يمنعه فحص `scripts/check-next-imports.mjs`.
 */
export interface AppRouter {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

/** داخل Tauri: الصفحات العامة تفتح في المتصفح (الخطة §٣) */
const leaves = (href: string) => inTauri && isPublicPath(href);

export function useRouter(): AppRouter {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href) => (leaves(href) ? void openExternal(`${SITE}${href}`) : void navigate(href)),
      replace: (href) =>
        leaves(href) ? void openExternal(`${SITE}${href}`) : void navigate(href, { replace: true }),
      back: () => void navigate(-1),
      forward: () => void navigate(1),
      // البيانات من TanStack Query والتخزين المحلي — لا مكوّنات خادم تُعاد
      refresh: () => undefined,
      prefetch: () => undefined,
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRouteParams() as T;
}

export type ReadonlyURLSearchParams = URLSearchParams;
