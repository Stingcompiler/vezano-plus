import { mtx } from "@sting/texts";
/**
 * نصوص جوال بلا مقابل في الويب (القاعدة 1): تغطي ما لا تملكه نصوص الشاشات المولَّدة — حالات الاتصال في
 * شاشات الإشعارات التي كان الويب يتركها معلّقة، وقيود الجوال (لا مستعرض ملفات ولا AES-GCM أصلي)،
 * وشاشة إذن الإشعارات الأصلية (NAT-03). قليلة عمداً.
 */
export const OPS = {
  offlineCached: mtx("opsOfflineCached"),
  offlineNone: mtx("opsOfflineNone"),
  pasteFile: mtx("opsPasteFile"),
  pasteHint: mtx("opsPasteHint"),
  cryptoMissing: mtx("opsCryptoMissing"),
  sharePrompt: mtx("opsSharePrompt"),
  fileLabel: mtx("opsFileLabel"),
  // NAT-03 — إذن الإشعارات الأصلي
  permTitle: mtx("opsPermTitle"),
  permNotEnabled: mtx("opsPermNotEnabled"),
  permBody: mtx("opsPermBody"),
  permNote: mtx("opsPermNote"),
  permBuild: mtx("opsPermBuild"),
  permOpenInbox: mtx("opsPermOpenInbox"),
  permSettings: mtx("opsPermSettings"),
  permLinks: mtx("opsPermLinks"),
} as const;
