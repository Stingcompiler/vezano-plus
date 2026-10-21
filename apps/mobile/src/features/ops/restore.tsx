import { dayMonth, formatMinor, hhmm, reconcileNow } from "@sting/app-core";
import {
  applyRestore,
  type BackupContent,
  type BackupEnvelope,
  backupFileId,
  describeOperation,
  inspectBackup,
  previewRestore,
  readRestoreProgress,
  type RestorePreview,
  type RestoreProgress,
} from "@sting/sync-core";
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
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { N, Row, Strong } from "@/components/ops/ui";
import { openBackup } from "@/features/ops/backup-crypto";
import { OPS } from "@/features/ops/texts";
import { newId } from "@/lib/crypto";
import { shareLocalBackup } from "@/lib/local-backup";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SYS-06";
type State = "ready" | "validation_error" | "conflict" | "partial" | "success" | "server_error";
type Reject = "corrupt" | "other_tenant" | "newer_version" | "wrong_password";

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

function opAmount(
  kind: string,
  members: readonly { entity: string; payload: Record<string, unknown> }[],
): string {
  const find = (e: string) => members.find((m) => m.entity === e)?.payload ?? {};
  if (kind === "sale") return str(find("sales.Sale")["total_minor"]);
  if (kind === "sale_return") return str(find("sales.SaleReturn")["total_minor"]);
  if (kind === "payment_receipt" || kind === "refund")
    return str(find("parties.PaymentReceipt")["amount_minor"]);
  return "";
}

/**
 * SYS-06 — استعادة نسخة ومعاينتها (نظير `restore-client.tsx`): أخطر فعل في النظام. الملف يُفحص قبل قراءة
 * أي سطر (تالف / لمنشأة أخرى بلا كشف اسمها / إصدار أحدث)؛ معاينة قبل أي كتابة تقول الفرق لا المحتوى؛
 * الاستعادة دمجٌ بالهويات لا إحلال على دفعات قابلة للاستئناف؛ ما نجح ثابت وما تعثّر يُحجز؛ مرتين = لا
 * تكرار. اختيار الملف: لصق محتواه (لا مستعرض ملفات مضمَّن بعد).
 */
export function RestoreScreen() {
  const router = useRouter();
  const { api, state: session } = useSession();
  const [pasted, setPasted] = useState("");
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [reject, setReject] = useState<Reject | null>(null);
  const [password, setPassword] = useState("");
  const [content, setContent] = useState<BackupContent | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [proceed, setProceed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [done, setDone] = useState(false);
  const [interrupted, setInterrupted] = useState(false);

  useEffect(() => {
    void (async () => {
      const prior = await readRestoreProgress(await getStorage());
      if (prior) {
        setProgress(prior);
        setInterrupted(true);
      }
    })();
  }, []);

  const inspect = (text: string) => {
    setPasted(text);
    setReject(null);
    setContent(null);
    setPreview(null);
    setProceed(false);
    if (!text.trim()) return setEnvelope(null);
    const out = inspectBackup(text.trim(), session.tenantId ?? "");
    if (!out.ok) {
      setEnvelope(null);
      setReject(out.reason);
      return;
    }
    setEnvelope(out.envelope);
  };

  const unlock = async () => {
    if (!envelope || busy) return;
    setBusy(true);
    try {
      const out = await openBackup(envelope, password);
      if (!out.ok) {
        setReject(out.reason);
        return;
      }
      setReject(null);
      setContent(out.content);
      setPreview(await previewRestore(await getStorage(), out.content));
    } finally {
      setBusy(false);
    }
  };

  const run = async (opts: { stopAfter?: number } = {}) => {
    if (!envelope || !content || busy) return;
    setBusy(true);
    try {
      const out = await applyRestore(await getStorage(), backupFileId(envelope), content, opts);
      setProgress(out.progress);
      if (out.done) {
        setDone(true);
        setInterrupted(false);
      } else setInterrupted(true);
    } catch {
      setInterrupted(true);
    } finally {
      setBusy(false);
    }
  };

  const pushFirst = async () => {
    setBusy(true);
    try {
      const storage = await getStorage();
      await reconcileNow({ api, storage, requestId: newId });
      if (content) setPreview(await previewRestore(storage, content));
    } finally {
      setBusy(false);
    }
  };

  const pending = preview?.localPending ?? [];
  const state: State = done
    ? progress && progress.held.length > 0
      ? "partial"
      : "success"
    : interrupted
      ? "server_error"
      : reject
        ? "validation_error"
        : preview && pending.length > 0 && !proceed
          ? "conflict"
          : "ready";
  const exp = envelope ? dayMonth(envelope.exported_at) : null;

  return (
    <Screen screenId={T} state={state} title={tx(T, "مركز الاتصال والمزامنة")}>
      <AppText variant="section" style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "استعادة نسخة ومعاينتها")}
      </AppText>

      {state === "server_error" && progress ? (
        <StateView state="server_error" title={tx(T, "انقطع أثناء الكتابة")}>
          <AppText variant="secondary">{tx(T, "الدفتر الآن نصف مستعاد.")}</AppText>
          <AppText variant="note">
            <Strong>{tx(T, "لا نترك نصفاً")}</Strong>{" "}
            {tx(
              T,
              "· الاستعادة تُطبَّق على دفعات قابلة للتراجع: ما اكتمل يبقى وما انقطع يُلغى كاملاً.",
            )}
          </AppText>
          <AppText variant="note">
            {tx(T, "وقفنا عند الدفعة")} <N>{progress.nextBatch}</N> {tx(T, "من")}{" "}
            <N>{progress.totalBatches}</N> {tx(T, "· أُضيف حتى الآن")} <N>{progress.added}</N>
          </AppText>
          <Button
            label={tx(T, "استئناف")}
            loading={busy}
            onPress={() => void run()}
            disabledReason={
              content ? undefined : tx(T, "اختر الملف نفسه وافتحه بكلمة الحماية للاستئناف")
            }
          />
        </StateView>
      ) : null}
      {state === "success" && progress ? (
        <StateView state="success" title={tx(T, "اكتملت الاستعادة")}>
          <AppText variant="secondary">
            {tx(T, "أُضيفت")} <N>{progress.added}</N> {tx(T, "عملية · حُدّثت")}{" "}
            <N>{progress.updated}</N>{" "}
            {tx(
              T,
              "أرصدة · لم يُحذف شيء. ومعها: الكتابات الجديدة على هذا الجهاز تأخذ هوية جديدة — فلو استُعيد الملف مرتين لم يتكرّر شيء.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "partial" && progress ? (
        <StateView state="partial" title={tx(T, "استُعيد بعضه")}>
          <AppText variant="secondary">
            {tx(T, "نزلت")} <N>{progress.added - progress.held.length}</N> {tx(T, "فاتورة من")}{" "}
            <N>{progress.added}</N>
            {tx(T, "؛")} <N>{progress.held.length}</N> {tx(T, "تشير إلى صنف لم يعد موجوداً.")}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "لا نخترع")}</Strong>{" "}
            {tx(
              T,
              "· لا نُنشئ الصنف المحذوف تلقائياً لتكتمل الفاتورة. الفواتير تبقى محجوزة باسم الصنف الناقص ليقرّر المالك.",
            )}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "ما نجح ثابت")}</Strong> {tx(T, "· ما نزل لا يُلغى لأن بعضه تعثّر.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView
          state="validation_error"
          title={
            reject === "wrong_password" ? tx(T, "كلمة الحماية غير صحيحة") : tx(T, "الملف لا يُقبل")
          }
        >
          {reject === "other_tenant" ? (
            <>
              <AppText variant="secondary">
                {tx(
                  T,
                  "رُفض الملف — لم يتغير شيء. هذه النسخة تخص منشأة أخرى. لم تُقرأ بياناتها ولم تُكتب على جهازك.",
                )}
              </AppText>
              <AppText variant="note">
                {tx(T, "منشأة الملف")}: {tx(T, "لا تطابق منشأتك")}
              </AppText>
              <AppText variant="note">
                {tx(
                  T,
                  "لا نعرض اسم المنشأة الأخرى ولا أي محتوى من الملف — عزل المستأجرين يمنع ذلك حتى في رسالة الخطأ.",
                )}
              </AppText>
            </>
          ) : reject === "newer_version" ? (
            <AppText variant="secondary">
              <Strong>{tx(T, "إصدار أحدث")}</Strong>{" "}
              {tx(T, "· حدّث التطبيق ثم أعد المحاولة. الملف صالح والتطبيق هو المتخلّف.")}
            </AppText>
          ) : reject === "wrong_password" ? (
            <AppText variant="secondary">
              {tx(T, "لم يُفتح الملف بهذه الكلمة — لم يتغير شيء.")}
            </AppText>
          ) : (
            <AppText variant="secondary">
              {tx(T, "الملف تالف أو ليس نسخة فيزانو بلص — رُفض قبل قراءة أي سطر ولم يتغير شيء.")}
            </AppText>
          )}
          <Button
            variant="secondary"
            label={tx(T, "اختيار ملف آخر")}
            onPress={() => {
              inspect("");
              setPassword("");
            }}
          />
        </StateView>
      ) : null}
      {state === "conflict" ? (
        <StateView state="conflict" title={tx(T, "توقّف قبل الاستعادة")}>
          <AppText variant="secondary">
            {tx(T, "على هذا الجهاز")} <N>{pending.length}</N>{" "}
            {tx(
              T,
              "عمليات لم تصل الخادم. الاستعادة دمجٌ بالهويات لا إحلال — لا تمسّها، لكن ارفعها أولاً كي لا تختلط بما سيُستعاد.",
            )}
          </AppText>
          <AppText variant="note">
            {tx(T, "ما سيُفقد إن تابعت الآن: لا شيء — والمعلّق يبقى:")}
          </AppText>
          {pending.slice(0, 5).map((op) => {
            const d = describeOperation(op);
            const amount = opAmount(op.kind, op.members);
            return (
              <AppText key={op.operationId} variant="note">
                {d.title} <N>{d.number}</N>
                {amount ? (
                  <>
                    {" · "}
                    <N>{formatMinor(amount)}</N>
                  </>
                ) : null}
              </AppText>
            );
          })}
          <Button
            label={tx(T, "ارفع المعلّق أولاً — الأسلم")}
            loading={busy}
            onPress={() => void pushFirst()}
          />
          <Button
            variant="secondary"
            label={tx(T, "تصدير المعلّق كملف ثم المتابعة")}
            onPress={() =>
              void (async () => {
                await shareLocalBackup();
                setProceed(true);
              })()
            }
          />
          <Button
            variant="quiet"
            label={tx(T, "متابعة الاستعادة")}
            onPress={() => setProceed(true)}
          />
        </StateView>
      ) : null}

      {!done ? (
        <>
          <StateView state="ready" title={tx(T, "معاينة قبل أي كتابة")}>
            <AppText variant="secondary">
              {envelope
                ? tx(
                    T,
                    "الملف قُرئ ولم يُكتب حرفٌ بعد. نعرض ما فيه: المنشأة، والتاريخ، والعدد، وما الذي سيتغيّر مقارنةً بالحالي.",
                  )
                : tx(T, "اختر ملف النسخة لعرض محتواه قبل أي كتابة.")}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "لا استعادة كاملة عمياء")}</Strong>{" "}
              {tx(T, "· الاستعادة دمجٌ بالهويات لا إحلال. الإحلال يمحو ما عمله الجهاز بعد النسخة.")}
            </AppText>
          </StateView>
          <TextField
            label={tx(T, "ملف النسخة")}
            hint={OPS.pasteHint}
            value={pasted}
            onChangeText={inspect}
            multiline
            numberOfLines={4}
            autoCapitalize="none"
            autoCorrect={false}
            mono
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          {pasted.trim() && !envelope && !reject ? (
            <AppText variant="note" muted>
              {tx(T, "يُفحص الملف")}
            </AppText>
          ) : null}
          {envelope && !content ? (
            <>
              <GroupedList>
                <Row title={tx(T, "المنشأة")} detail={tx(T, "منشأتك")} />
                <Row
                  title={tx(T, "التاريخ")}
                  detail={
                    <>
                      <N>{exp?.day ?? ""}</N> {exp?.month} <N>{hhmm(envelope.exported_at)}</N>
                    </>
                  }
                />
                <Row
                  title={tx(T, "العدد")}
                  detail={
                    <>
                      <N>{envelope.counts.operations}</N> {tx(T, "عملية ·")}{" "}
                      <N>{envelope.counts.pending}</N> {tx(T, "معلّق")}
                    </>
                  }
                  last
                />
              </GroupedList>
              <TextField
                label={tx(T, "كلمة الحماية")}
                value={password}
                onChangeText={setPassword}
                secure
                autoCapitalize="none"
              />
              <Button
                label={tx(T, "فتح الملف ومعاينته")}
                loading={busy}
                onPress={() => void unlock()}
              />
            </>
          ) : null}
          {preview ? (
            <View style={{ marginTop: SPACE["3"] }}>
              <StateView state="ready" title={tx(T, "الفرق لا المحتوى")}>
                <AppText variant="secondary">
                  {tx(T, "ستُضاف")} <N>{preview.addOperations}</N> {tx(T, "فاتورة · ستُحدَّث")}{" "}
                  <N>{preview.updateProjections}</N> {tx(T, "أرصدة · لن يُحذف شيء.")}
                </AppText>
                <AppText variant="note">
                  {tx(T, "منها")} <N>{preview.addPending}</N> {tx(T, "معلّق داخل النسخة ·")}{" "}
                  <N>{preview.addProjections}</N> {tx(T, "مرجعيات جديدة ·")}{" "}
                  <N>{preview.heldOperations}</N> {tx(T, "تشير إلى صنف غير موجود وستُحجز.")}
                </AppText>
              </StateView>
              {state === "ready" ? (
                <Button
                  financial
                  label={tx(T, "استعادة الآن")}
                  loading={busy}
                  onPress={() => void run()}
                />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      <View style={{ marginTop: SPACE["4"], gap: SPACE["2"] }}>
        <Button
          variant="quiet"
          label={tx(T, "تصدير نسخة محلية")}
          onPress={() => router.push("/sync/backup")}
        />
        <Button
          variant="quiet"
          label={tx(T, "مركز المزامنة")}
          onPress={() => router.push("/sync")}
        />
      </View>
    </Screen>
  );
}
