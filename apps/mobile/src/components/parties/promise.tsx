import { dayMonth } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, StateView, TextField } from "@sting/ui-native";
import { useState } from "react";

import { M, PRow, Stack } from "@/components/parties/parts";
import type { Card } from "@/features/parties/lib";
import { useSession } from "@/lib/session";

const S = "shared:features/parties/promise-block.tsx";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * «موعد السداد الموعود» في بطاقة العميل (مراجعة الأطراف 2026-11-20، المرحلة ٥ ب — 0005 §٢٨٨): وعد
 * يسجّله المالك أو المدير؛ تذكير لا يغيّر الرصيد، وفواته والدين باقٍ يُشعر المالك. أونلاين فقط.
 */
export function PromiseRows({ card, onSaved }: { card: Card; onSaved: (c: Card) => void }) {
  const { api } = useSession();
  const promise = card.promise;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(promise?.promised_on ?? "");
  const [note, setNote] = useState(promise?.note ?? "");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!promise) return null;
  const set = Boolean(promise.promised_on);
  const missed = set && promise.promised_on < todayIso() && BigInt(card.balance_minor || "0") > 0n;
  const error = !DATE.test(date)
    ? tx(S, "يُطلب تاريخ")
    : date < todayIso()
      ? tx(S, "تاريخ قادم")
      : undefined;

  const save = async (clear: boolean) => {
    if (busy) return;
    setAttempted(true);
    if (!clear && error) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api.POST("/api/parties/{party_id}/promise", {
        params: { path: { party_id: card.id } },
        body: { promised_on: clear ? null : date, note: clear ? "" : note },
      });
      const body = data as unknown as Card | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      onSaved(body);
      setEditing(false);
      setAttempted(false);
      if (clear) {
        setDate("");
        setNote("");
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const d = set ? dayMonth(promise.promised_on) : null;
  return (
    <>
      <GroupedList>
        <PRow
          title={tx(S, "موعد السداد الموعود")}
          sub={
            set
              ? `${promise.note ? `${promise.note} · ` : ""}${
                  promise.set_by_name ? `${tx(S, "سجّله")} ${promise.set_by_name}` : ""
                }`
              : undefined
          }
          trailing={
            d ? (
              <AppText>
                <M>{d.day}</M> {d.month}
              </AppText>
            ) : (
              <AppText muted>{tx(S, "لا موعد مسجَّل")}</AppText>
            )
          }
          last
        />
      </GroupedList>
      {missed ? (
        <StateView state="stale" title={tx(S, "فات الموعد والدين باقٍ")}>
          <AppText variant="secondary">
            {tx(S, "ذكّره بنفسك من «طباعة وتصدير» أو سجّل موعداً جديداً.")}
          </AppText>
        </StateView>
      ) : null}
      {failed ? (
        <StateView state="server_error" title={tx(S, "تعذّر الحفظ")}>
          <AppText variant="secondary">{tx(S, "لم يتغيّر شيء.")}</AppText>
        </StateView>
      ) : null}
      {editing ? (
        <>
          <TextField
            label={tx(S, "تاريخ السداد الموعود")}
            value={date}
            onChangeText={setDate}
            placeholder={todayIso()}
            keyboardType="numbers-and-punctuation"
            mono
            error={attempted ? error : undefined}
            required
          />
          <TextField label={tx(S, "ملاحظة")} value={note} onChangeText={setNote} maxLength={200} />
          <AppText variant="note" muted>
            {tx(S, "تذكير لك لا يغيّر الرصيد. إن فات والدين باقٍ يصلك إشعار.")}
          </AppText>
          <Stack>
            <Button label={tx(S, "احفظ الموعد")} loading={busy} onPress={() => void save(false)} />
            <Button
              label={tx(S, "تراجع")}
              variant="quiet"
              onPress={() => {
                setEditing(false);
                setAttempted(false);
              }}
            />
          </Stack>
        </>
      ) : card.can_edit ? (
        <Stack>
          <Button
            label={set ? tx(S, "غيّر الموعد") : tx(S, "سجّل موعد سداد")}
            variant="quiet"
            onPress={() => setEditing(true)}
          />
          {set ? (
            <Button
              label={tx(S, "امسح الموعد")}
              variant="quiet"
              loading={busy}
              onPress={() => void save(true)}
            />
          ) : null}
        </Stack>
      ) : null}
    </>
  );
}
