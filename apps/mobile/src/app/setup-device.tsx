import {
  type BootstrapProgress,
  capabilities,
  percentDone,
  storeVerifiers,
} from "@sting/sync-core";
import { mtx, tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  ListRow,
  Mono,
  Screen,
  SPACE,
  StateView,
} from "@sting/ui-native";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

import { goAfterSetup } from "@/lib/after-setup";
import { runBootstrap, type BootstrapStop } from "@/lib/bootstrap";
import { SECRET_KEYS, secrets } from "@/lib/secrets";
import { type DeviceRegistration, useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "ACC-05";
const REGISTRATION = "device.registration";
const GROUP: Record<string, string> = {
  catalog: tx(T, "الكتالوج"),
  parties: tx(T, "الأطراف"),
  balances: tx(T, "الأرصدة"),
  settings: tx(T, "الإعدادات"),
};

/**
 * ACC-05 — تجهيز الجهاز والتنزيل الأول (خطة الجوال M1؛ 0005 §١٧٣). شاشة تقدّم بملء الشاشة: يُسجَّل
 * الهاتف (أو يُجدَّد تسجيله باعتماد محفوظ في المخزن الآمن)، فتصير الجلسة جلسة جهاز برمز تجديد طويل،
 * ثم تُنزَّل نسخة المنشأة إلى SQLite. بعدها متحققات PIN لفرعه، ثم ضبط PIN إن لم يكن للمستخدم رمز.
 */
export default function SetupDevice() {
  const router = useRouter();
  const session = useSession();
  const { state, api, adoptDevice, completeSetup } = session;
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);
  const [stop, setStop] = useState<BootstrapStop | "denied" | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [done, setDone] = useState(false);
  const [run, setRun] = useState(0);
  const running = useRef(false);

  const ensureDevice = useCallback(async (): Promise<
    DeviceRegistration & { branch_id: string }
  > => {
    // اعتماد التسجيل في المخزن الآمن (لا في قاعدة البيانات كالويب): تجديد الجهاز نفسه لا جهاز جديد
    const raw = await secrets().get(REGISTRATION);
    const stored = raw ? (JSON.parse(raw) as { deviceId: string; secret: string }) : null;
    if (stored) {
      const { data, response } = await api.POST("/api/devices/renew", {
        body: { device_id: stored.deviceId, registration_secret: stored.secret },
      });
      if (response.ok && data) return data;
    }
    const { data, response } = await api.POST("/api/devices/register", {
      // اسم الجهاز بيانات تراها الإدارة لا نص واجهة (كالويب «web · …»)
      body: { name: `mobile · ${Platform.OS}` },
    });
    if (response.status === 403) throw new DeniedError();
    if (!response.ok || !data) throw new Error("register_failed");
    await secrets().set(
      REGISTRATION,
      JSON.stringify({ deviceId: data.device_id, secret: data.registration_secret }),
    );
    return data;
  }, [api]);

  useEffect(() => {
    if (state.status !== "active" || !state.tenantId || running.current || done) return;
    running.current = true;
    let cancelled = false;
    const tenantId = state.tenantId;
    void (async () => {
      setStop(null);
      try {
        const reg = await ensureDevice();
        if (cancelled) return;
        await adoptDevice(reg);
        const storage = await getStorage();
        const result = await runBootstrap({
          api,
          storage,
          tenantId,
          branchId: reg.branch_id,
          isCancelled: () => cancelled,
          onProgress: (p, expired) => {
            setProgress(p);
            setExpiredNotice(expired);
          },
        });
        if (cancelled) return;
        if (!result.done) {
          setStop(result.stop);
          return;
        }
        // متحققات PIN لفرع الجهاز — القفل يعمل بها بلا شبكة
        const { data } = await api.GET("/api/devices/verifiers");
        if (data) {
          await storeVerifiers(storage, { ...data, fetched_at: new Date().toISOString() });
        }
        setDone(true);
        const userId = (await secrets().get(SECRET_KEYS.userId)) ?? state.userId;
        const hasPin = Boolean(data?.verifiers.some((v) => v.user_id === userId));
        if (hasPin) completeSetup();
        if (hasPin) goAfterSetup(router);
        else router.replace("/set-pin");
      } catch (e) {
        if (!cancelled)
          setStop(
            e instanceof DeniedError ? "denied" : e instanceof TypeError ? "offline" : "error",
          );
      } finally {
        running.current = false;
      }
    })();
    return () => {
      cancelled = true;
      running.current = false;
    };
    // run محفّز الإعادة عمداً
  }, [state.status, state.tenantId, run]);

  if (state.status === "anonymous") return <Redirect href="/welcome" />;
  if (state.status === "selecting") return <Redirect href="/select-org" />;

  const p = progress;
  const caps = p ? capabilities(p) : { sell: false, inventory: false };
  const pct = p ? percentDone(p) : 0;
  const screenState = done
    ? "success"
    : stop === "offline"
      ? "offline"
      : stop === "expired"
        ? "stale"
        : stop === "denied"
          ? "permission_denied"
          : stop === "error"
            ? caps.sell || caps.inventory
              ? "partial"
              : "server_error"
            : "loading";
  const retry = () => setRun((n) => n + 1);

  return (
    <Screen screenId={T} state={screenState} title={tx(T, "تجهيز الجهاز")}>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
        {tx(T, "التنزيل الأول يحتاج اتصالاً. بعده يعمل الجهاز كاملاً بلا إنترنت.")}
      </AppText>

      {screenState === "loading" ? (
        <View accessibilityRole="progressbar" accessibilityLabel={tx(T, "تقدّم تجهيز الجهاز")}>
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: SPACE["3"],
              marginBottom: SPACE["4"],
            }}
          >
            <ActivityIndicator />
            <AppText variant="bodyStrong">{tx(T, "التنزيل جارٍ")}</AppText>
            <Mono>{`${pct}%`}</Mono>
          </View>
          <GroupedList>
            {(p?.image.scopes ?? []).map((s, i, all) => (
              <ListRow
                key={s.group}
                title={GROUP[s.group] ?? s.group}
                trailing={
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      gap: SPACE["1"],
                      alignItems: "baseline",
                    }}
                  >
                    <Mono>{p?.received[s.group] ?? 0}</Mono>
                    <AppText variant="secondary">{tx(T, "من")}</AppText>
                    <Mono>{s.total}</Mono>
                  </View>
                }
                last={i === all.length - 1}
              />
            ))}
          </GroupedList>
        </View>
      ) : null}

      {screenState === "offline" ? (
        <StateView state="offline" title={tx(T, "انقطع الاتصال عند")}>
          <Mono>{`${pct}%`}</Mono>
          <AppText variant="secondary">
            {tx(
              T,
              "التقدّم محفوظ ويُستأنف من حيث توقّف — لا يبدأ من الصفر. وما نُزّل من كتالوج وخطوط يعمل الآن؛ ما ينتظر هو الباقي فقط.",
            )}
          </AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={retry} />
        </StateView>
      ) : null}

      {screenState === "partial" ? (
        <StateView state="partial" title={tx(T, "بعض النطاقات وصلت")}>
          <AppText variant="secondary">{tx(T, "المُنزَّل سليم والباقي لا. ما نزل يبقى.")}</AppText>
          {caps.sell ? <AppText variant="secondary">{tx(T, "تستطيع البيع الآن")}</AppText> : null}
          {!caps.inventory ? (
            <AppText variant="secondary">{tx(T, "الجرد يحتاج الأرصدة")}</AppText>
          ) : null}
          <Button label={tx(T, "أعد المحاولة")} onPress={retry} />
        </StateView>
      ) : null}

      {screenState === "server_error" ? (
        <StateView state="server_error" title={tx(T, "انقطع التنزيل بخطأ")}>
          <AppText variant="secondary">{tx(T, "من حيث توقّف لا من الصفر.")}</AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={retry} />
        </StateView>
      ) : null}

      {screenState === "stale" || expiredNotice ? (
        <StateView state="stale" title={tx(T, "تهيئة قديمة غير مكتملة")}>
          <AppText variant="secondary">{tx(T, "ما نُزِّل قديم — نبدأ من جديد")}</AppText>
          {screenState === "stale" ? (
            <Button label={tx(T, "أعد المحاولة")} onPress={retry} />
          ) : null}
        </StateView>
      ) : null}

      {screenState === "permission_denied" ? (
        <StateView state="permission_denied" title={mtx("deviceDenied")} />
      ) : null}

      {screenState === "success" ? (
        <StateView state="success" title={tx(T, "الجهاز جاهز")}>
          <AppText variant="secondary">{tx(T, "يعمل بلا اتصال ويُزامن حين تعود الشبكة")}</AppText>
        </StateView>
      ) : null}
    </Screen>
  );
}

class DeniedError extends Error {}
