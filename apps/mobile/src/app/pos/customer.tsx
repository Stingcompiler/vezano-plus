import { formatMinorShort, pushPending } from "@sting/app-core";
import {
  type CartDraft,
  cartTotals,
  createPartyLocally,
  findSimilarLocal,
  type LocalParty,
  readCartDraft,
  readLocalParties,
  searchLocalParties,
  writeCartDraft,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  StateView,
  TextField,
  ThemedText as Text,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "POS-04";

/**
 * POS-04 — اختيار عميل وإنشاء سريع (خطة الجوال M2). ورقة بحث في أطراف الجهاز مع «إنشاء عميل جديد» بحقلين
 * (اسم وهاتف). العميل مطلوب للأثر الآجل فقط — لا عميل وهمي للبيع النقدي. التشابه المضلل (الاسم أو الهاتف
 * نفسه) يُعرض ويُسأل عنه قبل الإنشاء — لا يُمنع ولا يُدمج؛ والفحص الخادمي يكتمل عند المزامنة. الكاشير
 * لا يرفع حدّ الائتمان: الآجل فوق الحدّ يُرفض هنا بسببه.
 */
export default function Customer() {
  const router = useRouter();
  const { api } = useSession();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [parties, setParties] = useState<LocalParty[]>([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [similar, setSimilar] = useState<{ byName: LocalParty | null; byPhone: LocalParty | null }>(
    {
      byName: null,
      byPhone: null,
    },
  );
  const [overLimit, setOverLimit] = useState<LocalParty | null>(null);
  const [busy, setBusy] = useState(false);
  const opIds = useRef({ operationId: "", partyId: "" });

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [d, p] = await Promise.all([readCartDraft(storage), readLocalParties(storage)]);
      setDraft(d);
      setParties(p);
    })();
  }, []);

  const totals = draft ? cartTotals(draft.lines, draft.discount) : null;
  const results = searchLocalParties(parties, q);

  const choose = async (p: LocalParty) => {
    if (!draft) return;
    const limit = BigInt(p.credit_limit_minor || "0");
    if (limit > 0n && BigInt(p.balance_minor || "0") + (totals?.totalMinor ?? 0n) > limit) {
      setOverLimit(p);
      return;
    }
    await writeCartDraft(await getStorage(), { ...draft, customer: { id: p.id, name: p.name } });
    router.back();
  };
  const cashOnly = async () => {
    if (!draft) return;
    await writeCartDraft(await getStorage(), { ...draft, customer: undefined });
    router.back();
  };
  const create = async (distinctFromId?: string) => {
    if (!name.trim() || busy) return;
    if (!distinctFromId) {
      const sim = findSimilarLocal(parties, name, phone);
      if (sim.byName[0] || sim.byPhone[0]) {
        setSimilar({ byName: sim.byName[0] ?? null, byPhone: sim.byPhone[0] ?? null });
        return;
      }
    }
    setBusy(true);
    try {
      if (!opIds.current.operationId) opIds.current = { operationId: newId(), partyId: newId() };
      const storage = await getStorage();
      const { party } = await createPartyLocally(storage, {
        ...opIds.current,
        name,
        phone,
        distinctFromPartyId: distinctFromId,
        occurredAt: new Date().toISOString(),
      });
      void pushPending({ api, storage, requestId: newId }).catch(() => undefined);
      await choose(party);
    } finally {
      setBusy(false);
    }
  };

  const state = overLimit
    ? "validation_error"
    : results.length === 0 && q.trim()
      ? "empty"
      : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "اختيار العميل")}>
      {overLimit ? (
        <StateView state="validation_error" title={tx(T, "آجل فوق حدّ ائتمان العميل")}>
          <AppText variant="secondary">{tx(T, "الكاشير لا يرفع الحدّ")}</AppText>
          <AppText variant="note">
            {overLimit.name} · {tx(T, "· الحدّ")}{" "}
            <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
              {formatMinorShort(overLimit.credit_limit_minor)}
            </Text>
          </AppText>
          <Button label={tx(T, "بيع نقدي بلا عميل")} onPress={() => void cashOnly()} />
        </StateView>
      ) : null}

      {!creating ? (
        <>
          <TextField
            label={tx(T, "العملاء")}
            value={q}
            onChangeText={setQ}
            hint={tx(T, "البحث في أطراف الجهاز، والإنشاء السريع محلي.")}
            autoCorrect={false}
          />
          <Button
            label={tx(T, "بيع نقدي بلا عميل")}
            variant="secondary"
            onPress={() => void cashOnly()}
          />
          <Button
            label={tx(T, "إنشاء عميل جديد")}
            variant="secondary"
            onPress={() => {
              setCreating(true);
              setName(q);
            }}
          />
          <GroupedList title={tx(T, "العملاء")}>
            {results.length === 0 ? (
              <ListRow title={tx(T, "لا نتائج بحث")} last />
            ) : (
              results.slice(0, 30).map((p, i, all) => {
                const v = BigInt(p.balance_minor || "0");
                return (
                  <ListRow
                    key={p.id}
                    title={p.name}
                    subtitle={p.phone || undefined}
                    trailing={
                      <AppText variant="secondary">
                        <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
                          {formatMinorShort((v < 0n ? -v : v).toString())}
                        </Text>{" "}
                        {v > 0n ? tx(T, "عليه") : v < 0n ? tx(T, "له") : tx(T, "لا رصيد")}
                      </AppText>
                    }
                    onPress={() => void choose(p)}
                    last={i === all.length - 1}
                  />
                );
              })
            )}
          </GroupedList>
        </>
      ) : (
        <>
          <TextField label={tx(T, "الاسم")} value={name} onChangeText={setName} required />
          <TextField
            label={tx(T, "الهاتف")}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            mono
          />
          {similar.byName || similar.byPhone ? (
            <StateView
              state="validation_error"
              title={
                similar.byName ? tx(T, "يوجد عميل بنفس الاسم") : tx(T, "هاتف مسجَّل على طرف قائم")
              }
            >
              <AppText variant="secondary">{(similar.byName ?? similar.byPhone)?.name}</AppText>
              <Button
                label={tx(T, "استخدام العميل الموجود")}
                onPress={() => {
                  const p = similar.byName ?? similar.byPhone;
                  if (p) void choose(p);
                }}
              />
              <Button
                label={tx(T, "إنشاء منفصل مع تمييز")}
                variant="secondary"
                onPress={() => void create((similar.byName ?? similar.byPhone)?.id)}
              />
            </StateView>
          ) : null}
          <Button
            label={tx(T, "إنشاء عميل جديد")}
            financial
            loading={busy}
            disabledReason={name.trim() ? undefined : tx(T, "الاسم")}
            onPress={() => void create()}
          />
          <Button
            label={tx(T, "اختيار العميل")}
            variant="quiet"
            onPress={() => setCreating(false)}
          />
        </>
      )}
    </Screen>
  );
}
