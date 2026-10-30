import { receiptHtml } from "@/features/org/receipt";
import { printPage } from "@/lib/print-page";

jest.mock("expo-router", () => ({ useRouter: () => ({}) }));

/** ورقة الجوال (0005 §٢٠٥): اسم المستند في العنوان، UTF-8، هامش صفر، ولا رابط في المستند. */
describe("printPage", () => {
  it("يحمل اسم المستند وترميزه وهامش صفحة صفر", () => {
    const html = printPage("فاتورة <1>", "<p>x</p>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>فاتورة &lt;1&gt;</title>");
    expect(html).toContain("@page{margin:0}");
  });

  it("إيصال الاشتراك باسمه ولا رابط فيه", () => {
    const html = receiptHtml({
      number: "R-2026-0001",
      issuer: { legal: "فيزانو بلص", contact: "support" },
      tenant_name: "متجر النور",
      plan_name: "الأساسية",
      cycle_label: "شهري",
      period_from: "2026-10-01T00:00:00Z",
      period_to: "2026-10-31T00:00:00Z",
      reference: "TRX-1",
      issued_by_name: "سارة",
      amount_minor: "150000",
      currency: "SDG",
      note: "",
    } as unknown as Parameters<typeof receiptHtml>[0]);
    expect(html).toMatch(/<title>[^<]*R-2026-0001<\/title>/);
    expect(html).not.toMatch(/https?:\/\/|localhost/);
  });
});
