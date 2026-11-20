import { formatMinorShort, hhmm } from "@sting/app-core";
import { type LocalReceipt, readLocalParties, readPendingSupplierPayments } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView } from "@sting/ui-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { M, PRow, Segments, Stack } from "@/components/parties/parts";
import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-05";
type State =
  "ready" | "loading" | "empty" | "stale" | "pending_sync" | "offline" | "permission_denied";
type Range = "30" | "all";

interface ServerRow {
  readonly doc: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
}

interface SupplierStatement {
  readonly party: { readonly name: string };
  readonly rows: readonly ServerRow[];
  readonly owed_minor: string;
  readonly last_payment_at: string;
}

const cacheKey = (id: string) => `parties.supplier-statement.${id}`;

function Day({ iso, now }: { iso: string; now: Date }): ReactNode {
  const d = dayLabel(iso, now);
  return d.word ?? <M>{d.n}</M>;
}

/**
 * «كشف حساب المورد» (مراجعة الأطراف 2026-11-20، المرحلة ٣؛ 0005 §٢٨٤): «له علينا» الجاري — الافتتاحي
 * ومستندات الشراء المعتمدة ترفعه، والمرتجعات وسندات الصرف تخفّضه؛ سندات الصرف المحلية غير المغطّاة
 * تُلحق موسومة «معلّق — هذا الجهاز».
 */
export default function SupplierStatementScreen() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const { id: partyId } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [name, setName] = useState("");
  const [data, setData] = useState<SupplierStatement | null>(null);
  const [cached, setCached] = useState<SupplierStatement | null>(null);
  const [pending, setPending] = useState<LocalReceipt[]>([]);
  const [range, setRange] = useState<Range>("30");
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const now = new Date();

  const loadLocal = useCallback(async () => {
    const storage = await getStorage();
    const [parties, pend, raw] = await Promise.all([
      readLocalParties(storage),
      readPendingSupplierPayments(storage, partyId),
      storage.read((t) => t.getMeta(cacheKey(partyId))),
    ]);
    const local = parties.find((p) => p.id === partyId);
    if (local && !local.is_supplier) {
      routerRef.current.replace({ pathname: "/parties/[id]", params: { id: partyId } });
      return;
    }
    if (local) setName(local.name);
    setPending(pend.rows);
    if (raw) setCached(JSON.parse(raw) as SupplierStatement);
  }, [partyId]);

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
    }, [loadLocal]),
  );

  useEffect(() => {
    let live = true;
    setFailed(false);
    void (async () => {
      try {
        const { data: res, response } = await api.GET("/api/parties/{party_id}/statement", {
          params: { path: { party_id: partyId }, query: { range, side: "supplier" } },
        });
        if (!live) return;
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        const body = res as unknown as SupplierStatement | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        setOffline(false);
        setName(body.party.name);
        const storage = await getStorage();
        await storage.transaction((t) => t.putMeta(cacheKey(partyId), JSON.stringify(body)));
      } catch {
        if (live) setOffline(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, partyId, range]);

  const server = data ?? cached;
  const serverIds = new Set((server?.rows ?? []).map((r) => r.doc_id));
  const pendingRows = pending.filter((r) => !serverIds.has(r.id));
  const serverOwed = server ? BigInt(server.owed_minor) : null;
  const owed =
    serverOwed === null
      ? null
      : pendingRows.reduce((acc, r) => acc - BigInt(r.amount_minor), serverOwed);

  const state: State = denied
    ? "permission_denied"
    : offline
      ? "offline"
      : failed && server
        ? "stale"
        : !server
          ? "loading"
          : pendingRows.length > 0
            ? "pending_sync"
            : server.rows.length === 0
              ? "empty"
              : "ready";

  return (
    <Screen screenId={T} state={state} title={`${tx(T, "كشف حساب المورد —")} ${name || "—"}`}>
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "كشف المورد لمن يرى المال")}>
          <AppText variant="secondary">
            {tx(
              T,
              "ما للمورد على المنشأة صورة مالية: للمالك والمدير. أمين المخزن يرى اسمه ليستلم منه.",
            )}
          </AppText>
        </StateView>
      ) : (
        <>
          <GroupedList>
            <PRow
              title={tx(T, "له علينا الآن")}
              sub={
                server?.last_payment_at ? (
                  <>
                    {tx(T, "آخر دفع")} <Day iso={server.last_payment_at} now={now} />
                  </>
                ) : (
                  tx(T, "لا يوجد دفع مسجَّل")
                )
              }
              trailing={<M strong>{owed === null ? "—" : formatMinorShort(owed.toString())}</M>}
              last
            />
          </GroupedList>
          <Segments
            value={range}
            onChange={setRange}
            options={[
              ["30", tx(T, "آخر 30 يوماً")],
              ["all", tx(T, "كل الحركات")],
            ]}
          />
          <Stack>
            <Button
              label={tx(T, "دفع لمورد")}
              onPress={() =>
                router.push({ pathname: "/parties/[id]/pay", params: { id: partyId } })
              }
            />
          </Stack>
          {state === "loading" ? (
            <StateView state="loading" title={tx(T, "جارٍ الحساب")}>
              <AppText variant="secondary">
                {tx(T, "الكشف يُحسب من كل الحركات ولا يُقرأ جاهزاً.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "empty" ? (
            <StateView state="empty" title={tx(T, "لا حركات مع هذا المورد")}>
              <AppText variant="secondary">
                {tx(T, "الذمّة تنشأ من مستند شراء معتمد أو رصيد افتتاحي، وتنقص بسند صرف أو مرتجع.")}
              </AppText>
            </StateView>
          ) : null}
          {(server?.rows.length ?? 0) + pendingRows.length > 0 ? (
            <GroupedList title={tx(T, "كشف حساب المورد")}>
              {(server?.rows ?? []).map((r) => (
                <PRow
                  key={r.doc_id}
                  title={r.label}
                  sub={
                    <>
                      <M>{r.doc}</M> · <Day iso={r.occurred_at} now={now} />{" "}
                      <M>{hhmm(r.occurred_at)}</M>
                    </>
                  }
                  trailing={
                    <M>
                      {r.credit_minor
                        ? `+${formatMinorShort(r.credit_minor)}`
                        : r.debit_minor
                          ? `-${formatMinorShort(r.debit_minor)}`
                          : "—"}
                    </M>
                  }
                />
              ))}
              {pendingRows.map((r, i) => (
                <PRow
                  key={r.id}
                  title={`${r.method === "cash" ? tx(T, "دفع نقدي") : tx(T, "دفع بتحويل بنكي")} · ${tx(T, "معلّق — هذا الجهاز")}`}
                  sub={<M>{r.receipt_number}</M>}
                  trailing={<M>{`-${formatMinorShort(r.amount_minor)}`}</M>}
                  last={i === pendingRows.length - 1}
                />
              ))}
            </GroupedList>
          ) : null}
        </>
      )}
    </Screen>
  );
}
