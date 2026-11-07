"use client";

import { Button, Frame } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import "./platform.css";
import { ThemeToggle } from "@/features/home/theme-toggle";
import { PLATFORM_ICONS } from "@/features/platform/platform-icons";
import {
  logoutOperator,
  operatorMustChangePassword,
  operatorName,
  operatorRole,
  operatorToken,
  platformApi,
} from "@/features/platform/operator-session";

export type PlatformSection =
  | "overview"
  | "notices"
  | "messages"
  | "tenants"
  | "login"
  | "proofs"
  | "announcements"
  | "outbound"
  | "verifications"
  | "reports"
  | "disputes"
  | "health"
  | "backups"
  | "m0"
  | "entitlements"
  | "demo"
  | "operators"
  | "audit"
  | "apps"
  | "plans"
  | "password";

/** شاشات بلا قائمة أقسام: الدخول وتغيير كلمة مرور مؤقتة (0005 §١٣٨). */
type Bare = "login" | "password";

type NavItem = { id: Exclude<PlatformSection, Bare>; label: string; badge?: "unread" | "messages" };

/**
 * أقسام المشغّل بعلاقة موضوعاتها (0005 §١٣٥): النظرة العامة أعلى القائمة بلا مجموعة، ثم ما يخصّ
 * التجار واشتراكاتهم (مراجعة الدفع أولاً — أكثرها تكراراً)، ثم الإشراف على السوق، ثم التواصل، ثم
 * النموّ، ثم النظام والفريق آخراً. جانبي على الحاسوب ودرج على الهاتف (C-NAV).
 */
const GROUPS: readonly { readonly title: string; readonly items: readonly NavItem[] }[] = [
  { title: "", items: [{ id: "overview", label: "النظرة العامة" }] },
  {
    // 0005 §١٩٠: ما وصل من التجار وينتظر نظر الفريق — فوق كل شيء بعد النظرة العامة
    title: "الوارد",
    items: [
      { id: "notices", label: "الإشعارات", badge: "unread" },
      { id: "messages", label: "الرسائل", badge: "messages" },
    ],
  },
  {
    title: "المستأجرون والاشتراكات",
    items: [
      { id: "proofs", label: "مراجعة الدفع" },
      { id: "tenants", label: "المستأجرون" },
      { id: "entitlements", label: "الاستحقاقات" },
      { id: "plans", label: "الباقات والتسعير" },
      // 0005 §٢١٥: ما يُوزَّع على التجار من نسخ التطبيق
      { id: "apps", label: "متجر التطبيقات" },
    ],
  },
  {
    title: "السوق والإشراف",
    items: [
      { id: "verifications", label: "طلبات التحقُّق" },
      { id: "reports", label: "البلاغات" },
      { id: "disputes", label: "الخلافات" },
    ],
  },
  {
    title: "التواصل",
    items: [
      { id: "announcements", label: "الإعلانات" },
      { id: "outbound", label: "الإرسال" },
    ],
  },
  {
    title: "النموّ",
    items: [
      { id: "demo", label: "طلبات الجولة" },
      { id: "m0", label: "لوحة الاكتساب" },
    ],
  },
  {
    title: "النظام والفريق",
    items: [
      { id: "health", label: "الصحة" },
      { id: "backups", label: "النسخ" },
      { id: "operators", label: "المشغّلون" },
      { id: "audit", label: "سجل التدقيق" },
    ],
  },
];

const HREF: Record<Exclude<PlatformSection, Bare>, string> = {
  overview: "/platform",
  notices: "/platform/notices",
  messages: "/platform/messages",
  tenants: "/platform/tenants",
  proofs: "/platform/proofs",
  entitlements: "/platform/entitlements",
  verifications: "/platform/verifications",
  reports: "/platform/reports",
  disputes: "/platform/disputes",
  outbound: "/platform/outbound",
  announcements: "/platform/announcements",
  health: "/platform/health",
  backups: "/platform/backups",
  m0: "/platform/m0",
  demo: "/platform/demo-requests",
  operators: "/platform/operators",
  audit: "/platform/audit",
  plans: "/platform/plans",
  apps: "/platform/apps",
};

/** مفتاح الشريط المطويّ — تفضيل عرض على هذا الجهاز لا بيانات (الجلسة نفسها لا تُحفظ هنا). */
const RAIL_KEY = "vz-plt-rail";
/** مجموعة الوارد تبقى مفتوحة: عدّاداتها تنبيه لا يُخفى خلف عنوان مطويّ. */
const ALWAYS_OPEN = "الوارد";

/**
 * القائمة الجانبية للمشغّل بأنماط C-NAV — روابط حقيقية: الجلسة تبقى بعد التحميل (§١٦٨) فيُفتح القسم
 * في تبويب ويظهر في سجل المتصفح (فحص 2026-10-17 VP13).
 *
 * تقرير تصميم الاشتراكات 2026-11-06 (0005 §٢١٢): أيقونة لكل رابط، والمجموعات تُطوى كقائمة المتجر
 * (مجموعة الصفحة الحالية والوارد مفتوحتان)، وعلى الحاسوب زرّ يطوي الشريط إلى أيقونات فيتسع المحتوى.
 * الاسم يبقى في الرابط مخفياً بصرياً عند الطيّ (اسم ميسَّر)، ويظهر تلميحاً عند المرور والتركيز.
 */
export function PlatformNav({ current }: { current: PlatformSection }) {
  // تلميح الشريط المطويّ: عنصر ثابت الموضع (لا يقصّه تمرير القائمة) عند المرور والتركيز
  const [tip, setTip] = useState<{ text: string; top: number; right: number } | null>(null);
  const showTip = (e: { target: EventTarget }) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (!rail) return;
    if (!el) {
      setTip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTip({
      text: el.dataset.tip ?? "",
      top: r.top + r.height / 2,
      right: window.innerWidth - r.left + 8,
    });
  };
  // عدّادا الوارد: إشعارات غير مقروءة ورسائل جديدة — يُحدَّثان كل دقيقة وعند تغيير القسم
  const [counts, setCounts] = useState<{ unread: number; messages: number }>({
    unread: 0,
    messages: 0,
  });
  const currentGroup = GROUPS.find((g) => g.items.some((i) => i.id === current))?.title ?? "";
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set([ALWAYS_OPEN, currentGroup].filter(Boolean)),
  );
  // الانتقال إلى قسم في مجموعة مطويّة يفتحها (من النظرة العامة أو رابط داخل المحتوى)
  useEffect(() => {
    if (currentGroup)
      setOpen((prev) => (prev.has(currentGroup) ? prev : new Set([...prev, currentGroup])));
  }, [currentGroup]);
  const [rail, setRail] = useState(false);
  useEffect(() => {
    try {
      setRail(localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* تخزين محجوب: الشريط موسّع */
    }
  }, []);
  const toggleRail = () =>
    setRail((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? "0" : "1");
      } catch {
        /* تخزين محجوب: التفضيل لهذه الجلسة فقط */
      }
      return !r;
    });
  const toggleGroup = (g: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!operatorToken()) return;
      try {
        const { data, response } = await platformApi().GET("/api/platform/notices", {
          params: { query: { limit: 1 } },
        });
        const b = data as unknown as { unread?: number; new_messages?: number } | undefined;
        if (alive && response.ok && b)
          setCounts({ unread: b.unread ?? 0, messages: b.new_messages ?? 0 });
      } catch {
        /* بلا اتصال: العدّاد يبقى كما كان */
      }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [current]);
  const link = (it: NavItem) => {
    const n = it.badge ? counts[it.badge] : 0;
    return (
      <Link
        key={it.id}
        href={HREF[it.id]}
        className="c-nav__item plt-nav__item"
        aria-current={current === it.id ? "page" : undefined}
        data-tip={it.label}
      >
        <span className="c-nav__icon" aria-hidden="true">
          {PLATFORM_ICONS[it.id]}
        </span>
        <span className="plt-nav__label">{it.label}</span>
        {n > 0 ? (
          <span className="plt-nav__badge sting-mono" aria-label={`${n} جديد`}>
            {n}
          </span>
        ) : null}
      </Link>
    );
  };
  return (
    <nav
      aria-label="أقسام المشغّل"
      className="plt-nav"
      data-rail={rail || undefined}
      onMouseOver={showTip}
      onFocus={showTip}
      onMouseLeave={() => setTip(null)}
      onBlur={() => setTip(null)}
    >
      <button
        type="button"
        className="plt-nav__rail"
        aria-pressed={rail}
        aria-label={rail ? "وسّع القائمة" : "اطوِ القائمة"}
        data-tip={rail ? "وسّع القائمة" : "اطوِ القائمة"}
        onClick={toggleRail}
      >
        <span className="c-nav__icon" aria-hidden="true">
          {PLATFORM_ICONS.rail}
        </span>
        <span className="plt-nav__label">اطوِ القائمة</span>
      </button>
      <ul className="c-nav c-nav--side c-nav--collapsible">
        {GROUPS.map((g, gi) => {
          if (!g.title) return g.items.map((it) => <li key={it.id}>{link(it)}</li>);
          // مطويّ الشريط: كل الأيقونات ظاهرة (لا عناوين تُفتح)
          const isOpen = rail || open.has(g.title);
          const panelId = `plt-nav-g${gi}`;
          return (
            <li key={g.title} className="c-nav__section" data-open={isOpen || undefined}>
              <button
                type="button"
                className="c-nav__group c-nav__group--toggle"
                aria-expanded={isOpen}
                aria-controls={panelId}
                data-current={g.title === currentGroup || undefined}
                data-keep-nav
                onClick={() => toggleGroup(g.title)}
              >
                <span className="c-nav__group-label">{g.title}</span>
                <span className="c-nav__chevron" aria-hidden="true" />
              </button>
              <ul id={panelId} className="c-nav__sub" hidden={!isOpen}>
                {g.items.map((it) => (
                  <li key={it.id}>{link(it)}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {rail && tip ? (
        <span
          className="plt-nav__tip"
          aria-hidden="true"
          style={{ top: tip.top, right: tip.right }}
        >
          {tip.text}
        </span>
      ) : null}
    </nav>
  );
}

/** ترويسة المشغّل داخل شريط الإطار: شارة ADMIN، التلميح المرسوم، اسم المشغّل وخروج. */
function PlatformBanner({ current }: { current: PlatformSection }) {
  const router = useRouter();
  // شاشتا الدخول وكلمة المرور: البطاقة تحمل الشارة والتلميح — لا تكرار في الترويسة
  const bare = current === "login" || current === "password";
  return (
    <div className={`plt-banner${bare ? " plt-banner--bare" : ""}`}>
      {bare ? null : (
        <>
          <span className="plt-badge plt-badge--admin">ADMIN</span>
          <span className="plt-banner__hint">إطار منفصل عن تطبيق المتاجر · كل فتح سجل يُدقَّق</span>
        </>
      )}
      {/* 0005 §١١٨ — إضافة خارج الإطار: صلاحية «الدعم» معلنة لا مفاجأة عند أول زرّ */}
      {current !== "login" && operatorRole() === "support" ? (
        <span
          className="plt-badge plt-badge--support"
          title="التغيير لمدير المنصة عدا طلبات الجولة"
        >
          الدعم — قراءة فقط
        </span>
      ) : null}
      {current !== "login" ? (
        <div className="plt-banner__user">
          <ThemeToggle className="plt-banner__theme" />
          <span className="plt-banner__name">{operatorName()}</span>
          <Button
            variant="quiet"
            className="plt-banner__logout"
            onClick={() => {
              void logoutOperator().then(() => router.push("/platform/login"));
            }}
          >
            خروج
          </Button>
        </div>
      ) : (
        <div className="plt-banner__user">
          <ThemeToggle className="plt-banner__theme" />
        </div>
      )}
    </div>
  );
}

/**
 * إطار مساحة المشغّل الموحَّد: ترويسة كحلية بعنوان «إدارة فيزانو — مشغّل الخدمة» وشارة ADMIN،
 * قائمة جانبية على الحاسوب وشريط أفقي على الهاتف، بلا زرّ رجوع (التنقل من القائمة).
 */
export function PlatformFrame({
  current,
  children,
}: {
  current: PlatformSection;
  children: ReactNode;
}) {
  const router = useRouter();
  const pendingPassword =
    current !== "login" && current !== "password" && operatorMustChangePassword();
  // 0005 §١٣٨ — كلمة مؤقتة: كل قسم يعيد إلى تغييرها (الخادم يرفض بـ403 على أي حال)
  useEffect(() => {
    if (pendingPassword) router.replace("/platform/password");
  }, [pendingPassword, router]);
  return (
    <Frame
      title="إدارة فيزانو بلص — مشغّل الخدمة"
      back={false}
      banner={<PlatformBanner current={current} />}
      nav={
        current === "login" || current === "password" ? undefined : (
          <PlatformNav current={current} />
        )
      }
      footer={null}
    >
      {children}
    </Frame>
  );
}
