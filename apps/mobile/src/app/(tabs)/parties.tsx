import { formatMinorShort, hhmm } from "@sting/app-core";
import {
  type LocalParty,
  maskPhone,
  readLocalParties,
  readPartiesMatchedAt,
  readPendingCreditByParty,
  searchLocalParties,
  storeParties,
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
  useColors,
} from "@sting/ui-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { M, PRow, Segments, Stack } from "@/components/parties/parts";
import { type ListData, type PartyRow, toRow } from "@/features/parties/lib";
import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-01";
type State = "ready" | "loading" | "empty" | "offline" | "stale" | "permission_denied";
type Filter = "all" | "due" | "idle";
type SortKey = "due" | "last";
const IDLE_DAYS = 30;

/**
 * PTY-01 — قائمة العملاء (خطة الجوال M3). الأسماء من الجهاز فوراً والأرصدة تُوسم حتى تُطابَق؛ الرصيد
 * مركّب «خادمي + معلّق على جهازك» لا مجموع وحده؛ الترتيب بالمبلغ أو بتاريخ آخر حركة — لا «عمر دين»؛
 * الكاشير يرى من يبيع له (POS-04) لا القائمة كاملةً.
 */
export default function Customers() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [local, setLocal] = useState<readonly LocalParty[] | null>(null);
  const [pending, setPending] = useState<Map<string, { pendingMinor: bigint; count: number }>>(
    new Map(),
  );
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("due");
  const [q, setQ] = useState("");

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const storage = await getStorage();
        const [parties, pend, at] = await Promise.all([
          readLocalParties(storage),
          readPendingCreditByParty(storage),
          readPartiesMatchedAt(storage),
        ]);
        if (!alive) return;
        setLocal(parties);
        setPending(pend);
        setMatchedAt(at);
        try {
          const { data: res, response } = await api.GET("/api/parties/list", {
            params: { query: { kind: "customers" } },
          });
          if (!alive) return;
          const body = res as unknown as ListData | undefined;
          if (response.status === 403) {
            setDenied(true);
            return;
          }
          if (!response.ok || !body) {
            setFailed(true);
            return;
          }
          await storeParties(storage, body.rows, body.as_of);
          setData(body);
          setOffline(false);
          setFailed(false);
          setLocal(await readLocalParties(storage));
          setPending(await readPendingCreditByParty(storage));
          setMatchedAt(body.as_of);
        } catch {
          // بلا شبكة: الأسماء والأرصدة من آخر مطابقة ومعها المعلّق من هذا الجهاز
          if (alive) setOffline(true);
        }
      })();
      return () => {
        alive = false;
      };
    }, [api]),
  );

  const now = new Date();
  const active = (local ?? []).filter((p) => p.is_active !== false && p.is_customer !== false);
  const visible = q.trim() ? searchLocalParties(active, q) : active;
  const rowsAll: PartyRow[] = active.map((p) => toRow(p, pending.get(p.id)));
  const shownIds = new Set(visible.map((p) => p.id));
  const idleBefore = now.getTime() - IDLE_DAYS * 86_400_000;
  const rows = rowsAll
    .filter((r) => shownIds.has(r.id))
    .filter((r) =>
      filter === "due"
        ? (r.dueMinor ?? 0n) > 0n
        : filter === "idle"
          ? !r.lastAt || new Date(r.lastAt).getTime() < idleBefore
          : true,
    )
    .sort((a, b) => {
      if (sort === "last") return b.lastAt.localeCompare(a.lastAt);
      const da = a.dueMinor ?? 0n;
      const db = b.dueMinor ?? 0n;
      return da === db ? a.name.localeCompare(b.name, "ar") : da > db ? -1 : 1;
    });

  const state: State = denied
    ? "permission_denied"
    : local === null
      ? "loading"
      : offline
        ? "offline"
        : failed
          ? "stale"
          : data === null
            ? "loading"
            : rowsAll.length === 0
              ? "empty"
              : "ready";

  const totalDue = rowsAll.reduce(
    (acc, r) => acc + (r.dueMinor && r.dueMinor > 0n ? r.dueMinor : 0n),
    0n,
  );
  const pendingOps = rowsAll.reduce((acc, r) => acc + r.pendingCount, 0);
  const open = (r: PartyRow) =>
    router.push({ pathname: "/parties/[id]/statement", params: { id: r.id } });

  return (
    <Screen screenId={T} state={state} title={tx(T, "العملاء والذمم")}>
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الكاشير يرى من يبيع له")}>
          <AppText variant="secondary">
            {tx(T, "يرى الطرف ورصيده وقت البيع، ولا يرى القائمة كاملةً بأرصدتها.")}
          </AppText>
          <Button label={tx(T, "اختيار العميل")} onPress={() => router.push("/pos/customer")} />
        </StateView>
      ) : (
        <>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "الكاشير يرى رصيد العميل الذي يبيع له فقط، ولا يرى قائمة الذمم كاملة.")}
          </AppText>
          <TextField label={tx(T, "العملاء")} value={q} onChangeText={setQ} autoCorrect={false} />
          <Segments
            value={filter}
            onChange={setFilter}
            options={[
              ["all", tx(T, "كل العملاء")],
              ["due", tx(T, "عليهم رصيد")],
              ["idle", tx(T, "بلا حركة 30 يوماً")],
            ]}
          />
          <Segments
            value={sort}
            onChange={setSort}
            options={[
              ["due", tx(T, "عليه")],
              ["last", tx(T, "آخر حركة")],
            ]}
          />

          {state === "loading" ? (
            <StateView state="loading" title={tx(T, "جلب الأطراف")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "المحلي فوراً ثم تُطابَق الأرصدة. الأسماء لا تنتظر الخادم؛ الأرصدة تُوسم حتى تُطابَق.",
                )}
              </AppText>
            </StateView>
          ) : null}
          {state === "offline" ? (
            <StateView state="offline" title={tx(T, "أرصدة محلية")}>
              <AppText variant="secondary">
                {tx(T, "الأسماء كاملة والأرصدة من آخر مطابقة، ومعها ما لم يُرفع من هذا الجهاز.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "stale" ? (
            <StateView state="stale" title={tx(T, "أرصدة قديمة")}>
              <AppText variant="secondary">
                {tx(T, "المطابقة متعثّرة وقد سدّد طرفٌ في فرع آخر.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "empty" ? (
            <StateView state="empty" title={tx(T, "لا عملاء")}>
              <AppText variant="secondary">
                {tx(T, "لا عملاء مسجّلون بعد. العميل يُنشأ حين يُباع له آجلاً، أو من «عميل جديد».")}
              </AppText>
            </StateView>
          ) : null}

          <Stack>
            <Button label={tx(T, "عميل جديد")} onPress={() => router.push("/parties/new")} />
            <Button
              label={tx(T, "قائمة الموردين")}
              variant="quiet"
              onPress={() => router.push("/parties/suppliers")}
            />
          </Stack>

          {rows.length > 0 ? (
            <GroupedList title={tx(T, "العملاء")}>
              {rows.map((r, i) => {
                const over = r.dueMinor !== null && r.limitMinor > 0n && r.dueMinor > r.limitMinor;
                const d = r.lastAt ? dayLabel(r.lastAt, now) : null;
                return (
                  <PRow
                    key={r.id}
                    title={r.name}
                    sub={
                      <>
                        {r.bothRoles
                          ? tx(T, "عميل ومورد")
                          : r.aliases.length
                            ? r.aliases.join(" · ")
                            : null}
                        {r.phone ? (
                          <>
                            {r.bothRoles || r.aliases.length ? " · " : ""}
                            <M>{maskPhone(r.phone)}</M>
                          </>
                        ) : null}
                        {r.pendingMinor !== 0n ? (
                          <>
                            {"\n"}
                            {tx(T, "خادمي")}{" "}
                            <M>{formatMinorShort((r.serverMinor ?? 0n).toString())}</M>{" "}
                            {tx(T, "+ معلّق على جهازك")}{" "}
                            <M>{formatMinorShort(r.pendingMinor.toString())}</M>
                          </>
                        ) : null}
                        {d ? (
                          <>
                            {"\n"}
                            {tx(T, "آخر حركة")} {d.word ?? <M>{d.n}</M>} <M>{hhmm(r.lastAt)}</M>
                          </>
                        ) : null}
                      </>
                    }
                    trailing={
                      <View style={{ alignItems: "flex-end" }}>
                        <AppText variant="bodyStrong">
                          <M strong>
                            {r.dueMinor === null ? "—" : formatMinorShort(r.dueMinor.toString())}
                          </M>
                        </AppText>
                        {r.limitMinor > 0n ? (
                          <AppText
                            variant="note"
                            style={{ color: over ? c.state.stale.fg : c.inkMuted }}
                          >
                            {over ? `${tx(T, "تجاوز الحد")} · ` : `${tx(T, "حد الائتمان")} `}
                            <M>{formatMinorShort(r.limitMinor.toString())}</M>
                          </AppText>
                        ) : null}
                      </View>
                    }
                    onPress={() => open(r)}
                    last={i === rows.length - 1}
                  />
                );
              })}
            </GroupedList>
          ) : null}

          <AppText variant="secondary" style={{ marginBottom: SPACE["1"] }}>
            <M>{rowsAll.length}</M> {tx(T, "عملاء · مجموع ما على العملاء")}{" "}
            <M>{formatMinorShort(totalDue.toString())}</M>
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "آخر تحديث خادمي")} <M>{matchedAt ? hhmm(matchedAt) : "—"}</M>
            {pendingOps > 0 ? (
              <>
                {" "}
                {tx(T, "— يشمل")}{" "}
                {pendingOps === 1 ? (
                  tx(T, "عملية واحدة معلقة")
                ) : pendingOps === 2 ? (
                  tx(T, "عمليتين معلقتين")
                ) : (
                  <>
                    <M>{pendingOps}</M> {tx(T, "عمليات معلقة")}
                  </>
                )}{" "}
                {tx(T, "من هذا الجهاز")}
              </>
            ) : null}
          </AppText>
          <AppText variant="note" muted style={{ marginTop: SPACE["2"] }}>
            {tx(T, "حد الائتمان اختياري · تنبيه لا منع")}
          </AppText>
        </>
      )}
    </Screen>
  );
}
