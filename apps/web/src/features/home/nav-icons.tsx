import type { ReactNode } from "react";

/**
 * أيقونات خطّية للتنقل (مراجعة 2026-10-18): لون النص نفسه (`currentColor`)، 24×24 بسماكة 1.8 —
 * تعمل فاتحاً وداكناً بلا ألوان إضافية. مسارات مرسومة هنا (لا مكتبة أيقونات).
 */
const I = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const NAV_ICONS = {
  home: (
    <I>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </I>
  ),
  search: (
    <I>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </I>
  ),
  sell: (
    <I>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M7 20h10M12 16v4" />
      <path d="M7 9h4" />
    </I>
  ),
  stock: (
    <I>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </I>
  ),
  reports: (
    <I>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-5M12 16V8M16 16v-3" />
    </I>
  ),
  buy: (
    <I>
      <path d="M3 4h2l2.4 11h11.2L21 7H6.2" />
      <circle cx="9" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </I>
  ),
  sellMarket: (
    <I>
      <path d="M3 9.5 4.5 4h15L21 9.5" />
      <path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12v8h14v-8" />
    </I>
  ),
  notify: (
    <I>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </I>
  ),
  org: (
    <I>
      <path d="M4 21V5l8-2v18M12 21h8V9l-8-2" />
      <path d="M7.5 8h1M7.5 12h1M7.5 16h1M15.5 12h1M15.5 16h1" />
    </I>
  ),
  device: (
    <I>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </I>
  ),
  data: (
    <I>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6.5c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V5.5" />
      <path d="M4.5 12v6.5c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V12" />
    </I>
  ),
  help: (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2-2.4 3.6" />
      <path d="M12 17h.01" />
    </I>
  ),
} as const;
