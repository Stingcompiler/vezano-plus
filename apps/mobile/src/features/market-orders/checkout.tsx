import { formatMinor } from "@sting/app-core";
import { AppText, Button, Chip, StateView, TextField } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import {
  ChipRow,
  Heading,
  LinesWord,
  M,
  Note,
  Para,
  Row,
  Shell,
  Stack,
  StatusWord,
  Units,
  When,
} from "@/components/market-orders/parts";
import {
  type CartLine,
  clearOpId,
  dm as dmLabel,
  opIdFor,
  readCart,
  type Rejection,
  safePost,
  saveAttempt,
  writeCart,
} from "@/features/market-orders/lib";
import { tOf } from "@/features/market-orders/texts";
import type { Order, VerifiedLine } from "@/features/market-orders/types";
import { useSession } from "@/lib/session";

const T = "ORD-02";
const t = tOf(T);
type State = "ready" | "validation_error" | "saving" | "expired" | "success" | "server_error";

interface Responsibility {
  who: string;
  items: string[];
}

/** ORD-02 — مراجعة وإرسال طلب أو طلب سعر (41-D33 ready/validation_error/saving/success/server_error · 10-D6 expired): من يتحمل ماذا. */
export default function Checkout() {
  const router = useRouter();
  const { api } = useSession();
  const { supplier = "" } = useLocalSearchParams<{ supplier?: string }>();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [verified, setVerified] = useState<Record<string, VerifiedLine>>({});
  const [responsibilities, setResponsibilities] = useState<Responsibility[]>([]);
  const [hours, setHours] = useState(72);
  const [kind, setKind] = useState<"order" | "quote">("order");
  const [deliveryTo, setDeliveryTo] = useState<string>(t("الفرع الرئيسي"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [failed, setFailed] = useState(false);
  const [opId, setOpId] = useState("");
  const [rejected, setRejected] = useState<{ code: string; extra: Record<string, unknown> } | null>(
    null,
  );
  const [excluded, setExcluded] = useState<string[]>([]);

  const verify = useCallback(
    async (ls: CartLine[]) => {
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
        const body = data as unknown as
          | { lines: VerifiedLine[]; responsibilities: Responsibility[]; response_hours: number }
          | undefined;
        if (response.ok && body) {
          const map: Record<string, VerifiedLine> = {};
          for (const v of body.lines) map[v.offer_id] = v;
          setVerified(map);
          setResponsibilities(body.responsibilities);
          setHours(body.response_hours);
        }
      } catch {
        /* بلا اتصال: لا تحقق — الإرسال نفسه يفشل ويُحفظ المعرّف */
      }
    },
    [api],
  );

  useEffect(() => {
    void (async () => {
      const ls = (await readCart()).lines.filter((l) => l.seller_tenant_id === supplier);
      setLines(ls);
      setCartLoaded(true);
      if (ls.length) void verify(ls);
      setOpId(await opIdFor(supplier));
    })();
  }, [supplier, verify]);

  const first = lines[0] ?? null;
  const buyerCurrency = first?.currency ?? "";
  const currencyMismatch = Object.values(verified).some(
    (v) => v.currency && buyerCurrency && v.currency !== buyerCurrency,
  );
  const expiredIds = lines
    .filter((l) => verified[l.offer_id]?.expired || excluded.includes(l.offer_id))
    .map((l) => l.offer_id);
  const sendable = lines.filter((l) => !expiredIds.includes(l.offer_id));

  const dropFromCart = async (gone: (l: CartLine) => boolean) => {
    await writeCart((await readCart()).lines.filter((l) => !gone(l)));
  };

  const submit = async (only: CartLine[] = sendable) => {
    if (busy || !first) return;
    setBusy(true);
    setFailed(false);
    setRejected(null);
    try {
      const op = await opIdFor(supplier);
      setOpId(op);
      const payload = only.map((l) => ({
        offer_id: l.offer_id,
        qty: l.qty,
        price_minor: l.price_minor,
      }));
      await saveAttempt({
        op_id: op,
        supplier_tenant_id: supplier,
        kind,
        delivery_to: deliveryTo,
        note,
        lines: payload,
        at: new Date().toISOString(),
      });
      const r = await safePost<{ order?: Order } & Rejection>(() =>
        api.POST("/api/market/orders", {
          body: {
            op_id: op,
            supplier_tenant_id: supplier,
            kind,
            delivery_to: deliveryTo,
            note,
            lines: payload,
          } as never,
        }),
      );
      if (r.kind === "offline") {
        setFailed(true);
        return;
      }
      if (r.ok && r.body?.order) {
        setOrder(r.body.order);
        await clearOpId(supplier);
        await dropFromCart((l) => only.some((x) => x.offer_id === l.offer_id));
        return;
      }
      const code = r.body?.detail ?? "";
      if (code === "line_expired") {
        const ids = ((r.body?.extra?.offer_ids as string[] | undefined) ?? []).filter(Boolean);
        setExcluded((cur) => [...new Set([...cur, ...ids])]);
        await verify(lines);
        return;
      }
      if (code === "price_changed") {
        router.push("/market/cart");
        return;
      }
      setRejected({ code, extra: r.body?.extra ?? {} });
    } finally {
      setBusy(false);
    }
  };

  const inquire = async () => {
    try {
      const { data, response } = await api.GET("/api/market/orders", {
        params: { query: { op_id: await opIdFor(supplier) } },
      });
      const body = data as unknown as { orders: Order[] } | undefined;
      const found = response.ok && body ? body.orders[0] : undefined;
      if (found) {
        setOrder(found);
        setFailed(false);
        await clearOpId(supplier);
        await dropFromCart((l) => l.seller_tenant_id === supplier);
      }
    } catch {
      /* ما زال بلا اتصال: يبقى server_error */
    }
  };

  const state: State = order
    ? "success"
    : failed
      ? "server_error"
      : busy
        ? "saving"
        : expiredIds.length && kind === "order"
          ? "expired"
          : currencyMismatch || rejected
            ? "validation_error"
            : "ready";
  const expiredLine = lines.find((l) => expiredIds.includes(l.offer_id)) ?? null;
  const limitMinor =
    typeof rejected?.extra.limit_minor === "string" ? rejected.extra.limit_minor : "0";

  return (
    <Shell id={T} state={state} title={t("السوق")}>
      <Heading>{t("مراجعة الطلب قبل الإرسال — من يتحمل ماذا")}</Heading>

      {state === "success" && order ? (
        <StateView state="success" title={t("أُرسل الطلب")}>
          <Para>
            <M>{order.number_label}</M> {t("إلى")} {order.supplier_name} · {order.status_label} ·{" "}
            {t("· مهلة الرد")} <M>{order.response_hours}</M> {t("ساعة حتى")}{" "}
            <When iso={order.deadline_at} />{" "}
            {t("— وعند انقضائها يُعرض الطلب بلا ردّ وتقرر أنت إبقاءه أو إلغاءه.")}
          </Para>
          <Note>
            {t("أُرسل ليست قُبل")} {t("· لا التزام مالي ولا حجز مخزون الآن.")}
          </Note>
          <Button label={t("طلباتي")} financial onPress={() => router.push("/market/orders")} />
        </StateView>
      ) : null}

      {state === "server_error" ? (
        <StateView state="server_error" title={t("فشل الإرسال")}>
          <Para>{t("الشبكة قُطعت أثناء الإرسال، ولا نعرف هل وصل الطلب.")}</Para>
          <Note>
            {t("المعرّف محفوظ")} {t("· إعادة المحاولة تُرسل الطلب نفسه بمعرّفه لا طلباً جديداً.")}
          </Note>
          <Stack>
            <Button
              label={t("أعد المحاولة بالمعرّف نفسه")}
              financial
              onPress={() => void submit()}
            />
            <Button
              label={t("استعلم عن الحالة")}
              variant="secondary"
              onPress={() => void inquire()}
            />
            <Button
              label={t("افتح صفحة الردّ المفقود")}
              variant="quiet"
              onPress={() =>
                router.push({ pathname: "/market/orders/recover", params: { op: opId } })
              }
            />
          </Stack>
        </StateView>
      ) : null}

      {state === "saving" ? (
        <StateView state="saving" title={t("جارٍ الإرسال")}>
          <Para>
            {t("الإرسال فعلٌ واحد بمعرّف واحد. الزرّ يُقفل ولا يُنشئ ضغطٌ ثانٍ طلباً ثانياً.")}
          </Para>
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        currencyMismatch ? (
          <StateView state="validation_error" title={t("عملة العرض تخالف عملة حسابك")}>
            <Para>{t("العرض بعملة أخرى وحساب المنشأة بعملة واحدة غير قابلة للتبديل.")}</Para>
            <Note>
              {t("لا تحويل ضمني")} {t("· نمنع التأكيد ولا نحوّل بسعر صرف مفترض.")}
            </Note>
          </StateView>
        ) : rejected ? (
          <StateView state="validation_error" title={t("لم يُرسل")}>
            <Para>
              {rejected.code === "permission_denied" ? (
                <>
                  {t("الإرسال توقيع على مبلغ يتجاوز سقفك (")}
                  <M>{formatMinor(limitMinor)}</M>
                  {t(") — يرسله من يملك الصلاحية.")}
                </>
              ) : rejected.code === "min_order_not_met" ? (
                t("قسمٌ تحت حدّه الأدنى — عُد إلى السلة وأكمل الفارق.")
              ) : rejected.code === "supplier_suspended" ? (
                t("نشر هذه المنشأة معلَّق — لا طلب جديد حتى يُرفع التعليق.")
              ) : (
                t("تعذّر الإرسال — راجع السلة.")
              )}
            </Para>
            <Button label={t("السلة")} onPress={() => router.push("/market/cart")} />
          </StateView>
        ) : null
      ) : null}

      {first && !order ? (
        <>
          <Stack>
            {state === "expired" ? <StatusWord tone="expired" label={t("منتهي الصلاحية")} /> : null}
            <StatusWord tone="synced" label={kind === "order" ? t("طلب") : t("طلب سعر")} />
          </Stack>
          <AppText variant="bodyStrong">
            {t("مراجعة طلب إلى")} {first.seller_name}
          </AppText>
          <Note>
            <LinesWord n={lines.length} /> {t("· التسليم إلى")} {deliveryTo || "—"}
          </Note>

          {state === "expired" && expiredLine ? (
            <StateView state="expired" title={t("بند واحد انتهى تأكيده أثناء مراجعتك.")}>
              <Para>
                {expiredLine.public_name}{" "}
                {t(
                  "سعره لم يعد مؤكداً. الإرسال متاح للبنود المؤكدة وحدها، أو تنتظر تأكيداً جديداً له. لن نرسل البند بسعره القديم ولن نحذفه دون علمك.",
                )}
              </Para>
              <Stack>
                <Button
                  label={
                    sendable.length === 2 ? t("إرسال البندين المؤكدين") : t("إرسال البنود المؤكدة")
                  }
                  financial
                  loading={busy}
                  onPress={() => void submit(sendable)}
                  disabledReason={sendable.length ? undefined : t("لا بند مؤكداً للإرسال")}
                />
                <Button
                  label={`${t("طلب تأكيد جديد")} ${
                    expiredLine.public_name.startsWith(t("ال"))
                      ? `${t("ل")}${expiredLine.public_name}`
                      : `${t("لل")}${expiredLine.public_name}`
                  }`}
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: "/market/suppliers/[id]", params: { id: supplier } })
                  }
                />
              </Stack>
            </StateView>
          ) : null}

          {lines.map((l, i) => {
            const v = verified[l.offer_id];
            const isExpired = expiredIds.includes(l.offer_id);
            return (
              <Row
                key={l.offer_id}
                dim={isExpired}
                last={i === lines.length - 1}
                title={
                  <>
                    {l.public_name} — <Units n={l.qty} unit={l.unit_name || t("وحدة")} />
                  </>
                }
                sub={
                  kind === "quote" ? (
                    t("بلا التزام سعري — السعر يأتي في عرض المورد")
                  ) : isExpired ? (
                    <>
                      {t("آخر سعر معروف")} <M>{formatMinor(l.price_minor)}</M>
                    </>
                  ) : (
                    <>
                      <M>{formatMinor(l.price_minor)}</M> {t("لل")}
                      {l.unit_name || t("وحدة")}
                    </>
                  )
                }
                trailing={
                  isExpired ? (
                    <StatusWord
                      tone="expired"
                      label={`${t("انتهى تأكيده")} ${v?.valid_until ? dmLabel(v.valid_until) : ""} ${t("— غير قابل للإرسال")}`}
                    />
                  ) : kind === "order" ? (
                    <StatusWord
                      tone="success"
                      label={`${t("سعر مؤكد خادمياً حتى")} ${
                        v?.valid_until
                          ? dmLabel(v.valid_until)
                          : l.valid_until
                            ? dmLabel(l.valid_until)
                            : "—"
                      }`}
                    />
                  ) : null
                }
              />
            );
          })}

          <Note>
            {t("رسوم التوصيل")}:{" "}
            {verified[first.offer_id]?.fees_label ??
              first.fees_label ??
              t("حسب شروط المورد المنشورة")}{" "}
            {t("— من شروط الخدمة المعلنة")}
          </Note>
          <Note>
            {t("مهلة رد المورد")}: <M>{hours}</M>{" "}
            {t("ساعة من الإرسال — وبعدها يُعرض الطلب بلا ردّ")}
          </Note>

          {responsibilities.length ? <Heading>{t("المسؤوليات في هذا الطلب")}</Heading> : null}
          {responsibilities.map((r) => (
            <Row key={r.who} title={r.who} last>
              {r.items.map((x) => (
                <Note key={x}>• {x}</Note>
              ))}
            </Row>
          ))}

          <AppText variant="bodyStrong">{t("ما الذي ترسله؟")}</AppText>
          <ChipRow>
            <Chip label={t("طلب")} on={kind === "order"} onPress={() => setKind("order")} />
            <Chip label={t("طلب سعر")} on={kind === "quote"} onPress={() => setKind("quote")} />
          </ChipRow>
          <Note>
            {kind === "order"
              ? t("طلبٌ على سعر مؤكَّد قائم — السعر يُثبت بقبول المورد")
              : t("طلب سعرٍ بلا التزام سعري — المورد يردّ بعرض")}
          </Note>
          <TextField label={t("التسليم إلى")} value={deliveryTo} onChangeText={setDeliveryTo} />
          <TextField label={t("ملاحظة للمورد (اختيارية)")} value={note} onChangeText={setNote} />
          {state !== "expired" ? (
            <Stack>
              <Button
                label={kind === "order" ? t("أرسل الطلب") : t("أرسل طلب السعر")}
                financial
                loading={busy}
                onPress={() => void submit()}
                disabledReason={
                  currencyMismatch
                    ? t("عملة العرض تخالف عملة حسابك — لا تحويل ضمني")
                    : !sendable.length
                      ? t("لا بند للإرسال")
                      : undefined
                }
              />
              <Button
                label={t("عُد إلى السلة")}
                variant="secondary"
                onPress={() => router.push("/market/cart")}
              />
            </Stack>
          ) : null}
        </>
      ) : null}

      {cartLoaded && !first && !order ? (
        <StateView state="empty" title={t("لا بنود لهذا المورد في سلتك")}>
          <Button label={t("السلة")} onPress={() => router.push("/market/cart")} />
        </StateView>
      ) : null}
    </Shell>
  );
}
