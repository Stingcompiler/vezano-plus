# ملفات الخطوط (رخصة SIL OFL 1.1)

تُوضع هنا الملفات التي يشير إليها `src/fonts.css`. لا تُحمَّل من CDN وقت التشغيل.

**ثلاث عائلات لا غير** (0005 §٢٠٣، D-0007): Tajawal للنص، IBM Plex Mono للأرقام، Reem Kufi للشعار. حُذفت Cairo وIBM Plex Sans Arabic وInter بملفاتها ورخصها؛ `fonts.test.ts` يفشل إن عاد ملف عائلة أخرى.

| الملف | المصدر الرسمي | الأوزان |
|---|---|---|
| `Tajawal-{Regular,Medium,Bold,ExtraBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/tajawal/` | 400 / 500 / 700 / 800 — **الواجهة والعناوين** (هوية فيزانو 2026-09-22) |
| `IBMPlexMono-{Regular,Medium,SemiBold}.ttf` (+ `.woff2`) | github.com/google/fonts — `ofl/ibmplexmono/` | 400 / 500 / 600 — **كل الأرقام والتواريخ والمبالغ والمعرفات** (`.num`) |
| `source/ReemKufi[wght].ttf` (المصدر) + `ReemKufi[wght].ttf` و`ReemKufi-Wordmark.woff2` (مقتطعان) | github.com/google/fonts — `ofl/reemkufi/` | متغيّر 400–700 — **اسم الشعار «فيزانو بلص» وحده** (0005 §١٣٢) |

ملف `OFL.txt` لكل عائلة يُنسخ بجانبها. تحويل TTF إلى WOFF2 اختياري (أصغر حجماً)؛ CSS يذكر الصيغتين.

**الحالة:** نُزِّلت بإذن المالك من `github.com/google/fonts` مع `OFL-*.txt` لكل عائلة. اختبار `fonts.test.ts` يثبت وجود الملفات وغياب أي عائلة رابعة.

**الاقتطاع** (0005 §٢٠٣، «ادرس تقليل حجم الخطوط»): المصادر الكاملة من google/fonts في `source/`، والملفات في هذا المجلد
مقتطعة منها بالأسماء نفسها التي يستوردها الويب (`.woff2`) والجوال (`.ttf`). أعد التوليد بعد أي تغيير:

```bash
bash packages/design/scripts/subset-fonts.sh
```

- **Tajawal:** العربية كاملة، لأن أسماء الزبائن والأصناف قد تحوي أي حرف. معها اللاتينية 1 والممتدة، والترقيم والرموز والأسهم والأشكال.
- **IBM Plex Mono:** الأرقام والمعرفات وحدها، أي اللاتينية 1 والترقيم والعملات والرموز المستعملة (≤ ≥ ≠ ≈ ∞ ✓ …).
- **Reem Kufi:** حروف «فيزانو بلص Vezano Plus» وحدها، متغيّراً 400–700.
- `src/fonts.coverage.test.ts` يفشل إن أسقط الاقتطاع حرفاً من نصوص الواجهة (الويب والحزم والجوال) يغطيه المصدر.

| | قبل | بعد |
|---|---|---|
| الويب، أول عرض (4 Tajawal + 3 Plex + الشعار) | 204 ك.ب | 119 ك.ب |
| الجوال، الخطوط المضمَّنة (3 Tajawal + 3 Plex + Reem Kufi) | 722 ك.ب | 275 ك.ب |

**Reem Kufi** (نُزِّل بإذن المالك 2026-09-26 مع `OFL-ReemKufi.txt`): الويب يحمّل `ReemKufi-Wordmark.woff2` (~5 ك.ب)، والجوال `ReemKufi[wght].ttf` المقتطع (~12 ك.ب)، كلاهما لحروف «فيزانو بلص Vezano Plus». إن تغيّر الاسم فعدّل `NAME` في السكربت. الأمر اليدوي القديم للمرجع:

```bash
cd packages/design/fonts
uvx --from "fonttools[woff]" pyftsubset "source/ReemKufi[wght].ttf" --text="فيزانو بلص Vezano Plus" --layout-features='*' --flavor=woff2 --output-file=ReemKufi-Wordmark.woff2
```
