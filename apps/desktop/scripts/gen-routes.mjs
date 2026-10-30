// يولّد src/generated/routes.ts من شجرة صفحات الويب (apps/web/src/app/**/page.tsx) — جدول المسارات لا يُكتب يدوياً،
// فكل شاشة تُضاف إلى الويب تظهر في تطبيق الحاسوب في البناء التالي (docs/desktop-plan.md §٢).
// `--check` يفشل إن كان الملف المحفوظ لا يطابق الشجرة (CI).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../../web/src/app");
const out = resolve(here, "../src/generated/routes.ts");
const webSrc = resolve(here, "../../web/src");

/** خارج تطبيق الحاسوب: لوحة المشغّل تبقى على الويب (الخطة §٣). */
export const EXCLUDED = ["/platform"];

function walk(dir, match = (name) => name === "page.tsx") {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full, match));
    else if (match(name)) found.push(full);
  }
  return found;
}

/**
 * الشاشات تُستورد كما هي، فلا تستعمل من Next إلا ما له بديل في src/shims: `next/link`، و`next/navigation`
 * بأسمائه الأربعة. أي استيراد آخر يكسر تطبيق الحاسوب صامتاً — فيُمنع هنا (CI).
 */
const SHIMMED = {
  "next/link": null,
  "next/navigation": ["useRouter", "usePathname", "useSearchParams", "useParams"],
};
function nextImportProblems() {
  const problems = [];
  const files = [
    ...walk(join(webSrc, "features"), (n) => /\.tsx?$/.test(n)),
    ...walk(join(webSrc, "lib"), (n) => /\.tsx?$/.test(n)),
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s+"(next\/[^"]+)"/g)) {
      const [, what, mod] = m;
      const rel = relative(webSrc, file);
      if (!(mod in SHIMMED)) problems.push(`${rel}: ${mod} لا بديل له في تطبيق الحاسوب`);
      else if (SHIMMED[mod]) {
        const names = (what.match(/\{([^}]*)\}/)?.[1] ?? "")
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0])
          .filter(Boolean);
        for (const n of names)
          if (!SHIMMED[mod].includes(n)) problems.push(`${rel}: ${n} من ${mod} لا بديل له`);
      }
    }
  }
  return problems;
}

/** `notify/inbox/[id]/page.tsx` → `/notify/inbox/:id` */
function toPath(file) {
  const segs = relative(appDir, dirname(file)).split(sep).filter(Boolean);
  return "/" + segs.map((s) => (s.startsWith("[") ? `:${s.slice(1, -1)}` : s)).join("/");
}

const routes = walk(appDir)
  .map((file) => ({ path: toPath(file), module: relative(appDir, file).split(sep).join("/") }))
  .filter((r) => !EXCLUDED.some((x) => r.path === x || r.path.startsWith(`${x}/`)));

// الصفحات تُستورد مباشرةً لا كسولاً: كلها على قرص الجهاز، والجذر (المزوّدون والتخزين) يُركَّب مع أول رسم
// كما في الويب — التحميل الكسول كان يؤخّر فتح قاعدة الجهاز إلى ما بعد حدث load.
const body = `// مولَّد بـ scripts/gen-routes.mjs من apps/web/src/app — لا تحرّره يدوياً.
import type { PageModule } from "../page-host";

${routes.map((r, i) => `import * as P${i} from "@/app/${r.module.replace(/\.tsx$/, "")}";`).join("\n")}

export interface DesktopRoute {
  readonly path: string;
  readonly mod: PageModule;
}

export const ROUTES: readonly DesktopRoute[] = [
${routes.map((r, i) => `  { path: ${JSON.stringify(r.path)}, mod: P${i} },`).join("\n")}
];
`;

if (process.argv.includes("--check")) {
  const problems = nextImportProblems();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  let saved = "";
  try {
    saved = readFileSync(out, "utf8");
  } catch {
    /* غير موجود */
  }
  if (saved !== body) {
    console.error(
      "src/generated/routes.ts لا يطابق صفحات الويب — شغّل: pnpm --filter @sting/desktop prepare-app",
    );
    process.exit(1);
  }
  console.log(`routes: ${routes.length} مساراً مطابقاً`);
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  console.log(`routes: ${routes.length} مساراً`);
}
