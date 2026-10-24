# نظام الخطوط — مواصفة

المرجع: Design Reference v2.3 §2، والقرار D-0007، و`docs/decisions/0005-…` §٢٠٣. المصدر الوحيد للقيم
`design_handoff_sting_systems/handoff/tokens.json`، ومنه يُولَّد `theme.css` و`tokens.native.ts` (`pnpm --filter @sting/design generate`).
هذه الوثيقة تصف القيم ولا تعرّفها: إن اختلفتا فالرموز هي الصحيحة، وتُحدَّث الوثيقة.

## العائلات — ثلاث لا غير

| العائلة | الأوزان | الاستعمال | الرمز |
|---|---|---|---|
| **Tajawal** | 400 / 500 / 700 / 800 | كل النص والعناوين | `--font-ui`، `--font-heading` = `Tajawal, system-ui, sans-serif` |
| **IBM Plex Mono** | 400 / 500 / 600 | كل الأرقام والتواريخ والأوقات والمبالغ والمعرفات والهواتف وعدّادات الشارات وأرقام الخطوات | `--font-mono` = `"IBM Plex Mono", ui-monospace, monospace` |
| **Reem Kufi** | 400–700 (مقتطع لحروف الاسم) | اسم الشعار «فيزانو بلص» وحده | `"Reem Kufi Wordmark"` |

لا تُحمَّل ولا تُعرَّف عائلة أخرى. `fonts.test.ts` يفشل إن عاد ملف عائلة رابعة إلى `packages/design/fonts`.

## الأرقام — قاعدة واحدة

```css
.num,
[data-num] {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  direction: ltr;
  unicode-bidi: isolate;
}
```

`.sting-mono` و`[data-mono]` اسمان بديلان في المحدِّد نفسه، إذ تفحصهما مواصفات Playwright. لا رقم بـTajawal،
ولا حرف عربي داخل عنصر رقمي. `pnpm lint:ui` (`num-class`) يفشل عند خلية أو span رقمية بلا أحد هذه الأسماء.

## السلّم

| الدور | الرمز | الحجم | الوزن | ارتفاع السطر |
|---|---|---|---|---|
| عنوان الصفحة | `--text-pageTitle` | 28px | 800 | 1.25 (`--leading-tight`) |
| عنوان القسم | `--text-sectionTitle` | 20px | 700 | 1.25 |
| عنوان البطاقة | `--text-cardTitle` | 16px | 700 | 1.4 (`--leading-snug`) |
| النص الأساسي | `--text-base` | 16px | 400 | 1.65 (`--leading-body`) |
| المتن | `--text-body` | 15px | 400 | 1.65 |
| المتن الكثيف والجداول | `--text-bodyDense` | 14px | 400 | 1.7 (`--leading-dense`) |
| النص الثانوي | `--text-note` | 14px | 500 | ≥ 1.6 (يرث 1.65) |
| الشارة | `--text-badge` / `--text-badgeMin` | 12.5px / 12px | 500 | — |

- **الأحجام:** 28 / 20 / 16 / 15 / 14 / 14 / 12.5.
- **ارتفاعات السطر:** 1.25 / 1.4 / 1.65 / 1.7.
- **الأوزان:** 400–800 من Tajawal: 400 و500 و700 و800، بلا 600 فيه. الوزن 600 لـPlex Mono وحده.
- **الموقع التعريفي:** يُوحَّد على هذا السلّم، ويُضاف له حجم display واحد للبطل (hero) هو **30px بوزن 700**.

## حدود Tajawal على الخلفية الداكنة

- لا نص عربي دون **14px** خارج الشارات. `pnpm lint:ui` (`small-font`) يمنع `font-size` < 14px خارج محدِّد شارة: `badge` أو `tag` أو `chip` أو `.c-status`.
- 12.5 أو 12px للشارات وحدها، بوزن **500**.
- النص الثانوي تحت صفوف الجدول **14px/500**.
- ارتفاع سطر النص الثانوي **≥ 1.6** (`note-leading`).
- الاستثناء الموثَّق بتعليق `ui-allow: السبب` لما ليس نصاً على الشاشة، ومنه:
  - الإيصال الحراري المطبوع بمقاسه الفيزيائي (`.c-print__receipt`، `.org-receipt__*`).
  - السهم الزخرفي.

## لا يُلمس

- Tajawal نفسه.
- Plex Mono في جدول التدقيق.
- تباعد الترويسة.
- الشعار.
