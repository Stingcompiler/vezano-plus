import {
  Button,
  Frame,
  Notice,
  PrintDoc,
  printDocument,
  Receipt,
  Status,
  Table,
} from "@sting/ui-web";
import { useEffect, useState } from "react";

import { AppNav } from "@/features/home/app-nav";

import { native, type Printer } from "../platform/native";
import {
  clearQueue,
  listQueue,
  loadChoice,
  type PrintJob,
  type PrinterChoice,
  saveChoice,
} from "../platform/print-queue";
import "./desk.css";

/**
 * DESK-02 اختيار طابعة ومعاينة وطابور (37-D29 ready/empty/success · 09-D5 server_error).
 * الطابعات من النظام نفسه؛ الطابور تحتها، وفراغه في الحالة السويّة يطمئن.
 */
type State = "loading" | "ready" | "empty" | "server_error" | "success";

export function DeskPrinters() {
  const [printers, setPrinters] = useState<readonly Printer[] | null>(null);
  const [queue, setQueue] = useState<PrintJob[]>([]);
  const [choice, setChoice] = useState<PrinterChoice>({ receipts: "", reports: "", networkIp: "" });
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    void (async () => {
      const [found, q, saved] = await Promise.all([
        native.listPrinters().catch(() => [] as readonly Printer[]),
        listQueue(),
        loadChoice(),
      ]);
      const def = found.find((p) => p.default)?.name ?? found[0]?.name ?? "";
      setPrinters(found);
      setQueue(q);
      setChoice(saved ?? { receipts: def, reports: def, networkIp: "" });
    })();
  }, []);

  const failed = queue.filter((j) => j.state === "failed").length > 0;
  const state: State =
    printers === null
      ? "loading"
      : failed
        ? "server_error"
        : printed
          ? "success"
          : printers.length === 0
            ? "empty"
            : "ready";

  const update = (patch: Partial<PrinterChoice>) => {
    const next = { ...choice, ...patch };
    setChoice(next);
    void saveChoice(next);
  };

  const testPrint = () => {
    printDocument();
    setPrinted(true);
  };

  return (
    <Frame title="الطابعة والطابور" nav={<AppNav currentId="print" />} footer={null}>
      <div className="desk" data-screen="DESK-02" data-state={state}>
        {state === "server_error" ? (
          <>
            <div className="c-card desk__head">
              <div>
                <h2 className="desk__title">طابور الطباعة</h2>
                <p className="desk__sub">
                  الطابعة الحرارية توقفت عن الاستجابة ·{" "}
                  <span className="sting-mono">{queue.length}</span> مهام محفوظة
                </p>
              </div>
              <Button variant="secondary" onClick={() => setQueue([])}>
                تغيير الطابعة
              </Button>
            </div>
            <Table<PrintJob>
              caption="طابور الطباعة"
              rows={queue}
              rowKey={(j) => j.id}
              columns={[
                {
                  key: "name",
                  header: "المهمة",
                  render: (j) => (
                    <div>
                      <strong>{j.name}</strong>
                      <div className="desk__faint">
                        <span className="sting-mono">{j.ref}</span>
                        {j.copy ? " · نسخة" : null}
                      </div>
                    </div>
                  ),
                },
                { key: "src", header: "المصدر", render: (j) => j.source },
                {
                  key: "st",
                  header: "الحالة",
                  render: (j) =>
                    j.state === "failed" ? (
                      <Status state="server_error" label="فشل — انقطاع الطابعة" />
                    ) : (
                      <Status state="pending_sync" label="بانتظار الطابعة" />
                    ),
                },
                { key: "eff", header: "الأثر على الدفتر", render: (j) => j.effect },
              ]}
            />
            <Notice kind="info" title="إعادة الطباعة لا تنشئ شيئاً.">
              الفاتورة موجودة في دفترك ومزامَنة، والورقة فقط لم تخرج. النسخة المعادة تُوسم «نسخة»
              ومعها ختم وقتها ومَن طلبها، حتى لا تُقدَّم ورقتان كبيعين لنفس الزبون.
            </Notice>
            <div className="desk__actions">
              <Button variant="primary" onClick={testPrint}>
                إعادة طباعة المهام الثلاث
              </Button>
              <Button
                variant="secondary"
                onClick={() => void clearQueue().then(() => setQueue([]))}
              >
                حذف الطابور — لا يمس الفواتير
              </Button>
            </div>
          </>
        ) : state === "empty" ? (
          <>
            <Notice kind="warning" title="لا طابعات">
              لم يُعثر على طابعة. الفرق بين «لم نبحث» و«بحثنا ولم نجد» مهمّ.
            </Notice>
            <div className="c-card desk__pad">
              <strong>نقول ما فعلناه</strong>
              <p className="desk__sub">
                «بحثنا في طابعات النظام ولم نجد» مع خطوات التحقق ومدخل يدوي بعنوان IP للطابعات
                الشبكية.
              </p>
              <div className="desk__field">
                <label className="c-field">
                  <span className="c-field__label">عنوان IP</span>
                  <input
                    className="c-field__input sting-mono"
                    dir="ltr"
                    inputMode="decimal"
                    value={choice.networkIp}
                    onChange={(e) => update({ networkIp: e.target.value })}
                  />
                </label>
              </div>
            </div>
            <Notice kind="success" title="البيع مستمر">
              بلا طابعة يُباع وتُشارَك الفاتورة رقمياً. الطباعة راحةٌ لا شرطٌ للبيع.
            </Notice>
          </>
        ) : (
          <>
            {state === "success" ? (
              <Notice kind="success" title="طُبع">
                خرج المستند. والسؤال يبقى: هل خرج سليماً؟ <strong>إعادة الطباعة بنفس الرقم</strong>{" "}
                — حاضرة دائماً. إعادة طباعة إيصالٍ ليست بيعاً جديداً — قاعدة ACC-84.
              </Notice>
            ) : null}
            <div className="c-card desk__head">
              <div>
                <h2 className="desk__title">الطابعة والطابور</h2>
                <p className="desk__sub">
                  الطابعة الافتراضية والطابور تحتها. الطابور فارغٌ في الحالة السويّة — وظهوره فارغاً
                  يطمئن.
                </p>
              </div>
            </div>
            <div className="c-card desk__pad">
              <strong>طابعتان</strong>
              <p className="desk__sub">
                إيصالات على الحرارية وتقارير على A4. الافتراضي لكل نوع مستند لا للنظام كلّه.
              </p>
              <div className="desk__grid">
                {(
                  [
                    ["receipts", "إيصالات"],
                    ["reports", "تقارير"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="c-field">
                    <span className="c-field__label">{label}</span>
                    <select
                      className="c-field__input"
                      value={choice[k]}
                      onChange={(e) => update({ [k]: e.target.value })}
                    >
                      {(printers ?? []).map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <Table<PrintJob>
              caption="طابور الطباعة"
              rows={queue}
              rowKey={(j) => j.id}
              columns={[
                { key: "name", header: "المهمة", render: (j) => j.name },
                { key: "src", header: "المصدر", render: (j) => j.source },
              ]}
            />
            <div className="desk__actions">
              <Button variant="primary" onClick={testPrint}>
                اطبع إيصالاً تجريبياً
              </Button>
            </div>
          </>
        )}
        <PrintDoc title="إيصال تجريبي — فيزانو بلص" screen="hidden">
          <Receipt
            width={80}
            shopName="فيزانو بلص"
            title="اطبع إيصالاً تجريبياً"
            dateLabel={new Date().toISOString().slice(0, 16).replace("T", " ")}
            lines={[{ label: "الطابعة", value: choice.receipts }]}
          />
        </PrintDoc>
      </div>
    </Frame>
  );
}
