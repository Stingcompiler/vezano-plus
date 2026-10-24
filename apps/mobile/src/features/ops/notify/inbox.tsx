import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ChipGroup, dayLabelInbox, N, Row } from "@/components/ops/ui";
import { call, useCachedGet } from "@/features/ops/net";
import { OPS } from "@/features/ops/texts";
import { nativeRoute } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openOnWeb } from "@/lib/web";

const T = "NOT-01";
type State = "ready" | "loading" | "empty" | "expired" | "permission_denied" | "stale" | "offline";
type Category = "" | "operational" | "account" | "marketing";

export interface Item {
  id: string;
  kind: string;
  category: "operational" | "account" | "marketing";
  category_label: string;
  title: string;
  body: string;
  href: string;
  screen: string;
  needs_action: boolean;
  locked: boolean;
  expired: boolean;
  resolved: boolean;
  read: boolean;
  occurred_at: string;
  expires_at: string;
  link_token: string;
  link_expires_at: string;
}
export interface InboxPayload {
  items: Item[];
  needs_action: number;
  unread: number;
  category: string;
  as_of: string;
}
type OpenResult = {
  status: "ok" | "link_expired" | "expired" | "permission_denied";
  title: string;
  href: string;
  screen?: string;
};

export const INBOX_CACHE = "ops.inbox_cache";

const LABEL: Record<Item["category"], string> = {
  operational: tx(T, "تشغيلي"),
  account: tx(T, "حسابي"),
  marketing: tx(T, "تسويقي"),
};

/** يفتح وجهة الإشعار داخل التطبيق إن كان لها شاشة أصلية وإلا على الويب. */
export function goHref(router: ReturnType<typeof useRouter>, href: string) {
  const native = nativeRoute(href);
  if (native) router.push(native);
  else void openOnWeb(href);
}

/**
 * NOT-01 — صندوق الوارد والتفاصيل (نظير `inbox-client.tsx`): التشغيلي فوق التسويقي دائماً؛ مصدر الحقيقة
 * خادمي والقائمة تُحفظ للعرض بلا اتصال؛ الرابط يحمل صلاحية تُفحص على الخادم عند الفتح (ACC-113)؛ المنتهي
 * يُوسم ويُعطَّل زرّه ولا يُمحى؛ ما يخصّ المالك يظهر عنوانه ويُحجب محتواه. `id` = شاشة التفاصيل المكدّسة.
 */
export function InboxScreen({ id = "" }: { id?: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [category, setCategory] = useState<Category>("");
  const [opened, setOpened] = useState<OpenResult | null>(null);
  const deepLinked = useRef(false);

  const load = useCallback(
    () =>
      call<InboxPayload>(() =>
        api.GET("/api/notifications", {
          params: { query: category ? { category } : {} },
        }),
      ),
    [api, category],
  );
  const { p, data, failed, denied, reload } = useCachedGet<InboxPayload>({
    cacheKey: category ? undefined : INBOX_CACHE,
    load,
  });

  const items = p?.items ?? [];
  const selected = id ? (items.find((i) => i.id === id) ?? null) : null;

  const open = useCallback(
    async (item: Item) => {
      setOpened(null);
      if (item.locked) {
        setOpened({ status: "permission_denied", title: item.title, href: "" });
        return;
      }
      const r = await call<OpenResult>(() =>
        api.POST("/api/notifications/{notification_id}/{action}", {
          params: { path: { notification_id: item.id, action: "open" } },
          body: { token: item.link_token } as never,
        }),
      );
      const out =
        r.data ??
        (r.status === 403 ? { status: "permission_denied", title: item.title, href: "" } : null);
      setOpened(
        out ?? {
          status: "link_expired",
          title: item.title,
          href: item.href,
          screen: item.screen,
        },
      );
      if (out && out.status === "ok") void reload();
    },
    [api, reload],
  );

  // الرابط العميق: يُعاد فحص التخويل على الخادم عند فتح التفاصيل
  useEffect(() => {
    if (!id || !selected || deepLinked.current) return;
    deepLinked.current = true;
    void open(selected);
  }, [id, selected, open]);

  const muteMarketing = async () => {
    await call(
      () =>
        api.PUT("/api/notifications/preferences", {
          body: { prefs: { marketing: { in_app: false } } } as never,
        }) as never,
    );
    void reload();
  };

  const state: State = id
    ? selected
      ? opened?.status === "permission_denied" || (selected.locked && !opened)
        ? "permission_denied"
        : selected.expired || opened?.status === "expired"
          ? "expired"
          : "ready"
      : p
        ? "empty"
        : failed
          ? "offline"
          : "loading"
    : denied
      ? "permission_denied"
      : !p && failed
        ? "offline"
        : !p
          ? "loading"
          : failed && data === null
            ? "stale"
            : items.length === 0
              ? "empty"
              : "ready";

  const byCategory = (cat: Item["category"]) => items.filter((i) => i.category === cat);
  const goOpen = (item: Item) =>
    router.push({ pathname: "/notify/inbox/[id]", params: { id: item.id } });

  return (
    <Screen
      screenId={T}
      state={state}
      title={id ? tx(T, "تفاصيل الإشعار") : tx(T, "الإشعارات")}
      onRefresh={() => void reload()}
    >
      {!id ? (
        <>
          <AppText variant="section" style={{ marginBottom: SPACE["2"] }}>
            {tx(T, "صندوق الوارد — التشغيلي فوق التسويقي دائماً")}
          </AppText>
          <ChipGroup label={tx(T, "النوع")}>
            <Chip label={tx(T, "الوارد")} on={category === ""} onPress={() => setCategory("")} />
            <Chip
              label={tx(T, "تشغيلي")}
              on={category === "operational"}
              onPress={() => setCategory("operational")}
            />
            <Chip
              label={tx(T, "حسابي")}
              on={category === "account"}
              onPress={() => setCategory("account")}
            />
            <Chip
              label={tx(T, "تسويقي")}
              on={category === "marketing"}
              onPress={() => setCategory("marketing")}
            />
          </ChipGroup>
          {p ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              <N>{p.needs_action}</N> {tx(T, "تحتاج إجراءً ·")} <N>{p.unread}</N>{" "}
              {tx(T, "غير مقروء")}
            </AppText>
          ) : null}
        </>
      ) : null}

      {state === "loading" ? <StateView state="loading" title={tx(T, "جلب الوارد")} /> : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(T, "جلب الوارد")}>
          <AppText variant="secondary">{OPS.offlineNone}</AppText>
        </StateView>
      ) : null}
      {state === "stale" ? (
        <StateView state="stale" title={tx(T, "جلب الوارد")}>
          <AppText variant="secondary">{OPS.offlineCached}</AppText>
        </StateView>
      ) : null}
      {!id && state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "إشعار لدورٍ آخر")} />
      ) : null}

      {!id && state === "empty" ? (
        category ? (
          <StateView state="empty" title={tx(T, "لا نتائج لهذا المرشّح")}>
            <Button
              variant="secondary"
              label={tx(T, "امسح المرشّح")}
              onPress={() => setCategory("")}
            />
          </StateView>
        ) : (
          <StateView state="empty" title={tx(T, "لا إشعارات")}>
            <AppText variant="secondary">{tx(T, "صندوقٌ فارغ فعلاً لا مرشَّحٌ لا يطابق.")}</AppText>
          </StateView>
        )
      ) : null}

      {id && selected ? (
        <View style={{ gap: SPACE["3"] }}>
          <AppText variant="title">{selected.title}</AppText>
          <AppText variant="note" muted>
            {LABEL[selected.category]} · {dayLabelInbox(selected.occurred_at)}{" "}
            <N>{hhmm(selected.occurred_at)}</N>
          </AppText>
          {state === "permission_denied" ? (
            <StateView state="permission_denied" title={tx(T, "إشعار لدورٍ آخر")} />
          ) : state === "expired" ? (
            <StateView state="expired" title={tx(T, "إشعار انتهت صلاحيته")}>
              <AppText variant="secondary">{tx(T, "يبقى مقروءاً ولا يُخفى.")}</AppText>
              <AppText variant="note" muted>
                {selected.body}
              </AppText>
              <Button
                label={
                  selected.screen ? `${tx(T, "افتح")} ${selected.screen} ←` : tx(T, "التفاصيل ←")
                }
                onPress={() => undefined}
                disabledReason={tx(T, "انتهت صلاحية هذا الإشعار")}
              />
            </StateView>
          ) : (
            <>
              <AppText>{selected.body}</AppText>
              {opened?.status === "link_expired" ? (
                <StateView state="expired" title={tx(T, "انتهت صلاحية هذا الرابط")} />
              ) : null}
              {selected.href ? (
                <Button
                  label={
                    selected.screen ? `${tx(T, "افتح")} ${selected.screen} ←` : tx(T, "التفاصيل ←")
                  }
                  onPress={() => goHref(router, selected.href)}
                />
              ) : null}
              {selected.category === "marketing" ? (
                <Button
                  variant="secondary"
                  label={tx(T, "إيقاف هذا النوع")}
                  onPress={() => void muteMarketing()}
                />
              ) : null}
            </>
          )}
          <Button variant="quiet" label={tx(T, "رجوع")} onPress={() => router.back()} />
        </View>
      ) : null}

      {id && !selected && state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا إشعارات")}>
          <Button variant="quiet" label={tx(T, "رجوع")} onPress={() => router.back()} />
        </StateView>
      ) : null}

      {!id && items.length > 0
        ? (["operational", "account", "marketing"] as const).map((cat) =>
            byCategory(cat).length ? (
              <GroupedList key={cat} title={LABEL[cat]}>
                {byCategory(cat).map((i, idx, arr) => (
                  <Row
                    key={i.id}
                    title={i.title}
                    detail={
                      <>
                        {dayLabelInbox(i.occurred_at)} <N>{hhmm(i.occurred_at)}</N>
                        {" · "}
                        {i.locked ? (
                          tx(T, "يخصّ المالك")
                        ) : (
                          <>
                            {i.body}
                            {i.expired
                              ? ` ${tx(T, "— انتهت صلاحيته")}`
                              : i.resolved
                                ? ` ${tx(T, "— زال سببه")}`
                                : ""}
                          </>
                        )}
                      </>
                    }
                    trailing={
                      !i.read ? (
                        <AppText variant="note" style={{ color: c.state.pending_sync.fg }}>
                          {tx(T, "غير مقروء")}
                        </AppText>
                      ) : i.expired ? (
                        <AppText variant="note" style={{ color: c.state.expired.fg }}>
                          {tx(T, "إشعار انتهت صلاحيته")}
                        </AppText>
                      ) : undefined
                    }
                    onPress={() => goOpen(i)}
                    last={idx === arr.length - 1}
                  />
                ))}
              </GroupedList>
            ) : null,
          )
        : null}
    </Screen>
  );
}
