import { formatMinor, hhmm } from "@sting/app-core";
import { AppText, Button, GroupedList, SPACE, StateView, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import {
  Cells,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  Units,
} from "@/components/market-orders/parts";
import { type CartLine, readCart, writeCart } from "@/features/market-orders/lib";
import { tOf } from "@/features/market-orders/texts";
import type { VerifiedLine } from "@/features/market-orders/types";
import { useSession } from "@/lib/session";

const T = "ORD-01";
const t = tOf(T);
type State = "ready" | "empty" | "offline" | "validation_error" | "stale";

/** ORD-01 — سلة ومسودة طلب (41-D33 ready/empty/validation_error/stale · 08-D4 offline): كل مورد اتفاقٌ منفصل ولا مجموع كلّي. */
export default function Cart() {
  const router = useRouter();
  const { api, state: session } = useSession();
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [verified, setVerified] = useState<Record<string, VerifiedLine>>({});
  const [saved, setSaved] = useState(false);
  const [netDown, setNetDown] = useState(false);
  const linesRef = useRef<CartLine[]>([]);

  const verify = useCallback(
    async (ls: CartLine[]) => {
      if (!ls.length) return;
      try {
        const { data, response } = await api.POST("/api/market/orders/verify", {
          body: {
            lines: ls.map((l) => ({
              offer_id: l.offer_id,
              qty: l.qty,
              price_minor: l.price_minor,
            })),
          } as never,
        });
        const body = data as unknown as { lines: VerifiedLine[] } | undefined;
        setNetDown(false);
        if (response.ok && body) {
          const map: Record<string, VerifiedLine> = {};
          for (const v of body.lines) map[v.offer_id] = v;
          setVerified(map);
        }
      } catch {
        // بلا اتصال: المسودة كما هي — لا تقدير محلي
        setNetDown(true);
      }
    },
    [api],
  );

  useEffect(() => {
    void readCart().then((cart) => {
      linesRef.current = cart.lines;
      setLines(cart.lines);
      setSavedAt(cart.at);
      void verify(cart.lines);
    });
  }, [verify]);

  const update = (next: CartLine[]) => {
    linesRef.current = next;
    setLines(next);
    setSaved(false);
    void writeCart(next).then(setSavedAt);
  };
  const setQty = (id: string, qty: number) =>
    update((lines ?? []).map((l) => (l.offer_id === id ? { ...l, qty: Math.max(0, qty) } : l)));
  const remove = (id: string) => update((lines ?? []).filter((l) => l.offer_id !== id));
  const acceptPrice = (id: string) => {
    const v = verified[id];
    if (!v) return;
    update(
      (lines ?? []).map((l) =>
        l.offer_id === id
          ? { ...l, price_minor: v.current_price_minor, unit_name: v.unit_name }
          : l,
      ),
    );
  };

  const groups = new Map<string, CartLine[]>();
  for (const l of lines ?? []) {
    const g = groups.get(l.seller_tenant_id) ?? [];
    g.push(l);
    groups.set(l.seller_tenant_id, g);
  }
  const online = !(netDown || session.offline);
  const changedLines = (lines ?? []).filter((l) => verified[l.offer_id]?.changed);
  const unitMismatch = (lines ?? []).filter((l) => {
    const v = verified[l.offer_id];
    return v && !v.expired && v.unit_name && v.unit_name !== l.unit_name;
  });
  const shortOf = (ls: CartLine[]) =>
    ls.reduce((acc, l) => {
      const v = verified[l.offer_id];
      const min = v?.min_order_qty ?? l.min_order_qty ?? 0;
      return acc + Math.max(0, min - l.qty);
    }, 0);
  const anyShort = [...groups.values()].some((ls) => shortOf(ls) > 0);

  const state: State =
    lines && lines.length === 0
      ? "empty"
      : !online
        ? "offline"
        : changedLines.length
          ? "stale"
          : anyShort || unitMismatch.length
            ? "validation_error"
            : "ready";

  const sendBlockedOffline = t("الإرسال معطَّل حتى يعود الاتصال. لا رقم طلب قبل وصوله للمورد.");

  return (
    <Shell
      id={T}
      state={state}
      title={t("السوق")}
      hint={
        state === "offline"
          ? t("المسودة تُحفظ محلياً، والإرسال يحتاج شبكة، وتغيّر السعر يحتاج موافقتك بعد الاتصال.")
          : t(
              "السلة مقسومة بالمورد: لكل قسم حدّه الأدنى ورسومه وشروط تنفيذه، ولكل قسم زرّ إرسال مستقل. الإرسال يُنشئ طلباً لكل مورد.",
            )
      }
    >
      <AppText variant="title" style={{ marginBottom: SPACE["3"] }}>
        {state === "offline"
          ? t("سلة ومسودة طلب بلا اتصال — لا تأكيد محلي")
          : t("سلة ومسودة طلب — كل مورد اتفاقٌ منفصل")}
      </AppText>

      {state === "empty" ? (
        <StateView state="empty" title={t("سلة فارغة")}>
          <Para>{t("حالةٌ سويّة — الشراء من السوق ليس عملاً يومياً.")}</Para>
          <Stack>
            <Button
              label={t("ابحث في السوق")}
              financial
              onPress={() => router.push("/market/search")}
            />
            <Button
              label={t("موردون تتابعهم")}
              variant="secondary"
              onPress={() => router.push("/market/following")}
            />
            <Button
              label={t("اقتراح إعادة التوريد")}
              variant="quiet"
              onPress={() => router.push("/grow/replenish")}
            />
          </Stack>
        </StateView>
      ) : null}

      {state === "offline" ? (
        <StateView state="offline" title={t("بلا اتصال")}>
          <Para>
            {t("السلة —")}{" "}
            {groups.size === 1 ? (
              t("مورد واحد")
            ) : groups.size === 2 ? (
              t("موردان")
            ) : (
              <>
                <M>{groups.size}</M> {t("موردين")}
              </>
            )}{" "}
            {t("· آخر تحديث")} <M>{savedAt ? hhmm(savedAt) : "—"}</M>
          </Para>
          <Note>
            {t("ما يعمل الآن بلا اتصال:")} {t("تعديل الكميات، حفظ المسودة، مقارنة ما هو محمَّل.")}
          </Note>
          <Note>
            {t("ما لا يعمل:")}{" "}
            {t(
              "إرسال الطلب، التحقق من السعر الحالي، الاطلاع على توفر جديد. لن نعطيك رقم طلب محلياً لأن الرقم يعني أن المورد استلم، وهو لم يستلم.",
            )}
          </Note>
          <Stack>
            <Button
              label={t("حفظ المسودة على الجهاز")}
              financial
              onPress={() => {
                update(lines ?? []);
                setSaved(true);
              }}
            />
            <Button
              label={t("إرسال — يحتاج اتصالاً")}
              variant="secondary"
              onPress={() => undefined}
              disabledReason={sendBlockedOffline}
            />
            {saved ? <StatusWord tone="saved_local" label={t("حُفظت المسودة")} /> : null}
          </Stack>
        </StateView>
      ) : null}

      {state === "stale" ? (
        <StateView state="stale" title={t("السعر تغيّر بعد المسودة")}>
          <Para>{t("المسودة أُعدّت بلا اتصال، والعرض جُدِّد بسعر آخر قبل الإرسال.")}</Para>
          <Note>
            {t("لا تأكيد محلي")}{" "}
            {t("· المسودة لا تُثبّت سعراً. السعر يُثبت بقبول المورد لا بحفظ المشتري.")}
          </Note>
          <Note>
            {t("الموافقة صريحة")}{" "}
            {t("· يُعرض السعران القديم والجديد والفرق، ويُطلب قبولٌ سطراً سطراً.")}
          </Note>
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        <StateView state="validation_error" title={t("وحدة أو حدٌّ أدنى غير مستوفى")}>
          <Para>
            {anyShort && unitMismatch.length
              ? t("قسمٌ تحت حدّه الأدنى، وصنفٌ مطلوب بوحدة والعرض بوحدة أخرى.")
              : anyShort
                ? t("قسمٌ تحت حدّه الأدنى — الحدّ يُعرض بالفارق لا بالرفض.")
                : t("صنفٌ مطلوب بوحدة والعرض بوحدة أخرى.")}
          </Para>
        </StateView>
      ) : null}

      {[...groups.entries()].map(([sid, ls]) => {
        const first = ls[0];
        if (!first) return null;
        const short = shortOf(ls);
        const minMax = Math.max(
          ...ls.map((l) => verified[l.offer_id]?.min_order_qty ?? l.min_order_qty ?? 0),
        );
        const fees = verified[first.offer_id]?.fees_label ?? first.fees_label ?? "";
        const subtotal = ls.reduce((acc, l) => acc + l.qty * Number(l.price_minor || 0), 0);
        const blocked =
          ls.some((l) => verified[l.offer_id]?.changed || verified[l.offer_id]?.expired) ||
          short > 0;
        return (
          <View key={sid} style={{ marginBottom: SPACE["4"] }}>
            <GroupedList title={first.seller_name}>
              <Row
                title={
                  minMax ? (
                    <MinText n={minMax} unit={first.unit_name || t("وحدة")} />
                  ) : (
                    t("بلا حدّ أدنى")
                  )
                }
                sub={fees || undefined}
                last
              />
              {ls.map((l, i) => {
                const v = verified[l.offer_id];
                const minQ = v?.min_order_qty ?? l.min_order_qty ?? 0;
                const lineShort = Math.max(0, minQ - l.qty);
                return (
                  <Row
                    key={l.offer_id}
                    title={l.public_name}
                    sub={l.pack_label || l.unit_name}
                    dim={Boolean(v?.expired)}
                    last={i === ls.length - 1}
                    trailing={
                      v?.expired ? (
                        <StatusWord tone="expired" label={t("انتهى تأكيده — غير قابل للإرسال")} />
                      ) : v?.changed ? null : v && v.unit_name !== l.unit_name ? (
                        <StatusWord
                          tone="stale"
                          label={`${t("الوحدة تغيّرت:")} ${l.unit_name} ← ${v.unit_name}`}
                        />
                      ) : v ? (
                        <StatusWord tone="success" label={t("مؤكد خادمياً")} />
                      ) : (
                        <StatusWord
                          tone="saved_local"
                          label={l.price_minor ? t("محمَّل") : t("بلا سعر")}
                        />
                      )
                    }
                  >
                    <Cells
                      items={[
                        [
                          t("السعر"),
                          l.price_minor ? <M>{formatMinor(l.price_minor)}</M> : t("بلا سعر"),
                        ],
                      ]}
                    />
                    {v?.changed ? (
                      <>
                        <Note>
                          {t("الجديد")} <M>{formatMinor(v.current_price_minor)}</M> {t("· الفرق")}{" "}
                          <M>
                            {formatMinor(
                              String(Number(v.current_price_minor) - Number(l.price_minor || 0)),
                            )}
                          </M>
                        </Note>
                        <Button
                          label={t("اقبل السعر الجديد")}
                          variant="secondary"
                          onPress={() => acceptPrice(l.offer_id)}
                        />
                      </>
                    ) : null}
                    {state === "offline" ? (
                      <Note>
                        {l.price_minor ? (
                          <>
                            {t("سعر محمَّل")} <M>{savedAt ? hhmm(savedAt) : ""}</M>
                          </>
                        ) : (
                          t("سعر غير محمَّل")
                        )}
                      </Note>
                    ) : null}
                    <TextField
                      label={`${t("الكمية —")} ${l.public_name}`}
                      mono
                      keyboardType="number-pad"
                      value={String(l.qty)}
                      onChangeText={(x) => setQty(l.offer_id, Number(x.replace(/\D/g, "")))}
                    />
                    {lineShort ? (
                      <Note>
                        {t("ناقص")} <M>{lineShort}</M> {t("للوصول إلى الحدّ")}
                      </Note>
                    ) : null}
                    <Button label={t("أزل")} variant="quiet" onPress={() => remove(l.offer_id)} />
                  </Row>
                );
              })}
            </GroupedList>
            <AppText variant="secondary" style={{ marginBottom: SPACE["2"] }}>
              {t("مجموع القسم")} <M>{formatMinor(String(subtotal))}</M> <M>{first.currency}</M>
              {short ? (
                <>
                  {" "}
                  {t("· ناقص")} <M>{short}</M> {t("للوصول إلى الحدّ")}
                </>
              ) : (
                ` ${t("· الحد الأدنى مستوفى بالكميات المحمَّلة. سيُعاد التحقق عند الإرسال.")}`
              )}
            </AppText>
            <Button
              label={`${t("راجع وأرسل —")} ${first.seller_name}`}
              financial
              onPress={() =>
                router.push({ pathname: "/market/checkout", params: { supplier: sid } })
              }
              disabledReason={
                state === "offline"
                  ? sendBlockedOffline
                  : blocked
                    ? t("أكمل الحدّ الأدنى واقبل الأسعار الجديدة أولاً")
                    : undefined
              }
            />
          </View>
        );
      })}

      {lines && lines.length ? (
        <>
          <Note>
            {t("سلة بموردين")}{" "}
            {t(
              "· السلة مقسومة بالمورد: لكل قسم حدّه الأدنى ورسومه وشروط تنفيذه، ولكل قسم زرّ إرسال مستقل.",
            )}
          </Note>
          <Note>
            {t("طلبان لا طلب")} {t("· الإرسال يُنشئ طلباً لكل مورد.")}
          </Note>
        </>
      ) : null}
    </Shell>
  );
}

function MinText({ n, unit }: { n: number; unit: string }) {
  return (
    <>
      {t("حد أدنى")} <Units n={n} unit={unit} />
    </>
  );
}
