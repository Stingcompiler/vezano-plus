import { nativeRoute } from "@/lib/routes";
import { openOnWeb } from "@/lib/web";

/** مسار ويب لشاشة قد تكون خارج الكتالوج (المخزون مثلاً). */
export type CreateRoute = `/${string}`;

interface PushRouter {
  push: (href: never) => void;
}

/**
 * يفتح عنوان ويب داخل التطبيق إن كان له مسار أصلي في `lib/routes` (يملكه من يبني الشاشة)، وإلا يفتحه على
 * الويب — فلا يتعطّل زرّ يشير إلى شاشة لم تُبنَ بعد.
 */
export function goHref(router: PushRouter, href: CreateRoute): void {
  const native = nativeRoute(href);
  if (native) router.push(native as never);
  else void openOnWeb(href);
}
