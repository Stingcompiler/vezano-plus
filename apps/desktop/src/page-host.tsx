import { type ReactNode, use, useLayoutEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router";

import { SITE_NAME } from "@/features/public/site";

/**
 * يرسم صفحة ويب (`apps/web/src/app/**\/page.tsx`) كما يرسمها Next: يمرّر `params` و`searchParams` وعدين.
 * صفحات الويب أغلفة رقيقة (كثير منها `async` يقرأ `await params`) حول مكوّن `*-client` — فتُستدعى هنا
 * مباشرةً بلا تعديل عليها (docs/desktop-plan.md §٢).
 */
export interface PageModule {
  /** كل صفحة تعلن شكل معاملاتها (`{ id: string }`…) — `never` يقبلها كلها، والاستدعاء بـ`PageProps` */
  readonly default: (props: never) => ReactNode | Promise<ReactNode>;
  readonly metadata?: { readonly title?: unknown };
}

/** عنوان النافذة كما يبنيه Next من `metadata` والقالب في `app/layout.tsx` — والإطار يكمله بعنوانه */
const DEFAULT_TITLE = `${SITE_NAME} — نقطة بيع ومخزون وذمم تعمل بلا اتصال`;
function windowTitle(meta: PageModule["metadata"]): string {
  const t = meta?.title;
  if (typeof t === "string") return `${t} · ${SITE_NAME}`;
  if (t && typeof t === "object" && "absolute" in t) return String(t.absolute);
  return DEFAULT_TITLE;
}

interface PageProps {
  readonly params: Promise<Record<string, string>>;
  readonly searchParams: Promise<Record<string, string | string[]>>;
}

type Settled<T> = Promise<T> & { status?: "fulfilled"; value?: T };

/** وعد محلول سلفاً بعلامته — `use()` يقرؤه فوراً بلا تعليق (لا وميض بين الشاشات). */
function settled<T>(value: T): Settled<T> {
  const p = Promise.resolve(value) as Settled<T>;
  p.status = "fulfilled";
  p.value = value;
  return p;
}

function searchRecord(search: string): Record<string, string | string[]> {
  const rec: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(search)) {
    const prev = rec[k];
    rec[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return rec;
}

/** نتيجة الصفحات `async` لكل عنوان — تُحسب مرة فلا تعيد الصفحة التحميل عند كل رسم. */
const asyncResults = new Map<string, Promise<ReactNode>>();

export function PageHost({ mod }: { mod: PageModule }) {
  const params = useParams() as Record<string, string>;
  const { pathname, search } = useLocation();
  const Page = mod.default as unknown as (props: PageProps) => ReactNode | Promise<ReactNode>;
  const isAsync = Page.constructor.name === "AsyncFunction";
  const props = useMemo<PageProps>(
    // المعاملات تُشتقّ من العنوان كاملاً — فهو المفتاح
    () => ({ params: settled({ ...params }), searchParams: settled(searchRecord(search)) }),
    [pathname, search],
  );
  // قبل تأثيرات الإطار (الأبناء): Frame لا يبدّل إلا العنوان الافتراضي، كما يجده في Next
  useLayoutEffect(() => {
    document.title = windowTitle(mod.metadata);
  }, [mod, pathname]);
  if (!isAsync) {
    const Sync = Page as (p: PageProps) => ReactNode;
    return <Sync {...props} />;
  }
  const key = pathname + search;
  let result = asyncResults.get(key);
  if (!result) {
    result = Promise.resolve(Page(props)).then((node) => {
      (result as Settled<ReactNode>).status = "fulfilled";
      (result as Settled<ReactNode>).value = node;
      return node;
    });
    asyncResults.set(key, result);
  }
  return use(result);
}
