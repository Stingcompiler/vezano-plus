import { hhmm } from "@sting/app-core";
import {
  type BackupContent,
  type BackupEnvelope,
  backupCounts,
  backupSizeBytes,
  collectBackup,
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
import { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";

import { N, Row, Strong } from "@/components/ops/ui";
import { sealBackup } from "@/features/ops/backup-crypto";
import { call } from "@/features/ops/net";
import { OPS } from "@/features/ops/texts";
import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SYS-05";
type State = "ready" | "saving" | "validation_error" | "success" | "server_error";

/** آخر تصدير نسخة محلية (SYS-05) — نفس مفتاح الويب. */
export const LAST_BACKUP_META = "backup.last_exported_at";
const MB = 1024 * 1024;
export const mb = (bytes: number): string => (Math.round((bytes / MB) * 10) / 10).toString();
/** حجم الغلاف ≈ النص × 4/3 (base64) + هامش */
const envelopeEstimate = (plain: number): number => Math.ceil(plain * 1.4) + 2048;

export function backupFileName(exportedAt: string): string {
  return `sting-backup-${exportedAt.slice(0, 10).replace(/-/g, "")}-${exportedAt.slice(11, 16).replace(":", "")}.stg`;
}

/**
 * SYS-05 — تصدير نسخة محلية (نظير `backup-client.tsx`): مخرج الطوارئ — يعمل بلا اتصال وبلا صلاحية
 * خادمية؛ نطاق التصدير مُعلن والمعلّق مشمول وموسوم؛ بلا أسرار؛ كلمة حماية + AES-GCM (نفس صيغة الويب
 * فالملف يُستعاد على الويب والعكس)؛ التصدير نسخٌ لا رفع. الملف يُسلَّم لورقة المشاركة الأصلية.
 */
export function BackupScreen() {
  const router = useRouter();
  const { api, state: session } = useSession();
  const ctx = useShiftContext();
  const [content, setContent] = useState<BackupContent | null>(null);
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [noCrypto, setNoCrypto] = useState(false);
  const [result, setResult] = useState<{
    name: string;
    bytes: number;
    at: string;
    envelope: BackupEnvelope;
    counts: ReturnType<typeof backupCounts>;
  } | null>(null);
  const [upload, setUpload] = useState<"none" | "uploading" | "done" | "failed">("none");

  const load = useCallback(async () => {
    setContent(await collectBackup(await getStorage()));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = content ? backupCounts(content) : null;
  const fullBytes = content ? envelopeEstimate(backupSizeBytes(content)) : 0;
  const passwordError =
    attempted && password.length < 6 ? tx(T, "كلمة حماية من 6 أحرف فأكثر") : undefined;
  const state: State =
    upload === "failed" || noCrypto
      ? "server_error"
      : phase === "saved"
        ? "success"
        : phase === "saving"
          ? "saving"
          : attempted && password.length < 6
            ? "validation_error"
            : "ready";

  const exportNow = async () => {
    if (!content || phase !== "idle") return;
    setAttempted(true);
    if (password.length < 6) return;
    setPhase("saving");
    try {
      const storage = await getStorage();
      const exportedAt = new Date().toISOString();
      const envelope = await sealBackup({
        content,
        password,
        tenantId: session.tenantId ?? "",
        deviceId: ctx?.deviceId ?? "",
        syncEpoch: (await storage.read((t) => t.getMeta("sync_epoch"))) ?? "",
        exportedAt,
      });
      const text = JSON.stringify(envelope);
      const name = backupFileName(exportedAt);
      await Share.share({ title: name, message: text });
      await storage.transaction((t) => t.putMeta(LAST_BACKUP_META, exportedAt));
      setResult({
        name,
        bytes: new TextEncoder().encode(text).length,
        at: exportedAt,
        envelope,
        counts: backupCounts(content),
      });
      setPhase("saved");
    } catch {
      setNoCrypto(true);
      setPhase("idle");
    }
  };

  const uploadCopy = async () => {
    if (!result || upload === "uploading") return;
    setUpload("uploading");
    const r = await call(
      () =>
        api.POST("/api/support/backups", {
          body: { file_name: result.name, envelope: JSON.stringify(result.envelope) },
        }) as never,
    );
    setUpload(r.ok ? "done" : "failed");
  };

  const share = async () => {
    if (!result) return;
    try {
      await Share.share({
        title: result.name,
        message: JSON.stringify(result.envelope),
      });
    } catch {
      /* أُلغيت المشاركة */
    }
  };

  return (
    <Screen screenId={T} state={state} title={tx(T, "مركز الاتصال والمزامنة")}>
      <AppText variant="section" style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "تصدير نسخة محلية")}
      </AppText>

      {noCrypto ? (
        <StateView state="server_error" title={tx(T, "حفظ بكلمة حماية")}>
          <AppText variant="secondary">{OPS.cryptoMissing}</AppText>
        </StateView>
      ) : null}
      {upload === "failed" ? (
        <StateView state="server_error" title={tx(T, "فشل الرفع إلى التخزين")}>
          <AppText variant="secondary">{tx(T, "الملف المحلي سليم.")}</AppText>
          <AppText variant="note">
            <Strong>{tx(T, "الملف باقٍ")}</Strong> {result?.name}
          </AppText>
          <Button label={tx(T, "شارك يدوياً")} onPress={() => void share()} />
        </StateView>
      ) : null}

      {state === "success" && result ? (
        <>
          <StateView state="success" title={tx(T, "صُدّرت النسخة")}>
            <AppText variant="secondary">
              {tx(T, "ما زالت العمليات")} <N>{result.counts.pending}</N>{" "}
              {tx(T, "معلّقة — التصدير نسخٌ لا رفع.")}
            </AppText>
            <AppText variant="note">
              {tx(T, "النسخة حمايةٌ من الفقد لا بديلٌ عن المزامنة.")}
            </AppText>
          </StateView>
          <GroupedList>
            <Row title={tx(T, "الملف")} detail={result.name} />
            <Row
              title={tx(T, "حجم النسخة")}
              trailing={
                <AppText>
                  <N>{mb(result.bytes)}</N> {tx(T, "ميجابايت")}
                </AppText>
              }
            />
            <Row title={tx(T, "الوقت")} trailing={<N>{hhmm(result.at)}</N>} />
            <Row title={tx(T, "المعاملات")} trailing={<N>{result.counts.operations}</N>} />
            <Row title={tx(T, "الأطراف وأرصدتها")} trailing={<N>{result.counts.parties}</N>} />
            <Row title={tx(T, "الأصناف والحركات")} trailing={<N>{result.counts.items}</N>} last />
          </GroupedList>
          <View style={{ gap: SPACE["3"] }}>
            <Button
              variant="secondary"
              label={tx(T, "رفع النسخة إلى تخزين المنشأة")}
              loading={upload === "uploading"}
              onPress={() => void uploadCopy()}
              disabledReason={upload === "done" ? tx(T, "رُفعت") : undefined}
            />
            {upload === "done" ? (
              <AppText variant="note" muted>
                {tx(T, "رُفعت نسخة إلى تخزين المنشأة")}
              </AppText>
            ) : null}
            <Button
              variant="quiet"
              label={tx(T, "مركز المزامنة")}
              onPress={() => router.push("/sync")}
            />
          </View>
        </>
      ) : (
        <>
          <StateView state="ready" title={tx(T, "ما الذي يُصدَّر")}>
            <AppText variant="secondary">
              {tx(
                T,
                "نطاق التصدير مُعلن: كل بياناتك المحلية — الفواتير والأطراف والأرصدة والمعلّق. وبلا أسرار: لا رموز جلسات ولا مفاتيح.",
              )}
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "يعمل بلا اتصال")}</Strong>
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "المعلّق مشمول")}</Strong> {tx(T, "· وموسوم بوضوح داخل الملف:")}{" "}
              <N>{counts?.pending ?? 0}</N> {tx(T, "عمليات لم تُرفع.")}
            </AppText>
          </StateView>
          <GroupedList>
            <Row title={tx(T, "المعاملات")} trailing={<N>{counts?.operations ?? 0}</N>} />
            <Row title={tx(T, "الأطراف وأرصدتها")} trailing={<N>{counts?.parties ?? 0}</N>} />
            <Row title={tx(T, "الأصناف والحركات")} trailing={<N>{counts?.items ?? 0}</N>} />
            <Row
              title={tx(T, "حجم النسخة")}
              trailing={
                <AppText>
                  <N>{mb(fullBytes)}</N> {tx(T, "ميجابايت")}
                </AppText>
              }
              last
            />
          </GroupedList>
          <StateView
            state="expired"
            title={tx(T, "النسخة تحمل دفترك كاملاً؛ من يملكها يملك أرقامك")}
          >
            <AppText variant="secondary">
              {tx(
                T,
                "نطلب كلمة حماية قبل الحفظ، ونذكّرك أنها تحتوي أسماء زبائن وأرصدة ديون — لا ترسلها في مجموعة واتساب.",
              )}
            </AppText>
            <AppText variant="note">
              {tx(T, "التشفير بكلمة الحماية (AES-GCM) — لا يستطيع النظام استرداد الكلمة إن نُسيت.")}
            </AppText>
          </StateView>
          <TextField
            label={tx(T, "كلمة الحماية")}
            value={password}
            onChangeText={setPassword}
            secure
            required
            error={passwordError}
            autoCapitalize="none"
          />
          <Button
            financial
            label={tx(T, "حفظ بكلمة حماية")}
            loading={phase === "saving"}
            onPress={() => void exportNow()}
            disabledReason={!content ? tx(T, "جارٍ الجمع") : undefined}
          />
        </>
      )}
    </Screen>
  );
}
