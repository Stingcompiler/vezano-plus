import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { Fragment, useEffect, useState } from "react";
import { View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { Heading, Lead, M, Note, Row, Stack, StateWord } from "@/components/market-seller/parts";
import { netState, priceToMinor, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "MP-12";

interface Tier {
  min: number;
  max: number | null;
  label: string;
  price_minor: string;
  unit_price_minor: string;
  base_unit_name: string;
  negotiable: boolean;
  pack_label: string;
}
interface Member {
  id: string;
  buyer_name: string;
  status: "invited" | "active" | "suspended";
  status_label: string;
  hint: string;
}
interface PriceList {
  id: string;
  name: string;
  offer_id: string;
  offer_name: string;
  pack_label: string;
  unit_name: string;
  tiers: Tier[];
  gaps: { from: number; to: number }[];
  members: Member[];
  active_count: number;
}
interface TierDraft {
  min: string;
  max: string;
  price: string;
}
type Gap = { from: number; to: number };

const tiersToDraft = (ts: Tier[]): TierDraft[] =>
  ts.map((t) => ({
    min: String(t.min),
    max: t.max === null ? "" : String(t.max),
    price: t.price_minor ? formatMinor(t.price_minor).replace(/,/g, "") : "",
  }));

/** فجوات ما بين شريحتين محسوبة محلياً (كالويب) — تمنع الحفظ قبل السؤال. */
export const localGaps = (ds: TierDraft[]): Gap[] => {
  const rows = ds
    .map((d) => ({ min: Number(d.min || 0), max: d.max ? Number(d.max) : null }))
    .filter((r) => r.min > 0)
    .sort((a, b) => a.min - b.min);
  const out: Gap[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.max === null) break;
    if (b.min > a.max + 1) out.push({ from: a.max + 1, to: b.min - 1 });
  }
  return out;
};

const MEMBER_STATE: Record<Member["status"], StateCode> = {
  invited: "pending_sync",
  active: "success",
  suspended: "stale",
};

const EMPTY_DRAFT: TierDraft = { min: "", max: "", price: "" };

/** «فجوة: 11 – 19 كيس بلا سعر معلن» — الأرقام mono. */
function GapText({ g, unit }: { g: Gap; unit: string }) {
  return (
    <>
      {tx(T, "فجوة:")} <M>{g.from}</M> – <M>{g.to}</M> {unit} {tx(T, "بلا سعر معلن")}
    </>
  );
}

/** المشترون المخوَّلون: «N مشترين مخوَّلين · الوحدة: …». */
function ActiveLine({ pl }: { pl: PriceList }) {
  return (
    <>
      <M>{pl.active_count}</M> {tx(T, "مشترين مخوَّلين · الوحدة:")} {pl.pack_label || pl.unit_name}
    </>
  );
}

/** MP-12 — أسعار شرائح وقوائم خاصة (10-D6 validation_error · 43-D35 ready/empty/permission_denied). */
export default function PriceListsScreen({
  listId,
  offerId,
}: {
  listId?: string;
  offerId?: string;
}) {
  const router = useRouter();
  const { api } = useSession();
  const isIndex = !listId && !offerId;

  const idx = useServerGet<PriceList[]>(
    "cache.market.lists",
    () =>
      safeGet(
        () => api.GET("/api/market/lists"),
        (b) => (b as { lists?: PriceList[] } | undefined)?.lists,
      ),
    [],
    isIndex || Boolean(offerId),
  );
  const one = useServerGet<{ list: PriceList; role: string }>(
    `cache.market.list.${listId ?? ""}`,
    () =>
      safeGet(
        () =>
          api.GET("/api/market/lists/{list_id}", { params: { path: { list_id: listId ?? "" } } }),
        (b) =>
          b && (b as { list?: PriceList }).list
            ? (b as { list: PriceList; role: string })
            : undefined,
      ),
    [listId],
    Boolean(listId),
  );

  const [current, setCurrent] = useState<PriceList | null>(null);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<TierDraft[]>(offerId ? [{ ...EMPTY_DRAFT }] : []);
  const [attempted, setAttempted] = useState(false);
  const [serverGaps, setServerGaps] = useState<Gap[]>([]);
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [offlineTry, setOfflineTry] = useState(false);

  const applyList = (pl: PriceList) => {
    setCurrent(pl);
    setName(pl.name);
    setDrafts(tiersToDraft(pl.tiers));
    setServerGaps([]);
  };
  useEffect(() => {
    const d = one.data;
    if (d && d.role === "seller") applyList(d.list);
  }, [one.data]);

  const foreign =
    Boolean(listId) && (one.status === 404 || (one.shown !== null && one.shown.role !== "seller"));
  const cur = current ?? (one.shown?.role === "seller" ? one.shown.list : null);
  const lists = idx.shown;
  const gaps = attempted ? (serverGaps.length ? serverGaps : localGaps(drafts)) : [];

  const save = async () => {
    setAttempted(true);
    setOfflineTry(false);
    if (localGaps(drafts).length) return;
    setBusy(true);
    try {
      const payload = {
        offer_id: cur?.offer_id ?? offerId ?? "",
        name,
        tiers: drafts
          .filter((d) => d.min)
          .map((d) => ({ min: d.min, max: d.max, price_minor: priceToMinor(d.price) })),
      };
      const r = await send<{ list?: PriceList; extra?: { gaps?: Gap[] } }>(() =>
        cur
          ? api.PUT("/api/market/lists/{list_id}", {
              params: { path: { list_id: cur.id } },
              body: payload as never,
            })
          : api.POST("/api/market/lists", { body: payload as never }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "error" && r.status === 400) {
        setServerGaps(r.body?.extra?.gaps ?? []);
        return;
      }
      if (r.kind === "ok" && r.body.list) {
        if (!cur) router.push(`/market/lists/${r.body.list.id}`);
        else applyList(r.body.list);
        setAttempted(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const inviteMember = async () => {
    if (!cur || !invite.trim()) return;
    setOfflineTry(false);
    const r = await send<{ member?: Member }>(() =>
      api.POST("/api/market/lists/{list_id}/members", {
        params: { path: { list_id: cur.id } },
        body: { buyer_tenant_id: invite.trim() } as never,
      }),
    );
    if (r.kind === "offline") return setOfflineTry(true);
    if (r.kind === "ok" && r.body.member) {
      setCurrent({ ...cur, members: [...cur.members, r.body.member] });
      setInvite("");
    }
  };

  const memberAction = async (m: Member, action: "suspend" | "resume") => {
    if (!cur) return;
    setOfflineTry(false);
    const r = await send<{ member?: Member }>(() =>
      api.POST("/api/market/lists/{list_id}/members/{member_id}/{action}", {
        params: { path: { list_id: cur.id, member_id: m.id, action } },
      }),
    );
    if (r.kind === "offline") return setOfflineTry(true);
    if (r.kind === "ok" && r.body.member)
      setCurrent({
        ...cur,
        members: cur.members.map((x) => (x.id === m.id ? r.body.member! : x)),
      });
  };

  const srvNet = listId ? one : idx;
  const net = netState(srvNet.net, srvNet.fromCache, srvNet.status);
  const state: StateCode = foreign
    ? "permission_denied"
    : gaps.length
      ? "validation_error"
      : isIndex && lists && lists.length === 0
        ? "empty"
        : (net ?? "ready");

  const setDraft = (i: number, patch: Partial<TierDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const unit = cur?.unit_name ?? tx(T, "وحدة");

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "قوائم الأسعار الخاصة — الشريحة بوحدتها والمشترون بأسمائهم")}
      onRefresh={() => void (listId ? one.reload() : idx.reload())}
    >
      <Lead>
        {tx(
          T,
          "الشرائح بحدودها: كل شريحة: منشآت مسمّاة بعلاقة مخوَّلة، وأسعار بوحداتها، وحدود كمية. العلاقة أولاً — لا سعر خاص لمنشأة بلا علاقة قائمة (متابعة مقبولة أو تعامل سابق).",
        )}
      </Lead>
      <FetchFail
        net={net}
        hasData={Boolean(listId ? one.shown : lists)}
        onRetry={() => void (listId ? one.reload() : idx.reload())}
      />
      {net && (listId ? one.shown : lists) ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الرابط لم يعد صالحاً")}>
          <AppText variant="secondary">
            {tx(
              T,
              "هذا الرابط منتهٍ أو غير متاح لك. لا نقول إن كان موجوداً أصلاً، ولا لمن يخص، ولا ما نوعه.",
            )}
          </AppText>
          <Button
            label={tx(T, "عودة إلى الصفحة الرئيسية")}
            onPress={() => router.push("/market/offers")}
          />
        </StateView>
      ) : null}

      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا قوائم خاصة")}>
          <AppText variant="secondary">
            {tx(T, "كل الأسعار عامة — حالة سويّة لأغلب الباعة.")}
          </AppText>
          <Button label={tx(T, "ابدأ من عرض")} onPress={() => router.push("/market/offers")} />
        </StateView>
      ) : null}

      {isIndex && lists && lists.length ? (
        <GroupedList>
          {lists.map((pl, i) => (
            <Row
              key={pl.id}
              title={`${tx(T, "قائمة «")}${pl.name}» — ${pl.offer_name}`}
              sub={<ActiveLine pl={pl} />}
              trailing={<StateWord state="success" label={tx(T, "قائمة خاصة")} />}
              onPress={() => router.push(`/market/lists/${pl.id}`)}
              last={i === lists.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}

      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "فجوة بين شريحتين تمنع الحفظ")}>
          <AppText variant="secondary">
            {gaps.map((g, i) => (
              <Fragment key={`${g.from}-${g.to}`}>
                {i > 0 ? `${tx(T, "،")} ` : ""}
                <GapText g={g} unit={unit} />
              </Fragment>
            ))}
            {tx(
              T,
              ". طلب في الفجوة لا يجد سعراً، فيقع على سعر افتراضي لا أحد اتفق عليه. أغلق الفجوة أو صرّح بالسعر الساري فيها.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {(cur || offerId) && !foreign ? (
        <>
          <Heading>
            {tx(T, "قائمة «")}
            {name || "…"}»{cur ? ` — ${cur.offer_name}` : ""}
          </Heading>
          {cur ? (
            <Note>
              <ActiveLine pl={cur} />
            </Note>
          ) : null}
          <TextField label={tx(T, "اسم القائمة")} value={name} onChangeText={setName} />

          {drafts.map((d, i) => {
            const t = cur?.tiers[i];
            const gap = gaps.find((g) => Number(d.min) === g.to + 1);
            return (
              <View key={i} style={{ marginBottom: SPACE["3"] }}>
                <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
                  {tx(T, "الشريحة")} <M>{i + 1}</M>
                  {t ? ` — ${t.label}` : ""}
                </AppText>
                <TextField
                  label={`${tx(T, "من — شريحة")} ${i + 1}`}
                  mono
                  keyboardType="decimal-pad"
                  value={d.min}
                  onChangeText={(v) => setDraft(i, { min: v })}
                />
                <TextField
                  label={`${tx(T, "إلى — شريحة")} ${i + 1}`}
                  mono
                  keyboardType="decimal-pad"
                  value={d.max}
                  onChangeText={(v) => setDraft(i, { max: v })}
                  hint={tx(T, "فارغ = أكثر من")}
                />
                <TextField
                  label={`${tx(T, "سعر العبوة — شريحة")} ${i + 1}`}
                  mono
                  keyboardType="decimal-pad"
                  value={d.price}
                  onChangeText={(v) => setDraft(i, { price: v })}
                  hint={tx(T, "فارغ = بالتفاوض")}
                />
                {t?.pack_label ? <Note>{t.pack_label}</Note> : null}
                <AppText variant="secondary">
                  {tx(T, "سعر الوحدة")}:{" "}
                  {t?.unit_price_minor ? (
                    <>
                      <M>{formatMinor(t.unit_price_minor)}</M> /{t.base_unit_name}
                    </>
                  ) : d.price ? (
                    "—"
                  ) : (
                    tx(T, "بالتفاوض")
                  )}
                </AppText>
                {gap ? (
                  <StateWord
                    state="validation_error"
                    label={`${tx(T, "فجوة:")} ${gap.from} – ${gap.to}`}
                  />
                ) : d.price ? (
                  <StateWord state="success" label={tx(T, "سليمة")} />
                ) : (
                  <StateWord state="stale" label={tx(T, "بالتفاوض")} />
                )}
              </View>
            );
          })}
          <Note>{tx(T, "«بالتفاوض» مقبول ويمنع الطلب الفوري ويفتح طلب عرض سعر")}</Note>
          <Stack>
            <Button
              label={tx(T, "أضف شريحة")}
              variant="secondary"
              onPress={() => setDrafts((ds) => [...ds, { ...EMPTY_DRAFT }])}
            />
            <Button
              label={tx(T, "احفظ القائمة")}
              financial
              loading={busy}
              onPress={() => void save()}
            />
          </Stack>

          {cur ? (
            <>
              <Heading>{tx(T, "المشترون المخوَّلون — بأسمائهم لا بوصف عام")}</Heading>
              <GroupedList>
                {cur.members.map((m, i) => (
                  <View key={m.id}>
                    <Row
                      title={m.buyer_name}
                      sub={m.hint}
                      trailing={<StateWord state={MEMBER_STATE[m.status]} label={m.status_label} />}
                      last={m.status === "invited" && i === cur.members.length - 1}
                    />
                    {m.status === "active" ? (
                      <View style={{ paddingHorizontal: SPACE["4"], paddingBottom: SPACE["2"] }}>
                        <Button
                          label={tx(T, "أوقف")}
                          variant="quiet"
                          onPress={() => void memberAction(m, "suspend")}
                        />
                      </View>
                    ) : m.status === "suspended" ? (
                      <View style={{ paddingHorizontal: SPACE["4"], paddingBottom: SPACE["2"] }}>
                        <Button
                          label={tx(T, "استأنف")}
                          variant="quiet"
                          onPress={() => void memberAction(m, "resume")}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
              </GroupedList>
              <TextField
                label={tx(T, "معرّف منشأة مشترية لدعوتها")}
                mono
                value={invite}
                onChangeText={setInvite}
                hint={tx(T, "الدعوة تُقبل بحساب المشتري — لا تسجيل نيابةً عنه")}
                autoCapitalize="none"
              />
              <Stack>
                <Button
                  label={tx(T, "أرسل دعوة")}
                  variant="secondary"
                  onPress={() => void inviteMember()}
                />
              </Stack>
              <Note>
                <AppText variant="bodyStrong">{tx(T, "تسريب محجوب")}</AppText>{" "}
                {tx(
                  T,
                  "· منشأة غير مخوَّلة تفتح رابط هذه القائمة فترى صفحة «الرابط لم يعد صالحاً» نفسها التي يراها من فتح رابطاً غير موجود.",
                )}
              </Note>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
