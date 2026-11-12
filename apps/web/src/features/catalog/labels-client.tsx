"use client";

import { ean13Bars, normalizeSearch } from "@sting/domain";
import {
  chunkPages,
  expandLabels,
  type LabelRow,
  labelRows,
  readLocalItems,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  Frame,
  Notice,
  PrintDoc,
  printDocument,
  SelectField,
  SwitchField,
  Table,
  TextField,
} from "@sting/ui-web";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import { AppNav } from "@/features/home/app-nav";
import { useApp } from "@/lib/app-context";
import { printLabelsOnDevice } from "@/lib/print/printers";
import { getStorage } from "@/lib/storage";

type Size = "a4" | "58" | "80";
type State = "loading" | "empty" | "ready";
type Outcome = "idle" | "printing" | "printed" | "failed" | "unknown";

/** خطوط EAN-13 بمنطقة هادئة 10 وحدات كل جانب؛ الأرقام تحتها نصٌّ بخط mono لا داخل الرسم. */
export function Ean13Svg({ code, className }: { code: string; className?: string | undefined }) {
  return (
    <svg
      className={className}
      viewBox="0 0 115 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={code}
    >
      {ean13Bars(code).map((b) => (
        <rect key={b.x} x={10 + b.x} y={0} width={b.w} height={40} fill="#000" />
      ))}
    </svg>
  );
}

function LabelCell({ row, withPrice }: { row: LabelRow; withPrice: boolean }) {
  return (
    <div className="cat-label">
      <div className="cat-label__name">{row.label}</div>
      {withPrice ? (
        <div className="cat-label__price">
          <span className="sting-mono">{formatMinor(row.priceMinor)}</span> · {row.unitName}
        </div>
      ) : null}
      <Ean13Svg code={row.barcode} className="cat-label__bars" />
      <div className="cat-label__digits sting-mono">{row.barcode}</div>
    </div>
  );
}

/**
 * CAT-07 «ملصقات الأصناف» (0005 §٢٧٠؛ المرحلة ٢ من الباركود الداخلي — لا إطار مرسوم، نصوصها
 * مسجَّلة في القرار). المحلي وحده: الكتالوج على الجهاز، فالطباعة تعمل بلا اتصال. ورق A4 بأربعة
 * وعشرين ملصقاً (70×37 مم) بحوار الطباعة، أو طابعة الإيصالات 58/80 مم ملصقاً في كل قصّة عبر الناقل
 * نفسه للإيصال (BLE في الويب، خام في الحاسوب، وإلا حوار النظام). الملصق بلا سعر افتراضاً.
 */
export function LabelsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const [rows, setRows] = useState<LabelRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [size, setSize] = useState<Size>("a4");
  const [withPrice, setWithPrice] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("idle");

  useEffect(() => {
    if (!app.tokens && !app.expired) router.replace("/login?next=%2Fcatalog%2Flabels");
  }, [app.expired, app.tokens, router]);

  useEffect(() => {
    void (async () => {
      const r = labelRows(await readLocalItems(getStorage()));
      setRows(r.rows);
      setSkipped(r.skipped);
      const pre = params.get("item");
      if (pre) {
        setCounts(
          Object.fromEntries(r.rows.filter((x) => x.itemId === pre).map((x) => [x.key, 1])),
        );
      }
    })();
  }, [params]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const n = normalizeSearch(q);
    if (!n) return rows;
    return rows.filter(
      (r) => normalizeSearch(r.label).includes(n) || r.barcode.startsWith(q.trim()),
    );
  }, [q, rows]);

  const labels = useMemo(() => expandLabels(rows ?? [], counts), [counts, rows]);
  const state: State = rows === null ? "loading" : rows.length === 0 ? "empty" : "ready";

  const print = async () => {
    setOutcome("printing");
    if (size === "a4") {
      printDocument();
      setOutcome("idle");
      return;
    }
    const out = await printLabelsOnDevice(
      labels.map((l) => ({
        label: l.label,
        barcode: l.barcode,
        price: withPrice ? formatMinor(l.priceMinor) : undefined,
      })),
      size === "58" ? 58 : 80,
    );
    if (out === "system") {
      printDocument();
      setOutcome("idle");
      return;
    }
    setOutcome(out);
  };

  const columns = [
    { key: "label", header: "الصنف", render: (r: LabelRow) => r.label },
    {
      key: "barcode",
      header: "الباركود",
      mono: true,
      render: (r: LabelRow) => r.barcode,
    },
    {
      key: "count",
      header: "العدد",
      render: (r: LabelRow) => (
        <TextField
          label="العدد"
          aria-label={`العدد — ${r.label}`}
          kind="number"
          mono
          min={0}
          max={999}
          inputMode="numeric"
          value={counts[r.key] ? String(counts[r.key]) : ""}
          placeholder="0"
          onChange={(e) => {
            const n = Number(e.target.value);
            setCounts((c) => ({ ...c, [r.key]: Number.isFinite(n) ? n : 0 }));
            setOutcome("idle");
          }}
        />
      ),
    },
  ];

  const sheet =
    size === "a4" ? (
      chunkPages(labels).map((page, p) => (
        <div key={p} className="cat-labels-page">
          {page.map((r, i) => (
            <LabelCell key={i} row={r} withPrice={withPrice} />
          ))}
        </div>
      ))
    ) : (
      <div className={`cat-labels-strip cat-labels-strip--${size}`}>
        {labels.map((r, i) => (
          <LabelCell key={i} row={r} withPrice={withPrice} />
        ))}
      </div>
    );

  return (
    <Frame title="ملصقات الأصناف" nav={<AppNav currentId="catalog" />} footer={null}>
      <div className="home" data-screen="CAT-07" data-state={state}>
        {state === "loading" ? (
          <p className="acc-card__sub" role="status">
            جلب الأصناف
          </p>
        ) : null}

        {state === "empty" ? (
          <Notice kind="empty" title="لا صنف بباركود يُطبع">
            <p className="acc-lead">
              الملصق يحمل باركود EAN-13. أنشئ باركوداً داخلياً للأصناف من الكتالوج ثم عُد إلى هنا.
            </p>
            <div className="acc-actions">
              <Link href="/catalog" className="c-btn c-btn--primary">
                الكتالوج
              </Link>
            </div>
          </Notice>
        ) : null}

        {state === "ready" ? (
          <>
            <div className="cat-toolbar">
              <TextField label="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
              <SelectField
                label="المقاس"
                value={size}
                onChange={(e) => {
                  setSize(e.target.value as Size);
                  setOutcome("idle");
                }}
                options={[
                  { value: "a4", label: "ورق A4 — 24 ملصقاً" },
                  { value: "58", label: "طابعة إيصالات 58 مم" },
                  { value: "80", label: "طابعة إيصالات 80 مم" },
                ]}
              />
              <SwitchField
                label="السعر على الملصق"
                checked={withPrice}
                onChange={(v) => setWithPrice(v)}
              />
            </div>
            {skipped > 0 ? (
              <p className="acc-choice__note">
                <span className="sting-mono">{skipped}</span> باركود ليس EAN-13 — لا يُطبع هنا
              </p>
            ) : null}

            <Table caption="ملصقات الأصناف" columns={columns} rows={shown} rowKey={(r) => r.key} />

            <div className="cat-labels-actions">
              <p className="acc-lead">
                <span className="sting-mono">{labels.length}</span> ملصق
              </p>
              <Button
                onClick={() => void print()}
                loading={outcome === "printing"}
                disabledReason={labels.length ? undefined : "اكتب عدداً لصنف واحد على الأقل"}
              >
                اطبع ملصقات
              </Button>
            </div>

            {outcome === "printed" ? (
              <Notice kind="success" title="أُرسلت الملصقات إلى الطابعة">
                <p className="acc-lead">
                  امسح ملصقاً واحداً قبل لصقها كلها — الماسح يقرأ الرقم نفسه المطبوع تحت الخطوط.
                </p>
              </Notice>
            ) : null}
            {outcome === "unknown" ? (
              <Notice kind="warning" title="نتيجة الطباعة غير معروفة">
                <p className="acc-lead">
                  امسح ملصقاً واحداً قبل لصقها كلها — الماسح يقرأ الرقم نفسه المطبوع تحت الخطوط.
                </p>
              </Notice>
            ) : null}
            {outcome === "failed" ? (
              <Notice kind="error" title="لم تتم الطباعة">
                <p className="acc-lead">
                  تعذّر الاتصال بالطابعة أو رُفضت الكتابة — تحقّق من تشغيلها وقربها ثم أعد التجربة.
                </p>
              </Notice>
            ) : null}

            {labels.length ? (
              <section className="cat-labels-preview" aria-label="معاينة">
                <PrintDoc title="ملصقات الأصناف">{sheet}</PrintDoc>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </Frame>
  );
}
