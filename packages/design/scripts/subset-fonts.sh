#!/usr/bin/env bash
# اقتطاع الخطوط (0005 §٢٠٣ — «ادرس تقليل حجم الخطوط»): المصادر الكاملة في fonts/source/ (google/fonts، OFL)،
# والمقتطعة في fonts/ بالأسماء نفسها التي يستوردها الويب والجوال. لا يُسقط حرف تستعمله الواجهة:
# src/fonts.coverage.test.ts يقارن كل حرف في نصوص المستودع بجدول المصدر والمقتطع.
# التشغيل: bash packages/design/scripts/subset-fonts.sh  (يحتاج uv: uvx يجلب fonttools)
set -euo pipefail
cd "$(dirname "$0")/../fonts"
sub() { uvx -q --from "fonttools[woff]" pyftsubset "$@"; }

# Tajawal — النص: العربية كاملة (أسماء الزبائن والأصناف أي حرف) + اللاتينية 1 والممتدة + الترقيم والرموز والأسهم والأشكال
TEXT="U+0020-007E,U+00A0-024F,U+0300-036F,U+0391-03C9,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+2000-206F,U+20A0-20CF,U+2100-215F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2460-24FF,U+2500-25FF,U+2600-27BF,U+FB50-FDFF,U+FE70-FEFF"
# IBM Plex Mono — الأرقام والمعرفات وحدها: اللاتينية 1 والترقيم والعملات والرموز الرياضية والأسهم المستعملة
MONO="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2032-2033,U+2039-203A,U+2044,U+20AC,U+2116,U+2122,U+2190-2199,U+2208,U+2212,U+2215,U+221E,U+2248,U+2260-2265,U+2500,U+25B2,U+25BC,U+25CB-25CF,U+2713,U+2715"

for w in Regular Medium Bold ExtraBold; do
  sub "source/Tajawal-$w.ttf" --unicodes="$TEXT" --layout-features='*' --output-file="Tajawal-$w.ttf"
  sub "Tajawal-$w.ttf" --unicodes='*' --layout-features='*' --flavor=woff2 --output-file="Tajawal-$w.woff2"
done
for w in Regular Medium SemiBold; do
  sub "source/IBMPlexMono-$w.ttf" --unicodes="$MONO" --layout-features='kern,liga,calt,tnum,case,zero' --output-file="IBMPlexMono-$w.ttf"
  sub "IBMPlexMono-$w.ttf" --unicodes='*' --layout-features='*' --flavor=woff2 --output-file="IBMPlexMono-$w.woff2"
done
# Reem Kufi — اسم الشعار وحده (الويب woff2 والجوال ttf)، متغيّر 400–700
NAME="فيزانو بلص Vezano Plus"
sub "source/ReemKufi[wght].ttf" --text="$NAME" --layout-features='*' --output-file="ReemKufi[wght].ttf"
sub "source/ReemKufi[wght].ttf" --text="$NAME" --layout-features='*' --flavor=woff2 --output-file="ReemKufi-Wordmark.woff2"
