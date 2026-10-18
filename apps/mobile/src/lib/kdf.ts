import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Pbkdf2Sha256 } from "@sting/sync-core";

/**
 * PBKDF2-SHA256 على الهاتف (0005 §١٧٣): React Native بلا `crypto.subtle`، فالاشتقاق بـ@noble/hashes
 * (JS خالص، غير متزامن يترك الواجهة تستجيب). يطابق متجه الخادم نفسه (اختبار sync-core). الكلفة
 * محسوسة (210٬000 دورة)، فالقفل يجرّب متحقق صاحب الجلسة أولاً.
 */
export const noblePbkdf2: Pbkdf2Sha256 = (password, salt, iterations, length) =>
  pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: length, asyncTick: 20 });
