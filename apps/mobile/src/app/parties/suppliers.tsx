import { formatMinorShort } from "@sting/app-core";
import { type LocalParty, maskPhone, readLocalParties, storeParties } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { M, PRow, Stack } from "@/components/parties/parts";
import type { ListData } from "@/features/parties/lib";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-02";
type State = "ready" | "loading" | "empty" | "permission_denied";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly owedMinor: string;
  readonly linked: boolean;
}

/**
 * PTY-02 — قائمة الموردين (خطة الجوال M3). سجلات داخلية خاصة بك — المورد لا يصبح صفحة في السوق
 * تلقائياً؛ المستحقّ عليك لهم لمن يرى المال، وأمين المخزن يرى الأسماء ليستلم منهم.
 */
export default function Suppliers() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [local, setLocal] = useState<readonly LocalParty[] | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const storage = await getStorage();
        const parties = await readLocalParties(storage);
        if (!alive) return;
        setLocal(parties);
        try {
          const { data: res, response } = await api.GET("/api/parties/list", {
            params: { query: { kind: "suppliers" } },
          });
          const body = res as unknown as ListData | undefined;
          if (!alive) return;
          if (!response.ok || !body) {
            setFailed(true);
            return;
          }
          await storeParties(storage, body.rows, body.as_of);
          setData(body);
          setFailed(false);
          setLocal(await readLocalParties(storage));
        } catch {
          if (alive) setFailed(true);
        }
      })();
      return () => {
        alive = false;
      };
    }, [api]),
  );

  const canSee = data?.can_see_balances ?? false;
  const rows: Row[] = (local ?? [])
    .filter((p) => p.is_active !== false && p.is_supplier)
    .map((p) => {
      const sp = p as LocalParty & { supplier_owed_minor?: string; market_linked?: boolean };
      return {
        id: p.id,
        name: p.name,
        phone: p.phone,
        owedMinor: sp.supplier_owed_minor ?? "",
        linked: Boolean(sp.market_linked),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  const state: State =
    local === null || (data === null && !failed)
      ? "loading"
      : data && !data.can_see_balances
        ? "permission_denied"
        : rows.length === 0
          ? "empty"
          : "ready";

  const open = (r: Row) =>
    router.push({
      pathname: "/parties/[id]/statement",
      params: { id: r.id, side: "supplier" },
    });

  return (
    <Screen screenId={T} state={state} title={tx(T, "العملاء والذمم")}>
      <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "الموردون")}
      </AppText>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "سجلات داخلية خاصة بك. المورد هنا لا يصبح صفحة في السوق تلقائياً.")}
      </AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "هذه سجلات موردين داخلية في دفترك. نشر أي منها كمنشأة في السوق يحتاج موافقة صريحة وتحققاً منفصلاً في «تهيئة البائع».",
        )}
      </AppText>
      <Stack>
        <Button
          label={tx(T, "قائمة العملاء")}
          variant="quiet"
          onPress={() => router.push("/parties")}
        />
      </Stack>

      {state === "loading" ? <StateView state="loading" title={tx(T, "جلب الموردين")} /> : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا موردين")}>
          <AppText variant="secondary">{tx(T, "الشراء نقدي بلا حساب مفتوح.")}</AppText>
          <AppText variant="note">
            {tx(T, "المسار")}{" "}
            {tx(T, "· يُنشأ المورد عند أول استلام بضاعة أو أمر شراء. لا نطلب تسجيلاً مسبقاً.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "أمين المخزن يرى الأسماء")}>
          <AppText variant="secondary">
            {tx(T, "يرى الموردين ليستلم منهم، ولا يرى ما لهم على المنشأة.")}
          </AppText>
        </StateView>
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "الموردون")}>
          {rows.map((r, i) => (
            <PRow
              key={r.id}
              title={r.name}
              sub={
                <>
                  {r.phone ? <M>{maskPhone(r.phone)}</M> : null}
                  {r.phone ? " · " : ""}
                  <AppText
                    variant="note"
                    style={{ color: r.linked ? c.state.synced.fg : c.inkMuted }}
                  >
                    {r.linked ? tx(T, "مرتبط بمنشأة سوق") : tx(T, "سجل داخلي فقط")}
                  </AppText>
                </>
              }
              trailing={
                <View style={{ alignItems: "flex-end" }}>
                  <AppText variant="note" muted>
                    {tx(T, "له علينا")}
                  </AppText>
                  <M>{canSee && r.owedMinor ? formatMinorShort(r.owedMinor) : "—"}</M>
                </View>
              }
              onPress={() => open(r)}
              last={i === rows.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}
    </Screen>
  );
}
