import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  Sheet,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { FetchFail } from "@/components/market-seller/fetch-fail";
import {
  ChipRow,
  Heading,
  Lead,
  M,
  NodeChip,
  Note,
  RadioRows,
  Row,
  Stack,
} from "@/components/market-seller/parts";
import { netState, priceToMinor, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import type { Offer } from "@/features/market-seller/offers";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "MP-11";

interface ItemOpt {
  id: string;
  name: string;
  base_unit_code: string;
  base_unit_name: string;
  units: { code: string; name: string; factor_milli: string }[];
}

interface Preview {
  card: { title: string; seller_line: string; price_minor: string; price_line: string };
  published_fields: { title: string; hint: string }[];
  missing: { key: string; title: string; hint: string }[];
  hidden_fields: { title: string; hint: string }[];
  can_publish: boolean;
  seller_verified: boolean;
  plan_allows: boolean;
}

interface Form {
  item_id: string;
  public_name: string;
  description: string;
  unit_code: string;
  pack_label: string;
  price: string;
  min_order_qty: string;
  max_order_qty: string;
  fulfilment_note: string;
  audience: "public" | "private" | "followers";
  valid_until: string;
}

const EMPTY: Form = {
  item_id: "",
  public_name: "",
  description: "",
  unit_code: "",
  pack_label: "",
  price: "",
  min_order_qty: "",
  max_order_qty: "",
  fulfilment_note: "",
  audience: "public",
  valid_until: "",
};

/** نسخة نصّية لعنوان الزرّ (التسمية نص واحد): الرقم لاتيني. */
const countLabel = (n: number) =>
  n === 1 ? tx(T, "حقل ناقص") : n === 2 ? tx(T, "حقلان ناقصان") : `${n} ${tx(T, "حقول ناقصة")}`;

/** MP-11 — إنشاء عرض ونشره (08-D4 validation_error · 43-D35 ready/saving/permission_denied/success). */
export default function OfferEditScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [form, setForm] = useState<Form>(EMPTY);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [published, setPublished] = useState<Offer | null>(null);
  const [offlineTry, setOfflineTry] = useState(false);
  const [pickItem, setPickItem] = useState(false);
  const [q, setQ] = useState("");

  const itemsSrv = useServerGet<ItemOpt[]>("cache.market.offer-items", () =>
    safeGet(
      () => api.GET("/api/catalog/items", { params: { query: {} } }),
      (b) => (b as { items?: ItemOpt[] } | undefined)?.items,
    ),
  );
  const items = itemsSrv.shown ?? [];
  const offerSrv = useServerGet<Offer>(
    `cache.market.offer.${id ?? "new"}`,
    () =>
      safeGet(
        () =>
          api.GET("/api/market/offers/{offer_id}", { params: { path: { offer_id: id ?? "" } } }),
        (b) => (b as { offer?: Offer } | undefined)?.offer,
      ),
    [id],
    Boolean(id),
  );

  useEffect(() => {
    const o = offerSrv.data;
    if (!o) return;
    setForm({
      item_id: o.item_id,
      public_name: o.public_name,
      description: o.description,
      unit_code: o.unit_code,
      pack_label: o.pack_label,
      price: o.price_minor ? formatMinor(o.price_minor).replace(/,/g, "") : "",
      min_order_qty: o.min_order_qty ? String(o.min_order_qty) : "",
      max_order_qty: o.max_order_qty ? String(o.max_order_qty) : "",
      fulfilment_note: o.fulfilment_note,
      audience: o.audience,
      valid_until: o.valid_until,
    });
  }, [offerSrv.data]);

  const body = useCallback(
    (f: Form) => ({
      item_id: f.item_id,
      public_name: f.public_name,
      description: f.description,
      unit_code: f.unit_code,
      unit_name: (() => {
        const it = items.find((x) => x.id === f.item_id);
        if (!it) return "";
        if (it.base_unit_code === f.unit_code) return it.base_unit_name;
        return it.units.find((u) => u.code === f.unit_code)?.name ?? "";
      })(),
      pack_label: f.pack_label,
      price_minor: priceToMinor(f.price),
      min_order_qty: f.min_order_qty,
      max_order_qty: f.max_order_qty,
      fulfilment_note: f.fulfilment_note,
      audience: f.audience,
      valid_until: f.valid_until,
    }),
    [items],
  );

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void send<Preview>(() =>
        api.POST("/api/market/offers/preview", { body: body(form) as never }),
      ).then((r) => {
        if (alive && r.kind === "ok" && r.body.card) setPreview(r.body);
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [form, body, api]);

  const save = async (publish: boolean) => {
    if (saving) return;
    setAttempted(publish);
    setOfflineTry(false);
    if (publish && preview && preview.missing.length) return;
    setSaving(true);
    try {
      const payload = { ...body(form), publish };
      const r = await send<{ offer?: Offer }>(() =>
        id
          ? api.PUT("/api/market/offers/{offer_id}", {
              params: { path: { offer_id: id } },
              body: payload as never,
            })
          : api.POST("/api/market/offers", { body: payload as never }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "ok" && r.body.offer) {
        if (publish) setPublished(r.body.offer);
        else router.push("/market/offers");
      }
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const item = items.find((x) => x.id === form.item_id);
  const missingCount = preview?.missing.length ?? 0;
  const net = netState(itemsSrv.net, itemsSrv.fromCache, itemsSrv.status);
  const state: StateCode = published
    ? "success"
    : saving
      ? "saving"
      : preview && !preview.can_publish
        ? "permission_denied"
        : attempted && missingCount
          ? "validation_error"
          : (net ?? "ready");
  const shownItems = items.filter((i) => !q.trim() || i.name.includes(q.trim()));
  const publishReason =
    preview && !preview.can_publish
      ? tx(T, "النشر النهائي بصلاحية أعلى — ناشر الكتالوج يحرّر المسودة")
      : preview && !preview.seller_verified
        ? tx(T, "النشر بعد اعتماد دور البائع")
        : undefined;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "إنشاء عرض — النشر اختيار حقول لا تصدير مخزون")}
    >
      <Lead>
        {tx(
          T,
          "صنف يُختار لا مخزون يُنشر: العرض يبدأ باختيار صنفٍ من كتالوجك، وتُعرض قائمة الحقول التي ستُنشر منه حرفياً.",
        )}
      </Lead>
      <FetchFail
        net={net}
        hasData={Boolean(itemsSrv.shown)}
        onRetry={() => void itemsSrv.reload()}
      />
      {net && itemsSrv.shown ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "success" && published ? (
        <StateView state="success" title={tx(T, "نُشر العرض")}>
          <AppText variant="secondary">
            {tx(T, "بسعرٍ وصلاحية معلنة وجمهور — ورابط «كما يراه المشتري».")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الصلاحية تبدأ الآن")}</AppText>{" "}
            {tx(
              T,
              "· وتنتهي بتاريخها ما لم تُجدَّد صريحاً. النشر ليس التزاماً أبدياً — وانتهاؤه ليس عطلاً.",
            )}
          </AppText>
          <Button
            label={tx(T, "كما يراه المشتري — عروضي")}
            onPress={() => router.push("/market/offers")}
          />
        </StateView>
      ) : null}

      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "حفظ المسودة")}>
          <AppText variant="secondary">
            {tx(T, "المسودة عندك ولا يراها السوق حتى تُنشر صريحاً.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "التحرير غير النشر")}>
          <AppText variant="secondary">
            {tx(
              T,
              "ناشر الكتالوج يحرّر المسودة، والنشر النهائي بصلاحية أعلى إن ضُبط كذلك في «الأدوار والصلاحيات».",
            )}
          </AppText>
        </StateView>
      ) : null}

      {state === "validation_error" && preview ? (
        <StateView
          state="validation_error"
          title={`${countLabel(missingCount)} ${tx(T, "يمنعان النشر")}`}
        >
          <AppText variant="secondary">
            {preview.missing.map((m) => m.title).join(` ${tx(T, "و")}`)}
            {tx(
              T,
              ". بدونهما يصل المشتري إلى سلة لا يعرف فيها ما يشتري، ويصل إليك طلب لا تستطيع تنفيذه.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {state !== "success" ? (
        <>
          <Heading>
            {tx(T, "عرض جديد")}
            {form.public_name ? ` — ${form.public_name}` : ""}
          </Heading>

          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
            {tx(T, "الصنف من كتالوجك")}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx(T, "الصنف من كتالوجك")}
            onPress={() => setPickItem(true)}
            style={{
              minHeight: 52,
              justifyContent: "center",
              paddingHorizontal: SPACE["3"],
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 12,
              backgroundColor: c.surfaceCard,
              marginBottom: SPACE["3"],
            }}
          >
            <AppText>{item?.name ?? tx(T, "— اختر —")}</AppText>
          </Pressable>
          <Sheet
            open={pickItem}
            title={tx(T, "الصنف من كتالوجك")}
            onClose={() => setPickItem(false)}
          >
            <TextField label={tx(T, "الصنف من كتالوجك")} value={q} onChangeText={setQ} />
            <GroupedList>
              {shownItems.slice(0, 60).map((i, idx, arr) => (
                <Row
                  key={i.id}
                  title={i.name}
                  onPress={() => {
                    set({
                      item_id: i.id,
                      public_name: form.public_name || i.name,
                      unit_code: "",
                    });
                    setPickItem(false);
                    setQ("");
                  }}
                  last={idx === arr.length - 1}
                />
              ))}
            </GroupedList>
          </Sheet>

          <TextField
            label={tx(T, "الاسم المصرَّح به")}
            value={form.public_name}
            onChangeText={(v) => set({ public_name: v })}
            hint={tx(T, "نص منفصل عن اسمك الداخلي — تعدّله للسوق دون تغيير بطاقتك")}
          />
          <TextField
            label={tx(T, "الوصف المصرَّح به")}
            value={form.description}
            onChangeText={(v) => set({ description: v })}
            multiline
          />

          <AppText variant="bodyStrong" style={{ marginBottom: SPACE["1"] }}>
            {tx(T, "وحدة البيع")}
          </AppText>
          {item ? (
            <ChipRow>
              {[{ code: item.base_unit_code, name: item.base_unit_name }, ...item.units].map(
                (u) => (
                  <NodeChip
                    key={u.code}
                    on={form.unit_code === u.code}
                    onPress={() => set({ unit_code: u.code })}
                  >
                    {u.name}
                  </NodeChip>
                ),
              )}
            </ChipRow>
          ) : (
            <Note>{MS_TEXTS.noUnits}</Note>
          )}
          {attempted && !form.unit_code ? (
            <Note tone="danger">{tx(T, "مطلوب — بدونها لا تظهر البطاقة في المقارنة")}</Note>
          ) : null}

          <TextField
            label={tx(T, "العبوة")}
            value={form.pack_label}
            onChangeText={(v) => set({ pack_label: v })}
            hint={tx(T, "مثال: كرتونة 12×1كغ")}
          />
          <TextField
            label={tx(T, "السعر للوحدة")}
            mono
            keyboardType="decimal-pad"
            value={form.price}
            onChangeText={(v) => set({ price: v })}
            hint={tx(T, "اتركه فارغاً ليظهر «اطلب تأكيد سعر»")}
          />
          <TextField
            label={tx(T, "حد أدنى للطلب")}
            mono
            keyboardType="decimal-pad"
            value={form.min_order_qty}
            onChangeText={(v) => set({ min_order_qty: v })}
            error={
              attempted && !form.min_order_qty
                ? tx(T, "مطلوب — يحدد ما تستطيع تنفيذه فعلاً")
                : undefined
            }
          />
          <TextField
            label={tx(T, "حد أقصى للطلب")}
            mono
            keyboardType="decimal-pad"
            value={form.max_order_qty}
            onChangeText={(v) => set({ max_order_qty: v })}
            hint={tx(T, "اختياري — يُعرض بدل الكمية الفعلية")}
          />
          <TextField
            label={tx(T, "المنطقة وطريقة التنفيذ")}
            value={form.fulfilment_note}
            onChangeText={(v) => set({ fulfilment_note: v })}
            hint={tx(T, "توصيل داخل المنطقة أو استلام من المخزن")}
          />
          <TextField
            label={tx(T, "سارٍ حتى")}
            mono
            keyboardType="numbers-and-punctuation"
            value={form.valid_until}
            onChangeText={(v) => set({ valid_until: v })}
            hint={`${tx(T, "فارغ = 14 يوماً من النشر")} — ${MS_TEXTS.dateHint}`}
          />
          <RadioRows
            label={tx(T, "الجمهور")}
            value={form.audience}
            onChange={(v) => set({ audience: v })}
            options={[
              {
                value: "public",
                label: tx(T, "عام — كل من يبحث في السوق"),
                hint: tx(T, "السعر يظهر فقط إن اخترت سعراً عاماً. غير ذلك يظهر «اطلب تأكيد سعر»."),
              },
              {
                value: "private",
                label: tx(T, "قائمة خاصة — مشترون مخوَّلون"),
                hint: tx(T, "منشأة ثالثة لا ترى هذا السعر ولا تعرف بوجوده. الرفض عام بلا تسريب."),
              },
              {
                value: "followers",
                label: tx(T, "متابعو منشأتك فقط"),
                hint: tx(T, "المتابعة اشتراك B2B مستقل، وإلغاؤه لا يمحو أحداث الطلبات السابقة."),
              },
            ]}
          />

          {preview ? (
            <>
              <Heading>{tx(T, "معاينة البطاقة العامة")}</Heading>
              <Note>{tx(T, "معاينة عامة.")}</Note>
              <Note>
                {tx(
                  T,
                  "ما يراه غير المدعوّ: الصنف والوحدة والمنطقة وشروط الخدمة. لا يرى سعرك الخاص ولا اسم المشتري المخوَّل ولا رصيد مخزونك.",
                )}
              </Note>
              <AppText variant="title">{preview.card.title || "—"}</AppText>
              <Note>{preview.card.seller_line}</Note>
              <View style={{ marginBottom: SPACE["3"] }}>
                <AppText>
                  {preview.card.price_minor ? (
                    <M>{formatMinor(preview.card.price_minor)}</M>
                  ) : (
                    preview.card.price_line
                  )}
                </AppText>
              </View>
              <GroupedList title={tx(T, "ما يُنشر من بطاقة الصنف الداخلية")}>
                {preview.published_fields.map((f) => (
                  <Row
                    key={`p:${f.title}`}
                    title={f.title}
                    sub={f.hint}
                    trailing={
                      <AppText variant="note" muted>
                        {tx(T, "يُنشر")}
                      </AppText>
                    }
                  />
                ))}
                {preview.missing.map((f) => (
                  <Row
                    key={`m:${f.key}`}
                    title={f.title}
                    sub={f.hint}
                    trailing={
                      <AppText variant="note" style={{ color: c.danger }}>
                        {tx(T, "ناقص")}
                      </AppText>
                    }
                  />
                ))}
                {preview.hidden_fields.map((f, i) => (
                  <Row
                    key={`h:${f.title}`}
                    title={f.title}
                    sub={f.hint}
                    trailing={
                      <AppText variant="note" muted>
                        {tx(T, "محجوب")}
                      </AppText>
                    }
                    last={i === preview.hidden_fields.length - 1}
                  />
                ))}
              </GroupedList>
            </>
          ) : null}

          <Stack>
            <Button
              label={missingCount ? `${tx(T, "نشر")} — ${countLabel(missingCount)}` : tx(T, "نشر")}
              financial
              loading={saving}
              disabledReason={publishReason}
              onPress={() => void save(true)}
            />
            <Button
              label={tx(T, "حفظ كمسودة")}
              variant="secondary"
              loading={saving}
              onPress={() => void save(false)}
            />
            <Button
              label={tx(T, "رجوع")}
              variant="quiet"
              onPress={() => router.push("/market/offers")}
            />
          </Stack>
        </>
      ) : null}
    </Screen>
  );
}
