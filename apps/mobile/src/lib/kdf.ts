import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Pbkdf2Sha256 } from "@sting/sync-core";
import { pbkdf2 } from "react-native-quick-crypto";

/**
 * PBKDF2-SHA256 على الهاتف (0005 §١٧٣، §٢٠٠). الخادم يحدّد 210٬000 دورة لمتحقق الـPIN، وبجافاسكربت
 * خالص (@noble/hashes) كان فتح القفل يأخذ 20 ثانية إلى دقيقة. الاشتقاق الآن أصليّ عبر
 * react-native-quick-crypto (OpenSSL في C++ بلا حجز خيط الواجهة)، والنتيجة نفسها بايتاً ببايت.
 */
export const nativePbkdf2: Pbkdf2Sha256 = (password, salt, iterations, length) =>
  new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, length, "sha256", (err, key) => {
      if (err || !key) reject(err ?? new Error("pbkdf2"));
      else resolve(new Uint8Array(key.buffer, key.byteOffset, key.byteLength));
    });
  });

/** الاحتياط بجافاسكربت خالص — يطابق متجه الخادم نفسه (اختبار sync-core). */
export const noblePbkdf2: Pbkdf2Sha256 = (password, salt, iterations, length) =>
  pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: length, asyncTick: 20 });

/** الأصليّ أولاً؛ إن تعذّر (وحدة غير محمّلة) فالاحتياط، فلا يُغلق القفل أبداً بسبب الاشتقاق. */
export const devicePbkdf2: Pbkdf2Sha256 = async (password, salt, iterations, length) => {
  try {
    return await nativePbkdf2(password, salt, iterations, length);
  } catch {
    return noblePbkdf2(password, salt, iterations, length);
  }
};
