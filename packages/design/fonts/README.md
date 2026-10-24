# ملفات الخطوط (رخصة SIL OFL 1.1)

تُوضع هنا الملفات التي يشير إليها `src/fonts.css`. لا تُحمَّل من CDN وقت التشغيل.

**ثلاث عائلات لا غير** (0005 §٢٠٣، D-0007): Tajawal للنص، IBM Plex Mono للأرقام، Reem Kufi للشعار. حُذفت Cairo وIBM Plex Sans Arabic وInter بملفاتها ورخصها؛ `fonts.test.ts` يفشل إن عاد ملف عائلة أخرى.

| الملف | المصدر الرسمي | الأوزان |
|---|---|---|
| `Tajawal-{Regular,Medium,Bold,ExtraBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/tajawal/` | 400 / 500 / 700 / 800 — **الواجهة والعناوين** (هوية فيزانو 2026-09-22) |
| `IBMPlexMono-{Regular,Medium,SemiBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/ibmplexmono/` | 400 / 500 / 600 — **كل الأرقام والتواريخ والمبالغ والمعرفات** (`.num`) |
| `ReemKufi[wght].ttf` (المصدر) + `ReemKufi-Wordmark.woff2` (مقتطع) | github.com/google/fonts — `ofl/reemkufi/` | متغيّر 400–700 — **اسم الشعار «فيزانو بلص» وحده** (0005 §١٣٢) |

ملف `OFL.txt` لكل عائلة يُنسخ بجانبها. تحويل TTF إلى WOFF2 اختياري (أصغر حجماً)؛ CSS يذكر الصيغتين.

**الحالة:** نُزِّلت بإذن المالك من `github.com/google/fonts` مع `OFL-*.txt` لكل عائلة. اختبار `fonts.test.ts` يثبت وجود الملفات وغياب أي عائلة رابعة.

**IBM Plex Mono للويب** (0005 §٢٠٣): ملفات `.woff2` مقتطعة للاتينية والأرقام والرموز الشائعة (~13 ك.ب للوزن بدل ~39)، كي تبقى خطوط أول عرض ≤ 200 ك.ب. ملفات `.ttf` كاملة، وهي مصدر إعادة الاقتطاع ويقرؤها الجوال:

```bash
cd packages/design/fonts
for w in Regular Medium SemiBold; do uvx --from "fonttools[woff]" pyftsubset "IBMPlexMono-$w.ttf" --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2032-2033,U+2039-203A,U+2044,U+20AC,U+2190-2199,U+2212,U+2215,U+2116,U+2122" --layout-features='kern,liga,calt,tnum,case,zero' --flavor=woff2 --output-file="IBMPlexMono-$w.woff2"; done
```

**Reem Kufi** (نُزِّل بإذن المالك 2026-09-26 مع `OFL-ReemKufi.txt`): الواجهة تحمّل `ReemKufi-Wordmark.woff2` وحده (~5 ك.ب)، مقتطعاً لحروف «فيزانو بلص Vezano Plus». لإعادة الاقتطاع إن تغيّر الاسم:

```bash
cd packages/design/fonts
uvx --from "fonttools[woff]" pyftsubset "ReemKufi[wght].ttf" --text="فيزانو بلص Vezano Plus" --layout-features='*' --flavor=woff2 --output-file=ReemKufi-Wordmark.woff2
```
