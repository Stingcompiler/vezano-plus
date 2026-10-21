import { formatMinor } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useState } from "react";
import { Share, View } from "react-native";

import { M } from "@/components/catalog/parts";
import { CatRow, Line } from "@/components/catalog/row";
import { CT } from "@/features/catalog/texts";
import { API_URL, useSession } from "@/lib/session";

const T = "CAT-05";
type State = "ready" | "loading" | "validation_error" | "partial" | "success" | "server_error";

interface Row {
  readonly line: number;
  readonly key: string;
  readonly price_text: string;
  readonly item_id: string;
  readonly name: string;
  readonly old_price_minor: string;
  readonly new_price_minor: string;
  readonly result: "update" | "unchanged" | "rejected";
  readonly reason: string;
  readonly applied?: boolean;
}
interface Batch {
  readonly id: string;
  readonly file_name: string;
  readonly status: "previewed" | "applying" | "applied" | "reverted";
  readonly rows: readonly Row[];
  readonly ready_count: number;
  readonly rejected_count: number;
  readonly unchanged_count: number;
  readonly applied_count: number;
  readonly max_increase_pct: number;
  readonly revert_until: string;
}

/** أسباب الرفض كما في جدول الإطار: «مرفوض: سعر سالب»، «مرفوض: لا صنف بهذا المعرّف». */
const REASONS: Record<string, string> = {
  negative: tx(T, "سعر سالب"),
  item_not_found: tx(T, "لا صنف بهذا المعرّف"),
  not_a_number: tx(T, "سعر غير رقمي"),
  out_of_range: tx(T, "سعر خارج الحدّ"),
  duplicate: tx(T, "الصنف مكرّر في الملف"),
  missing_item: tx(T, "بلا معرّف صنف"),
};

function ResultLine({ r }: { r: Row }) {
  if (r.result === "update")
    return (
      <Line>
        {tx(T, "سيُحدَّث من")} <M>{formatMinor(r.old_price_minor || "0")}</M>
      </Line>
    );
  if (r.result === "unchanged") return <Line>{tx(T, "بلا تغيير — نفس السعر")}</Line>;
  return (
    <Line>
      {tx(T, "مرفوض:")} {REASONS[r.reason] ?? r.reason}
    </Line>
  );
}

/**
 * CAT-05 — استيراد أو تعديل أسعار متعدد. معاينة الأخطاء قبل الاعتماد، ونتيجة جزئية صريحة (ACC-86): الاعتماد
 * يطبّق الصالح فقط ويترك المرفوض؛ الملف نفسه لا يكرّر التطبيق؛ المرفوض يُصدَّر بسببه ورقم سطره؛ الانقطاع
 * يُستأنف: ما اكتمل يبقى؛ والتراجع دفعةً خلال 24 ساعة. على الجوال يُلصق نص CSV (مستعرض الملفات
 * `expo-document-picker` غير مثبّت).
 */
export default function ImportScreen() {
  const { api, state: session } = useSession();
  const [text, setText] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "applying" | "cut" | "done">("idle");
  const [blocked, setBlocked] = useState<"owner" | "subscription" | null>(null);
  const [revertRefused, setRevertRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const preview = async () => {
    if (!text.trim() || phase === "checking") return;
    setBatch(null);
    setBlocked(null);
    setRevertRefused(null);
    setFailed(false);
    setPhase("checking");
    try {
      const { data, error, response } = await api.POST("/api/catalog/prices/import/preview", {
        body: { file_name: "prices.csv", content: text },
      });
      if (response.status === 403 && error) {
        const detail = (error as { detail?: string }).detail;
        setBlocked(detail === "bulk_pricing_blocked" ? "subscription" : "owner");
        setPhase("idle");
        return;
      }
      if (response.ok && data) {
        const b = data as unknown as Batch;
        setBatch(b);
        setPhase(b.status === "applied" || b.status === "reverted" ? "done" : "idle");
      } else {
        setFailed(true);
        setPhase("idle");
      }
    } catch {
      setFailed(true);
      setPhase("idle");
    }
  };

  const apply = async () => {
    if (!batch || busy) return;
    setBusy(true);
    setPhase("applying");
    try {
      const { data, response } = await api.POST("/api/catalog/prices/import/{batch_id}/apply", {
        params: { path: { batch_id: batch.id } },
        body: {},
      });
      if (response.ok && data) {
        const b = data as unknown as Batch;
        setBatch(b);
        setPhase(b.status === "applied" ? "done" : "cut");
        return;
      }
      throw new Error("apply_failed");
    } catch {
      // انقطع أثناء التطبيق: نسأل الخادم أين وقفنا — ما اكتمل يبقى
      const { data } = await api
        .GET("/api/catalog/prices/import/{batch_id}", { params: { path: { batch_id: batch.id } } })
        .catch(() => ({ data: undefined }));
      if (data) setBatch(data);
      setPhase("cut");
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!batch || busy) return;
    setBusy(true);
    try {
      const { data, error, response } = await api.POST(
        "/api/catalog/prices/import/{batch_id}/revert",
        { params: { path: { batch_id: batch.id } }, body: undefined },
      );
      if (response.status === 409 && error) {
        setRevertRefused((error as { reason?: string }).reason ?? "refused");
        return;
      }
      if (response.ok && data) setBatch(data as unknown as Batch);
    } catch {
      setPhase("cut");
    } finally {
      setBusy(false);
    }
  };

  /** المرفوض بسببه ورقم سطره: يُجلب CSV ويُسلَّم لورقة المشاركة (حفظ/إرسال) بدل التنزيل. */
  const exportRejected = async () => {
    if (!batch) return;
    try {
      const res = await fetch(`${API_URL}/api/catalog/prices/import/${batch.id}/rejected.csv`, {
        headers: { Authorization: `Bearer ${session.tokens?.access ?? ""}` },
      });
      await Share.share({ message: await res.text() });
    } catch {
      setFailed(true);
    }
  };

  const state: State =
    phase === "checking"
      ? "loading"
      : phase === "cut"
        ? "server_error"
        : !batch
          ? "ready"
          : batch.status === "applied" || batch.status === "reverted"
            ? "success"
            : batch.ready_count === 0 && batch.rejected_count > 0
              ? "validation_error"
              : batch.rejected_count > 0
                ? "partial"
                : "ready";

  const changes = batch ? batch.rows.filter((r) => r.result === "update") : [];
  const tableRows = state === "ready" ? changes : (batch?.rows ?? []);

  return (
    <Screen screenId={T} state={state} title={tx(T, "استيراد أو تعديل أسعار متعدد")}>
      {batch ? (
        <AppText variant="bodyStrong" style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "معاينة استيراد الأسعار —")} <M>{batch.file_name}</M>
        </AppText>
      ) : null}

      {blocked === "subscription" ? (
        <StateView state="permission_denied" title={tx(T, "التسعير الجماعي")}>
          <AppText variant="secondary">
            {tx(T, "المحجوب هو التسعير الجماعي، مثل رفع مجموعة بنسبة أو استيراد قائمة أسعار.")}
          </AppText>
          <AppText variant="secondary">
            {tx(T, "تعديل السعر الأساسي لصنف واحد يبقى متاحاً للإدارة عند الاتصال.")}
          </AppText>
        </StateView>
      ) : null}
      {blocked === "owner" ? (
        <StateView state="permission_denied" title={tx(T, "تغيير السعر للمالك")}>
          <AppText variant="secondary">
            {tx(T, "مدير الفرع يرى السعر وتاريخه ولا يغيّره. السعر قرار منشأة لا فرع.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ الفحص")}>
          <AppText variant="secondary">{tx(T, "قراءة كاملة ومطابقة قبل أي كتابة.")}</AppText>
        </StateView>
      ) : null}

      {failed ? (
        <StateView state="offline" title={tx("ACC-01", "بلا اتصال")}>
          <Button label={tx("ACC-01", "أعد المحاولة")} onPress={() => void preview()} />
        </StateView>
      ) : null}

      {state === "ready" && batch ? (
        <StateView state="ready" title={tx(T, "معاينة ما سيتغيّر")}>
          <AppText variant="secondary">
            {tx(T, "الملف مقروء ولم يُكتب شيء. نعرض الفرق:")} <M>{batch.ready_count}</M>{" "}
            {tx(T, "سعراً سيتغيّر، أكبر ارتفاع")} <M>{batch.max_increase_pct}</M>
            {tx(T, "٪.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "validation_error" && batch ? (
        <StateView state="validation_error" title={tx(T, "صفوف لا تُقبل")}>
          <AppText variant="secondary">
            <M>{batch.rejected_count}</M>{" "}
            {tx(T, "صفاً بسعر غير رقمي أو بصنف غير موجود أو بسعر سالب.")}
          </AppText>
          <AppText variant="secondary">
            <AppText variant="bodyStrong">{tx(T, "يُستورد السليم")}</AppText>{" "}
            {tx(T, "ويُصدَّر المرفوض بسببه ورقم سطره ليُصحَّح ويُعاد.")}
          </AppText>
          <Button
            label={tx(T, "تنزيل المرفوض للتصحيح")}
            variant="secondary"
            onPress={() => void exportRejected()}
          />
        </StateView>
      ) : null}

      {state === "partial" && batch ? (
        <GroupedList title={tx(T, "النتيجة")}>
          <CatRow title={tx(T, "جاهز للاعتماد")} trailing={<M>{batch.ready_count}</M>} />
          <CatRow title={tx(T, "مرفوض")} trailing={<M>{batch.rejected_count}</M>} />
          <CatRow title={tx(T, "بلا تغيير")} trailing={<M>{batch.unchanged_count}</M>} last />
        </GroupedList>
      ) : null}

      {state === "success" && batch ? (
        <StateView state="success" title={tx(T, "طُبّقت الأسعار")}>
          <AppText variant="secondary">
            <M>{batch.applied_count}</M>{" "}
            {tx(T, "سعراً سرى الآن، وكلٌّ منها سطرٌ في تاريخ صنفه موسومٌ بالدفعة.")}
          </AppText>
          <AppText variant="secondary">
            {tx(T, "الدفعة كيانٌ واحد يُتراجَع عنه خلال")} <M>24</M>{" "}
            {tx(T, "ساعة ما لم يُبع بالسعر الجديد — وبعدها يصير جزءاً من الدفتر.")}
          </AppText>
          {batch.status === "reverted" ? (
            <AppText variant="secondary">
              <AppText variant="bodyStrong">{tx(T, "التراجع دفعةً")}</AppText>{" "}
              {tx(T, "— أُعيدت الأسعار السابقة.")}
            </AppText>
          ) : null}
          {revertRefused ? (
            <AppText variant="secondary" accessibilityRole="alert">
              {revertRefused === "sold_at_new_price"
                ? tx(T, "بيع بالسعر الجديد — صارت جزءاً من الدفتر.")
                : tx(T, "مضت 24 ساعة — صارت جزءاً من الدفتر.")}
            </AppText>
          ) : null}
          {batch.status === "applied" ? (
            <Button
              label={tx(T, "التراجع دفعةً")}
              variant="secondary"
              onPress={() => void revert()}
              loading={busy}
            />
          ) : null}
        </StateView>
      ) : null}

      {state === "success" ? (
        <Button
          label={tx(T, "استورد ملفاً")}
          variant="secondary"
          onPress={() => {
            setBatch(null);
            setText("");
            setPhase("idle");
          }}
        />
      ) : null}

      {state === "server_error" && batch ? (
        <StateView state="server_error" title={tx(T, "انقطع أثناء التطبيق")}>
          <AppText variant="secondary">
            {tx(T, "طُبّق")} <M>{batch.applied_count}</M> {tx(T, "من")} <M>{batch.ready_count}</M>{" "}
            {tx(T, "ثم انقطع. بعض الأصناف بالسعر الجديد وبعضها بالقديم.")}
          </AppText>
          <AppText variant="secondary">
            {tx(T, "الدفعة تُطبَّق كوحدة قابلة للتراجع: ما اكتمل يبقى وما انقطع يُلغى.")}
          </AppText>
          <Button label={tx(T, "استئناف")} onPress={() => void apply()} loading={busy} />
        </StateView>
      ) : null}

      {!batch ? (
        <View>
          <TextField
            label={CT.pasteLabel}
            hint={`${tx(T, "CSV بعمودين: الصنف، السعر")} — ${CT.pasteHint}`}
            value={text}
            onChangeText={setText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 140, textAlignVertical: "top" }}
          />
          <Button
            label={tx(T, "معاينة ما سيتغيّر")}
            onPress={() => void preview()}
            loading={phase === "checking"}
            disabledReason={text.trim() ? undefined : CT.pasteFirst}
          />
        </View>
      ) : null}

      {batch && (state === "partial" || state === "ready" || state === "validation_error") ? (
        <>
          <GroupedList title={tx(T, "معاينة استيراد الأسعار")}>
            {tableRows.map((r, i) => (
              <CatRow
                key={r.line}
                title={r.name || r.key}
                lines={
                  <>
                    <Line>
                      {tx(T, "السطر")} <M>{r.line}</M>
                    </Line>
                    <ResultLine r={r} />
                  </>
                }
                trailing={
                  <AppText>
                    <M>{r.new_price_minor ? formatMinor(r.new_price_minor) : r.price_text}</M>
                  </AppText>
                }
                last={i === tableRows.length - 1}
              />
            ))}
          </GroupedList>
          {state !== "validation_error" ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "الاعتماد يطبّق")} <M>{batch.ready_count}</M>{" "}
              {tx(
                T,
                "سطراً صالحاً فقط ويترك المرفوض دون تغيير. إعادة رفع الملف نفسه لا تكرّر التطبيق — يُطابَق بالمعرّف لا بالترتيب.",
              )}
            </AppText>
          ) : null}
          <View style={{ gap: SPACE["2"] }}>
            {batch.ready_count > 0 ? (
              <Button
                label={`${tx(T, "اعتماد")} ${batch.ready_count} ${tx(T, "سطراً")}`}
                onPress={() => void apply()}
                loading={busy}
                financial
              />
            ) : null}
            {batch.rejected_count > 0 && state !== "validation_error" ? (
              <Button
                label={tx(T, "تنزيل المرفوض للتصحيح")}
                variant="secondary"
                onPress={() => void exportRejected()}
              />
            ) : null}
            <Button
              label={tx(T, "استورد ملفاً")}
              variant="secondary"
              onPress={() => {
                setBatch(null);
                setText("");
                setPhase("idle");
              }}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
