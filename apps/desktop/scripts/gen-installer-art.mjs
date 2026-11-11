// صور هوية المثبّتين (0005 §٢٥٨) — تُولَّد من خطوط الهوية وعلامتها، لا تُرسم يدوياً:
//   src-tauri/installer/sidebar.bmp        164×314  صفحتا الترحيب والإنهاء في مثبّت ويندوز (NSIS)
//   src-tauri/installer/header.bmp         150×57   ترويسة صفحات مثبّت ويندوز
//   src-tauri/installer/dmg-background.png 660×400 نقطة (مرسومة ×2) خلفية نافذة DMG في ماك
// التشغيل: pnpm --filter @sting/desktop exec node scripts/gen-installer-art.mjs
/* global document, Image -- دوالّ `page.evaluate` تُنفَّذ داخل المتصفح */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const out = resolve(here, "../src-tauri/installer");
mkdirSync(out, { recursive: true });

const font = (f) => pathToFileURL(resolve(repo, "packages/design/fonts", f)).href;
const mark = readFileSync(resolve(repo, "apps/web/public/icons/icon.svg"), "utf8");
const markUri = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

const NAVY = "#12253B";
const TEAL = "#0E7C86";
const TEAL_LIGHT = "#37B0B8";
const PAGE = "#F6F8FB";

const base = `
  @font-face { font-family: Wordmark; src: url("${font("ReemKufi-Wordmark.woff2")}"); }
  @font-face { font-family: Tajawal; font-weight: 500; src: url("${font("Tajawal-Medium.woff2")}"); }
  @font-face { font-family: Tajawal; font-weight: 700; src: url("${font("Tajawal-Bold.woff2")}"); }
  * { box-sizing: border-box; margin: 0; }
  html, body { direction: rtl; font-family: Tajawal, sans-serif; -webkit-font-smoothing: antialiased; }
  .word { font-family: Wordmark, Tajawal, sans-serif; white-space: nowrap; }
  .latin { direction: ltr; font-family: system-ui, sans-serif; }
`;

const sidebar = `<style>${base}
  body { width: 164px; height: 314px; background:
    radial-gradient(120px 120px at 50% 18%, rgb(14 124 134 / .45), transparent 70%), ${NAVY};
    color: #fff; display: grid; grid-template-rows: auto 1fr auto; justify-items: center;
    padding: 30px 10px 18px; text-align: center; }
  img { width: 68px; height: 68px; }
  .word { font-size: 23px; margin-top: 14px; }
  .word b { color: ${TEAL_LIGHT}; font-weight: 400; }
  .latin { font-size: 11px; letter-spacing: .04em; opacity: .72; margin-top: 2px; }
  .lines { align-self: end; font-size: 12px; line-height: 1.75; opacity: .92; }
  .lines span { display: block; }
  .dot { width: 26px; height: 3px; border-radius: 2px; background: #E8A33D; margin: 0 auto 10px; }
</style>
<div><img src="${markUri}" alt=""><div class="word">فيزانو <b>بلص</b></div><div class="latin">Vezano Plus</div></div>
<div></div>
<div class="lines"><div class="dot"></div><span>نقطة بيع ومخزون وذمم</span><span>يعمل بلا إنترنت</span></div>`;

const header = `<style>${base}
  body { width: 150px; height: 57px; background: #fff; display: flex; align-items: center;
    justify-content: center; gap: 8px; }
  img { width: 34px; height: 34px; }
  .word { font-size: 17px; color: ${NAVY}; line-height: 1.1; }
  .word b { color: ${TEAL}; font-weight: 400; }
</style>
<img src="${markUri}" alt=""><div class="word">فيزانو <b>بلص</b></div>`;

// نافذة DMG: أيقونة التطبيق عند (180,170) ومجلد التطبيقات عند (480,170) — tauri.conf.json bundle.macOS.dmg.
// النطاق حول الأيقونتين وتسميتيهما يُترك خالياً؛ السهم بينهما والتعليمات تحتهما.
const dmg = `<style>${base}
  body { width: 660px; height: 400px; position: relative; color: ${NAVY}; background:
    radial-gradient(420px 260px at 50% -6%, rgb(14 124 134 / .16), transparent 70%), ${PAGE}; }
  .brand { position: absolute; inset-inline: 0; top: 22px; display: flex; align-items: center;
    justify-content: center; gap: 10px; }
  .brand img { width: 38px; height: 38px; }
  .word { font-size: 26px; }
  .word b { color: ${TEAL}; font-weight: 400; }
  svg { position: absolute; left: 262px; top: 150px; }
  .how { position: absolute; inset-inline: 0; top: 284px; text-align: center; }
  .how strong { display: block; font-size: 19px; font-weight: 700; }
  .how .latin { font-size: 12.5px; color: #5b6b7d; margin-top: 4px; }
  .foot { position: absolute; inset-inline: 0; bottom: 18px; text-align: center; font-size: 12.5px;
    font-weight: 500; color: ${TEAL}; }
</style>
<div class="brand"><img src="${markUri}" alt=""><div class="word">فيزانو <b>بلص</b></div></div>
<svg width="136" height="40" viewBox="0 0 136 40" fill="none" stroke="${TEAL}" stroke-width="4"
  stroke-linecap="round" stroke-linejoin="round"><path d="M6 20h116"/><path d="M106 6l18 14-18 14"/></svg>
<div class="how"><strong>اسحب فيزانو بلص إلى مجلد التطبيقات</strong>
  <div class="latin">Drag Vezano Plus to the Applications folder</div></div>
<div class="foot">يعمل بلا إنترنت، ويتزامن حين يعود الاتصال</div>`;

/** BMP 24-بت بلا ضغط (ما يقبله NSIS): الصفوف من الأسفل، BGR، وكل صف مكمَّل إلى مضاعف 4. */
function bmp24(width, height, rgba) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * height);
  buf.write("BM");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * height, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const dst = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      buf[dst + x * 3] = rgba[s + 2];
      buf[dst + x * 3 + 1] = rgba[s + 1];
      buf[dst + x * 3 + 2] = rgba[s];
    }
  }
  return buf;
}

const browser = await chromium.launch();
try {
  const shoot = async (html, width, height, scale = 1) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><html lang="ar" dir="rtl"><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: "png" });
    await page.close();
    return png;
  };
  const pixels = async (png, width, height) => {
    const page = await browser.newPage({ viewport: { width, height } });
    const data = await page.evaluate(
      async ({ uri, width, height }) => {
        const img = new Image();
        img.src = uri;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        return Array.from(ctx.getImageData(0, 0, width, height).data);
      },
      { uri: `data:image/png;base64,${png.toString("base64")}`, width, height },
    );
    await page.close();
    return data;
  };

  for (const [name, html, w, h] of [
    ["sidebar", sidebar, 164, 314],
    ["header", header, 150, 57],
  ]) {
    const png = await shoot(html, w, h);
    writeFileSync(resolve(out, `${name}.bmp`), bmp24(w, h, await pixels(png, w, h)));
    // معاينة PNG للمراجعة البصرية — خارج المستودع، بطلب صريح
    if (process.env.PREVIEW_DIR)
      writeFileSync(resolve(process.env.PREVIEW_DIR, `${name}.png`), png);
  }

  const dmgPath = resolve(out, "dmg-background.png");
  writeFileSync(dmgPath, await shoot(dmg, 660, 400, 2));
  // 144 نقطة/بوصة: Finder يعرض الصورة المرسومة ×2 بمقاس 660×400 نقطة حادّةً على شاشات Retina
  if (process.platform === "darwin")
    execFileSync("sips", ["-s", "dpiWidth", "144", "-s", "dpiHeight", "144", dmgPath], {
      stdio: "ignore",
    });
} finally {
  await browser.close();
}
console.log(`installer art → ${out}`);
