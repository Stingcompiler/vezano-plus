import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { type Evidence, EvidenceCapture } from "@/components/market-discovery/evidence";
import { M, Marked, Note, Row, Stack, StatusWord } from "@/components/market-discovery/parts";
import type { Preview } from "@/features/market-discovery/lib";
import { MD_TEXTS } from "@/features/market-discovery/texts";
import { useSession } from "@/lib/session";

const T = "MP-15";
type State = "ready" | "validation_error" | "permission_denied" | "success";

interface Reason {
  code: string;
  label: string;
  hint: string;
  needs_evidence: boolean;
}
export interface Report {
  id: string;
  number: number;
  number_label: string;
  target_label: string;
  reason: string;
  reason_label: string;
  note: string;
  evidence_name: string;
  status: "under_review" | "actioned" | "closed";
  status_label: string;
  outcome: string;
  created_at: string;
  decided_at: string;
  may_happen: string[];
  wont_happen: string[];
  not_given: string[];
}
interface Payload {
  reports: Report[];
  reasons: Reason[];
}

const MAX_EVIDENCE = 2 * 1024 * 1024;
const tone = (r: Report) =>
  r.status === "under_review" ? "stale" : r.status === "actioned" ? "success" : "expired";

function Outcome({ r }: { r: Report }) {
  return (
    <>
      <AppText variant="secondary">
        {tx(T, "بلاغك رقمه")} <M>{r.number_label}</M>
      </AppText>
      <Note>
        {tx(
          T,
          "تتابع حالته من حسابك: «قيد المراجعة» ثم «أُجري إجراء» أو «أُغلق بلا إجراء» مع سبب. لا نتركك في صمت، ولا نُخبرك بتفاصيل دفاتر الطرف الآخر.",
        )}
      </Note>
      <StatusWord tone={tone(r)} label={r.status_label} />
      {r.outcome ? <Note>{r.outcome}</Note> : null}
      {r.reason === "impersonation" ? (
        <>
          <AppText variant="bodyStrong">{tx(T, "وصل بلاغك عن انتحال هوية")}</AppText>
          <Note>
            {tx(
              T,
              "بلّغتَ أن ملفاً في السوق يستخدم اسم منشأتك وشعارها. المراجعة عند مشرف السوق وأقصى إجراء هو تعليق النشر. للمنشأة المعلَّقة حق اعتراض موثق، والقرار ونتيجته يظهران لك بلا تفاصيل داخلية عنها.",
            )}
          </Note>
        </>
      ) : null}
      <Marked title={tx(T, "ما قد يحدث")} items={r.may_happen} mark={tx(T, "قد")} />
      <Marked title={tx(T, "ما لن يحدث")} items={r.wont_happen} mark={tx(T, "لا")} />
      <Marked title={tx(T, "ما لا نعطيك")} items={r.not_given} mark={tx(T, "لا")} />
    </>
  );
}

/**
 * MP-15 — بلاغ عن عرض أو انتحال (29-D22 ready/validation_error/success · 43-D35 permission_denied · 10-D6
 * success): سبب مصنّف ودليل ومسار متابعة. يخدم `/market/report` (نموذج بـ`?offer=`/`?supplier=`) و
 * `/market/reports` (بلاغاتي) و`/market/reports/{id}` (متابعة لصاحبه). الدليل من الكاميرا. خادمي فقط.
 */
export default function MarketReport() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const {
    id: reportId = "",
    offer = "",
    supplier = "",
  } = useLocalSearchParams<{ id?: string; offer?: string; supplier?: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<Evidence | null>(null);
  const [shoot, setShoot] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Report | null>(null);
  const [tracked, setTracked] = useState<Report | null>(null);
  const [denied, setDenied] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res, response } = await api.GET("/api/market/reports");
      const body = res as unknown as Payload | undefined;
      if (response.ok && body) setData(body);
    } catch {
      setOffline(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
    if (reportId) {
      void (async () => {
        try {
          const { data: res, response } = await api.GET("/api/market/reports/{report_id}", {
            params: { path: { report_id: reportId } },
          });
          if (response.status === 404) {
            setDenied(true);
            return;
          }
          const body = res as unknown as { report: Report } | undefined;
          if (response.ok && body) setTracked(body.report);
        } catch {
          setOffline(true);
        }
      })();
      return;
    }
    if (!offer && !supplier) return;
    void (async () => {
      try {
        const { data: res, response } = await api.GET("/api/market/share/preview", {
          params: { query: { offer, supplier } },
        });
        const body = res as unknown as { preview: Preview } | undefined;
        if (response.ok && body) setPreview(body.preview);
      } catch {
        setOffline(true);
      }
    })();
  }, [api, load, offer, supplier, reportId]);

  const selected = data?.reasons.find((r) => r.code === reason) ?? null;
  const evidenceMissing = Boolean(selected?.needs_evidence) && !(file && file.size <= MAX_EVIDENCE);
  const invalid = !selected || evidenceMissing;

  const submit = async () => {
    setAttempted(true);
    if (invalid || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { reason, note };
      if (offer) body.offer_id = offer;
      if (supplier) body.supplier_tenant_id = supplier;
      if (file && file.size <= MAX_EVIDENCE) {
        body.evidence_name = file.name;
        body.evidence_data_url = file.dataUrl;
      }
      const r = await api.POST("/api/market/reports", { body: body as never });
      const b = r.data as unknown as { report: Report } | undefined;
      if (r.response.ok && b) {
        setSent(b.report);
        await load();
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : sent
      ? "success"
      : attempted && invalid
        ? "validation_error"
        : "ready";
  const formMode = !reportId && !sent && Boolean(offer || supplier);

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "بلاغ عن عرض أو انتحال — سبب ودليل ومسار متابعة")}
    >
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "البلاغ ليس زرّ شكوى مجهولاً: سبب من قائمة محدَّدة، ودليل مرفوع، ورقم متابعة يرى المبلِّغ حالته. ولا يُعلَّق شيء بمجرّد البلاغ.",
        )}
      </AppText>
      {offline ? <StateView state="offline" title={MD_TEXTS.needsServer} /> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "متابعة البلاغ لصاحبه")}>
          <AppText variant="secondary">{tx(T, "رابط متابعة بلاغ فُتح من غير مقدِّمه.")}</AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "هوية المبلّغ محفوظة")}</AppText>{" "}
            {tx(T, "· المبلَّغ عنه لا يرى من بلّغ، وغير المقدِّم لا يرى البلاغ أصلاً.")}
          </AppText>
          <Button label={tx(T, "بلاغاتي")} onPress={() => router.replace("/market/reports")} />
        </StateView>
      ) : null}

      {state === "success" && sent ? (
        <StateView state="success" title={tx(T, "أُرسل")}>
          <Outcome r={sent} />
          <Button label={tx(T, "بلاغاتي")} onPress={() => router.replace("/market/reports")} />
        </StateView>
      ) : null}

      {tracked && !denied ? (
        <>
          <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "البلاغ")} <M>{tracked.number_label}</M> — {tracked.target_label}
          </AppText>
          <Outcome r={tracked} />
        </>
      ) : null}

      {formMode ? (
        <>
          <AppText variant="title" style={{ marginBottom: SPACE["1"] }}>
            {tx(T, "إبلاغ عن «")}
            {preview ? preview.title : "…"}»
          </AppText>
          {preview?.subtitle ? <Note>{preview.subtitle}</Note> : null}
          {data ? (
            <GroupedList title={tx(T, "سبب البلاغ — اختر واحداً")}>
              {data.reasons.map((r, i) => (
                <Pressable
                  key={r.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reason === r.code }}
                  onPress={() => setReason(r.code)}
                >
                  <Row
                    title={r.label}
                    sub={r.hint}
                    trailing={
                      <AppText style={{ color: reason === r.code ? c.brandPrimary : c.inkFaint }}>
                        {reason === r.code ? "●" : "○"}
                      </AppText>
                    }
                    last={i === data.reasons.length - 1}
                  />
                </Pressable>
              ))}
            </GroupedList>
          ) : null}
          {attempted && !selected ? (
            <AppText variant="note" style={{ color: c.danger, marginBottom: SPACE["3"] }}>
              {tx(T, "اختر سبباً من القائمة")}
            </AppText>
          ) : null}

          <AppText variant="bodyStrong">{tx(T, "الدليل")}</AppText>
          <Note>{tx(T, "صورة أو مستند حتى 2 MB · يراه مراجع السوق وحده")}</Note>
          {file ? (
            <View style={{ marginBottom: SPACE["3"], gap: SPACE["2"] }}>
              <StatusWord
                tone={file.size > MAX_EVIDENCE ? "expired" : "success"}
                label={file.size > MAX_EVIDENCE ? tx(T, "أكبر من 2 MB") : MD_TEXTS.attached}
              />
              <Button label={MD_TEXTS.retake} variant="quiet" onPress={() => setFile(null)} />
            </View>
          ) : (
            <Stack>
              <Button label={MD_TEXTS.shoot} variant="secondary" onPress={() => setShoot(true)} />
            </Stack>
          )}
          {attempted && evidenceMissing ? (
            <AppText variant="note" style={{ color: c.danger, marginBottom: SPACE["3"] }}>
              {tx(T, "بلاغ «انتحال» بلا دليل مرفوع لا يُرسل")}
            </AppText>
          ) : null}

          <TextField label={tx(T, "ملاحظة (اختيارية)")} value={note} onChangeText={setNote} />
          {state === "validation_error" ? (
            <StateView state="validation_error" title={tx(T, "لا يُرسل بلا سبب ودليل")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "بلاغ «انتحال» بلا دليل مرفوع لا يُرسل. الانتحال اتهام ثقيل يُعلَّق به نشر منشأة، فنطلب ما يسنده — وسبب «سعر لا يعجبني» ليس في القائمة أصلاً.",
                )}
              </AppText>
            </StateView>
          ) : null}
          <Note>
            <AppText variant="bodyStrong">{tx(T, "البلاغ لا يُعلّق شيئاً بنفسه")}</AppText>{" "}
            {tx(T, "· التعليق قرار مراجِع بشري عند مشرف السوق.")}
          </Note>
          <Button
            label={tx(T, "أرسل البلاغ")}
            financial
            loading={busy}
            onPress={() => void submit()}
          />
          <EvidenceCapture open={shoot} onClose={() => setShoot(false)} onCapture={setFile} />
        </>
      ) : null}

      {!reportId && !sent && !offer && !supplier && data ? (
        <GroupedList title={tx(T, "بلاغاتي")}>
          {data.reports.length ? (
            data.reports.map((r, i) => (
              <Row
                key={r.id}
                title={
                  <>
                    <M>{r.number_label}</M> · {r.target_label}
                  </>
                }
                sub={r.reason_label}
                trailing={<StatusWord tone={tone(r)} label={r.status_label} />}
                onPress={() => router.push(`/market/reports/${r.id}`)}
                last={i === data.reports.length - 1}
              />
            ))
          ) : (
            <Row title={tx(T, "لا بلاغات بعد — يبدأ البلاغ من صفحة العرض أو ملف المنشأة.")} last />
          )}
        </GroupedList>
      ) : null}
    </Screen>
  );
}
