import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useNavigate } from "react-router";

/** بديل `next/link`: رابط عادي يتنقّل داخل التطبيق، والروابط الخارجية تفتح في المتصفح (طبقة المنصة). */
type Href = string | { pathname?: string; query?: Record<string, string>; hash?: string };

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  readonly href: Href;
  readonly replace?: boolean;
  readonly prefetch?: boolean | null;
  readonly scroll?: boolean;
}

function toUrl(href: Href): string {
  if (typeof href === "string") return href;
  const q = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
  return `${href.pathname ?? ""}${q}${href.hash ? `#${href.hash}` : ""}`;
}

const isExternal = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url);

export default function Link(props: LinkProps) {
  // prefetch/scroll خيارات Next لا أثر لها هنا — تُنزع كي لا تصل إلى <a>
  const { href, replace, onClick, ...anchor } = props;
  const rest = { ...anchor };
  delete rest.prefetch;
  delete rest.scroll;
  const navigate = useNavigate();
  const url = toUrl(href);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    if (rest.target || isExternal(url)) return;
    e.preventDefault();
    void navigate(url, replace ? { replace: true } : {});
  };
  return <a href={url} onClick={handle} {...rest} />;
}
