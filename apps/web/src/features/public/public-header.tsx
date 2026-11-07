"use client";

import { Button } from "@sting/ui-web";

import { ThemeToggle } from "@/features/home/theme-toggle";
import { usePathname, useRouter } from "next/navigation";
import { type CSSProperties, type MouseEvent, useEffect, useState } from "react";

import "./landing.css";
import { BrandMark, BrandName } from "@/features/public/brand-mark";

/**
 * الترويسة العامة الموحَّدة (الهبوط، الترحيب، الدخول، التسجيل، الشروط، الحالة): شعار فيزانو (علامة الأعمدة)،
 * روابط الأقسام، زرّ الدعوة، وعلى الهاتف زرّ قائمة يفتح لوحة الروابط واللغة ومبدّل المظهر.
 * روابط الأقسام تنزلق داخل صفحة الهبوط وتنتقل إليها من غيرها.
 */
// تقرير الموقع العام 2026-11-07: مجموعتان — المنتج (أقسام الرئيسية والباقات والتواصل)، ثم السوق
// والثقة (صفحات مستقلة). على الهاتف فاصل بينهما بدل سبعة صفوف متساوية.
const LINKS: readonly { href: string; label: string; group: "product" | "more" }[] = [
  { href: "/#lp-features", label: "المزايا", group: "product" },
  { href: "/plans", label: "الباقات", group: "product" },
  { href: "/#lp-faq", label: "أسئلة شائعة", group: "product" },
  { href: "/#lp-contact", label: "تواصل", group: "product" },
  { href: "/market", label: "السوق", group: "more" },
  { href: "/status", label: "حالة الخدمة", group: "more" },
  { href: "/legal", label: "الشروط", group: "more" },
];

/**
 * `minimal` (صفحات الدخول والتسجيل والترحيب — مراجعة 2026-10-18): الشعار والمظهر وزرّ واحد، بلا روابط
 * التسويق السبعة التي تشتّت عن إكمال الدخول.
 */
export function PublicHeader({
  cta = "login",
  minimal = false,
}: {
  cta?: "login" | "register" | "none";
  minimal?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // على الهاتف فقط: يختفي بعد تمرير متّصل للأسفل ويعود بعد تمرير متّصل للأعلى — بتراكم ≥ 24px
  // كي لا يرتجف مع الاهتزازات الصغيرة؛ على الحاسوب يبقى ثابتاً دائماً
  const [hidden, setHidden] = useState(false);
  // ظلّ ناعم تحت الشريط بعد أول تمرير — يفصله عن المحتوى (0005 §١٤٤)
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 833px)");
    let last = window.scrollY;
    let acc = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        setScrolled(window.scrollY > 8);
        if (!mq.matches) {
          setHidden(false);
          return;
        }
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const delta = y - last;
        last = y;
        if (y <= 0 || y >= max - 2) {
          acc = 0;
          setHidden(false);
          return;
        }
        acc = Math.sign(delta) === Math.sign(acc) ? acc + delta : delta;
        if (y > 120 && acc > 24) setHidden(true);
        else if (acc < -24) setHidden(false);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (href: string) => (e: MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    const hash = href.startsWith("/#") ? href.slice(2) : null;
    if (hash && pathname === "/") {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    router.push(href);
  };

  const ctaLabel = cta === "register" ? "حساب جديد" : "تسجيل الدخول";
  const ctaHref = cta === "register" ? "/register" : "/login";

  return (
    <div
      className={`lp__header${minimal ? " lp__header--minimal" : ""}${menuOpen ? " lp__header--open" : ""}${hidden && !menuOpen ? " lp__header--hidden" : ""}${scrolled ? " lp__header--scrolled" : ""}`}
    >
      <div className="lp__wrap lp__bar">
        <a className="lp__brand" href="/" onClick={go("/")}>
          <span className="lp__mark" aria-hidden="true">
            <BrandMark />
          </span>
          <BrandName />
        </a>
        {minimal ? (
          <span className="lp__spacer" />
        ) : (
          <nav id="lp-links" className="lp__links" aria-label="الصفحات العامة">
            {LINKS.map((l, i) => (
              <a
                key={l.href}
                href={l.href}
                onClick={go(l.href)}
                aria-current={pathname === l.href ? "page" : undefined}
                data-group-start={i > 0 && LINKS[i - 1]?.group !== l.group ? true : undefined}
                style={{ "--i": i } as CSSProperties}
              >
                {l.label}
              </a>
            ))}
            <div className="lp__links-foot">
              <Button variant="secondary" onClick={go("/register")} className="lp__links-cta">
                ابدأ تجربتك المجانية
              </Button>
              <div className="lp__links-tools">
                <span className="lp__lang" aria-label="اللغة: العربية">
                  <span aria-hidden="true">🌐</span> العربية
                </span>
                <ThemeToggle className="lp__theme" />
              </div>
            </div>
          </nav>
        )}
        <ThemeToggle className="lp__theme lp__theme--bar" />
        {cta !== "none" ? (
          <Button pos onClick={go(ctaHref)} className="lp__login">
            {ctaLabel}
          </Button>
        ) : null}
        {minimal ? null : (
          <button
            type="button"
            className="lp__menu"
            aria-expanded={menuOpen}
            aria-controls="lp-links"
            aria-label={menuOpen ? "أغلق القائمة" : "القائمة"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {/* ثلاثة خطوط تتحوّل إلى ✕ بحركة (عند «تقليل الحركة» تتبدّل فوراً) */}
            <span className="lp__burger" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
