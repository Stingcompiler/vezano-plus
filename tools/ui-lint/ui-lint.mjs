#!/usr/bin/env node
// فحص الأنماط الممنوعة في الواجهة (docs/ui-profile.md §«الأنماط الممنوعة»؛ 0005 §١٥٨).
// ينتهي بالفشل (1) ويعرض المواضع إن وُجدت مخالفة غير مستثناة، وبنجاح بلا مخرجات إن خلا النطاق.
// الاستثناء الموثَّق: تعليق `ui-allow: السبب` على سطر المخالفة أو داخل قاعدته أو السطر الذي قبلها.
// يكشف أنماطاً معروفة فقط ويمكن الالتفاف عليه — لا يحكم على الأناقة ولا يغني عن المراجعة البصرية.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCOPE = ["apps/web/src", "packages/ui-web/src"];
const NEUTRAL = /var\(--color-border\)|currentColor|transparent/;
// حدود Tajawal (0005 §٢٠٣ B3): 12–12.5px للشارات وحدها؛ لا نص دون 14px خارجها
const BADGE = /badge|(?:^|[-_.])tag\b|chip|\.c-status\b/;
const SMALL_FONT =
  /font-size\s*:\s*(var\(--text-(?:badge|badgeMin)\b[^)]*\)|(?:1[0-3]|\d)(?:\.\d+)?px|0?\.(?:[0-7]\d*|8|8[0-6]\d*)r?em\b)/;
// قاعدة الأرقام الواحدة (B2): عنصر رقمي مباشر بلا .num (أو بديله .sting-mono / data-num / data-mono)
const NUM_FMT =
  "formatMinor\\w*|formatQty|qty|num|trimQty|maskPhone|hhmm|hhmmss|fullDate|pct|wholeMinor|Number";
const NUM_EL = new RegExp(
  `<(td|th|span|div|p|li|dd|strong|b|time|small|em|output|data|a)\\b([^<>]*?)>\\s*(?:\\{\\s*(?:${NUM_FMT})\\(|[\\d٠-٩][\\d٠-٩.,:%+−-]*\\s*<)`,
  "g",
);
const HAS_NUM = /\bnum\b|sting-mono|data-num|data-mono/;

/** قاعدة CSS: المحدِّد والمتن وسطر البداية. */
function* rules(css) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(css));) {
    const start = css.slice(0, m.index + m[1].length - m[1].trimStart().length).split("\n").length;
    yield { selector: m[1].trim(), body: m[2], line: start, raw: m[0] };
  }
}

const found = [];
const add = (file, r, rule, why) =>
  found.push({ file, line: r.line, rule, why, sel: r.selector.split("\n").pop().slice(0, 80) });

function checkCss(file, css) {
  const lines = css.split("\n");
  for (const r of rules(css)) {
    const before = lines[Math.max(0, r.line - 2)] ?? "";
    if (/ui-allow:/.test(r.raw) || /ui-allow:/.test(before)) continue;
    const { selector: sel, body } = r;
    const pseudo = /::?(before|after)/.test(sel);

    // 1) شريط ملوّن على جانب الكرت أو أعلاه: بحدّ
    const side = body.match(
      /border-(?:inline|block|left|right|top|bottom)(?:-(?:start|end))?\s*:\s*([2-9])px\s+solid\s+([^;]+)/,
    );
    if (side && !NEUTRAL.test(side[2]))
      add(file, r, "stripe-border", `حدّ ${side[1]}px ملوّن على جانب`);
    // 2) شريط بعنصر زائف رفيع ممتدّ على حافة
    if (pseudo) {
      const thin = /(?:inline-size|block-size|width|height)\s*:\s*([2-6])px/.test(body);
      const edge =
        /inset-inline-(?:start|end)\s*:\s*0|inset-block(?:-start)?\s*:\s*0|(?:left|right|top)\s*:\s*0\b/.test(
          body,
        );
      if (thin && edge && /background/.test(body))
        add(file, r, "stripe-pseudo", "عنصر زائف رفيع ملوّن على حافة");
    }
    // 3) ظلّ داخلي يرسم شريطاً
    if (
      /box-shadow\s*:[^;]*inset\s+-?[3-9]px\s+0|box-shadow\s*:[^;]*inset\s+0\s+-?[3-9]px\s+0/.test(
        body,
      )
    )
      add(file, r, "stripe-inset", "ظلّ داخلي يرسم شريطاً");
    // 4) أيقونة في دائرة/مربع مصبوغ بلون الحالة
    const round = /border-radius\s*:\s*(?:50%|999px|9999px|\d{2,3}px)/.test(body);
    const center =
      /place-items\s*:\s*center|display\s*:\s*(?:inline-)?grid|justify-content\s*:\s*center/.test(
        body,
      );
    const tinted = /background\s*:[^;]*(?:color-mix\(|-tint|var\(--tone\))/.test(body);
    const small =
      /(?:inline-size|width)\s*:\s*(?:[2-4]\d)px/.test(body) &&
      /(?:block-size|height)\s*:\s*(?:[2-4]\d)px/.test(body);
    if (round && center && tinted && small)
      add(file, r, "icon-tint-circle", "أيقونة داخل دائرة مصبوغة بلون الحالة");
    // 5) حركة مستمرة على عنصر ليس عملية جارية
    if (
      /animation(?:-iteration-count)?\s*:[^;]*infinite/.test(body) &&
      !/spin|loading|skeleton|progress|ring|spinner|busy/i.test(sel + body)
    )
      add(file, r, "infinite-motion", "حركة مستمرة على عنصر ساكن");
    // 6) تدرّج على الأزرار والعناوين
    if (
      /\.c-btn|\bbutton\b|\bh[1-4]\b|__title|__heading/.test(sel) &&
      /linear-gradient|background-clip\s*:\s*text/.test(body)
    )
      add(file, r, "gradient-ui", "تدرّج لوني على زرّ أو عنوان");
    // 7) نص دون 14px خارج الشارات
    const tiny = body.match(SMALL_FONT);
    if (tiny && !BADGE.test(sel))
      add(file, r, "small-font", `${tiny[1]} خارج الشارات (الأدنى 14px)`);
    // 8) النص الثانوي بارتفاع سطر < 1.6
    if (/var\(--text-note\)/.test(body) && /line-height\s*:\s*1\.[0-5]\d*\b/.test(body))
      add(file, r, "note-leading", "ارتفاع سطر النص الثانوي دون 1.6");
  }
}

function checkTsx(file, src) {
  const lines = src.split("\n");
  for (const m of src.matchAll(NUM_EL)) {
    const i = src.slice(0, m.index).split("\n").length - 1;
    if (HAS_NUM.test(m[2]) || /ui-allow:/.test(lines[i]) || /ui-allow:/.test(lines[i - 1] ?? ""))
      continue;
    found.push({
      file,
      line: i + 1,
      rule: "num-class",
      why: "رقم بلا .num (Plex Mono جدولية LTR)",
      sel: m[0].replace(/\s+/g, " ").slice(0, 80),
    });
  }
  lines.forEach((l, i) => {
    if (/ui-allow:/.test(l) || /ui-allow:/.test(src.split("\n")[i - 1] ?? "")) return;
    // Tailwind احتياطاً (غير مستعمل هنا): شريط جانبي أو علوي
    if (/border-(?:l|r|s|e|t)-(?:2|4|8)\b|border-\[(?:2|3|4|5|6)px\]/.test(l))
      found.push({
        file,
        line: i + 1,
        rule: "stripe-class",
        why: "صنف شريط جانبي/علوي",
        sel: l.trim().slice(0, 80),
      });
    // حجم خط دون 14px في style مضمَّن
    if (/fontSize\s*:\s*["'`]?(?:1[0-3]|\d)(?:\.\d+)?(?:px)?["'`]?\s*[,}]/.test(l))
      found.push({
        file,
        line: i + 1,
        rule: "small-font",
        why: "fontSize مضمَّن دون 14px",
        sel: l.trim().slice(0, 80),
      });
    // ألوان حرفية في style المضمَّن لشريط
    if (/borderInlineStart\s*:\s*["'`]\s*[2-9]px/.test(l))
      found.push({
        file,
        line: i + 1,
        rule: "stripe-inline-style",
        why: "شريط في style مضمَّن",
        sel: l.trim().slice(0, 80),
      });
  });
}

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".next")) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const scope of SCOPE)
  for (const p of walk(join(ROOT, scope))) {
    const f = relative(ROOT, p);
    if (p.endsWith(".css")) checkCss(f, readFileSync(p, "utf8"));
    else if (/\.(tsx|jsx)$/.test(p) && !/\.(stories|test)\./.test(p))
      checkTsx(f, readFileSync(p, "utf8"));
  }

if (found.length) {
  const by = {};
  for (const h of found) (by[h.rule] ??= []).push(h);
  for (const [rule, hs] of Object.entries(by)) {
    console.log(`\n[${rule}] ${hs.length}`);
    for (const h of hs) console.log(`  ${h.file}:${h.line}  ${h.sel}  — ${h.why}`);
  }
  console.log(`\nالمجموع: ${found.length}. للاستثناء الموثَّق: تعليق «ui-allow: السبب» على السطر.`);
  process.exit(1);
}
