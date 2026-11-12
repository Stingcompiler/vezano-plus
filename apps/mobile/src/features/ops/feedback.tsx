import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Card,
  Chip,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";

import { DayLabel, N } from "@/components/ops/ui";
import { call, detailOf } from "@/features/ops/net";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/**
 * «ملاحظاتك» في SYS-11 على الجوال (نظير `apps/web/src/features/sys/feedback-section.tsx`، 0005 §٢٦٤):
 * أي دور يرسل اقتراحاً أو مشكلة أو رأياً إلى فريق فيزانو ويرى في «ملاحظاتي» الحالة وردّ الفريق. بلا
 * اتصال تُحفظ على الجهاز وتُرسل عند العودة إلى التطبيق. النصوص نصوص الويب نفسها (المفتاح المشترك).
 */
const K = "shared:features/sys/feedback-section.tsx";
const KK = "shared:features/sys/feedback.ts";
const OUTBOX = "feedback.outbox";
const TEXT_MAX = 1000;

const KINDS = [
  { value: "suggestion", label: tx(KK, "اقتراح") },
  { value: "problem", label: tx(KK, "مشكلة") },
  { value: "opinion", label: tx(KK, "رأي") },
] as const;

interface Draft {
  readonly client_id: string;
  readonly kind: string;
  readonly text: string;
  readonly contact_ok: boolean;
  readonly screen: string;
  readonly platform: string;
  readonly app_version: string;
  readonly created_at: string;
  /** 0005 §٢٦٧: اللقطة من الويب والحاسوب فقط — الجوال يرسلها فارغة. */
  readonly attachment: string;
  readonly attachment_name: string;
}

interface Row {
  readonly id: string;
  readonly reference: string;
  readonly kind_label: string;
  readonly text: string;
  readonly status: "new" | "studying" | "done" | "declined";
  readonly status_label: string;
  readonly reply: string;
  readonly created_at: string;
  readonly unseen: boolean;
}

const ERRORS: Record<string, string> = {
  text_required: tx(K, "اكتب ملاحظتك أولاً."),
  text_too_long: tx(K, "النص أطول من 1000 حرف."),
  rate_limited: tx(K, "بلغت حدّ الملاحظات اليوم — جرّب غداً."),
  kind_invalid: tx(K, "اختر نوع الملاحظة."),
};

async function readOutbox(): Promise<Draft[]> {
  const s = await getStorage();
  const raw = await s.read((t) => t.getMeta(OUTBOX));
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as Draft[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: readonly Draft[]): Promise<void> {
  const s = await getStorage();
  await s.transaction((t) => t.putMeta(OUTBOX, JSON.stringify(items)));
}

export function FeedbackSection() {
  const { api } = useSession();
  const c = useColors();
  const [kind, setKind] = useState("suggestion");
  const [text, setText] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Row | null>(null);
  const [savedLocal, setSavedLocal] = useState(false);
  const [items, setItems] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Draft[]>([]);
  const flushing = useRef(false);

  const send = useCallback(
    (d: Draft) => call<Row>(() => api.POST("/api/support/feedback", { body: d })),
    [api],
  );

  const load = useCallback(async () => {
    const r = await call<{ items: Row[]; unseen: number }>(() => api.GET("/api/support/feedback"));
    if (!r.ok || !r.data) {
      setItems((prev) => prev ?? []);
      return;
    }
    setItems(r.data.items);
    if (r.data.unseen > 0) void call(() => api.POST("/api/support/feedback/seen"));
  }, [api]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const queue = await readOutbox();
      const keep: Draft[] = [];
      let delivered = false;
      for (const d of queue) {
        const r = await send(d);
        if (r.ok) delivered = true;
        else if (r.offline || r.status >= 500) keep.push(d);
      }
      if (keep.length !== queue.length) await writeOutbox(keep);
      setPending(keep);
      if (delivered) await load();
    } finally {
      flushing.current = false;
    }
  }, [send, load]);

  useEffect(() => {
    void (async () => {
      setPending(await readOutbox());
      await load();
      await flush();
    })();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void flush();
    });
    return () => sub.remove();
  }, [load, flush]);

  const submit = async () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) return setError(ERRORS.text_required ?? null);
    if (trimmed.length > TEXT_MAX) return setError(ERRORS.text_too_long ?? null);
    setBusy(true);
    setError(null);
    setSent(null);
    setSavedLocal(false);
    const draft: Draft = {
      client_id: crypto.randomUUID(),
      kind,
      text: trimmed,
      contact_ok: contactOk,
      screen: "SYS-11",
      platform: "mobile",
      app_version: Constants.expoConfig?.version ?? "dev",
      created_at: new Date().toISOString(),
      attachment: "",
      attachment_name: "",
    };
    try {
      const r = await send(draft);
      if (r.ok && r.data) {
        setSent(r.data);
        setText("");
        await load();
        return;
      }
      if (r.offline || r.status >= 500) {
        const queue = [...(await readOutbox()), draft];
        await writeOutbox(queue);
        setPending(queue);
        setSavedLocal(true);
        setText("");
        return;
      }
      setError(ERRORS[detailOf(r.error)] ?? tx(K, "لم تُقبل الملاحظة — راجع النص وأعد الإرسال."));
    } finally {
      setBusy(false);
    }
  };

  const empty = items !== null && items.length + pending.length === 0;

  return (
    <Card
      title={tx(K, "ملاحظاتك")}
      lead={tx(K, "اقتراح أو مشكلة أو رأي — تصل إلى فريق فيزانو مباشرة.")}
    >
      {sent ? (
        <StateView state="success" title={tx(K, "وصلت ملاحظتك")}>
          <AppText variant="secondary">
            {tx(K, "المرجع:")} <N>{sent.reference}</N>{" "}
            {tx(K, "· ستجد ردّ الفريق هنا في «ملاحظاتي».")}
          </AppText>
        </StateView>
      ) : null}
      {savedLocal ? (
        <StateView
          state="saved_local"
          title={tx(K, "حُفظت الملاحظة على الجهاز — تُرسل عند عودة الاتصال")}
        />
      ) : null}
      <AppText variant="section">{tx(K, "نوع الملاحظة")}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE["2"] }}>
        {KINDS.map((k) => (
          <Chip
            key={k.value}
            label={k.label}
            on={kind === k.value}
            onPress={() => setKind(k.value)}
          />
        ))}
      </View>
      <TextField
        label={tx(K, "ملاحظتك")}
        hint={tx(K, "لا تكتب أسماء زبائنك أو أرقامهم — أي رقم هاتف يُخفى تلقائياً.")}
        error={error ?? undefined}
        value={text}
        maxLength={TEXT_MAX}
        multiline
        onChangeText={(v) => {
          setText(v);
          if (error) setError(null);
        }}
      />
      <Chip
        label={tx(K, "يمكن للفريق التواصل معي")}
        on={contactOk}
        onPress={() => setContactOk((v) => !v)}
      />
      <Button label={tx(K, "أرسل الملاحظة")} loading={busy} onPress={() => void submit()} />

      <AppText variant="bodyStrong" style={{ marginTop: SPACE["2"] }}>
        {tx(K, "ملاحظاتي")}
      </AppText>
      {items === null ? <StateView state="loading" title={tx(K, "ملاحظاتي")} /> : null}
      {empty ? (
        <StateView state="empty" title={tx(K, "لا ملاحظات بعد")}>
          <AppText variant="secondary">{tx(K, "ما ترسله يظهر هنا مع حالته وردّ الفريق.")}</AppText>
        </StateView>
      ) : null}
      {pending.map((d) => (
        <View key={d.client_id} style={{ gap: SPACE["1"] }}>
          <AppText variant="note" muted>
            {tx(K, "بانتظار الإرسال")} · <DayLabel iso={d.created_at} />
          </AppText>
          <AppText>{d.text}</AppText>
        </View>
      ))}
      {(items ?? []).map((f) => (
        <View
          key={f.id}
          style={{
            gap: SPACE["1"],
            paddingTop: SPACE["2"],
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          <AppText variant="note" muted>
            {f.kind_label} · {f.status_label}
            {f.unseen ? ` · ${tx(K, "ردّ جديد")}` : ""} · <N>{f.reference}</N> ·{" "}
            <DayLabel iso={f.created_at} />
          </AppText>
          <AppText>{f.text}</AppText>
          {f.reply ? (
            <View
              style={{
                padding: SPACE["2"],
                borderRadius: 14,
                borderTopStartRadius: 4,
                backgroundColor: c.surfaceSunken,
                gap: 2,
              }}
            >
              <AppText variant="note" muted>
                {tx(K, "ردّ فريق فيزانو")}
              </AppText>
              <AppText variant="secondary">{f.reply}</AppText>
            </View>
          ) : null}
        </View>
      ))}
    </Card>
  );
}
