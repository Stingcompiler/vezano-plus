import { formatMinor } from "@sting/app-core";
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
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";

import { ChipGroup, N, Row, Strong } from "@/components/ops/ui";
import { call, detailOf } from "@/features/ops/net";
import { OPS } from "@/features/ops/texts";
import { API_URL, useSession } from "@/lib/session";

const T = "SYS-10";
type State = "ready" | "loading" | "validation_error" | "partial" | "success" | "server_error";
type Kind = "items" | "parties";

interface ImportRow {
  readonly line: number;
  readonly row_hash: string;
  readonly values: Record<string, string>;
  readonly result: "create" | "update" | "rejected" | "needs_decision";
  readonly reason: string;
  readonly duplicate_of_line?: number;
  readonly price_minor?: string;
  readonly old_price_minor?: string;
  readonly opening_minor?: string;
  readonly applied?: boolean;
}
interface Batch {
  readonly id: string;
  readonly kind: Kind;
  readonly file_name: string;
  readonly status: "previewed" | "applying" | "applied" | "reverted";
  readonly mapping: Record<string, number>;
  readonly rows: readonly ImportRow[];
  readonly total_rows: number;
  readonly create_count: number;
  readonly update_count: number;
  readonly rejected_count: number;
  readonly decision_count: number;
  readonly applied_count: number;
  readonly revert_until: string;
  readonly already_imported: boolean;
  readonly headers?: readonly string[];
  readonly suggested_mapping?: Record<string, number>;
}

const FIELD_LABEL: Record<string, string> = {
  name: tx(T, "الاسم"),
  unit: tx(T, "الوحدة"),
  price: tx(T, "السعر"),
  barcode: tx(T, "الباركود"),
  phone: tx(T, "الهاتف"),
  opening: tx(T, "الرصيد الافتتاحي"),
  side: tx(T, "الصفة"),
};
const FIELDS: Record<Kind, readonly string[]> = {
  items: ["name", "unit", "price", "barcode"],
  parties: ["name", "phone", "opening", "side"],
};
const REASON: Record<string, string> = {
  unit_required: tx(T, "الوحدة فارغة. بلا وحدة لا يمكن حساب مخزون ولا سعر بيع."),
  negative: tx(T, "سعر سالب. لا نصحّحه نيابةً عنك ولا نستورده كصفر."),
  not_a_number: tx(T, "السعر ليس رقماً"),
  name_required: tx(T, "الاسم فارغ"),
  unit_unknown: tx(T, "الوحدة غير معرَّفة في المنشأة"),
  barcode_duplicate_in_file: tx(T, "باركود مكرر داخل الملف نفسه"),
  barcode_taken: tx(T, "الباركود مستعمل لصنف آخر"),
  duplicate_in_file: tx(T, "مكرر داخل الملف"),
  opening_invalid: tx(T, "الرصيد الافتتاحي ليس رقماً موجباً"),
  side_invalid: tx(T, "الصفة يجب أن تكون «عميل» أو «مورد»"),
  phone_taken: tx(T, "الهاتف مسجَّل لطرف آخر"),
};

/**
 * SYS-10 — استيراد بيانات (نظير `import-client.tsx`): اختر ملفاً وطابق أعمدته — المطابقة تُقترح لا
 * تُفترض، الوحدة إلزامية؛ لا كتابة أثناء الفحص؛ لا نرفض الملف كلّه — يُستورد السليم ويُصدَّر المرفوض
 * بسبب كل صف؛ المكرر يحتاج قرارك؛ بصمة الملف تمنع المضاعفة؛ الانقطاع يُستأنف بالبصمة؛ التراجع دفعةً
 * خلال 24 ساعة. الفحص والتطبيق على الخادم؛ الملف يُلصق نصاً (لا مستعرض ملفات مضمَّن).
 */
export function ImportScreen() {
  const router = useRouter();
  const c = useColors();
  const { api, state: session } = useSession();
  const [kind, setKind] = useState<Kind>("items");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("import.csv");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<"idle" | "checking" | "applying">("idle");
  const [failed, setFailed] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "keep" | "skip">>({});

  const preview = async (override?: Record<string, number>) => {
    if (!content || phase !== "idle") return;
    setPhase("checking");
    setFailed(null);
    try {
      const r = await call<Batch>(() =>
        api.POST("/api/imports/preview", {
          body: {
            kind,
            file_name: fileName,
            content,
            ...(override ? { mapping: override } : {}),
          },
        }),
      );
      if (!r.ok || !r.data)
        return setFailed(r.offline ? "server_error" : detailOf(r.error) || "server_error");
      setBatch(r.data);
      setMapping(r.data.mapping);
      setDecisions({});
    } finally {
      setPhase("idle");
    }
  };

  const decide = async () => {
    if (!batch) return;
    const r = await call<Batch>(() =>
      api.POST("/api/imports/{batch_id}/decide", {
        params: { path: { batch_id: batch.id } },
        body: { decisions },
      }),
    );
    if (r.ok && r.data) setBatch(r.data);
  };

  const apply = async (stopAfter?: number) => {
    if (!batch || phase !== "idle") return;
    setPhase("applying");
    setFailed(null);
    try {
      const r = await call<Batch>(() =>
        api.POST("/api/imports/{batch_id}/apply", {
          params: { path: { batch_id: batch.id } },
          body: stopAfter !== undefined ? { stop_after: stopAfter } : {},
        }),
      );
      if (!r.ok || !r.data)
        return setFailed(r.offline ? "server_error" : detailOf(r.error) || "server_error");
      setBatch(r.data);
    } finally {
      setPhase("idle");
    }
  };

  const revert = async () => {
    if (!batch) return;
    const r = await call<Batch>(() =>
      api.POST("/api/imports/{batch_id}/revert", {
        params: { path: { batch_id: batch.id } },
      }),
    );
    if (r.ok && r.data) setBatch(r.data);
    else setFailed(detailOf(r.error) || "server_error");
  };

  const shareRejected = async () => {
    if (!batch) return;
    try {
      const res = await fetch(`${API_URL}/api/imports/${batch.id}/rejected.csv`, {
        headers: { Authorization: `Bearer ${session.tokens?.access ?? ""}` },
      });
      if (!res.ok) return;
      await Share.share({ title: `rejected-${batch.file_name}`, message: await res.text() });
    } catch {
      /* بلا اتصال */
    }
  };

  const interrupted = batch?.status === "applying";
  const state: State = interrupted
    ? "server_error"
    : phase === "checking"
      ? "loading"
      : batch?.status === "applied" || batch?.status === "reverted"
        ? "success"
        : batch && batch.decision_count > 0
          ? "validation_error"
          : batch && batch.rejected_count > 0
            ? "partial"
            : "ready";
  const rows = batch?.rows ?? [];
  const importable = batch ? batch.create_count + batch.update_count : 0;
  const rejectedRows = rows.filter((r) => r.result === "rejected" || r.result === "needs_decision");
  const unit = kind === "items" ? tx(T, "صنفاً") : tx(T, "طرفاً");

  return (
    <Screen screenId={T} state={state} title={tx(T, "مركز الاتصال والمزامنة")}>
      <AppText variant="section" style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "استيراد بيانات")}
      </AppText>

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ الفحص")}>
          <AppText variant="secondary">
            {tx(T, "الفحص قبل الكتابة: عدّ الصفوف، كشف التكرار داخل الملف، ومطابقته بما هو موجود.")}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "لا كتابة أثناء الفحص")}</Strong>{" "}
            {tx(T, "· يُقرأ كاملاً ويُعرض تقريره ثم يُكتب بعد موافقة.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "server_error" && batch ? (
        <StateView state="server_error" title={tx(T, "انقطع أثناء الكتابة")}>
          <AppText variant="secondary">
            {tx(T, "كُتب")} <N>{batch.applied_count}</N> {tx(T, "من")} <N>{importable}</N>{" "}
            {tx(T, "ثم انقطع. الملف نصف مستورد.")}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "الاستئناف بالبصمة")}</Strong>{" "}
            {tx(T, "· نعرف ما كُتب ببصمة كل صف، فنستأنف من")} <N>{batch.applied_count + 1}</N>{" "}
            {tx(T, "بلا إعادة كتابة")} <N>{batch.applied_count}</N> {tx(T, "ولا تكرارها.")}
          </AppText>
          <Button
            label={tx(T, "استئناف")}
            loading={phase === "applying"}
            onPress={() => void apply()}
          />
        </StateView>
      ) : null}

      {state === "success" && batch ? (
        <StateView
          state={batch.status === "reverted" ? "expired" : "success"}
          title={batch.status === "reverted" ? tx(T, "تراجعت الدفعة") : tx(T, "اكتمل الاستيراد")}
        >
          <AppText variant="secondary">
            <N>{batch.create_count}</N> {unit} {tx(T, "أُضيف و")}
            <N>{batch.update_count}</N> {tx(T, "حُدّث")}
            {batch.rejected_count > 0 ? (
              <>
                {" "}
                {tx(T, "و")}
                <N>{batch.rejected_count}</N> {tx(T, "رُفض — ملف المرفوضات أدناه")}
              </>
            ) : null}
            {tx(T, ". والأهم: بصمة الملف محفوظة — رفعه ثانيةً يُكتشف ولا يُضاعف.")}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "التراجع")}</Strong>{" "}
            {tx(T, "· دفعة الاستيراد كيانٌ واحد قابل للتراجع خلال")} <N>24</N>{" "}
            {tx(T, "ساعة ما لم تُباع أصنافها. بعدها يصير جزءاً من الدفتر.")}
          </AppText>
          {batch.status === "applied" && kind === "items" ? (
            <Button
              variant="secondary"
              label={tx(T, "التراجع عن الدفعة")}
              onPress={() => void revert()}
            />
          ) : null}
          {batch.rejected_count > 0 ? (
            <Button
              variant="quiet"
              label={tx(T, "تنزيل المرفوضات لتصحيحها")}
              onPress={() => void shareRejected()}
            />
          ) : null}
        </StateView>
      ) : null}

      {failed && state !== "server_error" ? (
        <StateView state="server_error" title={tx(T, "لم يُنفَّذ")}>
          <AppText variant="secondary">
            {failed === "decisions_pending"
              ? tx(T, "حُسم المكرر أولاً — نسألك ولا نختار.")
              : failed === "import_owner_or_manager"
                ? tx(T, "الاستيراد للمالك ومدير الفرع.")
                : failed === "sold_at_new_price" || failed === "item_sold"
                  ? tx(T, "بيعت أصناف من الدفعة — صارت جزءاً من الدفتر.")
                  : failed === "window_passed"
                    ? tx(T, "مضت 24 ساعة — الدفعة جزء من الدفتر.")
                    : tx(T, "الخادم لم يقبل الطلب.")}
          </AppText>
        </StateView>
      ) : null}

      {!batch || batch.status === "previewed" ? (
        <>
          <StateView state="ready" title={tx(T, "اختر ملفاً وطابق أعمدته")}>
            <AppText variant="secondary">
              {tx(
                T,
                "رفع الملف ثم مطابقة أعمدته بحقول النظام، مع معاينة أول خمسة صفوف كما ستُحفظ فعلاً.",
              )}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "المطابقة تُقترح لا تُفترض")}</Strong>{" "}
              {tx(T, "· النظام يخمّن من العناوين ويعرض تخمينه للتعديل.")}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "الوحدة إلزامية")}</Strong>{" "}
              {tx(T, "· صنفٌ بلا وحدة لا يُستورد — نفس قاعدة إنشاء الصنف.")}
            </AppText>
          </StateView>
          <ChipGroup>
            <Chip
              label={tx(T, "قالب الأصناف والوحدات والأسعار")}
              on={kind === "items"}
              onPress={() => setKind("items")}
            />
            <Chip
              label={tx(T, "قالب الأطراف والافتتاحيات")}
              on={kind === "parties"}
              onPress={() => setKind("parties")}
            />
          </ChipGroup>
          <TextField
            label={tx(T, "ملف CSV")}
            hint={OPS.pasteHint}
            value={content}
            onChangeText={(v) => {
              setContent(v);
              setBatch(null);
            }}
            multiline
            numberOfLines={6}
            autoCapitalize="none"
            autoCorrect={false}
            mono
            style={{ minHeight: 120, textAlignVertical: "top" }}
          />
          <TextField label={OPS.fileLabel} value={fileName} onChangeText={setFileName} mono />
          {content && !batch ? (
            <Button
              label={tx(T, "فحص الملف")}
              loading={phase === "checking"}
              onPress={() => void preview()}
            />
          ) : null}
        </>
      ) : null}

      {batch && batch.status === "previewed" && batch.headers ? (
        <View style={{ marginTop: SPACE["4"] }}>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "مطابقة الأعمدة")}
          </AppText>
          {FIELDS[kind].map((f) => (
            <ChipGroup key={f} label={`${tx(T, "عمود")} ${FIELD_LABEL[f] ?? f}`}>
              <Chip
                label={tx(T, "— بلا عمود —")}
                on={(mapping[f] ?? -1) === -1}
                onPress={() => setMapping((m) => ({ ...m, [f]: -1 }))}
              />
              {(batch.headers ?? []).map((h, i) => (
                <Chip
                  key={i}
                  label={h || `${tx(T, "العمود")} ${i + 1}`}
                  on={mapping[f] === i}
                  onPress={() => setMapping((m) => ({ ...m, [f]: i }))}
                />
              ))}
            </ChipGroup>
          ))}
          <Button
            variant="secondary"
            label={tx(T, "أعد الفحص بهذه المطابقة")}
            loading={phase === "checking"}
            onPress={() => void preview(mapping)}
          />
        </View>
      ) : null}

      {batch && batch.status === "previewed" ? (
        <View style={{ marginTop: SPACE["4"] }}>
          {state === "partial" ? (
            <StateView state="partial" title={tx(T, "تقرير ما لن يُستورد")}>
              <AppText variant="secondary">
                <N>{batch.total_rows}</N> {tx(T, "صف:")} <N>{importable}</N> {tx(T, "سليم،")}{" "}
                <N>{batch.rejected_count}</N> {tx(T, "مرفوض.")}
              </AppText>
              <AppText variant="note">
                <Strong>{tx(T, "لا نرفض الملف كلّه")}</Strong>{" "}
                {tx(
                  T,
                  "· يُستورد السليم ويُصدَّر المرفوض في ملف مستقل بسبب كل صف — يُصحَّح ويُعاد رفعه.",
                )}
              </AppText>
              <AppText variant="note">
                <Strong>{tx(T, "المكرر داخل الملف")}</Strong>{" "}
                {tx(T, "· يُعرض الصفّان المتعارضان بأرقام أسطرهما.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "validation_error" ? (
            <StateView state="validation_error" title={tx(T, "صفوف تحتاج قرارك")}>
              <AppText variant="secondary">
                <N>{batch.decision_count}</N>{" "}
                {tx(T, "صفاً مكرراً داخل الملف بسعرين. نسألك ولا نختار.")}
              </AppText>
              <Button
                label={tx(T, "اعتماد القرارات")}
                onPress={() => void decide()}
                disabledReason={
                  Object.keys(decisions).length === 0
                    ? tx(T, "اختر الصف الصحيح لكل مكرر")
                    : undefined
                }
              />
            </StateView>
          ) : null}
          <AppText variant="bodyStrong">
            {tx(T, "معاينة استيراد")} {kind === "items" ? tx(T, "الأصناف") : tx(T, "الأطراف")}{" "}
            {tx(T, "— قبل الاعتماد")}
          </AppText>
          <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "الملف:")} {batch.file_name} · <N>{batch.total_rows}</N> {tx(T, "صفاً ·")}{" "}
            <N>{batch.rejected_count + batch.decision_count}</N> {tx(T, "صفاً لن يُستورد")}
          </AppText>
          <GroupedList title={tx(T, "صفوف الملف")}>
            {rows.map((r, i) => (
              <Row
                key={r.line}
                title={
                  <AppText>
                    <N>{r.line}</N> · {r.values["name"] ?? ""}
                  </AppText>
                }
                detail={
                  <>
                    {kind === "items"
                      ? `${tx(T, "الوحدة")}: ${r.values["unit"] ?? ""}`
                      : `${tx(T, "الهاتف")}: ${r.values["phone"] ?? ""}`}
                    {" · "}
                    {kind === "items" ? tx(T, "السعر") : tx(T, "الرصيد الافتتاحي")}{" "}
                    <N>
                      {kind === "items"
                        ? r.price_minor
                          ? formatMinor(r.price_minor)
                          : (r.values["price"] ?? "")
                        : r.opening_minor
                          ? formatMinor(r.opening_minor)
                          : (r.values["opening"] ?? "")}
                    </N>
                    {"\n"}
                    {r.result === "create"
                      ? kind === "items"
                        ? tx(T, "صنف جديد")
                        : tx(T, "طرف جديد")
                      : r.result === "update"
                        ? kind === "items"
                          ? tx(T, "مطابق لصنف قائم — سيُحدَّث سعره فقط")
                          : tx(T, "مطابق لطرف قائم")
                        : r.result === "needs_decision"
                          ? `${tx(T, "مكرر مع الصف")} ${r.duplicate_of_line ?? ""} ${tx(T, "بسعر مختلف. أيّهما الصحيح؟ نسألك ولا نختار.")}`
                          : `${REASON[r.reason] ?? r.reason}${r.duplicate_of_line ? ` ${tx(T, "(الصف")} ${r.duplicate_of_line})` : ""}`}
                  </>
                }
                trailing={
                  r.result === "needs_decision" ? (
                    <Chip
                      label={tx(T, "هذا الصحيح")}
                      on={decisions[String(r.line)] === "keep"}
                      onPress={() => setDecisions((d) => ({ ...d, [String(r.line)]: "keep" }))}
                    />
                  ) : (
                    <AppText
                      variant="note"
                      style={{
                        color:
                          r.result === "create"
                            ? c.state.synced.fg
                            : r.result === "update"
                              ? c.state.pending_sync.fg
                              : c.state.server_error.fg,
                      }}
                    >
                      {r.result === "create"
                        ? tx(T, "سيُستورد")
                        : r.result === "update"
                          ? tx(T, "تحديث")
                          : tx(T, "مرفوض")}
                    </AppText>
                  )
                }
                last={i === rows.length - 1}
              />
            ))}
          </GroupedList>
          <View style={{ gap: SPACE["3"] }}>
            <Button
              financial
              label={`${tx(T, "استيراد")} ${importable} ${tx(T, "صفاً الصالحة")}`}
              loading={phase === "applying"}
              onPress={() => void apply()}
              disabledReason={
                batch.decision_count > 0
                  ? tx(T, "حُسم المكرر أولاً")
                  : importable === 0
                    ? tx(T, "لا صفوف صالحة")
                    : undefined
              }
            />
            <Button
              variant="secondary"
              label={tx(T, "تنزيل المرفوضات لتصحيحها")}
              onPress={() => void shareRejected()}
              disabledReason={rejectedRows.length === 0 ? tx(T, "لا مرفوضات") : undefined}
            />
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: SPACE["3"] }}>
        <Button
          variant="quiet"
          label={tx(T, "مركز المزامنة")}
          onPress={() => router.push("/sync")}
        />
      </View>
    </Screen>
  );
}
