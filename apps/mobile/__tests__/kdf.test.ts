import { verifyPin } from "@sting/sync-core";

import { devicePbkdf2, nativePbkdf2, noblePbkdf2 } from "@/lib/kdf";

/**
 * فتح القفل بالاشتقاق الأصلي (0005 §٢٠٠): النتيجة نفسها بايتاً ببايت كالاحتياط بجافاسكربت وكمتجه
 * الخادم، والاحتياط يعمل إن تعذّرت الوحدة الأصلية. في Jest تحيل react-native-quick-crypto إلى node:crypto.
 */
// متجه الخادم نفسه في packages/sync-core/src/pin.test.ts (PIN «123456»، 1000 دورة، ملح صفري)
const SERVER_ENCODED =
  "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$xLL5EYZbGlWr9962Y1Y77xBK9jK/wka5FYHqDqwRYw8=";

describe("اشتقاق PIN على الجهاز", () => {
  it("الأصليّ يطابق الاحتياط بجافاسكربت", async () => {
    const pw = new TextEncoder().encode("123456");
    const salt = new Uint8Array(16).fill(7);
    const a = await nativePbkdf2(pw, salt, 2000, 32);
    const b = await noblePbkdf2(pw, salt, 2000, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("الأصليّ يتحقق من متجه الخادم", async () => {
    expect(await verifyPin("123456", SERVER_ENCODED, devicePbkdf2)).toBe(true);
    expect(await verifyPin("123457", SERVER_ENCODED, devicePbkdf2)).toBe(false);
  });

  it("إن تعذّر الأصليّ يعمل الاحتياط ولا يُغلق القفل", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnqc = require("react-native-quick-crypto") as { pbkdf2: unknown };
    const original = rnqc.pbkdf2;
    rnqc.pbkdf2 = () => {
      throw new Error("native module not loaded");
    };
    try {
      expect(await verifyPin("123456", SERVER_ENCODED, devicePbkdf2)).toBe(true);
    } finally {
      rnqc.pbkdf2 = original;
    }
  });
});
