"use client";

import { Button, Notice, TextField } from "@sting/ui-web";
import { useState } from "react";

import { dayMonth } from "@/features/home/format";
import type { Card } from "@/features/parties/party-card-client";
import { api } from "@/lib/api";

export interface Promise_ {
  readonly promised_on: string;
  readonly note: string;
  readonly set_by_name: string;
  readonly set_at: string;
}

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * «موعد السداد الموعود» في بطاقة العميل (مراجعة الأطراف 2026-11-20، المرحلة ٥ ب — 0005 §٢٨٨): وعد
 * العميل بتاريخ يسجّله المالك أو المدير. تذكير لا يغيّر الرصيد؛ فواته والدين باقٍ يُشعر المالك.
 */
export function PromiseBlock({ card, onSaved }: { card: Card; onSaved: (c: Card) => void }) {
  const promise = card.promise;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(promise?.promised_on || "");
  const [note, setNote] = useState(promise?.note || "");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  if (!promise) return null;
  const set = Boolean(promise.promised_on);
  const missed = set && promise.promised_on < todayIso() && BigInt(card.balance_minor || "0") > 0n;
  const error = !date ? "يُطلب تاريخ" : date < todayIso() ? "تاريخ قادم" : undefined;

  const save = async (clear: boolean) => {
    if (busy) return;
    setAttempted(true);
    if (!clear && error) return;
    setBusy(true);
    setFailed("");
    try {
      const { data, response } = await api().POST("/api/parties/{party_id}/promise", {
        params: { path: { party_id: card.id } },
        body: { promised_on: clear ? null : date, note: clear ? "" : note },
      });
      const body = data as unknown as Card | undefined;
      if (!response.ok || !body) {
        setFailed("تعذّر الحفظ");
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
      setFailed("تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  const d = set ? dayMonth(promise.promised_on) : null;
  return (
    <div className="pty-promise">
      <div className="shift-facts">
        <div>
          <span className="shift-facts__k">موعد السداد الموعود</span>
          <span className="shift-facts__v">
            {d ? (
              <>
                <span className="sting-mono">{d.day}</span> {d.month}
              </>
            ) : (
              "لا موعد مسجَّل"
            )}
          </span>
        </div>
      </div>
      {set ? (
        <p className="acc-choice__note">
          {promise.note ? `${promise.note} · ` : ""}
          {promise.set_by_name ? `سجّله ${promise.set_by_name}` : ""}
        </p>
      ) : null}
      {missed ? (
        <Notice kind="warning" title="فات الموعد والدين باقٍ">
          <p className="acc-lead">ذكّره بنفسك من «طباعة وتصدير» أو سجّل موعداً جديداً.</p>
        </Notice>
      ) : null}
      {failed ? (
        <Notice kind="error" title={failed}>
          <p className="acc-lead">لم يتغيّر شيء.</p>
        </Notice>
      ) : null}
      {editing ? (
        <>
          <TextField
            kind="date"
            label="تاريخ السداد الموعود"
            mono
            value={date}
            min={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            error={attempted ? error : undefined}
            required
          />
          <TextField
            label="ملاحظة"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="acc-choice__note">
            تذكير لك لا يغيّر الرصيد. إن فات والدين باقٍ يصلك إشعار.
          </p>
          <div className="pty-actions">
            <Button loading={busy} onClick={() => void save(false)}>
              احفظ الموعد
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setEditing(false);
                setAttempted(false);
              }}
            >
              تراجع
            </Button>
          </div>
        </>
      ) : card.can_edit ? (
        <div className="pty-actions">
          <Button variant="quiet" onClick={() => setEditing(true)}>
            {set ? "غيّر الموعد" : "سجّل موعد سداد"}
          </Button>
          {set ? (
            <Button variant="quiet" loading={busy} onClick={() => void save(true)}>
              امسح الموعد
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
