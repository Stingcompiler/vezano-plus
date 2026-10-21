import { tx, mtx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  Sheet,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { N, Row } from "@/components/ops/ui";
import { call } from "@/features/ops/net";
import { OPS } from "@/features/ops/texts";
import { useSession } from "@/lib/session";

const T = "ACC-09";
type State =
  | "loading"
  | "ready"
  | "permission_denied"
  | "pending_sync"
  | "success"
  | "server_error"
  | "offline";

export interface SessionRow {
  readonly session_id: string;
  readonly kind: "own" | "device";
  readonly session_label: string;
  readonly is_current: boolean;
  readonly tenant_name: string;
  readonly branch_name: string;
  readonly device_id: string;
  readonly last_seen_at: string;
  readonly revoked_at: string;
  readonly revoke_after_upload: boolean;
  readonly reported_pending: number | null;
  readonly can_revoke: boolean;
}

/** «آخر نشاط قبل N ساعات» / «نشطة الآن» — الرقم mono والعربي بجانبه. */
function WhenOf({ row }: { row: SessionRow }) {
  const ms = Date.now() - new Date(row.last_seen_at).getTime();
  const place = row.branch_name || row.tenant_name;
  if (row.revoked_at) return <>{tx(T, "أُبطلت")}</>;
  if (ms < 5 * 60_000)
    return (
      <>
        {tx(T, "نشطة الآن")}
        {place ? ` · ${place}` : ""}
      </>
    );
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return (
    <>
      {tx(T, "آخر نشاط قبل")} <N>{hours}</N> {tx(T, "ساعات")}
    </>
  );
}

function EffectOf({ row }: { row: SessionRow }) {
  if (row.revoked_at) return <>{tx(T, "أُبطلت")}</>;
  if (row.is_current) return <>{tx(T, "الجلسة الحالية. إبطالها يخرجك أنت.")}</>;
  if (row.kind === "device" && (row.reported_pending ?? 0) > 0)
    return (
      <>
        {tx(T, "الإبطال يمنع بيعاً جديداً من هذا الجهاز، وتبقى الـ")}
        <N>{row.reported_pending ?? 0}</N>{" "}
        {tx(T, "عملية في طابوره حتى ترفعها جلسة مصرَّحة. لا تُمحى.")}
      </>
    );
  return <>{tx(T, "الإبطال يمنع بيعاً جديداً من هذا الجهاز")}</>;
}

/**
 * ACC-09 — الحساب والأمان والجلسات (نظير `sessions-client.tsx`). القائمة من الخادم دائماً لا من كاش؛ لا
 * تفاؤل: الجلسة لا تُعرض منتهية قبل تأكيد الخادم؛ ولا يُمحى معلّق عند الإبطال. على الجوال: صفوف بزرّ
 * «إنهاء الجلسة» (لا سحب أفقي — لا مكتبة إيماءات مضمَّنة بعد)، وتأكيد بورقة حين يكون على الجهاز معلّق.
 */
export function SessionsScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [rows, setRows] = useState<readonly SessionRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [target, setTarget] = useState<SessionRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState<SessionRow | null>(null);

  const load = useCallback(async () => {
    const r = await call<{ sessions: SessionRow[] }>(() => api.GET("/api/account/sessions"));
    setOffline(r.offline);
    setRows(r.ok && r.data ? r.data.sessions : []);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (row: SessionRow, afterUpload: boolean) => {
    if (busy) return;
    setBusy(row.session_id);
    setFailed(false);
    setDenied(false);
    const r = await call<SessionRow>(() =>
      api.POST("/api/account/sessions/{session_id}/revoke", {
        params: { path: { session_id: row.session_id } },
        body: { after_upload: afterUpload },
      }),
    );
    setBusy(null);
    if (r.status === 403) return setDenied(true);
    if (!r.ok || !r.data) return setFailed(true);
    const out = r.data;
    setTarget(null);
    setEnded(out);
    setRows((rs) => rs?.map((x) => (x.session_id === out.session_id ? out : x)) ?? null);
  };

  const onRevokeClick = (row: SessionRow) => {
    if (row.kind === "device" && (row.reported_pending ?? 0) > 0) setTarget(row);
    else void revoke(row, false);
  };

  const state: State =
    rows === null
      ? "loading"
      : denied
        ? "permission_denied"
        : failed
          ? "server_error"
          : target
            ? "pending_sync"
            : ended
              ? "success"
              : offline
                ? "offline"
                : "ready";

  return (
    <Screen screenId={T} state={state} title={tx(T, "فيزانو بلص")} onRefresh={() => void load()}>
      <AppText variant="section">{tx(T, "· الجلسات النشطة")}</AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "إبطال الجلسة يمنع الاستمرار لا الماضي")}
      </AppText>

      {state === "loading" ? <StateView state="loading" title={tx(T, "جلب الجلسات")} /> : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "جلب الجلسات")}>
          <AppText variant="secondary">{OPS.offlineNone}</AppText>
        </StateView>
      ) : null}
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "إنهاء جلسة جهاز آخر")}>
          <AppText variant="secondary">
            {tx(T, "الجهاز عهدةُ المنشأة لا ملكُ من دخل عليه.")}
          </AppText>
          <Button
            variant="secondary"
            label={tx(T, "الجلسات النشطة")}
            onPress={() => setDenied(false)}
          />
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "تعذّر إنهاء الجلسة")}>
          <AppText variant="secondary">
            {tx(T, "لا نُظهر الجلسة كمنتهية قبل تأكيد الخادم.")}
          </AppText>
          <Button label={tx(T, "الجلسات النشطة")} onPress={() => setFailed(false)} />
        </StateView>
      ) : null}
      {state === "success" && ended ? (
        <StateView state="success" title={tx(T, "أُنهيت الجلسة")}>
          <AppText variant="secondary">
            {ended.session_label}
            {ended.branch_name ? ` · ${ended.branch_name}` : ""}
          </AppText>
          <AppText variant="secondary">{tx(T, "الإنهاء لا يُلغى.")}</AppText>
          <Button
            variant="secondary"
            label={tx(T, "الجلسات النشطة")}
            onPress={() => setEnded(null)}
          />
        </StateView>
      ) : null}

      {rows && rows.length > 0 ? (
        <GroupedList title={tx(T, "الجلسات النشطة")}>
          {rows.map((r, i) => (
            <View key={r.session_id}>
              <Row
                title={r.session_label}
                detail={
                  <>
                    <WhenOf row={r} />
                    {"\n"}
                    {tx(T, "معلّق محلي")}: <N>{r.reported_pending ?? 0}</N>
                    {"\n"}
                    <EffectOf row={r} />
                  </>
                }
                last={i === rows.length - 1 && !(r.can_revoke && !r.revoked_at)}
              />
              {r.can_revoke && !r.revoked_at ? (
                <View
                  style={{
                    paddingHorizontal: SPACE["4"],
                    paddingBottom: SPACE["3"],
                  }}
                >
                  <Button
                    variant="secondary"
                    label={tx(T, "إنهاء الجلسة")}
                    loading={busy === r.session_id}
                    onPress={() => onRevokeClick(r)}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </GroupedList>
      ) : null}

      <View style={{ marginBottom: SPACE["4"], gap: SPACE["1"] }}>
        <AppText variant="bodyStrong" style={{ color: c.inkStrong }}>
          {tx(T, "لا نمحو عملية معلّقة عند الإبطال.")}
        </AppText>
        <AppText variant="secondary" muted>
          {tx(
            T,
            "الجهاز المُبطَلة جلسته يُمنع من بيع جديد، وتبقى عملياته المحفوظة محلياً في الطابور حتى ترفعها جلسة مصرَّحة.",
          )}
        </AppText>
      </View>
      <Button
        variant="secondary"
        label={mtx("pinSetTitle")}
        onPress={() => router.push("/set-pin")}
      />

      <Sheet
        open={target !== null}
        title={tx(T, "إنهاء جلسة على جهاز فيه معلّق")}
        onClose={() => setTarget(null)}
      >
        <View style={{ gap: SPACE["3"] }}>
          <AppText>
            {tx(T, "هذا الجهاز عليه")} <N>{target?.reported_pending ?? 0}</N>{" "}
            {tx(T, "عملية لم تُرفع")}
          </AppText>
          <AppText>{tx(T, "الإنهاء يقطع الرفع.")}</AppText>
          <Button
            variant="danger"
            label={tx(T, "إنهاء الجلسة")}
            loading={busy !== null}
            onPress={() => target && void revoke(target, false)}
          />
          <Button
            variant="secondary"
            label={tx(T, "أنهِ بعد رفع المعلّق")}
            onPress={() => target && void revoke(target, true)}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
