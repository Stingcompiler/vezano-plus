import { hhmm } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { Lead, M, Note, Row, Stack, StateWord, SwitchRow } from "@/components/market-seller/parts";
import { FetchFail } from "@/components/market-seller/fetch-fail";
import { netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "MP-08";

interface Item {
  key: "identity" | "service_area" | "terms" | "registry_doc";
  title: string;
  hint: string;
  done: boolean;
  reason: string;
}

export interface Account {
  shop_name: string;
  role: string;
  verification: "none" | "draft" | "pending" | "needs_more" | "verified" | "rejected";
  verification_label: string;
  checklist: Item[];
  done: number;
  total: number;
  submitted_at: string;
  days_since_submitted: number | null;
  usual_review_days: number;
  review_reasons: Record<string, string>;
  badge_limits: string;
  can_submit: boolean;
  registry_doc_name: string;
}

/** «اليوم/يوم/يومين/N أيام/N يوماً» — الرقم mono والكلمة نص. */
function DaysWord({ n }: { n: number }) {
  if (n === 0) return <>{tx(T, "اليوم")}</>;
  if (n === 1) return <>{tx(T, "يوم")}</>;
  if (n === 2) return <>{tx(T, "يومين")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "أيام") : tx(T, "يوماً")}
    </>
  );
}

const wasYesterday = (iso: string) => {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString();
};

/** MP-08 — تهيئة بائع وتحقق الهوية (08-D4 ready/permission_denied · 43-D35 loading/validation_error/success). */
export default function SellerScreen() {
  const router = useRouter();
  const { api } = useSession();
  const srv = useServerGet<Account>("cache.market.seller", () =>
    safeGet(
      () => api.GET("/api/market/account"),
      (b) => (b as { account?: Account } | undefined)?.account,
    ),
  );
  const [acc, setAcc] = useState<Account | null>(null);
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [offlineTry, setOfflineTry] = useState(false);

  const apply = (a: Account, prefill: boolean) => {
    setAcc(a);
    if (!prefill) return;
    const sa = a.checklist.find((i) => i.key === "service_area");
    if (sa?.done && sa.hint.includes(" · ")) {
      const [x, y] = sa.hint.split(" · ");
      setAddress((cur) => cur || (x ?? ""));
      setArea((cur) => cur || (y ?? ""));
    }
    setTerms(a.checklist.find((i) => i.key === "terms")?.done ?? false);
  };
  useEffect(() => {
    if (srv.data) apply(srv.data, true);
  }, [srv.data]);

  const view = acc ?? srv.shown;

  const save = async (): Promise<boolean> => {
    const r = await send<{ account?: Account }>(() =>
      api.PUT("/api/market/account", {
        body: {
          business_address: address,
          service_area_note: area,
          accept_terms: terms,
        } as never,
      }),
    );
    if (r.kind === "offline") {
      setOfflineTry(true);
      return false;
    }
    if (r.kind === "ok" && r.body.account) apply(r.body.account, false);
    return r.kind === "ok";
  };

  const run = async (submit: boolean) => {
    if (busy) return;
    setBusy(true);
    setOfflineTry(false);
    if (submit) setAttempted(true);
    try {
      if (!(await save()) || !submit) return;
      const r = await send<{ account?: Account }>(() =>
        api.POST("/api/market/account/verification/submit"),
      );
      if (r.kind === "offline") setOfflineTry(true);
      else if (r.kind === "ok" && r.body.account) apply(r.body.account, false);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    try {
      await srv.reload();
    } finally {
      setBusy(false);
    }
  };

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode = !view
    ? (net ?? "ready")
    : view.verification === "verified"
      ? "success"
      : view.verification === "needs_more" || (attempted && view.done < view.total)
        ? "validation_error"
        : view.verification === "pending"
          ? "loading"
          : !view.can_submit
            ? "permission_denied"
            : (net ?? "ready");
  const missing = view ? view.checklist.filter((i) => !i.done) : [];
  const verStateFor = (v: Account["verification"]): StateCode =>
    v === "verified"
      ? "success"
      : v === "pending"
        ? "pending_sync"
        : v === "needs_more"
          ? "validation_error"
          : "ready";

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "تفعيل دور البائع — طلب تحقق قبل أول نشر")}
      onRefresh={() => void srv.reload()}
    >
      <Lead>
        {view?.shop_name ?? ""}{" "}
        {tx(
          T,
          "تريد النشر في السوق. حسابك يبقى واحداً ودفترك واحداً. ما يُضاف هو دور بائع بعد تحقق منفصل يراجعه مشرف السوق.",
        )}
      </Lead>

      <FetchFail net={net} hasData={Boolean(view)} onRetry={() => void srv.reload()} />
      {net && view ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {view ? (
        <>
          <AppText variant="bodyStrong">
            {tx(T, "طلب تحقق البائع —")} <M>{view.done}</M> {tx(T, "من")} <M>{view.total}</M>{" "}
            {tx(T, "مكتملة")}
          </AppText>
          <StateWord
            state={verStateFor(view.verification)}
            label={
              view.verification === "pending" ? tx(T, "بانتظار المراجعة") : view.verification_label
            }
          />
          {view.submitted_at ? (
            <Note>
              {tx(T, "قُدِّم")}{" "}
              {wasYesterday(view.submitted_at) ? (
                tx(T, "أمس")
              ) : (view.days_since_submitted ?? 0) === 0 ? (
                tx(T, "اليوم")
              ) : (
                <>
                  {tx(T, "قبل")} <DaysWord n={view.days_since_submitted ?? 0} />
                </>
              )}{" "}
              <M>{hhmm(view.submitted_at)}</M>{" "}
              {tx(T, "· متوسط المراجعة يوم عمل واحد · لا نشر قبل الاعتماد")}
            </Note>
          ) : null}
        </>
      ) : null}

      {state === "loading" && view ? (
        <StateView state="loading" title={tx(T, "قيد مراجعة المشرف")}>
          <AppText variant="secondary">{tx(T, "الطلب مرفوع وأدلته عند مشرف السوق.")}</AppText>
          <AppText variant="note" muted>
            {tx(T, "«قيد المراجعة منذ")} <DaysWord n={view.days_since_submitted ?? 0} />{" "}
            {tx(T, "— المدة المعتادة")} <M>{view.usual_review_days}</M> {tx(T, "أيام».")}
          </AppText>
          <Button
            label={tx(T, "تحقّق من الحالة")}
            variant="secondary"
            loading={busy}
            onPress={() => void check()}
          />
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "أدلة ناقصة")}>
          <AppText variant="secondary">
            {tx(T, "سجل تجاري غير مقروء أو نشاط لا يطابق الفئة المطلوبة.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" ? (
        <StateView state="success" title={tx(T, "فُعِّل دور البائع")}>
          <AppText variant="secondary">
            {tx(T, "الترقية من مشترٍ إلى بائع على الحساب نفسه.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "التفعيل لا ينشر")}</AppText>{" "}
            {tx(T, "· لا ملف عام ولا عرض ولا صنف يُنشر تلقائياً.")}
          </AppText>
          <Button label={tx(T, "صفحة المنشأة")} onPress={() => router.push("/market/profile")} />
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "طلب التحقق للمالك")}>
          <AppText variant="secondary">
            {tx(
              T,
              "هوية المنشأة ومسؤوليتها في السوق تمثّل المنشأة كلها — يقدّمها المالك ويوقّع شروط البائع.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {view ? (
        <GroupedList>
          {view.checklist.map((i, idx) => (
            <Row
              key={i.key}
              title={i.title}
              sub={
                <>
                  {i.hint}
                  {i.reason ? `\n${i.reason}` : ""}
                  {attempted && !i.done && !i.reason
                    ? `\n${tx(T, "ناقص — أكمله قبل التقديم")}`
                    : ""}
                </>
              }
              trailing={
                <StateWord
                  state={i.done ? "success" : "validation_error"}
                  label={i.done ? tx(T, "مكتمل") : tx(T, "مطلوب")}
                />
              }
              last={idx === view.checklist.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}

      {view && view.can_submit && state !== "success" && state !== "loading" ? (
        <>
          <TextField
            label={tx(T, "عنوان النشاط")}
            value={address}
            onChangeText={setAddress}
            hint={tx(T, "المنطقة والحيّ — يراجعه المشرف ولا يُنشر")}
          />
          <TextField
            label={tx(T, "منطقة الخدمة وطريقة الاستلام")}
            value={area}
            onChangeText={setArea}
            hint={tx(T, "مثال: استلام من المخزن وتوصيل داخل المنطقة")}
          />
          <SwitchRow
            label={tx(T, "أوافق على شروط البائع")}
            hint={tx(T, "مسؤولية الوصف والسعر والتسليم على المنشأة لا على فيزانو بلص")}
            value={terms}
            onChange={setTerms}
          />
          <Note strong>{tx(T, "مستند السجل التجاري")}</Note>
          <Note>
            {view.registry_doc_name
              ? `${view.registry_doc_name} — ${tx(T, "محفوظ")}`
              : MS_TEXTS.noUpload}
          </Note>
          <Note>{tx(T, "صورة واضحة حتى 2 MB · يراجعها مشرف السوق ولا تُنشر في ملفك العام")}</Note>
          <Stack>
            <Button
              label={
                view.verification === "needs_more" ? tx(T, "أعد التقديم") : tx(T, "قدّم طلب التحقق")
              }
              financial
              loading={busy}
              onPress={() => void run(true)}
            />
            <Button
              label={tx(T, "احفظ ما اكتمل")}
              variant="secondary"
              loading={busy}
              onPress={() => void run(false)}
            />
          </Stack>
          {attempted && missing.length ? (
            <Note>
              {tx(T, "ناقص:")} {missing.map((m) => m.title).join(tx(T, "،") + " ")}.
            </Note>
          ) : null}
        </>
      ) : null}

      <Note>
        <AppText variant="bodyStrong">{tx(T, "حدود الشارة")}</AppText> · {view?.badge_limits ?? ""}{" "}
        {tx(T, "هذا النص يظهر حرفياً في ملف منشأتك المنشور بجوار الشارة.")}
      </Note>
      <Note>
        {tx(
          T,
          "مورّد سجّلته في دفترك المحلي لا يحصل على ملف عام في السوق ولا يُدعى إليه. سجلّك الخاص ليس إعلاناً عن غيرك.",
        )}
      </Note>
    </Screen>
  );
}
