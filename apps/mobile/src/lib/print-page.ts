const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * صفحة كاملة لطباعة النظام (expo-print) — نظير `PrintDoc` في الويب (0005 §٢٠٥): اسم المستند في
 * `<title>` فيحمله حوار الطباعة وملف PDF، وترميز UTF-8 صريح للعربية، وهامش صفحة صفر فلا يكتب
 * النظام شيئاً فوق المستند وتحته؛ الحشو داخل الصفحة.
 */
export function printPage(title: string, body: string): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{margin:0}body{margin:0;padding:16mm 14mm;color:#000;background:#fff}</style></head>
<body style="font-family:-apple-system,Roboto,sans-serif">${body}</body></html>`;
}
