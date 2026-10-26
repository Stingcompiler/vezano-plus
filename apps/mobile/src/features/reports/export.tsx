import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ChipGroup, N, ReportNav, Row, Strong } from "@/components/reports/ui";
import { useSession } from "@/lib/session";

import { fetchFileText, previewHtml, shareReportFile } from "./share";

const T = "REP-06";
type State = "ready" | "loading" | "validation_error" | "success" | "server_error";
type Report = "sales" | "receivables" | "stock" | "cash";
type Fmt = "html" | "csv";
type RangeKey = "today" | "7d" | "30d" | "custom";

export interface ExportPreview {
  report: Report;
  label: string;
  format: Fmt;
  file_name: string;
  monthly: boolean;
  expected_pages: number;
  row_count: number;
  first_page_html: string;
  range: { start: string; end: string; label: string; months: number };
  quota: { used: number; limit: number };
  months_limit: number;
}
export interface ExportFile {
  id: string;
  report: Report;
  label: string;
  format: Fmt;
  range: { start: string; end: string };
  file_name: string;
  byte_size: number;
  page_count: number;
  row_count: number;
  url: string;
  generated_at: string;
  generated_by_name: string;
  open_count: number;
}
interface TooWide {
  months: number;
  limit: number;
  alternatives: {
    key: "split" | "monthly_summary" | "request_wider";
    first_end?: string;
    rest_months?: number;
    months?: number;
    limit?: number;
  }[];
}

const REPORTS: { value: Report; label: string }[] = [
  { value: "sales", label: tx(T, "تقرير المبيعات") },
  { value: "receivables", label: tx(T, "تقرير الذمم") },
  { value: "stock", label: tx(T, "تقرير المخزون") },
  { value: "cash", label: tx(T, "تقرير الصندوق") },
];

const kb = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * REP-06 — تصدير تقرير ومعاينته (نظير `export-client.tsx`): معاينة الصفحة الأولى في عارض النظام
 * الأصلي (معاينة الطباعة)، التوليد على الخادم بعدد الصفحات المتوقَّع، حدّ المدى بالبدائل الثلاثة،
 * وفشل التوليد لا يسلّم ملفاً ناقصاً. الملف المولَّد يُسلَّم إلى ورقة المشاركة الأصلية.
 */
export function ExportReport() {
  const router = useRouter();
  // مرجع ثابت: هوية `router` قد تتبدّل بين التصييرات فلا تعيد المعاينة بلا نهاية
  const routerRef = useRef(router);
  routerRef.current = router;
  const { api, state: session } = useSession();
  const access = session.tokens?.access;
  const [report, setReport] = useState<Report>("sales");
  const [fmt, setFmt] = useState<Fmt>("html");
  const [range, setRange] = useState<RangeKey>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [tooWide, setTooWide] = useState<TooWide | null>(null);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState<ExportFile | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [recent, setRecent] = useState<ExportFile[]>([]);
  const [limitRequested, setLimitRequested] = useState(false);

  const query = useCallback(() => {
    const q: Record<string, string> = { report, range, format: fmt };
    if (range === "custom") {
      q.start = start;
      q.end = end;
    }
    if (monthly) q.summary = "monthly";
    return q;
  }, [report, range, fmt, start, end, monthly]);

  const loadPreview = useCallback(async () => {
    if (range === "custom" && (!start || !end)) return;
    setPreviewing(true);
    setTooWide(null);
    setFailed(null);
    try {
      const { data, error, response } = await api.GET("/api/reports/export/preview", {
        params: { query: query() },
      });
      if (response.status === 403) {
        routerRef.current.replace("/reports");
        return;
      }
      if (response.status === 400) {
        const e = error as unknown as { detail: string; extra: TooWide };
        if (e.detail === "range_too_wide") setTooWide(e.extra);
        return;
      }
      const body = data as unknown as ExportPreview | undefined;
      if (!response.ok || !body) {
        setFailed("preview");
        return;
      }
      setPreview(body);
    } catch {
      setFailed("preview");
    } finally {
      setPreviewing(false);
    }
  }, [api, query, range, start, end]);

  const loadRecent = useCallback(async () => {
    try {
      const { data, response } = await api.GET("/api/reports/exports", {});
      const body = data as unknown as { exports: ExportFile[] } | undefined;
      if (response.ok && body) setRecent(body.exports);
    } catch {
      /* بلا اتصال: لا قائمة */
    }
  }, [api]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    setDone(null);
    void loadPreview();
  }, [loadPreview]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setFailed(null);
    setDone(null);
    try {
      const { data, error, response } = await api.POST("/api/reports/exports", {
        body: query() as never,
      });
      if (response.status === 400) {
        const e = error as unknown as { detail: string; extra: TooWide };
        if (e.detail === "range_too_wide") setTooWide(e.extra);
        else setFailed(e.detail);
        return;
      }
      const body = data as unknown as { export: ExportFile } | undefined;
      if (!response.ok || !body) {
        setFailed("server");
        return;
      }
      setDone(body.export);
      void loadRecent();
    } catch {
      setFailed("server");
    } finally {
      setGenerating(false);
    }
  };

  const requestWider = async () => {
    if (!tooWide) return;
    try {
      const { response } = await api.POST("/api/reports/exports/limit-request", {
        body: { months: tooWide.months } as never,
      });
      if (response.ok) setLimitRequested(true);
    } catch {
      /* بلا اتصال: لا يُسجَّل الطلب */
    }
  };

  /** الملف المولَّد من الخادم كما وُلِّد (لا يُعاد حسابه) → ورقة المشاركة الأصلية. */
  const share = async (e: ExportFile) => {
    const body = await fetchFileText(`${e.url}?download=1`, access);
    if (body !== null) await shareReportFile(body, e.file_name, e.format);
  };

  const state: State = tooWide
    ? "validation_error"
    : failed
      ? "server_error"
      : done
        ? "success"
        : generating || (previewing && !preview)
          ? "loading"
          : "ready";
  const label = REPORTS.find((r) => r.value === report)?.label ?? "";

  return (
    <Screen screenId={T} state={state} title={tx(T, "التقارير")}>
      <ReportNav current="export" />
      <AppText variant="section">{tx(T, "تصدير تقرير ومعاينته")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "معاينةٌ للصفحة الأولى كما ستُطبع بالضبط: الترويسة والاتجاه والأرقام.")}
      </AppText>

      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "اختر المدى والصيغة")}
      </AppText>
      <ChipGroup label={tx(T, "التقرير")}>
        {REPORTS.map((r) => (
          <Chip
            key={r.value}
            label={r.label}
            on={report === r.value}
            onPress={() => {
              setReport(r.value);
              setMonthly(false);
            }}
          />
        ))}
      </ChipGroup>
      <ChipGroup label={tx(T, "المدى")}>
        <Chip label={tx(T, "اليوم")} on={range === "today"} onPress={() => setRange("today")} />
        <Chip label={tx(T, "آخر 7 أيام")} on={range === "7d"} onPress={() => setRange("7d")} />
        <Chip label={tx(T, "آخر 30 يوماً")} on={range === "30d"} onPress={() => setRange("30d")} />
        <Chip
          label={tx(T, "مدى مخصَّص")}
          on={range === "custom"}
          onPress={() => setRange("custom")}
        />
      </ChipGroup>
      {range === "custom" ? (
        <>
          <TextField
            label={tx(T, "من تاريخ")}
            mono
            value={start}
            onChangeText={setStart}
            placeholder="2026-01-01"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />
          <TextField
            label={tx(T, "إلى تاريخ")}
            mono
            value={end}
            onChangeText={setEnd}
            placeholder="2026-12-31"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />
        </>
      ) : null}
      <ChipGroup label={tx(T, "الصيغة")}>
        <Chip
          label={tx(T, "HTML للطباعة أو PDF")}
          on={fmt === "html"}
          onPress={() => setFmt("html")}
        />
        <Chip label="CSV" on={fmt === "csv"} onPress={() => setFmt("csv")} />
      </ChipGroup>
      {monthly ? (
        <View style={{ marginBottom: SPACE["3"] }}>
          <AppText variant="note" muted>
            <Strong>{tx(T, "ملخص شهري")}</Strong> {tx(T, "· سطر لكل شهر بدل التفصيل.")}
          </AppText>
          <Button
            variant="quiet"
            label={tx(T, "عُد إلى التفصيل")}
            onPress={() => setMonthly(false)}
          />
        </View>
      ) : null}
      {preview ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "الحصة هذا الشهر:")} <N>{preview.quota.used}</N> {tx(T, "من")}{" "}
          <N>{preview.quota.limit}</N> {tx(T, "· حدّ المدى")} <N>{preview.months_limit}</N>{" "}
          {tx(T, "شهراً")}
        </AppText>
      ) : null}
      <View style={{ marginBottom: SPACE["4"] }}>
        <Button
          financial
          label={tx(T, "صدِّر")}
          onPress={() => void generate()}
          loading={generating}
          disabledReason={
            tooWide
              ? tx(T, "المدى أوسع من الحدّ")
              : !preview
                ? tx(T, "بانتظار المعاينة")
                : undefined
          }
        />
      </View>

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ التوليد")}>
          <AppText variant="secondary">
            {tx(T, "مع عدد الصفحات المتوقَّع")}
            {preview ? (
              <>
                : <N>{preview.expected_pages}</N> {tx(T, "صفحات")}
              </>
            ) : null}
            .
          </AppText>
        </StateView>
      ) : null}
      {state === "validation_error" && tooWide ? (
        <StateView state="validation_error" title={tx(T, "التصدير متوقف")}>
          <AppText variant="secondary">
            {tx(T, "النطاق المطلوب")} <N>{tooWide.months}</N> {tx(T, "شهراً وحدّ التصدير")}{" "}
            <N>{tooWide.limit}</N>.
          </AppText>
          <Button
            variant="secondary"
            label={tx(T, "قسّمه إلى ملفين")}
            onPress={() => {
              const alt = tooWide.alternatives.find((a) => a.key === "split");
              if (alt?.first_end) {
                setRange("custom");
                setEnd(alt.first_end);
                setTooWide(null);
              }
            }}
          />
          <AppText variant="note" muted>
            <N>{tooWide.limit}</N> {tx(T, "شهراً ثم")} <N>{tooWide.months - tooWide.limit}</N>{" "}
            {tx(T, "شهراً. الترويسة في كل ملف تقول أي مدى يغطيه ومتى حُسب.")}
          </AppText>
          <Button
            variant="secondary"
            label={tx(T, "صدّر الملخص الشهري بدل التفصيل")}
            onPress={() => {
              setReport("sales");
              setMonthly(true);
              setTooWide(null);
            }}
          />
          <AppText variant="note" muted>
            {tx(T, "يغطي")} <N>{tooWide.months}</N>{" "}
            {tx(T, "شهراً كاملة بسطر لكل شهر — مناسب للبنك والمراجع الخارجي.")}
          </AppText>
          <Button
            variant="secondary"
            label={tx(T, "اطلب مدى أوسع")}
            onPress={() => void requestWider()}
            disabledReason={limitRequested ? tx(T, "سُجّل الطلب") : undefined}
          />
          <AppText variant="note" muted>
            {tx(T, "حدّ الـ")}
            <N>{tooWide.limit}</N>{" "}
            {tx(T, "شهراً من الباقة لا من النظام. يُرفع بطلب ويُذكر تأثيره على حجم الملف.")}
            {limitRequested ? ` ${tx(T, "— سُجّل طلبك.")}` : ""}
          </AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "فشل التوليد")}>
          <AppText variant="secondary">
            {tx(T, "التقرير كبير أو الخادم تعثّر. لا ملف ناقص يُنزَّل.")}
          </AppText>
          <AppText variant="secondary">
            <Strong>{tx(T, "البديل")}</Strong> {tx(T, "· مدى أقصر، أو صيغة CSV أخفّ.")}
          </AppText>
          <Button
            variant="secondary"
            label={tx(T, "مدى أقصر")}
            onPress={() => {
              setFailed(null);
              setRange("7d");
            }}
          />
          <Button
            variant="secondary"
            label={tx(T, "صيغة CSV أخفّ")}
            onPress={() => {
              setFailed(null);
              setFmt("csv");
            }}
          />
        </StateView>
      ) : null}
      {state === "success" && done ? (
        <StateView state="success" title={tx(T, "جاهز للتنزيل")}>
          <AppText variant="secondary">
            <N>{done.file_name}</N> · <N>{kb(done.byte_size)}</N> · <N>{done.page_count}</N>{" "}
            {tx(T, "صفحات ·")} <N>{`${done.range.start} – ${done.range.end}`}</N>
          </AppText>
          <Button label={tx(T, "تنزيل")} onPress={() => void share(done)} />
        </StateView>
      ) : null}

      <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "المعاينة قبل التصدير")}
      </AppText>
      <AppText variant="secondary" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "معاينة")} {label}
        {preview ? (
          <>
            {" — "}
            {tx(T, "الصفحة الأولى من")} {preview.label} {tx(T, "من")} <N>{preview.range.start}</N>{" "}
            {tx(T, "إلى")} <N>{preview.range.end}</N> — <N>{preview.row_count}</N>{" "}
            {tx(T, "صفاً في")} <N>{preview.expected_pages}</N> {tx(T, "صفحات")}
          </>
        ) : (
          ` — ${tx(T, "لا معاينة بعد")}`
        )}
      </AppText>
      <View style={{ marginBottom: SPACE["3"] }}>
        <Button
          variant="secondary"
          label={tx(T, "معاينة")}
          onPress={() => preview && void previewHtml(preview.first_page_html)}
          loading={previewing && !preview}
          disabledReason={preview ? undefined : tx(T, "لا معاينة بعد")}
        />
      </View>
      {preview ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
          <N>{preview.file_name}</N> · <N>{preview.expected_pages}</N> {tx(T, "صفحات متوقَّعة ·")}{" "}
          <N>{preview.row_count}</N> {tx(T, "صفاً")}
        </AppText>
      ) : null}

      {recent.length ? (
        <GroupedList title={tx(T, "آخر التصديرات")}>
          {recent.map((e, i) => (
            <Row
              key={e.id}
              title={<N>{e.file_name}</N>}
              detail={
                <>
                  <N>{kb(e.byte_size)}</N> · {e.generated_by_name} <N>{hhmm(e.generated_at)}</N>{" "}
                  {tx(T, "· فُتح")} <N>{e.open_count}</N>
                </>
              }
              onPress={() => void share(e)}
              last={i === recent.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}
    </Screen>
  );
}
