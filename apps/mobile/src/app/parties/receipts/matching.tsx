import { formatMinorShort, hhmm } from "@sting/app-core";
import { storeParties } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { AppText, Button, Card, Screen, StateView, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { M, PRow, Stack } from "@/components/parties/parts";
import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-10";
type State =
  | "ready"
  | "loading"
  | "empty"
  | "offline"
  | "server_error"
  | "saving"
  | "validation_error"
  | "permission_denied";

interface Transfer {
  readonly id: string;
  readonly receipt_number: string;
  readonly kind: string;
  readonly party_id: string;
  readonly party_name: string;
  readonly amount_minor: string;
  readonly reference: string;
  readonly occurred_at: string;
  readonly user_name: string;
  readonly branch_name: string;
}

interface Payload {
  readonly rows: readonly Transfer[];
  readonly totals: { readonly count: number; readonly receipts_minor: string };
}

const NOT_ARRIVED = "لم يصل التحويل إلى الحساب";

function Day({ iso, now }: { iso: string; now: Date }): ReactNode {
  const d = dayLabel(iso, now);
  return d.word ?? <M>{d.n}</M>;
}

/**
 * PTY-10 — «تحويلات تنتظر المطابقة» (مراجعة الأطراف 2026-11-20، المرحلة ٤ — 0005 §٢٨٦؛ G-04):
 * «مطابق» يُسقط الدين (ACC-133)، و«لم يصل» يعكس السند بسبب (PTY-09) فيبقى الدين ويخرج من القائمة.
 * للمالك؛ خادمي فقط — لا مطابقة محلية.
 */
export default function Matching() {
  const router = useRouter();
  const { api } = useSession();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");
  const [reason, setReason] = useState<string>(tx(T, NOT_ARRIVED));
  const [attempted, setAttempted] = useState(false);
  const [done, setDone] = useState<{ number: string; matched: boolean } | null>(null);
  const [actionError, setActionError] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data: d, response } = await api.GET("/api/parties/receipts/unmatched");
      setOffline(false);
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      const body = d as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
    } catch {
      setOffline(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const keepParty = async (body: unknown) => {
    const party = (body as { party?: unknown } | undefined)?.party;
    if (party) await storeParties(await getStorage(), [party as never], new Date().toISOString());
  };

  const match = async (t: Transfer) => {
    if (busy) return;
    setBusy(t.id);
    setActionError(false);
    try {
      const { data: d, response } = await api.POST("/api/parties/receipts/{receipt_id}/match", {
        params: { path: { receipt_id: t.id } },
      });
      if (response.status === 403) setDenied(true);
      else if (!response.ok) setActionError(true);
      else {
        await keepParty(d);
        setDone({ number: t.receipt_number, matched: true });
      }
      await load();
    } catch {
      setActionError(true);
    } finally {
      setBusy("");
    }
  };

  const notArrived = async (t: Transfer) => {
    if (busy) return;
    setAttempted(true);
    if (!reason.trim()) return;
    setBusy(t.id);
    setActionError(false);
    try {
      const { data: d, response } = await api.POST("/api/parties/receipts/{receipt_id}/correct", {
        params: { path: { receipt_id: t.id } },
        body: { kind: "reverse", reason, new_method: "", new_reference: "", new_amount_minor: "" },
      });
      if (response.status === 403) setDenied(true);
      else if (!response.ok) setActionError(true);
      else {
        await keepParty(d);
        setDone({ number: t.receipt_number, matched: false });
        setOpen("");
        setAttempted(false);
        setReason(tx(T, NOT_ARRIVED));
      }
      await load();
    } catch {
      setActionError(true);
    } finally {
      setBusy("");
    }
  };

  const state: State = denied
    ? "permission_denied"
    : offline
      ? "offline"
      : busy
        ? "saving"
        : failed && !data
          ? "server_error"
          : !data
            ? "loading"
            : attempted && open && !reason.trim()
              ? "validation_error"
              : data.rows.length === 0
                ? "empty"
                : "ready";
  const now = new Date();

  return (
    <Screen screenId={T} state={state} title={tx(T, "تحويلات تنتظر المطابقة")}>
      <AppText variant="secondary" muted>
        {tx(T, "طابِق كل تحويل مع كشف البنك. دين العميل لا ينقص قبل «مطابق».")}
      </AppText>
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "المطابقة للمالك")}>
          <AppText variant="secondary">
            {tx(T, "تأكيد وصول المال من كشف البنك قرار المالك.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "المطابقة تحتاج اتصالاً")}>
          <AppText variant="secondary">
            {tx(T, "القائمة والقرار على الخادم. لا شيء يضيع من التحويلات.")}
          </AppText>
          <Stack>
            <Button label={tx(T, "أعد المحاولة")} onPress={() => void load()} />
          </Stack>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "تعذّر التحميل")}>
          <Stack>
            <Button label={tx(T, "أعد المحاولة")} onPress={() => void load()} />
          </Stack>
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ التحميل")}>
          <AppText variant="secondary">{tx(T, "التحويلات المسجَّلة التي لم تُطابَق بعد.")}</AppText>
        </StateView>
      ) : null}
      {done ? (
        <StateView
          state="success"
          title={done.matched ? tx(T, "طوبق — نقص الدين") : tx(T, "سُجّل أنه لم يصل")}
        >
          <AppText variant="secondary">
            <M>{done.number}</M>
            {done.matched ? null : ` ${tx(T, "· عُكس السند ويبقى الدين كما هو.")}`}
          </AppText>
        </StateView>
      ) : null}
      {actionError ? (
        <StateView state="server_error" title={tx(T, "تعذّر التسجيل")}>
          <AppText variant="secondary">{tx(T, "لم يتغيّر شيء.")}</AppText>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا تحويلات تنتظر المطابقة")}>
          <AppText variant="secondary">{tx(T, "كل تحويل مسجَّل طوبق أو عُكس.")}</AppText>
        </StateView>
      ) : null}
      {data && data.rows.length > 0 && state !== "permission_denied" ? (
        <>
          <AppText variant="note" muted>
            <M>{data.totals.count}</M> {tx(T, "سنداً · سداد ينتظر")}{" "}
            <M>{formatMinorShort(data.totals.receipts_minor)}</M>
          </AppText>
          {data.rows.map((t) => (
            <Card key={t.id}>
              <PRow
                title={t.party_name}
                trailing={<M strong>{formatMinorShort(t.amount_minor)}</M>}
                onPress={() =>
                  router.push({ pathname: "/parties/[id]/statement", params: { id: t.party_id } })
                }
                last
              />
              <AppText variant="secondary" muted>
                {t.kind === "receipt" ? tx(T, "سداد بتحويل") : tx(T, "ردّ مبلغ بتحويل")}{" "}
                {tx(T, "· المرجع")} <M>{t.reference}</M> {tx(T, "· السند")}{" "}
                <M>{t.receipt_number}</M>
              </AppText>
              <AppText variant="secondary" muted>
                <Day iso={t.occurred_at} now={now} /> <M>{hhmm(t.occurred_at)}</M>
                {t.user_name ? ` ${tx(T, "· سجّله")} ${t.user_name}` : ""}
                {t.branch_name ? ` · ${t.branch_name}` : ""}
              </AppText>
              {open === t.id ? (
                <>
                  <TextField
                    label={tx(T, "السبب")}
                    value={reason}
                    onChangeText={setReason}
                    error={attempted && !reason.trim() ? tx(T, "يُطلب سبب") : undefined}
                    required
                  />
                  <AppText variant="note" muted>
                    {tx(T, "يُعكس السند بمستند تصحيح ويبقى الدين كما هو.")}
                  </AppText>
                  <Stack>
                    <Button
                      label={tx(T, "سجّل أنه لم يصل")}
                      variant="secondary"
                      loading={busy === t.id}
                      onPress={() => void notArrived(t)}
                    />
                    <Button
                      label={tx(T, "تراجع")}
                      variant="quiet"
                      onPress={() => {
                        setOpen("");
                        setAttempted(false);
                      }}
                    />
                  </Stack>
                </>
              ) : (
                <Stack>
                  <Button
                    label={tx(T, "مطابق")}
                    financial
                    loading={busy === t.id}
                    onPress={() => void match(t)}
                  />
                  <Button
                    label={tx(T, "لم يصل")}
                    variant="quiet"
                    onPress={() => {
                      setOpen(t.id);
                      setReason(tx(T, NOT_ARRIVED));
                      setAttempted(false);
                    }}
                  />
                </Stack>
              )}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
