import type { ReactNode } from "react";

import { NAV_ICONS } from "@/features/home/nav-icons";

/**
 * أيقونات أقسام المشغّل (تقرير تصميم الاشتراكات 2026-11-06 §١٥): خطّية بلون النص، 24×24 بسماكة 1.8
 * كأيقونات المتجر في `nav-icons` — مسارات مرسومة هنا لا مكتبة. لكل وجهة أيقونة لا تتكرر لغيرها.
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

export const PLATFORM_ICONS = {
  overview: NAV_ICONS.home,
  notices: NAV_ICONS.notify,
  messages: (
    <I>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </I>
  ),
  // إيصال
  proofs: (
    <I>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </I>
  ),
  // متجر
  tenants: NAV_ICONS.sellMarket,
  // مفتاح صلاحيات
  entitlements: (
    <I>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l2.5 2.5M14.5 8.5 16.5 10.5" />
    </I>
  ),
  // نافذة تطبيقات بأربعة مربعات
  apps: (
    <I>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <path d="M16.5 13v7M13 16.5h7" />
    </I>
  ),
  // جدول المستأجرين: شبكة صفوف وأعمدة
  directory: (
    <I>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </I>
  ),
  // أعمدة تحليلات الزوار
  analytics: (
    <I>
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V7M17 16v-7" />
    </I>
  ),
  // طبقات الباقات
  plans: (
    <I>
      <path d="m12 3 9 4.5-9 4.5-9-4.5z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </I>
  ),
  verifications: (
    <I>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </I>
  ),
  reports: (
    <I>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </I>
  ),
  disputes: (
    <I>
      <path d="M12 4v16M7 20h10" />
      <path d="M4 8h16" />
      <path d="m6.5 8-2.5 6a2.5 2.5 0 0 0 5 0zM17.5 8 15 14a2.5 2.5 0 0 0 5 0z" />
    </I>
  ),
  announcements: (
    <I>
      <path d="M4 10v4h3l7 4V6L7 10z" />
      <path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" />
    </I>
  ),
  outbound: (
    <I>
      <path d="M21 3 10 14" />
      <path d="M21 3 14.5 21 10 14 3 9.5z" />
    </I>
  ),
  demo: (
    <I>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="M8 14h3" />
    </I>
  ),
  m0: (
    <I>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </I>
  ),
  health: (
    <I>
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </I>
  ),
  backups: NAV_ICONS.data,
  operators: (
    <I>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </I>
  ),
  audit: (
    <I>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <circle cx="11.5" cy="14" r="2.5" />
      <path d="m13.4 15.9 2.1 2.1" />
    </I>
  ),
  // زرّ طيّ الشريط: لوحة بعمود جانبي
  rail: (
    <I>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </I>
  ),
} as const;
