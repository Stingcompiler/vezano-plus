import { hhmm } from "@sting/app-core";
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

import { DayLabel, N, Row, Strong } from "@/components/ops/ui";
import { call } from "@/features/ops/net";
import { buildSupportPayload, errorLog, type SupportPayload } from "@/features/ops/diagnostics";
import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SYS-11";
type State = "ready" | "empty" | "permission_denied" | "success";
const MB = 1024 * 1024;

/**
 * SYS-11 — الدعم والتشخيص (نظير `support-client.tsx`): ما يُرسل معروض قبل الإرسال — إصدار التطبيق ونوع
 * الجهاز ومساحته الحرة وسجل الأخطاء التقنية آخر 48 ساعة ومعرّفات العمليات المتعثّرة؛ لا أسماء ولا أرقام
 * هواتف ولا أرصدة ولا مبالغ ولا رموز. الإرسال قرار المالك؛ الموظف يُنشئ التقرير ويحفظه محلياً ويطلب من
 * المالك إرساله. الحفظ المحلي عبر ورقة المشاركة.
 */
export function SupportScreen() {
  const router = useRouter();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [payload, setPayload] = useState<SupportPayload | null>(null);
  const [weekErrors, setWeekErrors] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ reference: string; sentKeys: string[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);

  const load = useCallback(async () => {
    const storage = await getStorage();
    setPayload(
      await buildSupportPayload(storage, {
        id: ctx?.deviceId ?? "",
        prefix: ctx?.devicePrefix ?? "",
        branchCode: ctx?.branchCode ?? "",
      }),
    );
    setWeekErrors((await errorLog(storage, 24 * 7)).length);
  }, [ctx?.deviceId, ctx?.devicePrefix, ctx?.branchCode]);
  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = ctx?.roleCode === "owner";
  const state: State = sent
    ? "success"
    : denied || (ctx !== null && !isOwner)
      ? "permission_denied"
      : payload && weekErrors === 0
        ? "empty"
        : "ready";

  const send = async () => {
    if (!payload || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await call<{ reference: string; sent_keys: string[] }>(() =>
        api.POST("/api/support/reports", {
          body: {
            app_version: payload.app.version,
            note: note.trim(),
            payload: payload as unknown as Record<string, unknown>,
          },
        }),
      );
      if (r.status === 403) return setDenied(true);
      if (!r.ok || !r.data) return setFailed(true);
      setSent({ reference: r.data.reference, sentKeys: r.data.sent_keys });
    } finally {
      setBusy(false);
    }
  };

  const saveLocally = async () => {
    if (!payload) return;
    try {
      await Share.share({
        title: `sting-support-${payload.generated_at.replace(/[:.]/g, "-")}.json`,
        message: JSON.stringify(payload, null, 2),
      });
      setSavedLocally(true);
    } catch {
      setSavedLocally(false);
    }
  };

  const preview = payload ? (
    <GroupedList>
      <Row
        title={tx(T, "يُرسل")}
        detail={
          <>
            {tx(T, "إصدار التطبيق ونوع الجهاز ومساحته الحرة")}
            {"\n"}
            <N>{payload.app.version}</N> · {payload.app.ua_family} ·{" "}
            <N>
              {Math.round(
                payload.storage.quota_bytes > 0
                  ? (payload.storage.quota_bytes - payload.storage.usage_bytes) / MB
                  : 0,
              )}
            </N>{" "}
            {tx(T, "ميجابايت حرة")}
            {"\n"}
            {tx(T, "سجلّ الأخطاء التقنية آخر 48 ساعة ومعرّفات العمليات المتعثّرة")}
            {"\n"}
            <N>{payload.errors.length}</N> {tx(T, "خطأ · معلّق")} <N>{payload.sync.pending}</N>{" "}
            {tx(T, "· محجوز")} <N>{payload.sync.held}</N> {tx(T, "· فشل طباعة")}{" "}
            <N>{payload.print_failures}</N>
          </>
        }
      />
      <Row
        title={tx(T, "لا يُرسل")}
        detail={`${tx(T, "أسماء الأطراف وأرقام هواتفهم وأرصدتهم")}\n${tx(T, "مبالغ الفواتير وتفاصيل الأصناف والأسعار")}`}
        last
      />
    </GroupedList>
  ) : null;

  return (
    <Screen screenId={T} state={state} title={tx(T, "مركز الاتصال والمزامنة")}>
      <AppText variant="section">{tx(T, "الدعم والتشخيص")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "ما يُرسل إلى الدعم. القاعدة الحاكمة: لا أسرار ولا بيانات مستأجر آخر ولا مبالغ.")}
      </AppText>

      {state === "success" && sent ? (
        <>
          <StateView state="success" title={tx(T, "أُرسل التقرير")}>
            <AppText variant="secondary">
              {tx(
                T,
                "رقم مرجعي يُقال لموظف الدعم، ومعه بالضبط ما أُرسل: سجل الأخطاء، إصدار التطبيق، حالة المزامنة.",
              )}
            </AppText>
            <AppText variant="secondary">
              {tx(T, "المرجع:")} <N>{sent.reference}</N>
            </AppText>
            <AppText variant="note">
              <Strong>{tx(T, "وما لم يُرسل")}</Strong>{" "}
              {tx(T, "· لا فواتير ولا مبالغ ولا أسماء عملاء ولا رموز دخول.")}
            </AppText>
          </StateView>
          {preview}
        </>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الإرسال للمالك")}>
          <AppText variant="secondary">
            {tx(
              T,
              "التقرير يحوي بنية بيانات المنشأة وأسماء فروعها وأجهزتها. إرساله خارج المنشأة قرار مالكها.",
            )}
          </AppText>
          <AppText variant="note">
            <Strong>{tx(T, "ما يفعله الموظف")}</Strong>{" "}
            {tx(T, "· يُنشئ التقرير ويحفظه محلياً ويطلب من المالك إرساله.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا شيء يُبلَّغ عنه")}>
          <AppText variant="secondary">{tx(T, "لا أخطاء مسجّلة في آخر سبعة أيام.")}</AppText>
        </StateView>
      ) : null}

      {state !== "success" ? (
        <>
          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "ما يُرسل بالضبط، معروض قبل الإرسال")}
          </AppText>
          {preview}
          {payload && payload.errors.length > 0 ? (
            <GroupedList title={tx(T, "سجل الأخطاء")}>
              {payload.errors.slice(0, 20).map((e, i, arr) => (
                <Row
                  key={i}
                  title={
                    <AppText variant="secondary">
                      <DayLabel iso={e.at} /> <N>{hhmm(e.at)}</N>
                    </AppText>
                  }
                  detail={
                    <N>
                      {`${e.event}${e.status ? ` ${e.status}` : ""}${e.code ? ` ${e.code}` : ""} · op ${e.op}`}
                    </N>
                  }
                  last={i === arr.length - 1}
                />
              ))}
            </GroupedList>
          ) : null}
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "أسماء الزبائن والأرقام والمبالغ")}{" "}
            <Strong>{tx(T, "لا تُرسل افتراضياً")}</Strong>
            {tx(
              T,
              ". لو احتاجها الدعم يطلبها بتذكرة، وتُرفق بموافقتك لمرة واحدة تنتهي بإغلاق التذكرة.",
            )}
          </AppText>
          <TextField label={tx(T, "ملاحظة للدعم (اختياري)")} value={note} onChangeText={setNote} />
          {failed ? (
            <StateView state="server_error" title={tx(T, "لم يُرسل التقرير")}>
              <AppText variant="secondary">
                {tx(T, "الخادم لم يقبل التقرير — احفظه محلياً وأعد المحاولة.")}
              </AppText>
            </StateView>
          ) : null}
          <View style={{ gap: SPACE["3"] }}>
            {state === "permission_denied" ? (
              <>
                <Button
                  label={tx(T, "إنشاء التقرير وحفظه محلياً")}
                  onPress={() => void saveLocally()}
                />
                <Button
                  variant="secondary"
                  label={tx(T, "أرسل تقريراً على أي حال")}
                  onPress={() => undefined}
                  disabledReason={tx(T, "الإرسال للمالك")}
                />
              </>
            ) : (
              <>
                <Button
                  label={
                    state === "empty" ? tx(T, "أرسل تقريراً على أي حال") : tx(T, "إرسال التقرير")
                  }
                  loading={busy}
                  onPress={() => void send()}
                />
                <Button
                  variant="secondary"
                  label={tx(T, "حفظ محلياً")}
                  onPress={() => void saveLocally()}
                />
              </>
            )}
          </View>
          {savedLocally ? (
            <AppText variant="note" muted style={{ marginTop: SPACE["2"] }}>
              {tx(T, "حُفظ التقرير محلياً — اطلب من المالك إرساله")}
            </AppText>
          ) : null}
        </>
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
