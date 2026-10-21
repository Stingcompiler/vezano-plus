import { formatMinorShort, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { useSession } from "@/lib/session";

const T = "POS-12";
type State = "ready" | "empty" | "conflict" | "permission_denied" | "offline";

interface Doc {
  readonly id: string;
  readonly invoice_number: string;
  readonly device_name: string;
  readonly user_name: string;
  readonly party_name: string;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly credit_minor: string;
  readonly occurred_at: string;
  readonly sync_state: "synced" | "reversed";
}
interface Pair {
  readonly source: "auto" | "report";
  readonly seconds_apart: number;
  readonly first: Doc;
  readonly second: Doc;
  readonly note: string;
  readonly reported_by_name: string;
}
interface Data {
  readonly can_decide: boolean;
  readonly pairs: readonly Pair[];
}
const pairKey = (p: Pair) => `${p.first.id}:${p.second.id}`;

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

function DocRows({ title, doc }: { title: string; doc: Doc }) {
  return (
    <GroupedList title={title}>
      <ListRow
        title={doc.invoice_number}
        subtitle={`${doc.device_name} · ${doc.user_name}`}
        trailing={<M>{formatMinorShort(doc.total_minor)}</M>}
      />
      <ListRow
        title={BigInt(doc.cash_minor) > 0n ? tx(T, "نقداً") : `${tx(T, "آجل —")} ${doc.party_name}`}
        subtitle={hhmm(doc.occurred_at)}
        trailing={
          <AppText variant="note">
            {doc.sync_state === "reversed" ? tx(T, "مستند إلغاء مستقلاً") : tx(T, "مؤكد خادمياً")}
          </AppText>
        }
        last
      />
    </GroupedList>
  );
}

/**
 * POS-12 — مراجعة تكرار تجاري أو تصحيح (خطة الجوال M2). المستندان جنباً إلى جنب بهويّتيهما وجهازيهما
 * ومنفّذيهما؛ الإجراء عكسي — «إلغاء المستند» لا «احذف»؛ المراجعة لمدير الفرع والكاشير يُبلغ. القرار يحتاج
 * اتصالاً لأن له أثراً مالياً عكسياً مركزياً.
 */
export default function Duplicates() {
  const { api } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decidedBy, setDecidedBy] = useState<string | null>(null);

  useEffect(() => {
    void api
      .GET("/api/sales/duplicates")
      .then(({ data: d, response }) => {
        if (response.ok && d) setData(d);
      })
      .catch(() => setOffline(true));
  }, [api]);

  const pairs = data?.pairs ?? [];
  const pair = pairs.find((p) => pairKey(p) === selected) ?? null;
  const canDecide = data?.can_decide ?? false;
  const state: State = offline
    ? "offline"
    : pair
      ? canDecide
        ? "conflict"
        : "permission_denied"
      : data && pairs.length === 0
        ? "empty"
        : "ready";

  const decide = async (decision: "reverse" | "both_real") => {
    if (!pair || busy) return;
    setAttempted(true);
    if (decision === "reverse" && !reason.trim()) return;
    setBusy(true);
    try {
      const { data: out, response } = await api.POST("/api/sales/duplicates/decide", {
        body: {
          first_id: pair.first.id,
          second_id: pair.second.id,
          decision,
          reason: reason.trim(),
        },
      });
      const body = out as unknown as { decided_by_name: string } | undefined;
      if (!response.ok || !body) return;
      setDecidedBy(body.decided_by_name);
      setData((d) =>
        d ? { ...d, pairs: d.pairs.filter((p) => pairKey(p) !== pairKey(pair)) } : d,
      );
      setSelected(null);
      setReason("");
      setAttempted(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen screenId={T} state={state} title={tx(T, "مراجعة تكرار تجاري أو تصحيح")}>
      {offline ? (
        <StateView state="offline" title={tx(T, "المراجعة تحتاج اتصالاً")}>
          <AppText variant="secondary">{tx(T, "القرار يحتاج اتصالاً")}</AppText>
        </StateView>
      ) : null}
      {decidedBy ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "سُجّل القرار باسم")} {decidedBy}
        </AppText>
      ) : null}

      {!pair ? (
        pairs.length === 0 && data ? (
          <StateView state="empty" title={tx(T, "لا اشتباهات")}>
            <AppText variant="secondary">{tx(T, "حالة سويّة.")}</AppText>
          </StateView>
        ) : (
          <GroupedList title={tx(T, "فاتورتان متطابقتان خلال دقيقة")}>
            {pairs.map((p, i) => (
              <ListRow
                key={pairKey(p)}
                title={`${p.first.invoice_number} / ${p.second.invoice_number}`}
                subtitle={`${p.source === "report" ? tx(T, "بلاغ") : tx(T, "تعارض")} · ${p.seconds_apart} ${tx(T, "ث")}`}
                trailing={<M>{formatMinorShort(p.first.total_minor)}</M>}
                onPress={() => setSelected(pairKey(p))}
                last={i === pairs.length - 1}
              />
            ))}
          </GroupedList>
        )
      ) : (
        <>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "المستندان جنباً إلى جنب")}
          </AppText>
          <DocRows title={tx(T, "المستند الأول — الأصل")} doc={pair.first} />
          <DocRows title={tx(T, "المستند الثاني — المشتبه به")} doc={pair.second} />
          {canDecide ? (
            <>
              <AppText variant="note" muted>
                {tx(T, "القرار «هذا تكرار» يُنشئ مستنداً عكسياً بأثر مالي.")}
              </AppText>
              <TextField
                label={tx(T, "السبب")}
                value={reason}
                onChangeText={setReason}
                error={attempted && !reason.trim() ? tx(T, "يُطلب سبب") : undefined}
                required
              />
              <Button
                label={`${tx(T, "إلغاء المستند")} ${pair.second.invoice_number}`}
                variant="danger"
                loading={busy}
                onPress={() => void decide("reverse")}
              />
              <Button
                label={tx(T, "الاثنان بيعان حقيقيان")}
                variant="secondary"
                onPress={() => void decide("both_real")}
              />
            </>
          ) : (
            <StateView state="permission_denied" title={tx(T, "المراجعة لمدير الفرع")}>
              <AppText variant="secondary">
                {tx(T, "الإلغاء يتطلب صلاحية مدير فرع أو مالك")}
              </AppText>
            </StateView>
          )}
          <Button
            label={tx(T, "رجوع إلى القائمة")}
            variant="quiet"
            onPress={() => setSelected(null)}
          />
        </>
      )}
    </Screen>
  );
}
