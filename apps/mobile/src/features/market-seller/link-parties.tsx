import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useState } from "react";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import { Fact, Heading, M, Note, Row, Stack, StateWord } from "@/components/market-seller/parts";
import { dm, netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "LINK-01";

interface Link {
  id: string;
  party_id: string;
  counterparty_tenant_id: string;
  counterparty_name: string;
  status: "requested" | "accepted" | "rejected" | "cancelled";
  status_label: string;
  requested_at: string;
  decided_at: string;
  decided_by_name: string;
}
interface PartyRow {
  party_id: string;
  party_name: string;
  created_at: string;
  documents: number;
  balance_minor: string;
  link: Link | null;
}
interface Candidate {
  tenant_id: string;
  public_name: string;
  badge: string;
  badge_label: string;
  offers: number;
  category_line: string;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_link: boolean;
  parties: PartyRow[];
  linked_count: number;
}

/** «مستند واحد / مستندان / N مستندات / N مستنداً». */
function DocsWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "مستند واحد")}</>;
  if (n === 2) return <>{tx(T, "مستندان")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "مستندات") : tx(T, "مستنداً")}
    </>
  );
}
/** «عرض واحد / عرضان / N عروض / N عرضاً». */
function OffersWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "عرض واحد")}</>;
  if (n === 2) return <>{tx(T, "عرضان")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "عروض") : tx(T, "عرضاً")}
    </>
  );
}

/** LINK-01 — ربط الطرف المحلي بمنشأة (29-D22 ready/validation_error · 38-D30 permission_denied/success · phase_locked): موافقة وهوية، لا دمج بالاسم (ACC-131). */
export default function LinkPartiesScreen() {
  const { api } = useSession();
  const srv = useServerGet<Payload>("cache.market.link.parties", () =>
    safeGet(() => api.GET("/api/market/link/parties")),
  );
  const [current, setCurrent] = useState<PartyRow | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Link | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  const search = async (text: string) => {
    setQ(text);
    const r = await send<{ candidates?: Candidate[] }>(() =>
      api.GET("/api/market/link/parties", { params: { query: { q: text } } }),
    );
    if (r.kind === "ok" && r.body.candidates) setCandidates(r.body.candidates);
    if (r.kind === "offline") setOfflineTry(true);
  };

  const open = async (p: PartyRow) => {
    setCurrent(p);
    setErr("");
    setChosen("");
    setDone(null);
    setOfflineTry(false);
    await search(p.party_name);
  };

  const request = async (p: PartyRow) => {
    if (busy) return;
    setBusy("request");
    setErr("");
    setOfflineTry(false);
    try {
      const r = await send<{
        link?: Link;
        detail?: string;
        extra?: { candidates?: Candidate[] };
      }>(() =>
        api.POST("/api/market/link/parties/{party_id}/{action}", {
          params: { path: { party_id: p.party_id, action: "request" } },
          body: { counterparty_tenant_id: chosen } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.link) {
        setDone(r.body.link);
        await srv.reload();
        return;
      }
      if (r.body?.detail === "ambiguous_name") setCandidates(r.body.extra?.candidates ?? []);
      setErr(r.body?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const cancel = async (p: PartyRow) => {
    if (busy) return;
    setBusy("cancel");
    setOfflineTry(false);
    try {
      const r = await send<unknown>(() =>
        api.POST("/api/market/link/parties/{party_id}/{action}", {
          params: { path: { party_id: p.party_id, action: "cancel" } },
          body: {} as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok") {
        setCurrent(null);
        await srv.reload();
      }
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    err === "permission_denied" || (data && !data.can_link)
      ? "permission_denied"
      : done
        ? "success"
        : err === "ambiguous_name"
          ? "validation_error"
          : (net ?? (data ? "ready" : "loading"));
  const chosenCand = candidates?.find((c) => c.tenant_id === chosen) ?? null;
  const owes = (p: PartyRow) => Number(p.balance_minor) !== 0;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "ربط الطرف المحلي بمنشأة — موافقة وهوية، لا دمج بالاسم")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "«مخزن البركة» في دفترك اسم كتبته أنت. ربطه بمنشأة حقيقية في السوق يحتاج موافقتها — التشابه في الاسم ليس هوية.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الربط للمالك")}>
          <AppText variant="secondary">
            {tx(T, "الربط يجعل مستندات السوق تدخل دفتر طرفٍ محلي — أثرٌ مالي مباشر.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "لا ربط بالاسم")}</AppText>{" "}
            {tx(T, "· حتى للمالك: التطابق بالاسم ليس دليل هوية. الربط يحتاج تأكيداً من الطرفين.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "validation_error" && candidates ? (
        <StateView state="validation_error" title={tx(T, "اسمان متشابهان ليسا طرفاً واحداً")}>
          <AppText variant="secondary">
            {candidates.length === 3 ? (
              tx(T, "ثلاث منشآت")
            ) : candidates.length === 2 ? (
              tx(T, "منشأتان")
            ) : candidates.length === 1 ? (
              tx(T, "منشأة")
            ) : (
              <>
                <M>{candidates.length}</M> {tx(T, "منشأة")}
              </>
            )}{" "}
            {tx(T, "باسم قريب. لا نختار عنك ولا نقترح «الأرجح» — نعرض")}{" "}
            {candidates.length === 3 ? tx(T, "الثلاث") : tx(T, "المرشّحات")}{" "}
            {tx(T, "بمعرّفاتها وننتظر اختيارك، لأن ربطاً خاطئاً يُرسل ذمّتك إلى غير صاحبها.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" && done ? (
        <StateView
          state="success"
          title={
            done.status === "accepted"
              ? tx(T, "رُبط الطرفان")
              : tx(T, "أُرسل طلب الربط — بانتظار موافقة المنشأة")
          }
        >
          <AppText variant="secondary">
            {done.status === "accepted"
              ? tx(
                  T,
                  "نقول ما صار ممكناً وما لم يتغيّر: مستندات السوق تقترح دخول دفتره، ورصيده لم يتغيّر بالربط.",
                )
              : tx(T, "بلا قبولها لا ربط — ولو تطابق الاسم حرفاً بحرف. رصيد الطرف لم يتغيّر.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الربط مطابقة لا دمج")}</AppText>{" "}
            {tx(
              T,
              "· دفتر كل طرف يبقى دفتره. الربط جسرٌ يعبر عليه المستند بموافقتك، لا دمجُ رصيدين.",
            )}
          </AppText>
          <Button
            label={tx(T, "التالي")}
            variant="secondary"
            onPress={() => {
              setDone(null);
              setCurrent(null);
            }}
          />
        </StateView>
      ) : null}

      {err && !["ambiguous_name", "permission_denied"].includes(err) ? (
        <StateView state="partial" title={tx(T, "لم يُرسل")}>
          <AppText variant="secondary">
            {err === "link_exists"
              ? tx(T, "لهذا الطرف طلب ربط قائم.")
              : err === "counterparty_not_published"
                ? tx(T, "المنشأة المختارة لم تنشر صفحتها بعد.")
                : err}
          </AppText>
        </StateView>
      ) : null}

      {data && !current ? (
        <>
          <Heading>
            {tx(T, "الموردون في دفترك — مربوط")} <M>{data.linked_count}</M> {tx(T, "من")}{" "}
            <M>{data.parties.length}</M>
          </Heading>
          {data.parties.length === 0 ? (
            <Note>{tx(T, "لا موردين في دفترك بعد — أضفهم من «الأطراف» في دفترك.")}</Note>
          ) : null}
          <GroupedList>
            {data.parties.map((p, i) => (
              <Row
                key={p.party_id}
                title={p.party_name}
                sub={
                  <>
                    {tx(T, "أنشأته")} <M>{dm(p.created_at)}</M> · <DocsWord n={p.documents} /> ·{" "}
                    {owes(p) ? tx(T, "ذمّة قائمة") : tx(T, "بلا ذمّة")}
                    {data.can_link ? "" : `\n${tx(T, "الربط للمالك")}`}
                  </>
                }
                trailing={
                  p.link ? (
                    <StateWord
                      state={p.link.status === "accepted" ? "success" : "stale"}
                      label={
                        p.link.status === "accepted"
                          ? `${tx(T, "مربوط بـ")}${p.link.counterparty_name}`
                          : p.link.status_label
                      }
                    />
                  ) : (
                    <StateWord state="saved_local" label={tx(T, "غير مربوط")} />
                  )
                }
                onPress={data.can_link ? () => void open(p) : undefined}
                last={i === data.parties.length - 1}
              />
            ))}
          </GroupedList>
        </>
      ) : null}

      {current ? (
        <>
          <Heading>{tx(T, "الطرف في دفترك")}</Heading>
          <Note>
            <AppText variant="bodyStrong">{current.party_name}</AppText> · {tx(T, "أنشأته")}{" "}
            <M>{dm(current.created_at)}</M> · <DocsWord n={current.documents} /> ·{" "}
            {owes(current) ? tx(T, "ذمّة قائمة") : tx(T, "بلا ذمّة")}
            {owes(current) ? (
              <>
                {" "}
                (<M>{formatMinor(current.balance_minor)}</M>)
              </>
            ) : null}
          </Note>
          {current.link &&
          current.link.status !== "cancelled" &&
          current.link.status !== "rejected" ? (
            <>
              <Heading>{tx(T, "المنشأة في السوق")}</Heading>
              <Note>
                <AppText variant="bodyStrong">{current.link.counterparty_name}</AppText> ·{" "}
                {current.link.status_label}
              </Note>
              <Stack>
                <Button
                  label={
                    current.link.status === "accepted" ? tx(T, "فكّ الربط") : tx(T, "إلغاء الطلب")
                  }
                  variant="danger"
                  loading={busy === "cancel"}
                  onPress={() => void cancel(current)}
                />
                <Button label={tx(T, "رجوع")} variant="quiet" onPress={() => setCurrent(null)} />
              </Stack>
            </>
          ) : (
            <>
              <Heading>{tx(T, "المنشأة في السوق")}</Heading>
              <TextField
                label={tx(T, "ابحث باسم المنشأة")}
                value={q}
                onChangeText={(v) => void search(v)}
              />
              <GroupedList>
                {(candidates ?? []).map((c, i, arr) => (
                  <Row
                    key={c.tenant_id}
                    title={
                      <AppText variant={chosen === c.tenant_id ? "bodyStrong" : "body"}>
                        {c.public_name}
                      </AppText>
                    }
                    sub={
                      <>
                        {c.badge_label} · <OffersWord n={c.offers} /> ·{" "}
                        <M>{c.tenant_id.slice(0, 8)}</M>
                      </>
                    }
                    trailing={
                      chosen === c.tenant_id ? <StateWord state="success" label="✓" /> : undefined
                    }
                    onPress={() => setChosen(c.tenant_id)}
                    last={i === arr.length - 1}
                  />
                ))}
              </GroupedList>
              {candidates && candidates.length === 0 ? (
                <Note>{tx(T, "لا منشأة منشورة بهذا الاسم.")}</Note>
              ) : null}
              <Fact label={tx(T, "مطلوب")}>
                <AppText variant="bodyStrong">{tx(T, "موافقة المنشأة على الربط")}</AppText>
                {"\n"}
                {tx(
                  T,
                  "يُرسل طلب ربط تراه المنشأة وتقبله. بلا قبولها لا ربط — ولو تطابق الاسم حرفاً بحرف.",
                )}
              </Fact>
              <Fact label={tx(T, "يبقى")}>
                <AppText variant="bodyStrong">{tx(T, "دفترك كما هو")}</AppText>
                {"\n"}
                {tx(T, "الاسم الذي كتبته، و")}
                <DocsWord n={current.documents} />
                {tx(T, "، والذمّة القائمة — كلها ملكك ولا تُستبدل ببيانات المنشأة العامة.")}
              </Fact>
              <Fact label={tx(T, "يُضاف")}>
                <AppText variant="bodyStrong">{tx(T, "قناة مستندات بين الطرفين")}</AppText>
                {"\n"}
                {tx(
                  T,
                  "هذا كل ما يفعله الربط: طلباتك معها تصبح قابلة للتحويل إلى مستندات في دفترك بموافقتك.",
                )}
              </Fact>
              <Stack>
                <Button
                  label={
                    chosenCand
                      ? `${tx(T, "أرسل طلب الربط إلى")} ${chosenCand.public_name}`
                      : tx(T, "أرسل طلب الربط")
                  }
                  financial
                  loading={busy === "request"}
                  onPress={() => void request(current)}
                />
                <Button label={tx(T, "رجوع")} variant="quiet" onPress={() => setCurrent(null)} />
              </Stack>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
