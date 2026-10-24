import { formatMinor, formatMinorShort } from "@sting/app-core";
import {
  maskPhone,
  readLocalParties,
  readPendingCreditByParty,
  storeParties,
} from "@sting/sync-core";
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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { M, PRow, Stack, SwitchRow } from "@/components/parties/parts";
import type { Card } from "@/features/parties/lib";
import { dayLabel } from "@/lib/invoices";
import { parseAmount } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-03";
type State = "ready" | "validation_error" | "saving" | "success" | "permission_denied" | "conflict";

interface Form {
  name: string;
  phone: string;
  aliases: string;
  note: string;
  limit: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

const formOf = (c: Card): Form => ({
  name: c.name,
  phone: c.phone,
  aliases: c.aliases.join(tx(T, "،") + " "),
  note: c.note,
  limit:
    c.credit_limit_minor && c.credit_limit_minor !== "0"
      ? formatMinor(c.credit_limit_minor, 2, false)
      : "",
  isCustomer: c.is_customer,
  isSupplier: c.is_supplier,
});

/**
 * PTY-03 — بطاقة طرف (خطة الجوال M3). الشخص عميل ومورد معاً برصيدين منفصلين بلا مقاصة تلقائية؛ الاسم
 * وحده إلزامي والهاتف اختياري والأسماء البديلة للبحث وحدّ الائتمان اختياري «غير محدد»؛ الكاشير يُنشئ
 * ولا يعدّل؛ التقارب يُعرض ولا يُدمج بالاسم. التعديل المتزامن/التكرار المحتمل = conflict.
 */
export default function PartyCard() {
  const router = useRouter();
  const { id: partyId } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [pending, setPending] = useState<bigint>(0n);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [denied, setDenied] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const storage = await getStorage();
        const pend = await readPendingCreditByParty(storage);
        if (!alive) return;
        setPending(pend.get(partyId)?.pendingMinor ?? 0n);
        try {
          const { data, response } = await api.GET("/api/parties/{party_id}", {
            params: { path: { party_id: partyId } },
          });
          const body = data as unknown as Card | undefined;
          if (!alive) return;
          if (!response.ok || !body) {
            setCard(await localCard(partyId));
            return;
          }
          setCard(body);
          setForm(formOf(body));
          await storeParties(storage, [body as never], new Date().toISOString());
        } catch {
          // بلا خادم: البطاقة من الإسقاط المحلي بلا تعديل
          if (alive) setCard(await localCard(partyId));
        }
      })();
      return () => {
        alive = false;
      };
    }, [api, partyId]),
  );

  useEffect(() => {
    if (card === null) router.replace("/parties");
  }, [card, router]);

  const limitMinor = form ? (form.limit.trim() ? parseAmount(form.limit) : 0n) : 0n;
  const errors: Record<string, string> = { ...serverErrors };
  if (form && !form.name.trim()) errors["name"] = tx(T, "الاسم إلزامي");
  if (form && form.limit.trim() && limitMinor === null) errors["limit"] = tx(T, "مبلغ غير صالح");
  if (form && !form.isCustomer && !form.isSupplier) errors["role"] = tx(T, "صفة واحدة على الأقل");
  const invalid = Object.keys(errors).length > 0;
  const dupes = card?.potential_duplicates ?? [];

  const state: State = denied
    ? "permission_denied"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? "success"
        : reviewing && dupes.length
          ? "conflict"
          : editing && attempted && invalid
            ? "validation_error"
            : "ready";

  const save = async () => {
    if (!card || !form || phase === "saving") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    setServerErrors({});
    try {
      const { data, response } = await api.PATCH("/api/parties/{party_id}", {
        params: { path: { party_id: card.id } },
        body: {
          name: form.name,
          phone: form.phone,
          aliases: form.aliases
            .split(/[،,]/)
            .map((a) => a.trim())
            .filter(Boolean),
          credit_limit_minor: (limitMinor ?? 0n).toString(),
          is_customer: form.isCustomer,
          is_supplier: form.isSupplier,
          note: form.note,
        },
      });
      if (response.status === 403) {
        setDenied(true);
        setPhase("idle");
        return;
      }
      if (response.status === 400) {
        const errs = (data as unknown as { errors?: { field: string; code: string }[] } | undefined)
          ?.errors;
        setServerErrors(Object.fromEntries((errs ?? []).map((e) => [e.field, e.code])));
        setPhase("idle");
        return;
      }
      const body = data as unknown as Card | undefined;
      if (!response.ok || !body) {
        setPhase("idle");
        return;
      }
      setCard(body);
      setForm(formOf(body));
      await storeParties(await getStorage(), [body as never], new Date().toISOString());
      setEditing(false);
      setPhase("saved");
    } catch {
      setPhase("idle");
    }
  };

  const markDistinct = async (otherId: string) => {
    if (!card) return;
    try {
      const { response } = await api.POST("/api/parties/{party_id}/distinct", {
        params: { path: { party_id: otherId } },
        body: { other_id: card.id },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.ok) {
        setCard({ ...card, potential_duplicates: dupes.filter((d) => d.id !== otherId) });
        if (dupes.length <= 1) setReviewing(false);
      }
    } catch {
      /* بلا شبكة: يبقى التنبيه */
    }
  };

  const both = Boolean(card?.is_customer && card.is_supplier);
  const title = both ? tx(T, "بطاقة طرف — الشخص عميل ومورد معاً") : tx(T, "بطاقة طرف");
  const due = card ? BigInt(card.balance_minor || "0") + pending : 0n;
  const lastSale = card?.last_movement_at ? dayLabel(card.last_movement_at) : null;
  const stmt = (side?: "supplier") =>
    router.push({
      pathname: "/parties/[id]/statement",
      params: side ? { id: partyId, side } : { id: partyId },
    });

  return (
    <Screen screenId={T} state={state} title={title}>
      {card ? (
        <>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "رصيدان منفصلان بلا مقاصة تلقائية.")}
          </AppText>
          <AppText variant="title">{card.name}</AppText>
          <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
            {[
              card.is_customer ? tx(T, "عميل") : "",
              card.is_supplier ? tx(T, "مورد") : "",
              card.aliases.join(" · "),
              card.note,
            ]
              .filter(Boolean)
              .join(" · ")}
            {card.phone ? (
              <>
                {" · "}
                <M>{maskPhone(card.phone)}</M>
              </>
            ) : null}
          </AppText>

          {state === "permission_denied" ? (
            <StateView state="permission_denied" title={tx(T, "الكاشير يُنشئ ولا يعدّل")}>
              <AppText variant="secondary">
                {tx(T, "يُنشئ طرفاً سريعاً وقت البيع، ولا يعدّل بطاقة قائمة ولا حدّه الآجل.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "success" ? (
            <StateView state="success" title={tx(T, "حُفظت البطاقة")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "نقول ما صار ممكناً: البيع الآجل له، والكشف، والسداد. أما رصيده الافتتاحي فبابه «الرصيد الافتتاحي».",
                )}
              </AppText>
              <AppText variant="note">
                {tx(T, "لا رصيد ضمنياً")}{" "}
                {tx(T, "· إنشاء الطرف لا يُنشئ رصيداً. الرصيد الافتتاحي مستندٌ له شاشته وصلاحيته.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "saving" ? (
            <StateView state="saving" title={tx(T, "جارٍ الحفظ")}>
              <AppText variant="secondary">
                {tx(T, "حفظٌ قصير. الأزرار معطّلة ولا تُغلق البطاقة.")}
              </AppText>
            </StateView>
          ) : null}
          {state === "validation_error" && errors["phone"] === "similar" ? (
            <StateView state="validation_error" title={tx(T, "رقم هاتف يُشبه طرفاً قائماً")}>
              <AppText variant="secondary">{tx(T, "قد يكون فرعاً ثانياً بنفس الرقم.")}</AppText>
            </StateView>
          ) : null}

          {state === "conflict" ? (
            <StateView state="conflict" title={tx(T, "طرفان باسم متقارب")}>
              <AppText variant="secondary">{tx(T, "لا نقترح الدمج ولا نفعله تلقائياً.")}</AppText>
              <AppText variant="note">
                {tx(T, "الدمج يجمع ذمتين في رصيد واحد، فلو كانا شخصين طالبتَ أحدهما بدين غيره.")}
              </AppText>
              {dupes.map((d) => (
                <View key={d.id} style={{ gap: SPACE["2"] }}>
                  <AppText variant="bodyStrong">
                    {d.name}
                    {d.phone ? (
                      <>
                        {" · "}
                        <M>{maskPhone(d.phone)}</M>
                      </>
                    ) : null}
                  </AppText>
                  <Button
                    label={tx(T, "وسمهما «مراجَعان ومنفصلان»")}
                    variant="secondary"
                    onPress={() => void markDistinct(d.id)}
                    disabledReason={card.can_edit ? undefined : tx(T, "لمدير الفرع أو المالك")}
                  />
                  <Button
                    label={tx(T, "دمج بتأكيد مزدوج")}
                    variant="danger"
                    onPress={() =>
                      router.push({
                        pathname: "/parties/[id]/merge",
                        params: { id: d.id, target: card.id },
                      })
                    }
                  />
                </View>
              ))}
            </StateView>
          ) : dupes.length && !editing ? (
            <Stack>
              <Button
                label={`${tx(T, "تكرار محتمل:")} ${dupes.length}`}
                variant="quiet"
                onPress={() => setReviewing(true)}
              />
            </Stack>
          ) : null}

          {!editing ? (
            <>
              {card.is_customer ? (
                <GroupedList>
                  <PRow
                    title={tx(T, "بصفته عميلاً — عليه لنا")}
                    trailing={
                      <M strong>
                        {card.balance_minor === "" ? "—" : formatMinorShort(due.toString())}
                      </M>
                    }
                    sub={
                      <>
                        {lastSale ? (
                          <>
                            {tx(T, "آخر بيع")} {lastSale.word ?? <M>{lastSale.n}</M>}
                          </>
                        ) : (
                          tx(T, "لا بيع مسجَّل")
                        )}
                        {" · "}
                        {tx(T, "حد ائتمان مرن")}{" "}
                        {BigInt(card.credit_limit_minor || "0") > 0n ? (
                          <>
                            <M>{formatMinorShort(card.credit_limit_minor)}</M>{" "}
                            {tx(T, "— ينبّه عند التجاوز ولا يمنع البيع")}
                          </>
                        ) : (
                          tx(T, "غير محدد")
                        )}
                      </>
                    }
                    onPress={() => stmt()}
                    last
                  />
                </GroupedList>
              ) : null}
              {card.is_supplier ? (
                <GroupedList>
                  <PRow
                    title={tx(T, "بصفته مورداً — له علينا")}
                    trailing={
                      <M strong>
                        {card.supplier_owed_minor === ""
                          ? "—"
                          : formatMinorShort(card.supplier_owed_minor)}
                      </M>
                    }
                    sub={tx(T, "لا استلام مسجَّل بعد — الاستلام من «استلام البضاعة».")}
                    onPress={() => stmt("supplier")}
                    last
                  />
                </GroupedList>
              ) : null}
              <Stack>
                {card.is_customer ? (
                  <Button
                    label={tx(T, "كشف حساب العميل")}
                    variant="secondary"
                    onPress={() => stmt()}
                  />
                ) : null}
                {card.is_supplier ? (
                  <Button
                    label={tx(T, "كشف حساب المورد")}
                    variant="secondary"
                    onPress={() => stmt("supplier")}
                  />
                ) : null}
              </Stack>
              {both ? (
                <AppText variant="note" muted style={{ marginBottom: SPACE["4"] }}>
                  {tx(T, "لا مقاصة تلقائية.")}{" "}
                  {tx(
                    T,
                    "الرصيدان مستقلان في دفترين. إن اتفقتَ معه على خصم دينه من مستحقاته، سجّل ذلك بمستندَي سداد متقابلين بسبب واضح — لا يجري النظام المقاصة نيابة عنك.",
                  )}
                </AppText>
              ) : null}
              <Stack>
                <Button
                  label={tx(T, "تعديل البطاقة")}
                  onPress={() => {
                    if (!card.can_edit) {
                      setDenied(true);
                      return;
                    }
                    setPhase("idle");
                    setEditing(true);
                  }}
                />
                <Button
                  label={tx(T, "رصيد افتتاحي")}
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: "/parties/[id]/opening", params: { id: card.id } })
                  }
                  disabledReason={card.can_open_balance ? undefined : tx(T, "الافتتاحي للمالك")}
                />
                <Button
                  label={tx(T, "قائمة العملاء")}
                  variant="quiet"
                  onPress={() => router.push("/parties")}
                />
              </Stack>
            </>
          ) : form ? (
            <>
              <TextField
                label={tx(T, "الاسم")}
                value={form.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
                error={attempted ? errors["name"] : undefined}
                required
              />
              <TextField
                label={tx(T, "الهاتف")}
                value={form.phone}
                onChangeText={(v) => setForm({ ...form, phone: v })}
                keyboardType="phone-pad"
                mono
                hint={tx(T, "اختياري")}
              />
              <TextField
                label={tx(T, "أسماء بديلة")}
                value={form.aliases}
                onChangeText={(v) => setForm({ ...form, aliases: v })}
                hint={tx(T, "للبحث — تُفصل بفاصلة")}
              />
              <TextField
                label={tx(T, "حد الائتمان")}
                value={form.limit}
                onChangeText={(v) => setForm({ ...form, limit: v })}
                keyboardType="decimal-pad"
                mono
                hint={tx(T, "اختياري · تنبيه لا منع — فارغ = غير محدد")}
                error={attempted ? errors["limit"] : undefined}
              />
              <TextField
                label={tx(T, "ملاحظة")}
                value={form.note}
                onChangeText={(v) => setForm({ ...form, note: v })}
              />
              <SwitchRow
                label={tx(T, "عميل")}
                value={form.isCustomer}
                onChange={(v) => setForm({ ...form, isCustomer: v })}
              />
              <SwitchRow
                label={tx(T, "مورد")}
                value={form.isSupplier}
                onChange={(v) => setForm({ ...form, isSupplier: v })}
                hint={attempted ? errors["role"] : undefined}
              />
              <Stack>
                <Button
                  label={tx(T, "حفظ البطاقة")}
                  financial
                  onPress={() => void save()}
                  loading={phase === "saving"}
                />
                <Button
                  label={tx(T, "إلغاء")}
                  variant="quiet"
                  onPress={() => {
                    setEditing(false);
                    setForm(formOf(card));
                    setAttempted(false);
                  }}
                  disabledReason={phase === "saving" ? tx(T, "جارٍ الحفظ") : undefined}
                />
              </Stack>
            </>
          ) : null}
        </>
      ) : (
        <StateView state="loading" title={tx(T, "جلب الأطراف")} />
      )}
    </Screen>
  );
}

/** بطاقة من الإسقاط المحلي بلا تعديل (بلا خادم). */
async function localCard(partyId: string): Promise<Card | null> {
  const local = (await readLocalParties(await getStorage())).find((p) => p.id === partyId);
  if (!local) return null;
  return {
    ...(local as unknown as Card),
    aliases: (local as unknown as { aliases?: string[] }).aliases ?? [],
    note: (local as unknown as { note?: string }).note ?? "",
    supplier_owed_minor: "",
    last_movement_at: local.last_sale_at,
    can_edit: false,
    can_open_balance: false,
    has_movements: false,
    opening_balances: [],
    potential_duplicates: [],
  };
}
