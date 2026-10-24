import { dayMonth, formatMinor } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";

import {
  InfoBox,
  M,
  Marked,
  Note,
  Row,
  Stack,
  StatusWord,
} from "@/components/market-discovery/parts";
import type { Preview } from "@/features/market-discovery/lib";
import { MD_TEXTS } from "@/features/market-discovery/texts";
import { useSession } from "@/lib/session";
import { WEB_URL } from "@/lib/web";

const T = "MP-07";
type State = "ready" | "expired" | "permission_denied" | "success";

interface Invite {
  id: string;
  kind: "share" | "invite" | "authorization";
  kind_label: string;
  target_name: string;
  message: string;
  status: "sent" | "accepted" | "declined" | "revoked" | "expired";
  status_label: string;
  expires_at: string;
  created_at: string;
  counts: { visits: number; signups: number; publishes: number; first_orders: number };
}
interface Payload {
  invites: Invite[];
  can_invite: boolean;
  share_days: number;
  reaches: string[];
  not_reaches: string[];
}

function Day({ iso }: { iso: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <M>{day}</M> {month}
    </>
  );
}

function PreviewCard({ p, message }: { p: Preview; message?: string }) {
  return (
    <GroupedList>
      <Row
        title={p.title}
        sub={
          <>
            {p.subtitle}
            {message ? `\n«${message}»` : ""}
          </>
        }
        trailing={
          p.price_minor ? (
            <M strong>{formatMinor(p.price_minor)}</M>
          ) : (
            <AppText>{p.price_line}</AppText>
          )
        }
        last
      />
    </GroupedList>
  );
}

/**
 * MP-07 — مشاركة رابط ودعوة منشأة (43-D35 ready/expired/permission_denied · 12-D7 success). الرابط يخرج عن
 * سيطرتك لحظة إرساله، فتُعرض المعاينة العامة أولاً؛ وإرساله بورقة المشاركة الأصلية للهاتف. خادمي فقط.
 */
export default function MarketShare() {
  const { api } = useSession();
  const { offer = "", supplier = "" } = useLocalSearchParams<{
    offer?: string;
    supplier?: string;
  }>();
  const [data, setData] = useState<Payload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [link, setLink] = useState<{ path: string; expires_at: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [requested, setRequested] = useState<Invite | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: res, response } = await api.GET("/api/market/invites");
      const body = res as unknown as Payload | undefined;
      if (response.ok && body) setData(body);
    } catch {
      setError(MD_TEXTS.needsServer);
    }
  }, [api]);

  useEffect(() => {
    void load();
    if (!offer && !supplier) return;
    void (async () => {
      try {
        const { data: res, response } = await api.GET("/api/market/share/preview", {
          params: { query: { offer, supplier } },
        });
        const body = res as unknown as { preview: Preview } | undefined;
        if (response.ok && body) setPreview(body.preview);
      } catch {
        /* المعاينة تحتاج الخادم */
      }
    })();
  }, [api, load, offer, supplier]);

  const create = async (kind: "share" | "invite" | "authorization") => {
    if (busy) return;
    setBusy(kind);
    setCopied(false);
    setError("");
    try {
      const body: Record<string, unknown> = { kind, message };
      if (kind !== "invite") {
        if (offer) body.offer_id = offer;
        if (supplier) body.supplier_tenant_id = supplier;
      }
      const r = await api.POST("/api/market/invites", { body: body as never });
      const b = r.data as unknown as
        { invite: Invite; path?: string; preview?: Preview } | undefined;
      if (r.response.ok && b) {
        if (kind === "authorization") setRequested(b.invite);
        else if (b.path) setLink({ path: b.path, expires_at: b.invite.expires_at });
        await load();
      }
    } catch {
      setError(MD_TEXTS.needsServer);
    } finally {
      setBusy("");
    }
  };

  const revoke = async (i: Invite) => {
    if (busy) return;
    setBusy(i.id);
    try {
      await api.POST("/api/market/invites/{invite_id}/revoke", {
        params: { path: { invite_id: i.id } },
        body: {} as never,
      });
      await load();
    } catch {
      setError(MD_TEXTS.needsServer);
    } finally {
      setBusy("");
    }
  };

  const send = async () => {
    if (!link) return;
    try {
      const r = await Share.share({ message: `${WEB_URL}${link.path}` });
      setCopied(r.action !== Share.dismissedAction);
    } catch {
      setCopied(false);
    }
  };

  const state: State = requested
    ? "success"
    : data && !data.can_invite
      ? "permission_denied"
      : "ready";

  return (
    <Screen screenId={T} state={state} title={tx(T, "مشاركة رابط ودعوة منشأة")}>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "الرابط يخرج عن سيطرتك لحظة إرساله. قبل الإرسال تُعرض المعاينة حرفياً: الاسم والصنف والسعر العام — ولا سعر خاص فيها أبداً.",
        )}
      </AppText>
      {error ? <StateView state="offline" title={error} /> : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الدعوة باسم المنشأة")}>
          <AppText variant="secondary">
            {tx(T, "دعوة منشأة أخرى إلى علاقة تجارية فعلٌ باسم منشأتك.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "لا نشر تلقائياً")}</AppText>{" "}
            {tx(
              T,
              "· قبول المدعوّ لا ينشر ملفه ولا كتالوجه — الدعوة تفتح باباً ولا تدخل أحداً منه. المشاركة والدعوة بصلاحية النشر من مالك المنشأة.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" && requested ? (
        <StateView state="success" title={tx(T, "طلب تخويل مرسَل — بانتظار المورد")}>
          <AppText variant="secondary">
            {requested.target_name}{" "}
            {tx(T, "· قرار المورد بشري ولا مهلة نفرضها عليه. الانتظار معلن وليس دوّارة.")}
          </AppText>
          <AppText variant="bodyStrong">{tx(T, "ما يصل المورد عنك")}</AppText>
          <Marked title={tx(T, "يصله")} items={data?.reaches ?? []} mark={tx(T, "نعم")} />
          <Marked title={tx(T, "لا يصله")} items={data?.not_reaches ?? []} mark={tx(T, "لا")} />
          <Note>
            {tx(
              T,
              "لو رفض المورد فلا سبب يُعرض لك: السبب قراره الخاص، وإظهاره قد يكشف سياسته التجارية أو علاقته بمنافسيك. الرفض عام بلا تسريب.",
            )}
          </Note>
          <Button label={tx(T, "حسناً")} onPress={() => setRequested(null)} />
        </StateView>
      ) : null}

      {state === "ready" && preview ? (
        <>
          <AppText variant="bodyStrong">{tx(T, "معاينة ما سيراه المستلم")}</AppText>
          <Note>
            {tx(
              T,
              "المعاينة عامة دوماً — ولو كان المرسل يرى سعرَ شريحته؛ الرابط يُعاد توجيهه ولا يعرف من يفتحه. ما يخرج من المنشأة يُفترض عاماً.",
            )}
          </Note>
          <PreviewCard p={preview} />
          <Stack>
            <Button
              label={tx(T, "أنشئ رابط مشاركة")}
              loading={busy === "share"}
              onPress={() => void create("share")}
            />
            {supplier ? (
              <Button
                label={tx(T, "اطلب تخويلاً من هذا المورد")}
                variant="secondary"
                loading={busy === "authorization"}
                onPress={() => void create("authorization")}
              />
            ) : null}
          </Stack>
        </>
      ) : null}

      {state === "ready" && link ? (
        <InfoBox title={tx(T, "رابط بعمر")}>
          <AppText variant="secondary">
            <M>{link.path}</M>
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "يسري حتى")} {link.expires_at ? <Day iso={link.expires_at} /> : "—"}{" "}
            <AppText variant="bodyStrong">{tx(T, "جديدٌ لا إحياء")}</AppText>{" "}
            {tx(T, "· يُنشأ رابط جديد بعمر جديد؛ القديم لا يُمدَّد.")}
          </AppText>
          <Button label={tx(T, "انسخ الرابط")} onPress={() => void send()} />
          {copied ? <StatusWord tone="success" label={tx(T, "نُسخ")} /> : null}
        </InfoBox>
      ) : null}

      {state === "ready" && data ? (
        <>
          <AppText variant="bodyStrong">{tx(T, "الدعوة باسم المنشأة")}</AppText>
          <Note>
            {tx(
              T,
              "دعوة منشأة أخرى إلى علاقة تجارية فعلٌ باسم منشأتك. لا نشر تلقائياً: قبول المدعوّ لا ينشر ملفه ولا كتالوجه — الدعوة تفتح باباً ولا تدخل أحداً منه.",
            )}
          </Note>
          <TextField
            label={tx(T, "رسالة قصيرة للمدعوّ (اختيارية)")}
            value={message}
            onChangeText={setMessage}
          />
          <Stack>
            <Button
              label={tx(T, "أنشئ رابط دعوة")}
              variant="secondary"
              loading={busy === "invite"}
              onPress={() => void create("invite")}
            />
          </Stack>

          <GroupedList title={tx(T, "روابطي ودعواتي")}>
            {data.invites.length ? (
              data.invites.map((i, idx) => (
                <View key={i.id}>
                  <Row
                    title={`${i.kind_label} · ${i.target_name}`}
                    sub={
                      <>
                        {tx(T, "زيارات")} <M>{i.counts.visits}</M> · {tx(T, "تسجيل")}{" "}
                        <M>{i.counts.signups}</M> · {tx(T, "نشر")} <M>{i.counts.publishes}</M> ·{" "}
                        {tx(T, "أول طلب")} <M>{i.counts.first_orders}</M>
                      </>
                    }
                    trailing={
                      <StatusWord
                        tone={
                          i.status === "sent"
                            ? "success"
                            : i.status === "accepted"
                              ? "synced"
                              : "expired"
                        }
                        label={i.status_label}
                      />
                    }
                    last={
                      !(i.status === "sent" && i.kind !== "authorization") &&
                      idx === data.invites.length - 1
                    }
                  />
                  {i.status === "sent" && i.kind !== "authorization" ? (
                    <View style={{ paddingHorizontal: SPACE["4"], paddingBottom: SPACE["2"] }}>
                      <Button
                        label={tx(T, "ألغِ")}
                        variant="secondary"
                        loading={busy === i.id}
                        onPress={() => void revoke(i)}
                      />
                    </View>
                  ) : null}
                </View>
              ))
            ) : (
              <Row title={tx(T, "لا روابط بعد.")} last />
            )}
          </GroupedList>
          <Note>
            {tx(
              T,
              "القياس بأقل بيانات: زيارة وتسجيل ونشر وأول طلب أعدادٌ مفصولة بلا هوية من فتح الرابط.",
            )}
          </Note>
        </>
      ) : null}
    </Screen>
  );
}

interface Opened {
  id: string;
  kind: "share" | "invite";
  message: string;
  expires_at: string;
  preview: Preview;
}

/** MP-07 (رابط مفتوح) — `/market/i/{token}`: ما يُرى عامّ دوماً؛ المنتهي «جديدٌ لا إحياء». */
export function InviteOpen() {
  const router = useRouter();
  const { api } = useSession();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [expired, setExpired] = useState(false);
  const [accepted, setAccepted] = useState<"" | "ok" | "self">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/public/market/invite/{token}", {
          params: { path: { token } },
        });
        if (response.status === 410 || response.status === 404) {
          setExpired(true);
          return;
        }
        const body = data as unknown as { invite: Opened } | undefined;
        if (response.ok && body) setOpened(body.invite);
      } catch {
        setError(MD_TEXTS.needsServer);
      }
    })();
  }, [api, token]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.POST("/api/market/invite/{token}/accept", {
        params: { path: { token } },
        body: {} as never,
      });
      if (r.response.status === 410) setExpired(true);
      else if (r.response.status === 400) setAccepted("self");
      else if (r.response.ok) setAccepted("ok");
    } catch {
      setError(MD_TEXTS.needsServer);
    } finally {
      setBusy(false);
    }
  };

  const state: State = expired ? "expired" : "ready";

  return (
    <Screen screenId={T} state={state} title={tx(T, "مشاركة رابط ودعوة منشأة")}>
      {error ? <StateView state="offline" title={error} /> : null}
      {state === "expired" ? (
        <StateView state="expired" title={tx(T, "دعوة منتهية")}>
          <AppText variant="secondary">{tx(T, "رابط الدعوة له عمر وانقضى.")}</AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "جديدٌ لا إحياء")}</AppText>{" "}
            {tx(T, "· يُنشأ رابط جديد بعمر جديد؛ القديم لا يُمدَّد. اطلب من مرسله رابطاً جديداً.")}
          </AppText>
          <Button label={tx(T, "السوق")} onPress={() => router.push("/market")} />
        </StateView>
      ) : null}
      {opened ? (
        <>
          <PreviewCard p={opened.preview} message={opened.message} />
          {opened.kind === "invite" ? (
            <>
              <Note>
                <AppText variant="bodyStrong">{tx(T, "لا نشر تلقائياً")}</AppText>{" "}
                {tx(
                  T,
                  "· قبول الدعوة لا ينشر ملفك ولا كتالوجك — الدعوة تفتح باباً ولا تدخل أحداً منه.",
                )}
              </Note>
              <Stack>
                {accepted === "ok" ? (
                  <StatusWord
                    tone="success"
                    label={tx(T, "قُبلت الدعوة — لا نشر ولا اشتراك نيابةً عنك")}
                  />
                ) : accepted === "self" ? (
                  <StatusWord tone="stale" label={tx(T, "هذه دعوة منشأتك نفسها")} />
                ) : (
                  <Button
                    label={tx(T, "اقبل الدعوة باسم منشأتك")}
                    financial
                    loading={busy}
                    onPress={() => void accept()}
                  />
                )}
                {opened.preview.path ? (
                  <Button
                    label={tx(T, "ملف المنشأة الداعية")}
                    variant="secondary"
                    onPress={() => router.push(opened.preview.path)}
                  />
                ) : null}
              </Stack>
            </>
          ) : (
            <Stack>
              <Button
                label={tx(T, "افتح في السوق")}
                financial
                onPress={() => router.push(opened.preview.path)}
              />
            </Stack>
          )}
          <Note>
            {tx(T, "الرابط يسري حتى")} {opened.expires_at ? <Day iso={opened.expires_at} /> : "—"}{" "}
            {tx(T, "· المعاينة عامة دوماً ولا سعر خاص فيها.")}
          </Note>
        </>
      ) : null}
    </Screen>
  );
}
