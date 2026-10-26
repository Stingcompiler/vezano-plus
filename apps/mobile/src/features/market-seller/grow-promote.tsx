import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useState } from "react";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import { PhaseScreen } from "@/components/market-seller/phase";
import {
  ChipRow,
  Heading,
  M,
  NodeChip,
  Note,
  Row,
  Stack,
  StateWord,
} from "@/components/market-seller/parts";
import { netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "GROW-03";

interface Req {
  id: string;
  offer_id: string;
  offer_name: string;
  audience: string;
  audience_label: string;
  area: string;
  duration_days: number;
  status: "draft" | "pricing_pending" | "cancelled";
  status_label: string;
  prepared_by_name: string;
  requested_by_name: string;
}
interface Payload {
  state: "ready" | "phase_locked";
  pricing_locked: boolean;
  pricing_lock_label: string;
  can_request: boolean;
  can_prepare: boolean;
  offers: { offer_id: string; public_name: string; pack_label: string }[];
  audiences: { code: string; label: string }[];
  requests: Req[];
}
interface Preview {
  promoted: { public_name: string; pack_label: string; price_minor: string; tag: string };
  neighbors: { public_name: string; pack_label: string; price_minor: string }[];
}

/** GROW-03 — طلب عرض ممول ومعاينته (21-D16 ready · 38-D30 validation_error/permission_denied · phase_locked): الإعلان يُوسم إعلاناً؛ قفلان لا واحد. */
export default function GrowPromoteScreen() {
  const { api } = useSession();
  const srv = useServerGet<Payload>("cache.grow.promote", () =>
    safeGet(() => api.GET("/api/grow/promote")),
  );
  const [offerId, setOfferId] = useState("");
  const [audience, setAudience] = useState("");
  const [area, setArea] = useState("");
  const [duration, setDuration] = useState("");
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; missing: string[] } | null>(null);
  const [saved, setSaved] = useState<Req | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const data = srv.shown;

  const preview = async (id: string) => {
    setOfferId(id);
    const r = await send<Preview>(() =>
      api.GET("/api/grow/promote", { params: { query: { preview: id } } }),
    );
    if (r.kind === "offline") setOfflineTry(true);
    else if (r.kind === "ok" && r.body.promoted) setPv(r.body);
  };

  const submit = async (action: "save" | "request") => {
    if (busy) return;
    setBusy(action);
    setErr(null);
    setOfflineTry(false);
    try {
      const r = await send<{
        request?: Req;
        detail?: string;
        extra?: { missing?: string[]; owner_required?: boolean };
      }>(() =>
        api.POST("/api/grow/promote", {
          body: {
            offer_id: offerId,
            audience,
            area,
            duration_days: duration ? Number(duration) : 0,
            action,
          } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.request) {
        setSaved(r.body.request);
        await srv.reload();
        return;
      }
      setErr({ code: r.body?.detail ?? "server_error", missing: r.body?.extra?.missing ?? [] });
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreen id={T} />;

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    err?.code === "permission_denied"
      ? "permission_denied"
      : err?.code === "audience_or_duration_required"
        ? "validation_error"
        : (net ?? (data ? "ready" : "loading"));

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "طلب عرض ممول")}
      onRefresh={() => void srv.reload()}
    >
      <Note>{tx(T, "الإعلان يُوسم إعلاناً")}</Note>
      <FetchFail net={net} hasData={Boolean(data)} onRetry={() => void srv.reload()} />
      {net && data ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الطلب للمالك")}>
          <AppText variant="secondary">
            {tx(T, "ناشر الكتالوج يُعدّ العرض ولا يطلب تمويله — الطلب التزام مالي.")}
          </AppText>
          <Button label={tx(T, "فهمت")} variant="secondary" onPress={() => setErr(null)} />
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "طلب بلا جمهور أو مدة")}>
          <AppText variant="secondary">{tx(T, "الجمهور غير محدَّد أو المدة فارغة.")}</AppText>
        </StateView>
      ) : null}
      {err && !["permission_denied", "audience_or_duration_required"].includes(err.code) ? (
        <StateView state="partial" title={tx(T, "لم يُحفظ الطلب")}>
          <AppText variant="secondary">
            {err.code === "area_required"
              ? tx(T, "اختر منطقة الخدمة.")
              : err.code === "already_requested"
                ? tx(T, "الطلب مرسَل من قبل — بانتظار التسعير.")
                : err.code}
          </AppText>
        </StateView>
      ) : null}
      {saved ? (
        <StateView
          state="success"
          title={
            saved.status === "pricing_pending"
              ? tx(T, "أُرسل الطلب — التسعير غير معتمد، يتواصل الفريق")
              : tx(T, "حُفظ الطلب — بانتظار المالك ليرسله")
          }
        >
          <AppText variant="secondary">
            {saved.offer_name} · {saved.audience_label} · <M>{saved.duration_days}</M>{" "}
            {tx(T, "يوماً ·")} {saved.status_label}
          </AppText>
          <Button label={tx(T, "التالي")} variant="secondary" onPress={() => setSaved(null)} />
        </StateView>
      ) : null}

      {data ? (
        <>
          <Note>
            <StateWord state="stale" label={data.pricing_lock_label} />
          </Note>
          {[
            tx(T, "وسم «عرض ممول» ظاهر في نتيجة البحث بحجم نص العنوان لا بخط صغير."),
            tx(T, "الترتيب الممول لا يُخفي نتيجة أقرب أو أرخص — يظهر بجوارها لا مكانها."),
            tx(T, "المعاينة تُري التاجر شكل إعلانه كما يراه المشتري قبل الدفع."),
            tx(
              T,
              "تفاصيل التسعير قرار مفتوح خارج التصميم؛ الشاشة تعرض الهيكل وتترك الرقم لقرار تجاري.",
            ),
          ].map((t) => (
            <Note key={t}>· {t}</Note>
          ))}
          <StateView state="phase_locked" title={tx(T, "التسعير غير معتمد")}>
            <AppText variant="secondary">
              {tx(
                T,
                "مرحلة النموّ مفتوحة، والتسعير نفسه قرار مفتوح — لا واجهة دفع ولا رقم؛ الطلب داخلي: وسم وجمهور ومدة.",
              )}
            </AppText>
            <AppText variant="note" muted>
              {tx(T, "لا واجهة دفع · طلب داخلي بلا رقم")}
            </AppText>
            <Button
              label={tx(T, "التسعير قرار تجاري خارج الشاشة")}
              variant="secondary"
              onPress={() => undefined}
              disabledReason={tx(
                T,
                "مرحلة النموّ مفتوحة، والتسعير نفسه قرار مفتوح — لا واجهة دفع ولا رقم؛ الطلب داخلي: وسم وجمهور ومدة.",
              )}
            />
          </StateView>

          <Heading>{tx(T, "العرض")}</Heading>
          <ChipRow>
            {data.offers.map((o) => (
              <NodeChip
                key={o.offer_id}
                on={offerId === o.offer_id}
                onPress={() => void preview(o.offer_id)}
              >
                {o.public_name}
              </NodeChip>
            ))}
          </ChipRow>
          {pv ? (
            <>
              <Heading>{tx(T, "المعاينة — كما يراه المشتري")}</Heading>
              <GroupedList>
                <Row
                  title={`${pv.promoted.public_name} · ${pv.promoted.pack_label}`}
                  sub={
                    pv.promoted.price_minor ? (
                      <M>{formatMinor(pv.promoted.price_minor)}</M>
                    ) : (
                      tx(T, "اطلب تأكيد سعر")
                    )
                  }
                  trailing={<StateWord state="stale" label={pv.promoted.tag} />}
                  last={pv.neighbors.length === 0}
                />
                {pv.neighbors.map((n, i) => (
                  <Row
                    key={i}
                    title={`${n.public_name} · ${n.pack_label}`}
                    sub={
                      n.price_minor ? <M>{formatMinor(n.price_minor)}</M> : tx(T, "اطلب تأكيد سعر")
                    }
                    last={i === pv.neighbors.length - 1}
                  />
                ))}
              </GroupedList>
            </>
          ) : null}

          <Heading>{tx(T, "الجمهور")}</Heading>
          <ChipRow>
            {data.audiences.map((a) => (
              <NodeChip key={a.code} on={audience === a.code} onPress={() => setAudience(a.code)}>
                {a.label}
              </NodeChip>
            ))}
          </ChipRow>
          {audience === "area" ? (
            <TextField label={tx(T, "منطقة الخدمة")} value={area} onChangeText={setArea} />
          ) : null}
          <TextField
            label={tx(T, "المدة بالأيام")}
            mono
            keyboardType="number-pad"
            value={duration}
            onChangeText={setDuration}
          />
          <Stack>
            <Button
              label={tx(T, "اطلب العرض الممول")}
              financial
              loading={busy === "request"}
              onPress={() => void submit("request")}
              disabledReason={offerId ? undefined : tx(T, "اختر العرض")}
            />
            <Button
              label={tx(T, "احفظ واطلب من المالك إرساله")}
              variant="secondary"
              loading={busy === "save"}
              onPress={() => void submit("save")}
              disabledReason={offerId ? undefined : tx(T, "اختر العرض")}
            />
          </Stack>

          {data.requests.length ? (
            <>
              <Heading>{tx(T, "طلباتك")}</Heading>
              <GroupedList>
                {data.requests.map((q, i) => (
                  <Row
                    key={q.id}
                    title={q.offer_name}
                    sub={
                      <>
                        {q.audience_label}
                        {q.area ? ` (${q.area})` : ""} · <M>{q.duration_days}</M> {tx(T, "يوماً ·")}{" "}
                        {q.status === "draft"
                          ? `${tx(T, "أعدّه")} ${q.prepared_by_name}`
                          : `${tx(T, "طلبه")} ${q.requested_by_name}`}
                      </>
                    }
                    trailing={
                      <StateWord
                        state={q.status === "pricing_pending" ? "stale" : "saved_local"}
                        label={q.status_label}
                      />
                    }
                    last={i === data.requests.length - 1}
                  />
                ))}
              </GroupedList>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
