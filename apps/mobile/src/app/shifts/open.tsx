import { hhmm, parseMoneyInput, pushPending } from "@sting/app-core";
import { type LocalShift, openShiftLocally, readOpenShift } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Keypad,
  ListRow,
  Screen,
  SPACE,
  StateView,
  FONT,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

import { newId } from "@/lib/crypto";
import { storeShiftContext, type ShiftContext, useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SHIFT-01";

interface Previous {
  readonly counted_cash_minor: string;
  readonly closed_at: string;
  readonly closed_by_name: string;
}

/**
 * SHIFT-01 — فتح وردية (خطة الجوال M2). حقل رصيد افتتاحي كبير بلوحة أرقام: تُفتح بعدٍّ كما تُقفل بعدّ.
 * الحفظ محلي أولاً (ShiftOpened حدث ثابت) ثم يُرفع إن كان الاتصال قائماً؛ بلا اتصال تُفتح على الجهاز ويعمل
 * البيع وتُرفع مع عملياتها عند العودة. الفراغ ليس صفراً: «لم أعدّ» تختلف عن «الدرج فارغ».
 */
export default function OpenShift() {
  const router = useRouter();
  const { state: session, api } = useSession();
  const stored = useShiftContext();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [previous, setPrevious] = useState<Previous | null>(null);
  const [counted, setCounted] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<LocalShift | null>(null);
  const [offline, setOffline] = useState(false);
  const ids = useRef({ shiftId: newId(), operationId: newId() });

  useEffect(() => {
    if (stored) setCtx(stored);
  }, [stored]);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      setExisting(await readOpenShift(storage));
      try {
        const { data, response } = await api.GET("/api/shifts/current", {
          params: { query: stored?.branchId ? { branch_id: stored.branchId } : {} },
        });
        if (!response.ok || !data) return;
        const d = data as unknown as {
          branch_id: string;
          branch_name: string;
          device_name: string;
          user_name: string;
          role_name: string;
          can_withdraw: boolean;
          owner_name: string;
          role_code?: string;
          branch_code?: string;
          previous: Previous | null;
        };
        const fresh: ShiftContext = {
          branchId: d.branch_id,
          branchName: d.branch_name || stored?.branchName || "",
          deviceId: stored?.deviceId ?? session.deviceId ?? "",
          deviceName: d.device_name || stored?.deviceName || "",
          userId: session.userId ?? stored?.userId ?? "",
          userName: d.user_name || stored?.userName || "",
          roleName: d.role_name || stored?.roleName || "",
          canWithdraw: d.can_withdraw,
          ownerName: d.owner_name,
          roleCode: d.role_code,
          branchCode: d.branch_code || stored?.branchCode,
          devicePrefix: stored?.devicePrefix,
        };
        await storeShiftContext(storage, fresh);
        setCtx(fresh);
        setPrevious(d.previous);
        setOffline(false);
      } catch {
        setOffline(true);
      }
    })();
  }, [api, stored, session.deviceId, session.userId]);

  const open = async () => {
    if (busy || !ctx) return;
    const minor = parseMoneyInput(counted);
    if (!counted.trim() || minor === null || minor.startsWith("-")) {
      return setError(
        tx(T, "درجٌ فارغ حالةٌ مشروعة تُكتب 0.00. والحقل الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة."),
      );
    }
    setBusy(true);
    setError(undefined);
    try {
      const now = new Date();
      const storage = await getStorage();
      const { shift: saved } = await openShiftLocally(storage, {
        ...ids.current,
        branchId: ctx.branchId,
        branchName: ctx.branchName,
        deviceId: ctx.deviceId,
        deviceName: ctx.deviceName,
        userId: ctx.userId,
        userName: ctx.userName,
        openingFloatMinor: minor,
        businessDate: now.toISOString().slice(0, 10),
        occurredAt: now.toISOString(),
      });
      setShift(saved);
      try {
        const out = await pushPending({ api, storage, requestId: newId });
        if (out.kind === "applied" || out.kind === "idle") {
          const op = await storage.read((t) => t.getOperation(saved.operation_id));
          setSynced(op?.state === "synced");
        }
      } catch {
        /* بلا اتصال: تُرفع مع عملياتها */
      }
    } finally {
      setBusy(false);
    }
  };

  const state = shift
    ? synced
      ? "success"
      : "saved_local"
    : error
      ? "validation_error"
      : offline
        ? "offline"
        : "ready";

  if (shift)
    return (
      <Screen screenId={T} state={state} title={tx(T, "الوردية مفتوحة")}>
        <StateView
          state={synced ? "success" : "saved_local"}
          title={synced ? tx(T, "الوردية مفتوحة") : tx(T, "فُتحت بلا اتصال")}
        >
          <AppText variant="secondary">
            {tx(T, "الوردية مفتوحة على الجهاز والبيع يعمل. تُرفع عند عودة الشبكة.")}
          </AppText>
          <AppText variant="note">
            {shift.number} · {tx(T, "شهادة الفتح")}
          </AppText>
        </StateView>
        <Button
          label={tx(T, "افتح الوردية وابدأ البيع")}
          financial
          onPress={() => router.replace("/pos")}
        />
      </Screen>
    );

  return (
    <Screen screenId={T} state={state} title={tx(T, "فتح وردية")}>
      {existing ? (
        <StateView state="ready" title={tx(T, "الوردية الحالية")}>
          <AppText variant="secondary">
            {existing.user_name} ·{" "}
            <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
              {hhmm(existing.opened_at)}
            </Text>
          </AppText>
          <Button
            label={tx(T, "الوردية الحالية")}
            onPress={() => router.replace("/shifts/current")}
          />
        </StateView>
      ) : null}

      {offline ? (
        <StateView state="offline" title={tx(T, "بلا اتصال")}>
          <AppText variant="secondary">
            {tx(
              T,
              "لا اتصال بالخادم الآن. تُفتح الوردية محلياً ويعمل البيع كاملاً، وتُرفع مع عملياتها عند عودة الاتصال.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {ctx && !ctx.deviceId ? (
        <StateView state="permission_denied" title={tx(T, "الجهاز غير مهيّأ — جهّز الجهاز أولاً")}>
          <Button label={tx(T, "جهّز هذا الجهاز")} onPress={() => router.push("/setup-device")} />
        </StateView>
      ) : null}

      <GroupedList title={tx(T, "الوردية والفرع والجهاز")}>
        <ListRow title={tx(T, "الفرع")} trailing={<AppText>{ctx?.branchName ?? "—"}</AppText>} />
        <ListRow title={tx(T, "الجهاز")} trailing={<AppText>{ctx?.deviceName ?? "—"}</AppText>} />
        <ListRow
          title={tx(T, "المسؤول")}
          trailing={<AppText>{ctx?.userName ?? "—"}</AppText>}
          last
        />
      </GroupedList>
      {previous ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "ما تركته في الدرج")}{" "}
          <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
            {(Number(previous.counted_cash_minor) / 100).toFixed(2)}
          </Text>
        </AppText>
      ) : null}

      <AppText variant="secondary" muted>
        {tx(T, "ما تعدّه الآن في الدرج")} · {tx(T, "الصفر يُدخَل صراحةً")}
      </AppText>
      <Text
        accessibilityLabel={tx(T, "ما تعدّه الآن في الدرج")}
        style={{
          fontFamily: FONT.monoSemiBold,
          fontSize: 36,
          textAlign: "center",
          writingDirection: "ltr",
          marginVertical: SPACE["3"],
        }}
      >
        {counted || "0.00"}
      </Text>
      {error ? (
        <AppText variant="note" style={{ color: "#B3261E", marginBottom: SPACE["2"] }}>
          {error}
        </AppText>
      ) : null}
      <Keypad value={counted} onChange={setCounted} />
      <Button
        label={tx(T, "افتح الوردية وابدأ البيع")}
        financial
        loading={busy}
        onPress={() => void open()}
      />
    </Screen>
  );
}
