import { Button, Frame } from "@sting/ui-web";
import { useState } from "react";
import { useNavigate } from "react-router";

import { BrandMark, BrandName } from "@/features/public/brand-mark";

import { markWelcomeSeen, WELCOME, type WelcomeLang } from "../platform/welcome";
import "./desk.css";

/**
 * ترحيب أول تشغيل (0005 §٢٥٨ — أمر المالك 2026-11-11): مزايا فيزانو بلص وخطوات تهيئة الجهاز، بالعربية
 * افتراضاً وبالإنجليزية بنقرة. تُعرض مرة واحدة قبل الدخول ثم تسلّم إلى الدخول؛ خطوات الإعداد نفسها
 * بحالاتها في DESK-01 بعد الدخول. ليست من حزمة التصميم — نصوصها معتمدة من المالك.
 */
export function DeskWelcome() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<WelcomeLang>("ar");
  const t = WELCOME[lang];

  return (
    <Frame title="فيزانو بلص" footer={null} back={false}>
      <div className="desk desk-welcome" data-screen="DESK-00" data-state="ready">
        <section
          className="c-card c-card--hero desk-welcome__card"
          lang={lang}
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <header className="desk-welcome__head">
            <span className="desk-welcome__brand" dir="rtl">
              <span className="desk-welcome__mark">
                <BrandMark />
              </span>
              <BrandName />
            </span>
            <div className="desk-welcome__langs" role="group" aria-label="اللغة · Language">
              <button
                type="button"
                className="desk-welcome__lang"
                aria-pressed={lang === "ar"}
                lang="ar"
                onClick={() => setLang("ar")}
              >
                العربية
              </button>
              <button
                type="button"
                className="desk-welcome__lang"
                aria-pressed={lang === "en"}
                lang="en"
                onClick={() => setLang("en")}
              >
                English
              </button>
            </div>
          </header>

          <div className="desk-welcome__intro">
            <h2 className="desk-welcome__title">{t.title}</h2>
            <p className="desk__sub">{t.lead}</p>
          </div>

          <div className="desk-welcome__cols">
            <div>
              <h3 className="desk__title">{t.featuresTitle}</h3>
              <ul className="desk-welcome__list">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="desk__title">{t.setupTitle}</h3>
              <ol className="desk-welcome__list desk-welcome__list--steps">
                {t.setup.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="desk-welcome__actions">
            <Button
              variant="primary"
              onClick={() => {
                markWelcomeSeen();
                void navigate("/login", { replace: true });
              }}
            >
              {t.start}
            </Button>
          </div>
        </section>
      </div>
    </Frame>
  );
}
