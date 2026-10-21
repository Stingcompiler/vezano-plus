import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, ListRow, Screen, SPACE, StateView } from "@sting/ui-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";

import { FONT } from "@sting/ui-native";
import { useSession } from "@/lib/session";

const T = "ACC-06";
type State = "ready" | "expired" | "permission_denied" | "success" | "server_error";

interface Invite {
  readonly status: "valid" | "expired" | "accepted" | "not_for_you" | "not_found";
  readonly tenant_name: string;
  readonly inviter_name: string;
  readonly role_name: string;
  readonly branch_name: string;
  readonly expires_at: string;
}

/**
 * ACC-06 — قبول دعوة (خطة الجوال M1؛ 0005 §١٩٢). تُفتح من رابط عميق `vezanoplus://invite/<token>` لا من
 * المتصفح. منطق الويب نفسه: القبول يمنح عضوية داخل هذه المنشأة فقط، ولا نُفشي لمن كانت الدعوة، والقبول
 * لا يُستهلك بالفشل. بلا جلسة: الدخول أولاً ثم العودة إلى الدعوة.
 */
export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { state: session, api, signOut } = useSession();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const headers = useCallback(
    () => (session.selection ? { "X-Select-Ticket": session.selection.ticket } : {}),
    [session.selection],
  );
  const signedIn = Boolean(session.tokens || session.selection);

  useEffect(() => {
    if (!signedIn || !token) return;
    let cancelled = false;
    void api
      .GET("/api/invites/{token}", { headers: headers(), params: { path: { token } } })
      .then(({ data }) => {
        if (!cancelled && data) setInvite(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, headers, signedIn, token]);

  if (!signedIn) return <Redirect href="/login" />;

  const accept = async () => {
    if (busy || !token) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api.POST("/api/invites/{token}/accept", {
        headers: headers(),
        params: { path: { token } },
      });
      if (response.ok && data) return setInvite(data);
      if (response.status === 403 || response.status === 410) {
        if (data) setInvite(data);
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = failed
    ? "server_error"
    : invite?.status === "accepted"
      ? "success"
      : invite?.status === "not_for_you" || invite?.status === "not_found"
        ? "permission_denied"
        : invite?.status === "expired"
          ? "expired"
          : "ready";
  const hoursLeft = invite?.expires_at
    ? Math.max(0, Math.floor((new Date(invite.expires_at).getTime() - Date.now()) / 3_600_000))
    : 0;

  if (state === "permission_denied")
    return (
      <Screen screenId={T} state={state} title={tx(T, "الدعوة ليست لك")}>
        <StateView state="permission_denied" title={tx(T, "الدعوة ليست لك")}>
          <AppText variant="secondary">{tx(T, "هذه الدعوة لحسابٍ آخر")}</AppText>
        </StateView>
        <Button
          label={tx(T, "بدّل الحساب")}
          onPress={() => {
            signOut();
            router.replace("/login");
          }}
        />
      </Screen>
    );

  if (state === "success" && invite)
    return (
      <Screen screenId={T} state={state} title={tx(T, "قُبلت الدعوة")}>
        <StateView state="success" title={tx(T, "قُبلت الدعوة")}>
          <AppText variant="secondary">
            {tx(T, "أنت الآن")} {invite.role_name} {tx(T, "في")} {invite.branch_name}
          </AppText>
        </StateView>
        <GroupedList>
          <ListRow
            title={tx(T, "الدور الممنوح")}
            trailing={<AppText>{invite.role_name}</AppText>}
          />
          <ListRow
            title={tx(T, "النطاق")}
            trailing={
              <AppText>
                {invite.branch_name} {tx(T, "فقط")}
              </AppText>
            }
            last
          />
        </GroupedList>
        <Button label={tx(T, "دخول")} financial onPress={() => router.replace("/select-org")} />
      </Screen>
    );

  return (
    <Screen
      screenId={T}
      state={state}
      title={invite ? `${tx(T, "دعوة من «")}${invite.tenant_name}»` : tx(T, "فيزانو بلص")}
    >
      {invite ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
            {tx(T, "دعاك")} {invite.inviter_name} {tx(T, "للانضمام بدور")}{" "}
            <Text style={{ fontFamily: FONT.bold }}>{invite.role_name}</Text> {tx(T, "على")}{" "}
            {invite.branch_name}.
          </AppText>
          <GroupedList>
            <ListRow
              title={tx(T, "الدور الممنوح")}
              trailing={<AppText>{invite.role_name}</AppText>}
            />
            <ListRow
              title={tx(T, "النطاق")}
              trailing={
                <AppText>
                  {invite.branch_name} {tx(T, "فقط")}
                </AppText>
              }
            />
            <ListRow
              title={tx(T, "صلاحية الرابط")}
              trailing={
                state === "expired" ? (
                  <AppText>{tx(T, "رابط منتهٍ")}</AppText>
                ) : (
                  <AppText>
                    {tx(T, "تنتهي بعد")}{" "}
                    <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
                      {hoursLeft}
                    </Text>{" "}
                    {tx(T, "ساعة")}
                  </AppText>
                )
              }
              last
            />
          </GroupedList>
        </>
      ) : null}
      {state === "expired" ? (
        <StateView state="expired" title={tx(T, "رابط منتهٍ")}>
          <AppText variant="secondary">
            {tx(T, "انتهت صلاحية الدعوة — اطلب دعوة جديدة من مالك المنشأة")}
          </AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "خطأ أثناء القبول")}>
          <AppText variant="secondary">
            {tx(T, "الدعوة تبقى صالحة حتى يُسجَّل القبول فعلاً. إعادة المحاولة آمنة")}
          </AppText>
        </StateView>
      ) : null}
      {invite && state !== "expired" ? (
        <Button
          label={state === "server_error" ? tx(T, "أعد المحاولة") : tx(T, "قبول الدعوة")}
          financial
          loading={busy}
          onPress={() => void accept()}
        />
      ) : null}
    </Screen>
  );
}
