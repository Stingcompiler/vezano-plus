import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, ListRow, Screen, SPACE, StateView } from "@sting/ui-native";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { type Membership, useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";

const T = "ACC-03";

/**
 * ACC-03 — اختيار المنشأة (خطة الجوال M1): قائمة مجمّعة بالمنشآت من تذكرة الدخول، تُحدَّث من الخادم.
 * منشأة واحدة نشطة = تُفتح آلياً كالويب. الموقوفة تقول سبب الوقف ولا تُفتح. بلا منشأة: إنشاؤها أو
 * الدعوة على الويب حتى تُبنى ACC-04/ACC-06 هنا.
 */
export default function SelectOrg() {
  const router = useRouter();
  const { state, api, signIn } = useSession();
  const ticket = state.selection?.ticket ?? "";
  const [rows, setRows] = useState<readonly Membership[]>(state.selection?.memberships ?? []);
  const [busy, setBusy] = useState("");
  const [denied, setDenied] = useState<Membership | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    api
      .GET("/api/account/memberships", { headers: { "X-Select-Ticket": ticket } })
      .then(({ data }) => {
        const list = (data as { memberships?: Membership[] } | undefined)?.memberships;
        if (!cancelled && list) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ticket]);

  const choose = async (m: Membership) => {
    if (busy) return;
    if (m.status === "suspended") {
      setDenied(m);
      return;
    }
    setBusy(m.tenant_id);
    try {
      const { data, response } = await api.POST("/api/account/select", {
        headers: { "X-Select-Ticket": ticket },
        body: { tenant_id: m.tenant_id },
      });
      if (response.status === 403) {
        setDenied(m);
        return;
      }
      if (data) {
        signIn(data);
        router.replace("/");
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy("");
    }
  };

  // منشأة واحدة نشطة: تخطٍّ آلي كالويب
  const active = rows.filter((r) => r.status === "active");
  useEffect(() => {
    if (rows.length === 1 && active.length === 1 && active[0] && !busy) void choose(active[0]);
    // مرة عند اكتمال القائمة (طولها) — لا عند كل تغيّر في `busy`
  }, [rows.length]);

  if (state.status === "active") return <Redirect href="/" />;
  if (state.status === "anonymous") return <Redirect href="/welcome" />;

  const screenState = offline
    ? "offline"
    : denied
      ? "permission_denied"
      : rows.length
        ? "ready"
        : "empty";
  return (
    <Screen screenId={T} state={screenState} title={tx(T, "اختر المنشأة والفرع")}>
      {offline ? (
        <StateView state="offline" title={tx(T, "بلا اتصال")}>
          <AppText variant="secondary">{tx(T, "تحتاج اتصالاً أول مرة")}</AppText>
        </StateView>
      ) : null}
      {denied ? (
        <StateView state="permission_denied" title={denied.tenant_name}>
          <AppText variant="secondary">
            {tx(T, "دخولك موقوف بقرار المالك. اتصل به لرفع الوقف — بياناتك وأثرك محفوظان.")}
          </AppText>
        </StateView>
      ) : null}
      {rows.length ? (
        <GroupedList>
          {rows.map((m, i) => (
            <ListRow
              key={m.tenant_id}
              title={m.tenant_name}
              subtitle={`${m.role_name} · ${m.scope || tx(T, "كل الفروع")}`}
              trailing={
                m.status === "suspended" ? (
                  <AppText variant="note" muted>
                    {tx(T, "موقوف")}
                  </AppText>
                ) : undefined
              }
              onPress={() => void choose(m)}
              last={i === rows.length - 1}
            />
          ))}
        </GroupedList>
      ) : (
        <StateView state="empty" title={tx(T, "لا منشأة بعد")}>
          <View style={{ gap: SPACE["2"] }}>
            <Button label={tx(T, "أنشئ منشأتك")} onPress={() => void openOnWeb("/create-org")} />
            <Button
              label={tx(T, "عندي دعوة")}
              variant="secondary"
              onPress={() => void openOnWeb("/select-org")}
            />
          </View>
        </StateView>
      )}
    </Screen>
  );
}
