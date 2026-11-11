#!/usr/bin/env bash
# تنزيل متصفح اختبارات Playwright في CI — يتحمّل تعذّر مستودعات النظام (0005 §٢٥٧).
#
# `playwright install --with-deps` يثبّت ملحقات النظام بـapt قبل تنزيل المتصفح. في 2026-11-11 تعذّر على
# مشغّلات GitHub حلّ أسماء مستودعات أوبونتو ساعةً وأكثر، ففشلت سبع وظائف على main قبل أن يبدأ أي اختبار
# وتوقف النشر. ما يضيفه apt على صورة المشغّل خطوط احتياطية فقط (آسيوية وسيريلية)؛ مكتبات تشغيل كروم
# في الصورة أصلاً، والتطبيق يحمل خطوطه.
#
# - نعيد المحاولة بفواصل متزايدة: عطل عابر يزول.
# - إن بقيت المستودعات لا تُبلَغ نُنزّل المتصفح وحده (من خادم آخر) ونكمل. الاختبارات تعمل كاملة؛
#   وإن نقصت مكتبة يوماً فشل إقلاع المتصفح صريحاً — لا نجاح كاذب.
#
# الاستعمال: scripts/ci/install-chromium.sh <مرشّح pnpm>   مثال: @sting/web
set -uo pipefail

filter="${1:?usage: install-chromium.sh <pnpm filter>}"
attempts="${PLAYWRIGHT_INSTALL_ATTEMPTS:-4}"
pause="${PLAYWRIGHT_INSTALL_PAUSE:-30}"

for attempt in $(seq 1 "$attempts"); do
  if pnpm --filter "$filter" exec playwright install --with-deps chromium; then
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    wait_s=$((attempt * pause))
    echo "::warning::تعذّر تنزيل متصفح الاختبار وملحقات النظام (محاولة $attempt من $attempts) — إعادة بعد ${wait_s} ثانية"
    sleep "$wait_s"
  fi
done

echo "::warning::مستودعات النظام لا تُبلَغ بعد $attempts محاولات — يُنزَّل المتصفح وحده بلا الخطوط الاحتياطية"
exec pnpm --filter "$filter" exec playwright install chromium
