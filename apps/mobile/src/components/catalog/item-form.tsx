import { formatMinor, parseMoneyInput } from "@sting/app-core";
import { mtx, tx } from "@sting/texts";
import { AppText, Button, SPACE, StateView, TextField, useColors } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { M, Parts } from "@/components/catalog/parts";
import { SelectField } from "@/components/catalog/select-field";
import {
  describeError,
  describeServerErrors,
  errorsTitle,
  type GroupRef,
  type ItemCard,
  type ItemFieldError,
  parseFactorInput,
  type ServerFieldError,
  type UnitRow,
} from "@/features/catalog/lib";
import { type CreateRoute, goHref } from "@/features/catalog/nav";
import { useSession } from "@/lib/session";

export type ItemFormState = "ready" | "validation_error" | "saving" | "success";
const F = "shared:features/catalog/item-form.tsx";

interface Step {
  readonly t: string;
  readonly done: boolean;
}

export interface ItemFormProps {
  readonly mode: "create" | "edit";
  readonly units: readonly UnitRow[];
  readonly groups: readonly GroupRef[];
  readonly initial?: ItemCard | undefined;
  readonly initialName?: string | undefined;
  readonly onState: (s: ItemFormState) => void;
  readonly onSaved?: ((card: ItemCard) => void) | undefined;
}

/**
 * CAT-02 — إنشاء صنف وبطاقته. الحقول والترتيب والتحقق والخطوات كالويب: الوحدة قبل السعر؛ الحفظ =
 * تحقّق من تفرّد الباركود ثم حفظ البطاقة؛ وكل الأخطاء تظهر معاً وما كتبتَه باقٍ. (الصورة غير مبنية على
 * الجوال: `expo-image-picker` غير مثبّتة.) الباركود يُكتب أو يُمسح بالكاميرا (NAT-01).
 */
export function ItemForm({
  mode,
  units,
  groups,
  initial,
  initialName,
  onState,
  onSaved,
}: ItemFormProps) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const larger0 = initial?.units[0];
  const [name, setName] = useState(initial?.name ?? initialName ?? "");
  const [groupId, setGroupId] = useState(initial?.group_id ?? "");
  const [baseUnitId, setBaseUnitId] = useState(initial?.base_unit_id ?? "");
  const [largerUnitId, setLargerUnitId] = useState(larger0?.unit_id ?? "");
  const [factor, setFactor] = useState(larger0 ? String(Number(larger0.factor_milli) / 1000) : "");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [price, setPrice] = useState(
    initial ? formatMinor(initial.sale_price_minor, 2, false) : "",
  );
  const [state, setStateRaw] = useState<ItemFormState>("ready");
  const [errors, setErrors] = useState<ItemFieldError[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saved, setSaved] = useState<ItemCard | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lost, setLost] = useState(false);
  const setState = (s: ItemFormState) => {
    setStateRaw(s);
    onState(s);
  };

  const baseUnit = units.find((u) => u.id === baseUnitId);
  const largerUnit = units.find((u) => u.id === largerUnitId);
  const factorMilli = useMemo(() => parseFactorInput(factor), [factor]);
  const priceMinor = parseMoneyInput(price || "0");
  const errorFor = (key: string) => errors.find((e) => e.key === key)?.msg;

  const save = async (addAnother: boolean) => {
    if (state === "saving") return;
    setErrors([]);
    setSaved(null);
    setLost(false);
    setSteps([
      { t: tx(F, "تحقّق من تفرّد الباركود"), done: false },
      { t: tx(F, "حفظ بطاقة الصنف"), done: false },
    ]);
    setState("saving");
    const mark = (i: number) =>
      setSteps((s) => s.map((x, j) => (j === i ? { ...x, done: true } : x)));

    try {
      const found: ServerFieldError[] = [];
      if (!name.trim()) found.push({ field: "name", code: "required" });
      if (!baseUnitId) found.push({ field: "base_unit_id", code: "required" });
      if (barcode.trim()) {
        const { data } = await api.GET("/api/catalog/barcode", {
          params: {
            query: { value: barcode.trim(), ...(initial ? { exclude_item_id: initial.id } : {}) },
          },
        });
        const chk = data as unknown as {
          taken: boolean;
          owner_item_id: string;
          owner_item_name: string;
          owner_unit_name: string;
          barcode: string;
        } | null;
        if (chk?.taken)
          found.push({
            field: "barcode",
            code: "barcode_taken",
            barcode: chk.barcode,
            owner_item_id: chk.owner_item_id,
            owner_item_name: chk.owner_item_name,
            owner_unit_name: chk.owner_unit_name,
          });
      }
      if (found.length) {
        setErrors(found.map(describeError));
        setState("validation_error");
        return;
      }
      mark(0);

      let card: ItemCard | null = null;
      if (mode === "create") {
        const { data, error, response } = await api.POST("/api/catalog/items", {
          body: {
            name,
            base_unit_id: baseUnitId,
            ...(groupId ? { group_id: groupId } : {}),
            barcode: barcode.trim(),
            sale_price_minor: priceMinor ?? price,
            larger_unit_id: largerUnitId,
            larger_factor_milli: largerUnitId ? (factorMilli ?? factor) : "",
          },
        });
        if (response.status === 400 && error) {
          setErrors(describeServerErrors(error));
          setState("validation_error");
          return;
        }
        if (!response.ok || !data) {
          setState("ready");
          return;
        }
        card = data;
      } else if (initial) {
        const { data, error, response } = await api.PATCH("/api/catalog/items/{item_id}", {
          params: { path: { item_id: initial.id } },
          body: {
            name,
            group_id: groupId,
            ...(initial.base_unit_locked ? {} : { base_unit_id: baseUnitId }),
            barcode: barcode.trim(),
            sale_price_minor: priceMinor ?? price,
          },
        });
        if (response.status === 400 && error) {
          setErrors(describeServerErrors(error));
          setState("validation_error");
          return;
        }
        if (!response.ok || !data) {
          setState("ready");
          return;
        }
        card = data;
      }
      if (!card) return;
      mark(1);
      setSaved(card);
      onSaved?.(card);
      setState("success");
      if (addAnother) resetKeepingUnit();
    } catch {
      // انقطعت الشبكة: لا حفظ نصف مكتمل، وما كُتب باقٍ
      setLost(true);
      setState("ready");
    }
  };

  const resetKeepingUnit = () => {
    setName("");
    setBarcode("");
    setPrice("");
    setErrors([]);
  };

  const busy = state === "saving";
  const disabledReason = busy ? tx(F, "جارٍ الحفظ") : undefined;
  const previewName = `${name.trim() || "—"} — ${baseUnit?.name ?? "—"}`;
  const priceLabel = baseUnit ? `${tx(F, "سعر بيع ال")}${baseUnit.name}` : tx(F, "سعر البيع");

  return (
    <View>
      <TextField
        label={tx(F, "اسم الصنف")}
        hint={tx(F, "كما ينطقه الكاشير")}
        value={name}
        onChangeText={setName}
        error={errorFor("name")}
        editable={!busy}
        required
      />
      <SelectField
        label={tx(F, "الوحدة الأساسية")}
        hint={tx(F, "لا تتغيّر بعد أول حركة")}
        value={baseUnitId}
        onChange={setBaseUnitId}
        options={[{ value: "", label: "" }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
        error={errorFor("base_unit_id")}
        disabledReason={
          initial?.base_unit_locked ? tx(F, "لا تتغيّر بعد أول حركة") : disabledReason
        }
      />
      {mode === "create" ? (
        <>
          <SelectField
            label={tx(F, "وحدة أكبر وتحويلها")}
            hint={tx(F, "اختيارية")}
            value={largerUnitId}
            onChange={setLargerUnitId}
            options={[
              { value: "", label: "" },
              ...units
                .filter((u) => u.id !== baseUnitId)
                .map((u) => ({ value: u.id, label: u.name })),
            ]}
            error={errorFor("units")}
            disabledReason={disabledReason}
          />
          <TextField
            label={tx(F, "المعامل")}
            mono
            keyboardType="decimal-pad"
            value={factor}
            onChangeText={setFactor}
            editable={!busy && Boolean(largerUnitId)}
            hint={largerUnitId ? undefined : tx(F, "اختر الوحدة الأكبر أولاً")}
          />
        </>
      ) : (
        <View style={{ marginBottom: SPACE["3"], gap: SPACE["2"] }}>
          {initial?.units.length ? (
            initial.units.map((u) => (
              <AppText key={u.id} variant="secondary" muted>
                {u.name} = <M>{Number(u.factor_milli) / 1000}</M> {initial.base_unit_name}
              </AppText>
            ))
          ) : (
            <AppText variant="secondary" muted>
              {tx(F, "وحدة أكبر وتحويلها — اختيارية")}
            </AppText>
          )}
          {initial ? (
            <>
              <Button
                label={tx(F, "الوحدات")}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: "/catalog/[id]/units", params: { id: initial.id } })
                }
              />
              <Button
                label={tx(F, "تاريخ السعر")}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: "/catalog/[id]/price", params: { id: initial.id } })
                }
              />
            </>
          ) : null}
        </View>
      )}
      <TextField
        label={tx(F, "الباركود")}
        hint={tx(F, "هوية لا اسم — لا يحمله صنفان")}
        mono
        keyboardType="number-pad"
        value={barcode}
        onChangeText={setBarcode}
        error={errorFor("barcode")}
        editable={!busy}
      />
      <View style={{ marginBottom: SPACE["3"] }}>
        <Button
          label={mtx("scanTitle")}
          variant="secondary"
          onPress={() => setScanning(true)}
          disabledReason={disabledReason}
        />
      </View>
      <TextField
        label={priceLabel}
        hint={tx(F, "شامل الضريبة")}
        mono
        keyboardType="decimal-pad"
        value={price}
        onChangeText={setPrice}
        error={errorFor("sale_price_minor")}
        editable={!busy}
      />
      {groups.length ? (
        <SelectField
          label={tx(F, "المجموعة")}
          value={groupId}
          onChange={setGroupId}
          options={[
            { value: "", label: "" },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
          disabledReason={disabledReason}
        />
      ) : null}

      <View style={{ marginBottom: SPACE["3"] }}>
        <Button
          label={tx(F, "اعرض البطاقة")}
          variant="quiet"
          onPress={() => setShowPreview((v) => !v)}
        />
        {showPreview ? (
          <View style={{ gap: SPACE["1"], paddingTop: SPACE["2"] }}>
            <AppText variant="note" muted>
              {tx(F, "بطاقة الصنف كما تُقرأ")}
            </AppText>
            <AppText variant="bodyStrong">{previewName}</AppText>
            {largerUnit && factor.trim() && baseUnit ? (
              <AppText variant="secondary" muted>
                {largerUnit.name} = <M>{factor.trim()}</M> {baseUnit.name} · {tx(F, "البيع بال")}
                {baseUnit.name} {tx(F, "وال")}
                {largerUnit.name}
              </AppText>
            ) : null}
            {barcode.trim() ? (
              <AppText variant="secondary">
                <M>{barcode.trim()}</M>
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>

      {state === "validation_error" && errors.length ? (
        <StateView state="validation_error" title={errorsTitle(errors.length)}>
          {errors.map((e) => (
            <View key={e.key + e.msg} style={{ gap: SPACE["1"], marginBottom: SPACE["2"] }}>
              <AppText variant="bodyStrong" style={{ color: c.state.validation_error.fg }}>
                {e.field} — {e.msg}
              </AppText>
              {e.why.length ? <Parts parts={e.why} variant="secondary" /> : null}
              {e.fix ? (
                <AppText variant="secondary">
                  {tx(F, "المخرج:")} {e.fix}
                </AppText>
              ) : null}
              {e.link ? (
                <Button
                  label={e.link.label}
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: "/catalog/[id]", params: { id: e.link?.id ?? "" } })
                  }
                />
              ) : null}
            </View>
          ))}
          <AppText variant="note">{tx(F, "ما كتبتَه باقٍ كما هو.")}</AppText>
        </StateView>
      ) : null}

      {lost ? (
        <StateView state="offline" title={tx("ACC-01", "بلا اتصال")}>
          <AppText variant="secondary">{tx(F, "ما كتبتَه باقٍ كما هو.")}</AppText>
        </StateView>
      ) : null}

      {state === "saving" ? (
        <StateView state="saving" title={tx(F, "جارٍ الحفظ")}>
          {steps.map((s) => (
            <AppText key={s.t} variant="secondary">
              {s.t}
              {s.done ? ` — ${tx(F, "تمّ")}` : ""}
            </AppText>
          ))}
          <AppText variant="note">{tx(F, "الأزرار معطّلة والنافذة لا تُغلق.")}</AppText>
        </StateView>
      ) : null}

      {state === "success" && saved ? (
        <StateView state="success" title={tx(F, "حُفظ الصنف")}>
          <AppText variant="bodyStrong">
            {saved.name} — {saved.base_unit_name}
          </AppText>
          <AppText variant="secondary">
            {[
              saved.barcode ? tx(F, "الباركود مرتبط") : null,
              saved.units[0]
                ? `${tx(F, "البيع بال")}${saved.base_unit_name} ${tx(F, "وال")}${saved.units[0].name} ${tx(F, "مفعّل")}`
                : null,
              tx(F, "الرصيد الافتتاحي صفر"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </AppText>
          <AppText variant="secondary">
            {tx(F, "الصنف موجود ولا رصيد له.")}{" "}
            {tx(F, "بيعه الآن يُخرج المخزون إلى سالب، وهذا قرار لا خطأ.")}
          </AppText>
          <Button
            label={tx(F, "أضف رصيداً افتتاحياً لهذا الصنف")}
            onPress={() => goHref(router, `/inventory/opening?item=${saved.id}` as CreateRoute)}
          />
          <Button
            label={tx(F, "أنشئ صنفاً آخر بنفس الوحدة والمجموعة")}
            variant="secondary"
            onPress={() => {
              resetKeepingUnit();
              setSaved(null);
              setState("ready");
            }}
          />
          <Button
            label={tx(F, "افتح بطاقة الصنف")}
            variant="secondary"
            onPress={() => router.push({ pathname: "/catalog/[id]", params: { id: saved.id } })}
          />
        </StateView>
      ) : null}

      <View style={{ gap: SPACE["2"] }}>
        <Button
          label={tx(F, "احفظ الصنف")}
          onPress={() => void save(false)}
          loading={busy}
          disabledReason={disabledReason}
        />
        {mode === "create" ? (
          <Button
            label={tx(F, "احفظ وأضف آخر")}
            variant="secondary"
            onPress={() => void save(true)}
            disabledReason={disabledReason}
          />
        ) : null}
      </View>

      <BarcodeScanner open={scanning} onScan={setBarcode} onClose={() => setScanning(false)} />
    </View>
  );
}
