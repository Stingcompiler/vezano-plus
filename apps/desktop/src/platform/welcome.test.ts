import { describe, expect, it } from "vitest";

import { WELCOME } from "./welcome";

describe("نصوص ترحيب أول تشغيل (DESK-00 · 0005 §٢٥٨)", () => {
  it("اللغتان متطابقتان بنية: الترجمة سطر بسطر", () => {
    expect(WELCOME.en.features).toHaveLength(WELCOME.ar.features.length);
    expect(WELCOME.en.setup).toHaveLength(WELCOME.ar.setup.length);
    for (const k of Object.keys(WELCOME.ar) as (keyof typeof WELCOME.ar)[])
      expect(WELCOME.en[k], k).toBeTruthy();
  });

  it("العربية بلا حروف لاتينية في جملها، والإنجليزية بلا حروف عربية", () => {
    const text = (l: "ar" | "en") =>
      [WELCOME[l].title, WELCOME[l].lead, ...WELCOME[l].features, ...WELCOME[l].setup].join(" ");
    expect(text("ar")).not.toMatch(/[A-Za-z]/);
    expect(text("en")).not.toMatch(/[؀-ۿ]/);
  });
});
