import { dayMonth, formatMinor, formatMinorShort, hhmm } from "@sting/app-core";
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
import * as Print from "expo-print";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Share, Text, View } from "react-native";

import { M, PRow, Segments, Stack, SwitchRow } from "@/components/parties/parts";
import { absoluteUrl } from "@/features/parties/lib";
import { PARTY_TEXTS } from "@/features/parties/texts";
import { useSession } from "@/lib/session";
import { WEB_URL } from "@/lib/web";

const T = "PTY-08";
type State = "ready" | "loading" | "permission_denied" | "success" | "server_error";
type Range = "30" | "all";
type Kind = "pdf" | "link";

interface Row {
  readonly doc: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly business_date: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
  readonly branch_id: string;
  readonly info: boolean;
}

interface Statement {
  readonly party: { readonly id: string; readonly name: string };
  readonly rows: readonly Row[];
  readonly balance_minor: string;
  readonly hidden_other_branch: number;
  readonly as_of: string;
  readonly scope: "all" | "branch";
  readonly branch_names: Record<string, string>;
  readonly tenant_name: string;
}

interface Export {
  readonly id: string;
  readonly kind: Kind;
  readonly file_name: string;
  readonly page_count: number;
  /** مسار نسبي من الخادم (`/api/parties/exports/<token>`) — يُبنى مطلقاً قبل المشاركة */
  readonly url: string;
  readonly generated_at: string;
  readonly opened_at: string;
  readonly open_count: number;
}

/** سطور الصفحة A4 المتوقَّعة — لعدّ الصفحات قبل التوليد (كما الخادم). */
const ROWS_PER_PAGE = 40;

/** عنوان الخادم المطلق لروابط التصدير: EXPO_PUBLIC_API_URL ثم عنوان الويب. */
function apiBase(): string {
  return process.env.EXPO_PUBLIC_API_URL || WEB_URL;
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/**
 * PTY-08 — طباعة وتصدير ومشاركة الكشف (خطة الجوال M3). معاينة الحقول والجمهور قبل المشاركة؛ الطباعة
 * للحاضر من الشاشة (NAT-02)، والملف والرابط المخوَّل للمالك؛ لا وعد بالتسليم — «أُرسل» ليست «وصل»؛
 * قالب تذكير الدين يدوي يراجعه المالك ويرسله بنفسه. رابط المشاركة مطلق: الخادم يعيد مساراً نسبياً
 * فيُبنى بـ`new URL(path, base)` ثم نسخ (نص قابل للتحديد) وواتساب (wa.me) والمشاركة الأصلية.
 */
export default function ShareScreen() {
  const router = useRouter();
  const c = useColors();
  const { id: partyId, range: rangeParam } = useLocalSearchParams<{ id: string; range?: string }>();
  const { api } = useSession();
  const [stmt, setStmt] = useState<Statement | null | undefined>(undefined);
  const [rng, setRng] = useState<Range>(rangeParam === "all" ? "all" : "30");
  const [movements, setMovements] = useState(true);
  const [invoices, setInvoices] = useState(false);
  const [branches, setBranches] = useState(false);
  const [phase, setPhase] = useState<"idle" | "generating" | "done" | "failed">("idle");
  const [kind, setKind] = useState<Kind>("pdf");
  const [exp, setExp] = useState<Export | null>(null);
  const [denied, setDenied] = useState(false);
  const [failReason, setFailReason] = useState<"too_long" | "server">("server");
  const [reminder, setReminder] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/parties/{party_id}/statement", {
          params: { path: { party_id: partyId }, query: { range: rng } },
        });
        if (!live) return;
        if (response.status === 403) {
          setDenied(true);
          setStmt(null);
          return;
        }
        const body = data as unknown as Statement | undefined;
        setStmt(!response.ok || !body ? null : body);
      } catch {
        if (live) setStmt(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, partyId, rng]);

  useEffect(() => {
    if (stmt === null && !denied)
      router.replace({ pathname: "/parties/[id]/statement", params: { id: partyId } });
  }, [stmt, denied, router, partyId]);

  // قالب التذكير يُملأ من الكشف مرة واحدة ثم يبقى ملكاً للمالك يعدّله ويرسله بنفسه
  useEffect(() => {
    if (!stmt || reminder) return;
    const d = dayMonth(stmt.as_of);
    setReminder(
      `${stmt.party.name}${tx(T, "، رصيدكم المستحق لدى")} ${stmt.tenant_name} ${tx(T, "حتى")} ${d.day} ${d.month}: ${formatMinor(
        stmt.balance_minor,
      )}${tx(T, ". الإرسال للزبون يحمل ختم وقته وما ينقصه إن كان هناك معلّق.")}`,
    );
  }, [stmt, reminder]);

  const isOwner = stmt?.scope === "all";
  const rows = stmt?.rows ?? [];
  const shown = movements ? rows : [];
  const expectedPages = Math.max(1, Math.ceil(shown.length / ROWS_PER_PAGE));
  const asOf = stmt ? dayMonth(stmt.as_of) : null;

  const state: State = denied
    ? "permission_denied"
    : stmt === undefined || phase === "generating"
      ? "loading"
      : phase === "done" && exp
        ? "success"
        : phase === "failed"
          ? "server_error"
          : "ready";

  const generate = async (k: Kind) => {
    if (!stmt || phase === "generating") return;
    setKind(k);
    setPhase("generating");
    try {
      const { data, error, response } = await api.POST("/api/parties/{party_id}/statement/export", {
        params: { path: { party_id: stmt.party.id } },
        body: { kind: k, range: rng, include_invoices: invoices, include_branch: branches },
      });
      if (response.status === 403) {
        setDenied(true);
        setPhase("idle");
        return;
      }
      if (response.status === 400) {
        const code = (error as { errors?: { code: string }[] } | undefined)?.errors?.[0]?.code;
        setFailReason(code === "too_long" ? "too_long" : "server");
        setPhase("failed");
        return;
      }
      const body = data as unknown as { export: Export } | undefined;
      if (!response.ok || !body) {
        setFailReason("server");
        setPhase("failed");
        return;
      }
      setExp(body.export);
      setPhase("done");
    } catch {
      setFailReason("server");
      setPhase("failed");
    }
  };

  const refreshStatus = async () => {
    if (!exp) return;
    try {
      const { data, response } = await api.GET("/api/parties/statement-exports/{export_id}", {
        params: { path: { export_id: exp.id } },
      });
      const body = data as unknown as { export: Export } | undefined;
      if (response.ok && body) setExp(body.export);
    } catch {
      /* بلا شبكة: تبقى الحالة السابقة */
    }
  };

  const link = exp ? absoluteUrl(exp.url, apiBase()) : "";
  const whatsapp = () =>
    void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(link)}`).catch(() => undefined);
  const nativeShare = () => void Share.share({ message: link }).catch(() => undefined);
  const openFile = () => void Linking.openURL(link).catch(() => undefined);
  // قالب التذكير يُرسل بنفسك: ورقة المشاركة الأصلية فيها النسخ وواتساب
  const shareReminder = () => void Share.share({ message: reminder }).catch(() => undefined);

  const print = () => {
    if (!stmt) return;
    const body = shown
      .map((r) => {
        const d = dayMonth(r.business_date || r.occurred_at);
        return `<tr><td dir="ltr">${d.day} ${esc(d.month)}</td><td>${esc(r.label)}</td>${
          invoices ? `<td dir="ltr">${esc(r.doc)}</td>` : ""
        }${branches ? `<td>${esc(stmt.branch_names[r.branch_id] ?? tx(T, "الرئيسي"))}</td>` : ""}<td dir="ltr">${
          r.debit_minor ? formatMinor(r.debit_minor) : "—"
        }</td><td dir="ltr">${r.credit_minor ? formatMinor(r.credit_minor) : "—"}</td><td dir="ltr">${formatMinor(
          r.balance_minor,
        )}</td></tr>`;
      })
      .join("");
    const html = `<html dir="rtl" lang="ar"><body style="font-family:-apple-system,Roboto,sans-serif;padding:16px">
<h2>${esc(stmt.tenant_name)}</h2>
<p>${esc(tx(T, "كشف حساب:"))} ${esc(stmt.party.name)} ${esc(tx(T, "· حتى"))} ${asOf?.day ?? ""} ${esc(asOf?.month ?? "")}</p>
<p>${esc(tx(T, "وُلِّد"))} ${hhmm(new Date().toISOString())}</p>
<table style="width:100%;border-collapse:collapse" border="1" cellpadding="4">${body}</table>
<h3>${esc(tx(T, "الرصيد المستحق"))} <span dir="ltr">${formatMinor(stmt.balance_minor)}</span></h3>
</body></html>`;
    void Print.printAsync({ html }).catch(() => undefined);
  };

  const back = () => router.push({ pathname: "/parties/[id]/statement", params: { id: partyId } });

  return (
    <Screen
      screenId={T}
      state={state}
      title={stmt ? `${tx(T, "مشاركة كشف حساب")} ${stmt.party.name}` : tx(T, "مشاركة كشف حساب")}
    >
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "المشاركة الخارجية للمالك")}>
          <AppText variant="secondary">
            {tx(T, "الكاشير يطبع نسخةً للطرف الحاضر، ولا يرسل الكشف برابط خارجي.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جارٍ التوليد")}>
          {stmt ? (
            <AppText variant="note">
              {tx(T, "الصفحات المتوقَّعة")} <M>{expectedPages}</M> {tx(T, "· المدى")}{" "}
              {kind === "pdf" ? tx(T, "تصدير PDF") : tx(T, "مشاركة رابط")}
            </AppText>
          ) : null}
        </StateView>
      ) : null}

      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "فشل التوليد")}>
          <AppText variant="secondary">{tx(T, "الكشف طويل أو الخادم تعثّر.")}</AppText>
          <AppText variant="note">
            {tx(T, "البديل")} {tx(T, "· مدى أقصر، أو طباعة مباشرة من الشاشة بلا توليد ملف.")}
          </AppText>
          {failReason === "too_long" || rng === "all" ? (
            <Button
              label={tx(T, "مدى أقصر")}
              variant="secondary"
              onPress={() => {
                setRng("30");
                setPhase("idle");
              }}
              disabledReason={rng === "30" ? tx(T, "المدى الأقصر معروض") : undefined}
            />
          ) : null}
          <Button label={tx(T, "طباعة")} onPress={print} />
          <Button label={tx(T, "إلغاء")} variant="quiet" onPress={() => setPhase("idle")} />
        </StateView>
      ) : null}

      {state === "success" && exp ? (
        <>
          <StateView state="success" title={tx(T, "جاهز")}>
            <AppText variant="secondary">
              {tx(
                T,
                "الملف بمداه في اسمه، ومعه وقت توليده — والكشف المطبوع يحمل الوقت في ترويسته.",
              )}
            </AppText>
            <AppText variant="note">
              <Text style={{ writingDirection: "ltr" }}>{exp.file_name}</Text> ·{" "}
              <M>{exp.page_count}</M> {exp.page_count === 1 ? tx(T, "صفحة") : tx(T, "صفحات")}{" "}
              {tx(T, "· وُلِّد")} <M>{hhmm(exp.generated_at)}</M>
            </AppText>
          </StateView>
          <StateView state="stale" title={tx(T, "لا وعد تسليم")}>
            <AppText variant="secondary">
              {tx(T, "المشاركة تُنشئ رابطاً ولا تَعِد بأن الطرف قرأه. «أُرسل» ليست «وصل».")}
            </AppText>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: SPACE["3"] }}>
              <AppText
                style={{ color: exp.opened_at ? c.state.synced.fg : c.state.pending_sync.fg }}
              >
                {exp.opened_at ? (
                  <>
                    {tx(T, "تم الاطلاع")} <M>{hhmm(exp.opened_at)}</M>
                  </>
                ) : (
                  tx(T, "لم يُفتح بعد")
                )}
              </AppText>
              <Button
                label={tx(T, "تحديث الحالة")}
                variant="quiet"
                onPress={() => void refreshStatus()}
              />
            </View>
          </StateView>
          <AppText variant="note" muted style={{ marginBottom: SPACE["1"] }}>
            {tx(T, "نسخ الرابط")}
          </AppText>
          <Text
            selectable
            accessibilityLabel={tx(T, "نسخ الرابط")}
            style={{
              writingDirection: "ltr",
              textAlign: "left",
              color: c.inkStrong,
              marginBottom: SPACE["3"],
            }}
          >
            {link}
          </Text>
          <Stack>
            <Button label={PARTY_TEXTS.whatsapp} financial onPress={whatsapp} />
            <Button label={tx(T, "مشاركة رابط")} variant="secondary" onPress={nativeShare} />
            {exp.kind === "pdf" ? (
              <Button label={tx(T, "تصدير PDF")} variant="secondary" onPress={openFile} />
            ) : null}
            <Button label={tx(T, "إلغاء")} variant="quiet" onPress={() => setPhase("idle")} />
          </Stack>
        </>
      ) : null}

      {stmt && asOf && state !== "permission_denied" ? (
        <>
          {state === "ready" ? (
            <>
              <AppText variant="section" muted style={{ marginBottom: SPACE["2"] }}>
                {tx(T, "ما سيراه المستلم")}
              </AppText>
              <SwitchRow
                label={tx(T, "الحركات والأرصدة")}
                value={movements}
                onChange={setMovements}
              />
              <SwitchRow
                label={tx(T, "أرقام الفواتير التفصيلية")}
                value={invoices}
                onChange={setInvoices}
              />
              <SwitchRow
                label={tx(T, "اسم الفرع لكل حركة")}
                value={branches}
                onChange={setBranches}
              />
              <Segments
                value={rng}
                onChange={setRng}
                options={[
                  ["30", tx("PTY-05", "آخر 30 يوماً")],
                  ["all", tx("PTY-05", "كل الحركات")],
                ]}
              />
            </>
          ) : null}

          <AppText variant="section" muted style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "معاينة المستند")}
          </AppText>
          <AppText variant="bodyStrong">{stmt.tenant_name}</AppText>
          <AppText variant="note" muted>
            {tx(T, "كشف حساب:")} {stmt.party.name} {tx(T, "· حتى")} <M>{asOf.day}</M> {asOf.month}
          </AppText>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "وُلِّد")} <M>{hhmm(new Date().toISOString())}</M> {tx(T, "· المدى")}{" "}
            {rng === "all" ? tx(T, "كامل") : <M>30</M>}
          </AppText>
          {shown.length ? (
            <GroupedList>
              {shown.map((r, i) => {
                const d = dayMonth(r.business_date || r.occurred_at);
                return (
                  <PRow
                    key={r.doc_id}
                    title={r.label}
                    sub={
                      <>
                        <M>{d.day}</M> {d.month}
                        {invoices ? (
                          <>
                            {" · "}
                            <M>{r.doc}</M>
                          </>
                        ) : null}
                        {branches ? (
                          <>{` · ${stmt.branch_names[r.branch_id] ?? tx(T, "الرئيسي")}`}</>
                        ) : null}
                      </>
                    }
                    trailing={
                      <View style={{ alignItems: "flex-end" }}>
                        <AppText variant="note" muted>
                          {r.debit_minor ? tx(T, "عليه") : tx(T, "له")}{" "}
                          <M>{formatMinorShort(r.debit_minor || r.credit_minor || "0")}</M>
                        </AppText>
                        <AppText variant="note" muted>
                          {tx(T, "الرصيد")} <M>{formatMinorShort(r.balance_minor)}</M>
                        </AppText>
                      </View>
                    }
                    last={i === shown.length - 1}
                  />
                );
              })}
            </GroupedList>
          ) : null}
          <GroupedList>
            <PRow
              title={tx(T, "الرصيد المستحق")}
              trailing={<M strong>{formatMinorShort(stmt.balance_minor)}</M>}
              last
            />
          </GroupedList>

          {state === "ready" ? (
            <>
              <StateView
                state="stale"
                title={tx(
                  T,
                  "المشاركة تُنشئ ملفاً أو رابطاً. لا نضمن وصوله ولا قراءته، ولا نسجّل «تم الاطلاع» ما لم يفتح المستلم رابطاً مخوَّلاً.",
                )}
              />
              <Stack>
                <Button label={tx(T, "طباعة")} financial onPress={print} />
                <Button
                  label={tx(T, "تصدير PDF")}
                  variant="secondary"
                  onPress={() => void generate("pdf")}
                  disabledReason={isOwner ? undefined : tx(T, "المشاركة الخارجية للمالك")}
                />
                <Button
                  label={tx(T, "مشاركة رابط")}
                  variant="secondary"
                  onPress={() => void generate("link")}
                  disabledReason={isOwner ? undefined : tx(T, "المشاركة الخارجية للمالك")}
                />
              </Stack>
              {isOwner ? (
                <>
                  <TextField
                    label={tx(T, "تذكير الدين — يدوي، تراجعه وترسله بنفسك")}
                    value={reminder}
                    onChangeText={setReminder}
                    multiline
                    numberOfLines={4}
                    style={{ minHeight: 110, textAlignVertical: "top", paddingTop: 12 }}
                  />
                  <Stack>
                    <Button
                      label={tx(T, "نسخ القالب")}
                      variant="secondary"
                      onPress={shareReminder}
                    />
                  </Stack>
                </>
              ) : null}
              <Button label={tx(T, "كشف الحساب")} variant="quiet" onPress={back} />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
