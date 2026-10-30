import { NAV_GROUPS, type NavItem } from "@sting/app-core";

/**
 * بديل `@/lib/nav-extras` في تطبيق الحاسوب: شاشات المتصفح في «الأجهزة والمزامنة» تُستبدل بشاشات DESK،
 * وتُضاف الاختصارات والإشعارات. في المتصفح (المواصفات) يبقى تنقل الويب كما هو فلا تتغيّر مواصفاته.
 */
import { inTauri } from "./tauri";

const REPLACE: Readonly<Record<string, string>> = {
  print: "/desktop/printers",
  update: "/desktop/setup",
};

const ADD: readonly NavItem[] = [
  {
    id: "desk-shortcuts",
    label: "الاختصارات",
    href: "/desktop/shortcuts",
    group: NAV_GROUPS.device,
  },
  {
    id: "desk-notify",
    label: "الإشعارات وسلوك الإغلاق",
    href: "/desktop/notifications",
    group: NAV_GROUPS.device,
  },
];

export function adaptNavItems(items: readonly NavItem[]): readonly NavItem[] {
  if (!inTauri) return items;
  const out = items
    .filter((i) => i.id !== "install")
    .map((i) => (REPLACE[i.id] ? { ...i, href: REPLACE[i.id]! } : i));
  const at = out.findIndex((i) => i.id === "print") + 1;
  return [...out.slice(0, at), ...ADD, ...out.slice(at)];
}
