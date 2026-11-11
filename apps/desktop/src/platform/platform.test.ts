import { describe, expect, it } from "vitest";

import { fromBase64, toBase64 } from "./base64";
import { readClaims } from "./claims";
import { detectOs, externalTarget, isPublicPath, SITE } from "./tauri";

const APP = "tauri://localhost";

describe("طبقة منصة الحاسوب", () => {
  it("الصفحات العامة تخرج إلى الموقع، وشاشات التطبيق تبقى فيه", () => {
    expect(isPublicPath("/legal")).toBe(true);
    expect(isPublicPath("/plans?x=1")).toBe(true);
    expect(isPublicPath("/pos")).toBe(false);
    expect(isPublicPath("/legalese")).toBe(false);
    expect(externalTarget("/status", APP)).toBe(`${SITE}/status`);
    expect(externalTarget("/inventory", APP)).toBeNull();
  });

  it("العناوين الكاملة لمواقع أخرى والبريد تفتح في المتصفح؛ أصل التطبيق لا", () => {
    expect(externalTarget("https://wa.me/249", APP)).toBe("https://wa.me/249");
    expect(externalTarget("mailto:a@b.c", APP)).toBe("mailto:a@b.c");
    expect(externalTarget("http://tauri.localhost/pos", "http://tauri.localhost")).toBeNull();
    expect(externalTarget("http://tauri.localhost/legal", "http://tauri.localhost")).toBe(
      `${SITE}/legal`,
    );
  });

  it("نظام الجهاز من وكيل المستخدم", () => {
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130")).toBe("win");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });

  it("حمولة رمز الوصول تُقرأ لمطابقة السياق، والرمز التالف لا يكسر شيئاً", () => {
    const payload = btoa(JSON.stringify({ user_id: "u2", tid: "t1" })).replace(/=+$/, "");
    expect(readClaims(`h.${payload}.s`)).toEqual({ user_id: "u2", tid: "t1" });
    expect(readClaims("garbage")).toEqual({});
  });

  it("إيصال طويل يُرمَّز دون تجاوز حدّ الوسائط ويعود كما هو", () => {
    // صورة نقطية لإيصال من مئات السطور: فوق حدّ وسائط الدالة بكثير
    const big = Uint8Array.from({ length: 600_000 }, (_, i) => (i * 31) % 256);
    const encoded = toBase64(big);
    expect(encoded).toHaveLength(Math.ceil(big.length / 3) * 4);
    expect(fromBase64(encoded)).toEqual(big);
    expect(toBase64(new Uint8Array())).toBe("");
    expect(toBase64(Uint8Array.from([1, 2, 3]))).toBe("AQID");
  });
});
