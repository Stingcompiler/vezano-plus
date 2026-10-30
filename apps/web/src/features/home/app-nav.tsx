"use client";

import { NAV_GROUPS, NAV_ITEMS } from "@sting/app-core";
import { Nav } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { LogoutButton } from "@/features/home/logout-button";
import { NAV_ICONS } from "@/features/home/nav-icons";
import { ThemeToggle } from "@/features/home/theme-toggle";
import { adaptNavItems } from "@/lib/nav-extras";
import "./home.css";

/**
 * التنقل الرئيسي داخل التطبيق (0005 §١٣٤): مجموعات بعلاقة موضوعاتها وبترتيب تكرار الاستعمال — البيع
 * اليومي أولاً، والتقنيّ آخراً. المجموعات تُطوى (مجموعة الصفحة الحالية مفتوحة) فتبقى القائمة قصيرة
 * على الحاسوب والدرج. الرئيسية والبحث بلا مجموعة ظاهران دائماً. التسميات ثابتة (المواصفات تنقر بها).
 * انتقال عميلي يحفظ الجلسة في الذاكرة (§٩.٤: لا localStorage).
 */
// العناصر من `@sting/app-core` (مشتركة مع الجوال)؛ الأيقونات خاصة بالويب فتُضاف هنا (0005 §١٧١)
const LOOSE_ICONS: Readonly<Record<string, (typeof NAV_ICONS)[keyof typeof NAV_ICONS]>> = {
  home: NAV_ICONS.home,
  search: NAV_ICONS.search,
};
const ITEMS = adaptNavItems(NAV_ITEMS).map((i) =>
  LOOSE_ICONS[i.id] ? { ...i, icon: LOOSE_ICONS[i.id] } : i,
);
const G = NAV_GROUPS;
const GROUP_ICONS = {
  [G.sell]: NAV_ICONS.sell,
  [G.stock]: NAV_ICONS.stock,
  [G.reports]: NAV_ICONS.reports,
  [G.buy]: NAV_ICONS.buy,
  [G.sellMarket]: NAV_ICONS.sellMarket,
  [G.notify]: NAV_ICONS.notify,
  [G.org]: NAV_ICONS.org,
  [G.device]: NAV_ICONS.device,
  [G.data]: NAV_ICONS.data,
  [G.help]: NAV_ICONS.help,
};

/** بحث شامل في طرف الترويسة (مراجعة 2026-10-18) — يُرسم في فتحة `#frame-banner-end` من الإطار. */
function BannerSearch({ hidden }: { hidden: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("frame-banner-end")), []);
  if (!slot || hidden) return null;
  return createPortal(
    <Link href="/search" className="app-search">
      <span className="app-search__icon" aria-hidden="true">
        {NAV_ICONS.search}
      </span>
      <span className="app-search__text">ابحث عن صنف أو فاتورة أو عميل</span>
    </Link>,
    slot,
  );
}

export function AppNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  return (
    <>
      <BannerSearch hidden={currentId === "search"} />
      <Nav
        label="التنقل الرئيسي"
        currentId={currentId}
        items={ITEMS}
        collapsible
        groupIcons={GROUP_ICONS}
        onNavigate={(item) => router.push(item.href)}
      />
      {/* المظهر الفاتح/الداكن — آخر عنصر في القائمة الجانبية، وحبّة في شريط الهاتف */}
      <div className="app-nav__tools">
        <ThemeToggle label />
        <LogoutButton />
      </div>
    </>
  );
}
