import { describe, expect, it } from "vitest";

import { imageSrc } from "./image-src";

describe("imageSrc — صورة الإيصال للمشغّل (B5)", () => {
  it("base64 خام يأخذ بادئة نوعه من التوقيع", () => {
    expect(imageSrc("iVBORw0KGgoAAA", "x.bin")).toBe("data:image/png;base64,iVBORw0KGgoAAA");
    expect(imageSrc("/9j/4AAQ")).toBe("data:image/jpeg;base64,/9j/4AAQ");
  });
  it("بلا توقيع معروف: من امتداد الاسم ثم jpeg", () => {
    expect(imageSrc("AAAA", "receipt.webp")).toBe("data:image/webp;base64,AAAA");
    expect(imageSrc("AAAA")).toBe("data:image/jpeg;base64,AAAA");
  });
  it("رابط بيانات كامل يمرّ كما هو", () => {
    expect(imageSrc("data:image/png;base64,iVBOR")).toBe("data:image/png;base64,iVBOR");
  });
});
