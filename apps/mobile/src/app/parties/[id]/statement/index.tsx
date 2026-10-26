import { formatMinorShort, hhmm } from "@sting/app-core";
import {
  type LocalReceipt,
  type LocalSale,
  maskPhone,
  PARTY_PREFIX,
  readLocalParties,
  readReceipts,
  readSales,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  ALIGN_LEFT,
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { M, PRow, Segments, Stack } from "@/components/parties/parts";
import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-05";
type State =
  "ready" | "loading" | "empty" | "offline" | "stale" | "pending_sync" | "permission_denied";
type Range = "30" | "all";

interface ServerRow {
  readonly doc: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly business_date: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
  readonly branch_id: string;
  readonly info: boolean;
  /** الطرف الأصلي بعد الدمج — يُوسم بمصدره (ACC-78) */
  readonly source_party?: string;
}

interface Statement {
  readonly party: {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly balance_as_of?: string;
    readonly updated_at: string;
  };
  readonly rows: readonly ServerRow[];
  readonly balance_minor: string;
  readonly hidden_other_branch: number;
  readonly last_payment_at: string;
  readonly oldest_unpaid_at: string;
  readonly as_of: string;
  readonly scope: "all" | "branch";
  readonly branch_names: Record<string, string>;
  readonly range: Range;
}

/** صف الكشف على الشاشة: خادمي (مؤكد) أو محلي معلّق من هذا الجهاز داخل في الرصيد. */
interface Row {
  readonly id: string;
  readonly doc: string;
  readonly at: string;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly branch: string;
  readonly tag: "confirmed" | "pending" | "opening";
  readonly info: boolean;
  readonly kind: string;
  readonly source: string;
}

const cacheKey = (id: string) => `parties.statement.${id}`;

const MONTHS = [
  tx(T, "يناير"),
  tx(T, "فبراير"),
  tx(T, "مارس"),
  tx(T, "أبريل"),
  tx(T, "مايو"),
  tx(T, "يونيو"),
  tx(T, "يوليو"),
  tx(T, "أغسطس"),
  tx(T, "سبتمبر"),
  tx(T, "أكتوبر"),
  tx(T, "نوفمبر"),
  tx(T, "ديسمبر"),
];

function fullDate(iso: string): { day: string; month: string; year: string } {
  const d = new Date(iso);
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: MONTHS[d.getMonth()] ?? "",
    year: String(d.getFullYear()),
  };
}

/** «منذ N يوماً» بأرقام لاتينية داخل mono والكلمة خارجه — بالأيام التقويمية لا بالساعات. */
function Since({ iso, now }: { iso: string; now: Date }): ReactNode {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000));
  if (days === 0) return tx(T, "اليوم");
  if (days === 1) return tx(T, "منذ يوم");
  if (days === 2) return tx(T, "منذ يومين");
  return (
    <>
      {tx(T, "منذ")} <M>{days}</M> {days <= 10 ? tx(T, "أيام") : tx(T, "يوماً")}
    </>
  );
}

function Day({ iso, now }: { iso: string; now: Date }): ReactNode {
  const d = dayLabel(iso, now);
  return d.word ?? <M>{d.n}</M>;
}

/**
 * PTY-05 — كشف الحساب (خطة الجوال M3): قائمة سطور زمنية برصيد جارٍ، والمعلّق من الجهاز موسوم في آخرها؛
 * المدى بأزرار مقطعية. البيع الآجل والسندات المحلية غير المغطّاة تظهر «معلّق — هذا الجهاز» وهي داخلة في
 * الرصيد (ACC-02/03)؛ التركيب معلَن «خادمي X + معلّق Y»؛ فواتير فرع آخر تدخل الرصيد دون تفاصيلها؛
 * لا أعمار ديون؛ لا رصيد جزئي قبل وصول الخادمي.
 */
export default function StatementScreen() {
  const router = useRouter();
  const c = useColors();
  const { id: partyId } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [range, setRange] = useState<Range>("30");
  const [party, setParty] = useState<{ name: string; phone: string; since: string } | null>(null);
  const [localPending, setLocalPending] = useState<readonly LocalSale[]>([]);
  const [localReceipts, setLocalReceipts] = useState<readonly LocalReceipt[]>([]);
  const [data, setData] = useState<Statement | null>(null);
  const [cached, setCached] = useState<Statement | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [denied, setDenied] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const now = new Date();

  const loadLocal = useCallback(async () => {
    const storage = await getStorage();
    const [parties, sales, receipts, raw] = await Promise.all([
      readLocalParties(storage),
      readSales(storage),
      readReceipts(storage),
      storage.read((t) => t.getMeta(cacheKey(partyId))),
    ]);
    const local = parties.find((p) => p.id === partyId);
    if (local) setParty({ name: local.name, phone: local.phone, since: local.updated_at || "" });
    const asOf =
      (
        (await storage.read((t) => t.getProjection(PARTY_PREFIX + partyId)))?.value as
          { balance_as_of?: string } | undefined
      )?.balance_as_of ?? "";
    // المعلّق من هذا الجهاز: آجل لم يؤكَّد أو وقع بعد تغطية الرصيد الخادمي
    const pend: LocalSale[] = [];
    for (const s of sales) {
      if (s.party_id !== partyId || BigInt(s.credit_minor) <= 0n) continue;
      const op = await storage.read((t) => t.getOperation(s.operation_id));
      const covered = op?.state === "synced" && (!asOf || s.occurred_at <= asOf);
      if (!covered) pend.push(s);
    }
    setLocalPending(pend);
    // السندات المحلية غير المغطّاة (سداد نقدي يخفّض؛ تحويل مسجَّل بلا أثر؛ ردّ يرفع) — PTY-06
    const pendRec: LocalReceipt[] = [];
    for (const r of receipts) {
      if (r.party_id !== partyId) continue;
      const op = await storage.read((t) => t.getOperation(r.operation_id));
      const covered = op?.state === "synced" && (!asOf || r.occurred_at <= asOf);
      if (!covered) pendRec.push(r);
    }
    setLocalReceipts(pendRec);
    if (raw) setCached(JSON.parse(raw) as Statement);
    setLocalReady(true);
  }, [partyId]);

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
    }, [loadLocal]),
  );

  useEffect(() => {
    let live = true;
    setFetching(true);
    setFailed(false);
    void (async () => {
      try {
        const { data: res, response } = await api.GET("/api/parties/{party_id}/statement", {
          params: { path: { party_id: partyId }, query: { range } },
        });
        if (!live) return;
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        const body = res as unknown as Statement | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        setOffline(false);
        setParty({ name: body.party.name, phone: body.party.phone, since: body.party.updated_at });
        const storage = await getStorage();
        await storage.transaction((t) => t.putMeta(cacheKey(partyId), JSON.stringify(body)));
      } catch {
        if (live) setOffline(true);
      } finally {
        if (live) setFetching(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, partyId, range]);

  const server = data ?? cached;
  const serverIds = new Set((server?.rows ?? []).map((r) => r.doc_id));
  const serverBalance = server ? BigInt(server.balance_minor) : null;
  const pendingRows = localPending.filter((s) => !serverIds.has(s.id));
  const pendingReceipts = localReceipts.filter((r) => !serverIds.has(r.id));
  const receiptEffect = (r: LocalReceipt) =>
    r.method === "bank"
      ? 0n
      : r.kind === "receipt"
        ? -BigInt(r.amount_minor)
        : BigInt(r.amount_minor);
  const pendingMinor =
    pendingRows.reduce((a, s) => a + BigInt(s.credit_minor), 0n) +
    pendingReceipts.reduce((a, r) => a + receiptEffect(r), 0n);
  // «لا رصيد جزئي»: الرصيد لا يُعرض قبل وصول الخادمي
  const balance = serverBalance === null ? null : serverBalance + pendingMinor;
  const pendingCount = pendingRows.length + pendingReceipts.length;

  let running = serverBalance ?? 0n;
  const rows: Row[] = [
    ...(server?.rows ?? []).map((r): Row => ({
      id: r.doc_id,
      doc: r.doc,
      at: r.occurred_at,
      label: r.label,
      debit: r.debit_minor,
      credit: r.credit_minor,
      balance: r.balance_minor,
      branch: r.branch_id ? (server?.branch_names[r.branch_id] ?? "") : "",
      tag: r.kind === "opening" ? ("opening" as const) : ("confirmed" as const),
      info: r.info,
      kind: r.kind,
      source: r.source_party ?? "",
    })),
    ...pendingRows.map((s): Row => {
      running += BigInt(s.credit_minor);
      const pure = BigInt(s.cash_minor) === 0n && BigInt(s.bank_minor) === 0n;
      return {
        id: s.id,
        doc: s.invoice_number,
        at: s.occurred_at,
        label: pure ? tx(T, "بيع آجل") : tx(T, "بيع مختلط — الجزء الآجل"),
        debit: s.credit_minor,
        credit: "",
        balance: serverBalance === null ? "" : running.toString(),
        branch: "",
        tag: "pending",
        info: false,
        kind: "sale",
        source: "",
      };
    }),
    ...pendingReceipts.map((r): Row => {
      running += receiptEffect(r);
      const cash = r.method === "cash";
      return {
        id: r.id,
        doc: r.receipt_number,
        at: r.occurred_at,
        label:
          r.kind === "receipt"
            ? cash
              ? tx(T, "سداد نقدي")
              : tx(T, "سداد بتحويل بنكي — مسجَّل غير مطابق")
            : tx(T, "ردّ مبلغ"),
        debit: r.kind === "refund" && cash ? r.amount_minor : "",
        credit: r.kind === "receipt" && cash ? r.amount_minor : "",
        balance: serverBalance === null ? "" : running.toString(),
        branch: "",
        tag: "pending",
        info: !cash,
        kind: r.kind,
        source: "",
      };
    }),
  ].sort((a, b) =>
    (a.tag === "pending") === (b.tag === "pending") ? 0 : a.tag === "pending" ? 1 : -1,
  );

  const state: State = denied
    ? "permission_denied"
    : offline
      ? "offline"
      : failed && server
        ? "stale"
        : (fetching && data === null) || (!server && !failed) || !localReady
          ? "loading"
          : server && server.hidden_other_branch > 0
            ? "permission_denied"
            : pendingCount > 0
              ? "pending_sync"
              : rows.length === 0
                ? "empty"
                : "ready";

  const isReceipt = (r: Row) =>
    ["payment", "payment_pending", "refund", "receipt"].includes(r.kind);
  const canCorrect = (r: Row) => isReceipt(r) && r.tag === "confirmed" && server?.scope === "all";

  const openDoc = (r: Row) => {
    if (r.tag === "opening" || r.kind === "correction") return;
    // سند القبض: تصحيحه مستند مستقل (PTY-09) — للمالك (نطاق «كل الفروع»)
    if (isReceipt(r)) {
      if (canCorrect(r))
        router.push({
          pathname: "/parties/receipts/[receiptId]/correct",
          params: { receiptId: r.id },
        });
      return;
    }
    if (!r.info) router.push({ pathname: "/pos/invoices/[id]", params: { id: r.id } });
  };

  const tagColor = (t: Row["tag"]) =>
    t === "pending"
      ? c.state.pending_sync.fg
      : t === "opening"
        ? c.state.empty.fg
        : c.state.synced.fg;
  const tagLabel = (t: Row["tag"]) =>
    t === "pending"
      ? tx(T, "معلّق — هذا الجهاز")
      : t === "opening"
        ? tx(T, "رصيد افتتاحي")
        : tx(T, "مؤكد");

  const since = party?.since ? fullDate(party.since) : null;

  return (
    <Screen
      screenId={T}
      state={state}
      title={party ? `${tx(T, "كشف حساب")} — ${party.name}` : tx(T, "كشف حساب")}
    >
      {party?.phone ? (
        <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
          <M>{maskPhone(party.phone)}</M>
          {since ? (
            <>
              {" "}
              {tx(T, "· عميل منذ")} {since.month} <M>{since.year}</M>
            </>
          ) : null}
        </AppText>
      ) : null}

      <View style={{ marginBottom: SPACE["4"], gap: SPACE["1"] }}>
        <AppText variant="secondary" muted>
          {tx(T, "الرصيد الحالي — عليه")}
        </AppText>
        <AppText variant="largeTitle" style={{ writingDirection: "ltr", textAlign: ALIGN_LEFT }}>
          <M strong>{balance === null ? "—" : formatMinorShort(balance.toString())}</M>
        </AppText>
        <AppText variant="note" muted>
          {tx(T, "آخر تحديث خادمي")} <M>{server ? hhmm(server.as_of) : "—"}</M>
          {pendingCount ? <> {tx(T, "+ معلّق هذا الجهاز")}</> : null}
        </AppText>
        {pendingRows.length && serverBalance !== null ? (
          <AppText variant="note" muted>
            {tx(T, "خادمي")} <M>{formatMinorShort(serverBalance.toString())}</M> {tx(T, "+ معلّق")}{" "}
            <M>{formatMinorShort(pendingMinor.toString())}</M> ={" "}
            <M>{formatMinorShort((balance ?? 0n).toString())}</M>
          </AppText>
        ) : null}
        <AppText variant="note" muted>
          {server?.last_payment_at ? (
            <>
              {tx(T, "آخر سداد")} <Day iso={server.last_payment_at} now={now} /> ·{" "}
              <Since iso={server.last_payment_at} now={now} />
            </>
          ) : (
            tx(T, "لا يوجد سداد مسجل")
          )}
          {server?.oldest_unpaid_at ? (
            <>
              {" "}
              {tx(T, "· أقدم حركة غير مسدَّدة")} <Day iso={server.oldest_unpaid_at} now={now} />
            </>
          ) : null}
        </AppText>
      </View>

      <AppText variant="section" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(T, "المدى")}
      </AppText>
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
          label={tx(T, "تسجيل سداد")}
          financial
          onPress={() =>
            router.push({ pathname: "/parties/[id]/payment", params: { id: partyId } })
          }
        />
        <Button
          label={tx(T, "طباعة وتصدير")}
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: "/parties/[id]/statement/share",
              params: { id: partyId, range },
            })
          }
        />
      </Stack>

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "كشف فرعٍ آخر")}>
          <AppText variant="secondary">
            {tx(T, "جهاز فرع يحسب رصيداً مؤسسياً نشأ بعضه في فرع آخر.")}
          </AppText>
          <AppText variant="note">
            {tx(T, "الرصيد نعم والتفصيل لا")}{" "}
            {tx(
              T,
              "· يُعرض الرصيد المؤسسي كاملاً (وهو حقيقة الطرف)، ولا تُكشف فواتير الفرع الآخر.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ الحساب")}>
          <AppText variant="secondary">
            {tx(T, "الكشف يُحسب من كل الحركات ولا يُقرأ جاهزاً.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "طرفٌ بلا حركات")}>
          <AppText variant="secondary">{tx(T, "أُنشئ ولم يُبع له ولا سُدّد منه.")}</AppText>
          <AppText variant="note">
            {tx(T, "المسار")} {tx(T, "· «سجّل رصيداً افتتاحياً» أو «ابدأ بيعاً آجلاً».")}
          </AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "كشفٌ من آخر مطابقة")}>
          <AppText variant="secondary">{tx(T, "قبل ساعتين، وقد سدّد الطرف في فرع آخر.")}</AppText>
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "كشف محلي")}>
          <AppText variant="secondary">
            {tx(T, "من بيانات الجهاز، ومعه ما لم يُرفع موسوماً سطراً سطراً.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "pending_sync" ? (
        <StateView state="pending_sync" title={tx(T, "معلّق المزامنة")}>
          <AppText variant="secondary">
            {pendingCount === 1 ? (
              tx(T, "حركة واحدة معلقة من هذا الجهاز داخلة في الرصيد")
            ) : pendingCount === 2 ? (
              tx(T, "حركتان معلقتان من هذا الجهاز داخلتان في الرصيد")
            ) : (
              <>
                <M>{pendingCount}</M> {tx(T, "حركات معلقة من هذا الجهاز داخلة في الرصيد")}
              </>
            )}
          </AppText>
        </StateView>
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "كشف الحساب")}>
          {rows.map((r, i) => {
            const opening = r.tag === "opening";
            const fd = fullDate(r.at);
            return (
              <PRow
                key={`${r.tag}-${r.id}`}
                title={
                  <>
                    {r.label}
                    {r.source ? <>{` ${tx(T, "· المصدر —")} ${r.source}`}</> : null}
                  </>
                }
                sub={
                  <>
                    <M>{r.doc}</M>
                    {" · "}
                    {opening ? (
                      <>
                        <M>{fd.day}</M> {fd.month} <M>{fd.year}</M>
                      </>
                    ) : (
                      <>
                        <Day iso={r.at} now={now} /> <M>{hhmm(r.at)}</M>
                      </>
                    )}
                    {" · "}
                    <AppText variant="note" style={{ color: tagColor(r.tag) }}>
                      {tagLabel(r.tag)}
                    </AppText>
                    {r.branch ? <>{` · ${tx(T, "الفرع")} ${r.branch}`}</> : null}
                    {canCorrect(r) ? (
                      <AppText variant="note" style={{ color: c.brandStrong }}>
                        {` · ${tx(T, "تصحيح حركة")}`}
                      </AppText>
                    ) : null}
                  </>
                }
                trailing={
                  <View style={{ alignItems: "flex-end" }}>
                    {r.debit ? (
                      <AppText variant="bodyStrong">
                        <M strong>{formatMinorShort(r.debit)}</M>
                      </AppText>
                    ) : r.credit ? (
                      <AppText variant="bodyStrong">
                        <M strong>{formatMinorShort(r.credit)}</M>
                      </AppText>
                    ) : (
                      <M>—</M>
                    )}
                    <AppText variant="note" muted>
                      {r.debit ? tx(T, "عليه") : r.credit ? tx(T, "له") : ""}
                    </AppText>
                    <AppText variant="note" muted>
                      {tx(T, "الرصيد")} <M>{r.balance ? formatMinorShort(r.balance) : "—"}</M>
                    </AppText>
                  </View>
                }
                onPress={() => openDoc(r)}
                last={i === rows.length - 1}
              />
            );
          })}
        </GroupedList>
      ) : null}

      {pendingRows.length ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
          {tx(T, "الرصيد")} <M>{formatMinorShort((balance ?? 0n).toString())}</M>{" "}
          {tx(T, "يشمل فاتورة")} <M>{pendingRows[0]?.invoice_number ?? ""}</M>{" "}
          {tx(
            T,
            "المعلّقة من هذا الجهاز. إن سجّل جهاز آخر سداداً لم يصلنا بعد فالرقم سيتغير عند المزامنة. الفواتير المنشأة في فرع آخر تدخل الرصيد المؤسسي دون أن تُعرض تفاصيلها هنا.",
          )}
        </AppText>
      ) : null}
      <Button
        label={tx(T, "بطاقة الطرف")}
        variant="quiet"
        onPress={() => router.push({ pathname: "/parties/[id]", params: { id: partyId } })}
      />
    </Screen>
  );
}
