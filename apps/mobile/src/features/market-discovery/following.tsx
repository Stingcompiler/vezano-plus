import { dayMonth, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { M, Marked, Note, Row, StatusWord } from "@/components/market-discovery/parts";
import { readSnap, writeSnap } from "@/features/market-discovery/lib";
import { MD_TEXTS } from "@/features/market-discovery/texts";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "MP-06";
type State = "ready" | "empty" | "permission_denied" | "success" | "stale";

interface Follow {
  id: string;
  supplier_tenant_id: string;
  supplier_name: string;
  status: "active" | "cancelled";
  status_label: string;
  hint: string;
  suspended: boolean;
  followed_at: string;
  cancelled_at: string;
}
interface Payload {
  follows: Follow[];
  active_count: number;
  can_follow: boolean;
  what_stops: string[];
  what_stays: string[];
}

const CACHE = "cache.market.following";
const STOPPED = [tx(T, "إشعارات عروضه الجديدة وتخفيضاته"), tx(T, "ظهور عروضه في قسم «متابعاتك»")];
const KEPT = [
  tx(T, "طلباتك السابقة معه وسجلّها كامل"),
  tx(T, "إشعارات الطلبات القائمة: رد، شحنة، خلاف"),
  tx(T, "ذمتك وذمته وكل مستند بينكما"),
];

function CancelledWhen({ iso }: { iso: string }) {
  const sameDay = new Date(iso).toDateString() === new Date().toDateString();
  if (sameDay)
    return (
      <>
        {tx(T, "اليوم")} <M>{hhmm(iso)}</M>
      </>
    );
  const { day, month } = dayMonth(iso);
  return (
    <>
      <M>{day}</M> {month} <M>{hhmm(iso)}</M>
    </>
  );
}

/**
 * MP-06 — متابعة مورد وقائمة المتابعين الخاصة (29-D22 ready/empty · 43-D35 permission_denied · 10-D6
 * success): اشتراك تسويقي مستقلّ يُلغى وحده ولا يمسّ أحداث الطلبات. `?follow=` من ملف المورد: المتابعة فعل
 * صريح باسم المنشأة تُنفَّذ مرة ثم يُنظَّف الرابط. الإلغاء بزرّ في الصف (لا سحب) — خادمي فقط.
 */
export default function MarketFollowing() {
  const router = useRouter();
  const { api } = useSession();
  const { follow: wanted = "" } = useLocalSearchParams<{ follow?: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [cachedOnly, setCachedOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<Follow | null>(null);
  const [followError, setFollowError] = useState("");
  const [actionError, setActionError] = useState("");
  const followedRef = useRef("");
  const routerRef = useRef(router);
  routerRef.current = router;

  const load = useCallback(async (): Promise<Payload | null> => {
    const storage = await getStorage();
    try {
      const { data: res, response } = await api.GET("/api/market/following");
      const body = res as unknown as Payload | undefined;
      if (response.ok && body) {
        setData(body);
        setCachedOnly(false);
        void writeSnap(storage, CACHE, body);
        return body;
      }
    } catch {
      /* بلا اتصال: آخر قائمة محفوظة */
    }
    const snap = await readSnap<Payload>(storage, CACHE);
    if (snap) {
      setData((cur) => cur ?? snap.data);
      setCachedOnly(true);
    }
    return null;
  }, [api]);

  useEffect(() => {
    void (async () => {
      const body = await load();
      if (!wanted || !body?.can_follow || followedRef.current === wanted) return;
      followedRef.current = wanted;
      try {
        const r = await api.POST("/api/market/following", {
          body: { supplier_tenant_id: wanted } as never,
        });
        if (!r.response.ok) {
          const d = (r.data ?? r.error) as unknown as { detail?: string } | undefined;
          setFollowError(
            d?.detail === "supplier_is_self"
              ? tx(T, "لا تتابع منشأتك نفسها.")
              : tx(T, "المورد غير منشور أو الرابط غير صالح — لم تُضَف متابعة."),
          );
        }
      } catch {
        setActionError(MD_TEXTS.needsServer);
      }
      await load();
      routerRef.current.replace("/market/following");
    })();
  }, [api, load, wanted]);

  const unfollow = async (f: Follow) => {
    if (busy) return;
    setBusy(f.id);
    setActionError("");
    try {
      const r = await api.POST("/api/market/following/{follow_id}/unfollow", {
        params: { path: { follow_id: f.id } },
        body: {} as never,
      });
      const b = r.data as unknown as { follow: Follow } | undefined;
      if (r.response.ok && b) {
        setCancelled(b.follow);
        await load();
      }
    } catch {
      setActionError(MD_TEXTS.needsServer);
    } finally {
      setBusy(null);
    }
  };

  const refollow = async (f: Follow) => {
    if (busy) return;
    setBusy(f.id);
    setActionError("");
    try {
      await api.POST("/api/market/following", {
        body: { supplier_tenant_id: f.supplier_tenant_id } as never,
      });
      await load();
    } catch {
      setActionError(MD_TEXTS.needsServer);
    } finally {
      setBusy(null);
    }
  };

  const state: State = cancelled
    ? "success"
    : data && !data.can_follow
      ? "permission_denied"
      : data && data.follows.length === 0
        ? "empty"
        : cachedOnly
          ? "stale"
          : "ready";

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "متابعة مورد — اشتراك تسويقي مستقلّ يُلغى وحده")}
    >
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "إلغاء المتابعة يوقف رسائل المورد التسويقية ولا يمسّ أحداث طلباتك المخوَّلة: تأكيد الطلب والشحنة والمرتجع تبقى.",
        )}
      </AppText>

      {state === "success" && cancelled ? (
        <StateView state="success" title={`${tx(T, "أُلغيت متابعة")} ${cancelled.supplier_name}`}>
          <AppText variant="secondary">{tx(T, "تم بنجاح")}</AppText>
          <Marked title={tx(T, "توقف")} items={STOPPED} mark={tx(T, "لا")} />
          <Marked title={tx(T, "لم يتوقف ولن يتوقف")} items={KEPT} mark={tx(T, "نعم")} />
          <Note>
            {tx(
              T,
              "إلغاء المتابعة قرار تسويقي. علاقتكما التجارية وسجلّها ليست إعلاناً حتى تُلغى معه.",
            )}
          </Note>
          <Button label={tx(T, "حسناً")} onPress={() => setCancelled(null)} />
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "المتابعة باسم المنشأة بصلاحية")}>
          <AppText variant="secondary">
            {tx(
              T,
              "المتابعة اشتراك B2B يصل تسويق المورد إلى المنشأة — قرارها لمن يملك ملفها لا لكل مستخدم.",
            )}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الإلغاء بحدوده")}</AppText>{" "}
            {tx(T, "· إلغاء المتابعة يوقف التسويق ولا يمحو أحداث الطلبات القائمة المخوَّلة.")}
          </AppText>
          <Button
            label={tx(T, "دليل المخازن والمتاجر")}
            onPress={() => router.push("/market/directory")}
          />
        </StateView>
      ) : null}

      {followError ? (
        <StateView state="validation_error" title={tx(T, "لم تُضَف المتابعة")}>
          <AppText variant="secondary">{followError}</AppText>
        </StateView>
      ) : null}
      {actionError ? <StateView state="offline" title={actionError} /> : null}
      {cachedOnly && data ? <StateView state="stale" title={MD_TEXTS.cached} /> : null}

      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا تتابع أحداً بعد")}>
          <AppText variant="secondary">
            {tx(
              T,
              "المتابعة اختيارية بالكامل — الشراء لا يشترطها، ولا نضيف موردين تلقائياً لأنك طلبت منهم مرة.",
            )}
          </AppText>
          <Button
            label={tx(T, "دليل المخازن والمتاجر")}
            onPress={() => router.push("/market/directory")}
          />
        </StateView>
      ) : null}

      {data && data.can_follow && data.follows.length ? (
        <>
          <AppText variant="bodyStrong">
            {tx(T, "الموردون الذين أتابعهم —")} <M>{data.active_count}</M>
          </AppText>
          <Note>{tx(T, "قائمة خاصة بك. لا يرى المورد قائمة من يتابعه كأسماء بل عدداً.")}</Note>
          <GroupedList>
            {data.follows.map((f, i) => (
              <View key={f.id}>
                <Row
                  dim={f.status === "cancelled"}
                  title={f.supplier_name}
                  sub={
                    f.status === "cancelled" ? (
                      <>
                        {tx(T, "أُلغيت المتابعة")} <CancelledWhen iso={f.cancelled_at} /> — {f.hint}
                      </>
                    ) : (
                      f.hint
                    )
                  }
                  trailing={
                    <StatusWord
                      tone={
                        f.status === "cancelled" ? "expired" : f.suspended ? "stale" : "success"
                      }
                      label={f.status_label}
                    />
                  }
                  onPress={() => router.push(`/market/suppliers/${f.supplier_tenant_id}`)}
                  last
                />
                <View style={{ paddingHorizontal: SPACE["4"], paddingBottom: SPACE["2"] }}>
                  {f.status === "active" ? (
                    <Button
                      label={tx(T, "إلغاء المتابعة")}
                      variant="secondary"
                      loading={busy === f.id}
                      onPress={() => void unfollow(f)}
                      disabledReason={cachedOnly ? MD_TEXTS.needsServer : undefined}
                    />
                  ) : (
                    <Button
                      label={tx(T, "تابع من جديد")}
                      variant="secondary"
                      loading={busy === f.id}
                      onPress={() => void refollow(f)}
                      disabledReason={cachedOnly ? MD_TEXTS.needsServer : undefined}
                    />
                  )}
                </View>
                {i < data.follows.length - 1 ? <View style={{ height: SPACE["2"] }} /> : null}
              </View>
            ))}
          </GroupedList>
          <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "ما يتوقّف وما يبقى بعد الإلغاء")}
          </AppText>
          <Marked title={tx(T, "يتوقف")} items={data.what_stops} mark={tx(T, "لا")} />
          <Marked title={tx(T, "يبقى")} items={data.what_stays} mark={tx(T, "نعم")} />
        </>
      ) : null}
    </Screen>
  );
}
