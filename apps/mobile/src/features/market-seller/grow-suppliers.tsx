import { agoParts, dayMonth } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView } from "@sting/ui-native";
import { useState } from "react";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import { Fact, M, Note, Row, StateWord } from "@/components/market-seller/parts";
import { netState, safeGet, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "GROW-02";

interface Doc {
  document_id: string;
  number: string;
  approved_at: string;
  summary: string;
  label: "متأخر" | "مطابق" | "مرتجع";
}
interface Supplier {
  supplier_id: string;
  supplier_name: string;
  documents: number;
  months: number;
  enough: boolean;
  on_time: number;
  with_order: number;
  on_time_line: string;
  returns: number;
  returns_line: string;
  price_moves: number;
  price_line: string;
  recent: Doc[];
  min_docs: number;
}
interface Payload {
  state: "ready" | "empty" | "stale" | "phase_locked" | "permission_denied";
  role_name?: string;
  computed_at?: string;
  newer_documents?: string[];
  suppliers?: Supplier[];
}

/** «مستند واحد / مستندان / N مستندات / N مستنداً». */
function DocsWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "مستند واحد")}</>;
  if (n === 2) return <>{tx(T, "مستندان")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "مستندات") : tx(T, "مستنداً")}
    </>
  );
}
/** «شهر / شهران / N أشهر / N شهراً». */
function MonthsWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "شهر")}</>;
  if (n === 2) return <>{tx(T, "شهران")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "أشهر") : tx(T, "شهراً")}
    </>
  );
}
/** «قبل دقائق / قبل ساعة / قبل N ساعات / قبل N أيام». */
function AgoWord({ iso }: { iso: string }) {
  const { n, unit } = agoParts(iso);
  if (unit === "minute") return <>{tx(T, "قبل دقائق")}</>;
  if (unit === "hour") {
    if (n === 1) return <>{tx(T, "قبل ساعة")}</>;
    if (n === 2) return <>{tx(T, "قبل ساعتين")}</>;
    return (
      <>
        {tx(T, "قبل")} <M>{n}</M> {n <= 10 ? tx(T, "ساعات") : tx(T, "ساعة")}
      </>
    );
  }
  if (n === 1) return <>{tx(T, "قبل يوم")}</>;
  if (n === 2) return <>{tx(T, "قبل يومين")}</>;
  return (
    <>
      {tx(T, "قبل")} <M>{n}</M> {tx(T, "أيام")}
    </>
  );
}

const docState = (l: Doc["label"]): StateCode =>
  l === "متأخر" ? "conflict" : l === "مرتجع" ? "partial" : "success";
const docLabel = (l: Doc["label"]) =>
  l === "متأخر" ? tx(T, "متأخر") : l === "مرتجع" ? tx(T, "مرتجع") : tx(T, "مطابق");

/** GROW-02 — تحليلات المورد (32-D24 ready/loading/empty/stale · phase_locked): يُحاسَب على ما وعد به لا على ما نتمنّاه؛ ثلاثة أرقام لا درجة. */
export default function GrowSuppliersScreen() {
  const { api } = useSession();
  const [compute, setCompute] = useState(0);
  const srv = useServerGet<Payload>(
    "cache.grow.suppliers",
    () =>
      safeGet(
        () =>
          api.GET("/api/grow/suppliers", { params: { query: compute ? { compute: "1" } : {} } }),
        (b) => b as Payload | undefined,
        [403],
      ),
    [compute],
  );
  const data = srv.shown;

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode = !data
    ? (net ?? "loading")
    : data.state === "permission_denied"
      ? "permission_denied"
      : data.state === "stale" || net === "stale"
        ? "stale"
        : data.state === "empty"
          ? "empty"
          : "ready";
  const suppliers = data?.suppliers ?? [];

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "تحليلات المورد — يُحاسَب على ما وعد به لا على ما نتمنّاه")}
      onRefresh={() => void srv.reload()}
    >
      <Note>
        {tx(
          T,
          "ثلاثة أرقام لا أكثر: التزامه بالمواعيد، ونسبة ما رُدَّ إليه، وثبات أسعاره. كلها محسوبة من مستندات حقيقية في نطاقك، وكلها تُفتح على المستندات التي بنَتها.",
        )}
      </Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "حساب من المستندات")}>
          <AppText variant="secondary">
            {tx(
              T,
              "ثلاثة هياكل بمواضع الأرقام الثلاثة. لا نُظهر رقماً جزئياً يتغيّر أمام العين — القارئ يتذكّر أول رقم رآه.",
            )}
          </AppText>
          {[tx(T, "التزام بالمواعيد"), tx(T, "نسبة المرتجع"), tx(T, "ثبات السعر")].map((l) => (
            <Fact key={l} label={l}>
              <M>—</M>
            </Fact>
          ))}
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView
          state="permission_denied"
          title={tx(T, "تحليلات المورد للمالك ومدير الفرع وأمين المخزن")}
        >
          <AppText variant="secondary">
            {tx(T, "الأرقام تُبنى على مستندات الشراء — من لا يراها لا يرى تحليلها.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "stale" && data ? (
        <StateView state="stale" title={tx(T, "محسوبة")}>
          <AppText variant="bodyStrong">
            {data.computed_at ? <AgoWord iso={data.computed_at} /> : null}
          </AppText>
          <Button
            label={tx(T, "أعِد الحساب الآن")}
            variant="secondary"
            onPress={() => setCompute((n) => n + 1)}
          />
          <AppText variant="secondary">
            {tx(T, "المؤشرات تُحسب ليلاً لا لحظياً. نُظهر وقت الحساب لأن")}{" "}
            {data.newer_documents?.length ? (
              <>
                {tx(T, "مستند")} <M>{data.newer_documents[0]}</M> {tx(T, "اعتُمد بعده ولم يدخل")}
              </>
            ) : (
              tx(T, "قد يكون مستند اعتُمد بعده ولم يدخل")
            )}
            .
          </AppText>
        </StateView>
      ) : null}

      {state === "empty" && suppliers.length ? (
        <StateView
          state="empty"
          title={`${suppliers[0].documents === 1 ? tx(T, "مستند واحد") : suppliers[0].documents === 2 ? tx(T, "مستندان") : `${suppliers[0].documents} ${suppliers[0].documents <= 10 ? tx(T, "مستندات") : tx(T, "مستنداً")}`} ${tx(T, "لا")} ${suppliers[0].documents === 2 ? tx(T, "يكفيان") : tx(T, "يكفي")}`}
        >
          <AppText variant="secondary">
            {tx(
              T,
              "مورد جديد بمستندين. لا نحسب نسبة التزام من مستندين ونعرضها كأنها حكم — «50%» من اثنين ليست معلومة.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "empty" && !suppliers.length ? (
        <StateView state="empty" title={tx(T, "لا مستندات شراء بعد")}>
          <AppText variant="secondary">{tx(T, "التحليل يبدأ من أول مستند شراء معتمد.")}</AppText>
        </StateView>
      ) : null}

      {data && state !== "loading" && state !== "permission_denied"
        ? suppliers.map((s) => (
            <GroupedList key={s.supplier_id}>
              <Row
                title={
                  <AppText variant="title">
                    {s.supplier_name} — <DocsWord n={s.documents} /> · <MonthsWord n={s.months} />
                  </AppText>
                }
              />
              {s.enough ? (
                <>
                  <Row
                    title={tx(T, "التزام بالمواعيد")}
                    sub={s.on_time_line}
                    trailing={
                      <AppText variant="bodyStrong">
                        <M>{s.with_order ? Math.round((s.on_time * 100) / s.with_order) : 0}</M>%
                      </AppText>
                    }
                  />
                  <Row
                    title={tx(T, "نسبة المرتجع")}
                    sub={s.returns_line}
                    trailing={
                      <AppText variant="bodyStrong">
                        <M>{Math.round((s.returns * 100) / s.documents)}</M>%
                      </AppText>
                    }
                  />
                  <Row
                    title={tx(T, "ثبات السعر")}
                    sub={s.price_line}
                    trailing={
                      <AppText variant="bodyStrong">
                        <M>{s.price_moves}</M>
                      </AppText>
                    }
                  />
                </>
              ) : (
                <Row
                  title={
                    <>
                      {tx(T, "تُحسب المؤشرات بعد")} <M>{s.min_docs}</M> {tx(T, "مستندات — الآن")}{" "}
                      <DocsWord n={s.documents} />
                    </>
                  }
                  dim
                />
              )}
              <Row title={<AppText variant="bodyStrong">{tx(T, "آخر خمسة مستندات")}</AppText>} />
              {s.recent.map((d) => {
                const { day, month } = dayMonth(d.approved_at);
                return (
                  <Row
                    key={d.document_id}
                    title={
                      <>
                        <M>{d.number}</M> · <M>{day}</M> {month}
                      </>
                    }
                    sub={d.summary}
                    trailing={<StateWord state={docState(d.label)} label={docLabel(d.label)} />}
                  />
                );
              })}
              <Row
                title={
                  <AppText variant="note" muted>
                    {tx(T, "حساب من")} <DocsWord n={s.documents} />
                  </AppText>
                }
                last
              />
            </GroupedList>
          ))
        : null}
    </Screen>
  );
}
