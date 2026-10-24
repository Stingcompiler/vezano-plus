import { formatQty } from "@sting/app-core";
import { fromBaseQtyMilliForDisplay, parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  RADIUS,
  Screen,
  Sheet,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { M } from "@/components/catalog/parts";
import { CatRow, Line } from "@/components/catalog/row";
import { SelectField } from "@/components/catalog/select-field";
import {
  describeServerErrors,
  factorText,
  type ItemFieldError,
  monthWord,
  parseFactorInput,
} from "@/features/catalog/lib";
import { readShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "CAT-03";
type State = "ready" | "validation_error" | "success" | "offline" | "loading";

interface Change {
  readonly id: string;
  readonly old_factor_milli: string;
  readonly new_factor_milli: string;
  readonly prior_lines: number;
  readonly changed_by_name: string;
  readonly changed_at: string;
}
interface CardUnit {
  readonly id: string;
  readonly unit_id: string;
  readonly name: string;
  readonly decimal_places: number;
  readonly factor_milli: string;
  readonly barcode: string;
  readonly created_at: string;
  readonly prior_lines: number;
  readonly changes: readonly Change[];
}
interface Card {
  readonly id: string;
  readonly name: string;
  readonly base_unit_id: string;
  readonly base_unit_name: string;
  readonly base_unit_decimal_places: number;
  readonly barcode: string;
  readonly units: readonly CardUnit[];
}
interface UnitOpt {
  readonly id: string;
  readonly name: string;
  readonly is_base: boolean;
}

/** «حتى مارس 2025» — الشهر عربياً والسنة رقماً لاتينياً في mono (القاعدة 2). */
function monthYear(iso: string): { month: string; year: string } {
  const d = new Date(iso);
  return { month: tx(T, monthWord(d.getMonth())), year: String(d.getFullYear()) };
}

/**
 * CAT-03 — وحدات وتحويلات وباركود. القاعدة الحرجة: تغيير معامل التحويل لا يُعيد تفسير سطور البيع السابقة
 * (ACC-19) — يسري من الآن ويُسجَّل في تاريخ التغيير باسم من غيّره. الأمثلة المحسوبة من `@sting/domain`.
 * الجدول على الجوال قائمة؛ كل وحدة تُغيَّر من ورقة سفلية (خطة الجوال M3).
 */
export default function UnitsScreen() {
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { api, state: session } = useSession();
  const [card, setCard] = useState<Card | null>(null);
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [offline, setOffline] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addUnitId, setAddUnitId] = useState("");
  const [addFactor, setAddFactor] = useState("");
  const [addBarcode, setAddBarcode] = useState("");
  const [editing, setEditing] = useState<CardUnit | null>(null);
  const [newFactor, setNewFactor] = useState("");
  const [errors, setErrors] = useState<ItemFieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ unit: CardUnit; prior: number; old: string } | null>(null);
  const [me, setMe] = useState("");

  const load = useCallback(async () => {
    setOffline(false);
    try {
      const [cr, u] = await Promise.all([
        api.GET("/api/catalog/items/{item_id}", { params: { path: { item_id: itemId ?? "" } } }),
        api.GET("/api/catalog/units"),
      ]);
      if (cr.data) setCard(cr.data);
      setUnits((u.data as unknown as { units?: UnitOpt[] } | undefined)?.units ?? []);
    } catch {
      setOffline(true);
    }
  }, [api, itemId]);

  useEffect(() => {
    void load();
    void getStorage()
      .then((s) => readShiftContext(s, { deviceId: session.deviceId, userId: session.userId }))
      .then((ctx) => setMe(ctx?.userName ?? ""))
      .catch(() => undefined);
  }, [load, session.deviceId, session.userId]);

  const errorFor = (key: string) => errors.find((e) => e.key === key)?.msg;

  const addUnit = async () => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const { data, error, response } = await api.POST("/api/catalog/items/{item_id}/units", {
        params: { path: { item_id: itemId ?? "" } },
        body: {
          unit_id: addUnitId,
          factor_milli: parseFactorInput(addFactor) ?? addFactor,
          barcode: addBarcode.trim(),
        },
      });
      if (response.status === 400 && error) {
        setErrors(describeServerErrors(error));
        return;
      }
      if (response.ok && data) {
        const next = data as unknown as Card;
        setCard(next);
        const unit = next.units.find((u) => u.unit_id === addUnitId);
        if (unit) setSaved({ unit, prior: 0, old: "" });
        setAdding(false);
        setAddUnitId("");
        setAddFactor("");
        setAddBarcode("");
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const confirmChange = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const { data, error, response } = await api.PATCH(
        "/api/catalog/items/{item_id}/units/{item_unit_id}",
        {
          params: { path: { item_id: itemId ?? "", item_unit_id: editing.id } },
          body: { factor_milli: parseFactorInput(newFactor) ?? newFactor },
        },
      );
      if (response.status === 400 && error) {
        setErrors(describeServerErrors(error));
        return;
      }
      if (response.ok && data) {
        const next = data as unknown as Card;
        setCard(next);
        const unit = next.units.find((u) => u.id === editing.id);
        if (unit) setSaved({ unit, prior: editing.prior_lines, old: editing.factor_milli });
        setEditing(null);
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = offline
    ? "offline"
    : saved
      ? "success"
      : errors.length || (editing && editing.prior_lines > 0)
        ? "validation_error"
        : card
          ? "ready"
          : "loading";

  const examples = useMemo(() => {
    if (!card) return [];
    const sample = card.base_unit_decimal_places >= 3 ? "123" : "1000";
    return card.units.map((u) => {
      const f = parseUnitFactor(u.factor_milli, "1000");
      const one = factorText(toBaseQtyMilli(1000n, f).toString());
      let half: string | null = null;
      try {
        half = factorText(toBaseQtyMilli(500n, f).toString());
      } catch {
        half = null;
      }
      return {
        u,
        one,
        half,
        sample: formatQty(sample, card.base_unit_decimal_places as 0 | 1 | 2 | 3),
        inUnit: formatQty(fromBaseQtyMilliForDisplay(BigInt(sample), f), 3),
      };
    });
  }, [card]);

  const editFrom = editing ? monthYear(editing.created_at) : null;
  const rows = card
    ? [
        {
          key: "base",
          unit: null as CardUnit | null,
          name: card.base_unit_name,
          factor: "1",
          barcode: card.barcode,
        },
        ...card.units.map((u) => ({
          key: u.id,
          unit: u,
          name: u.name,
          factor: factorText(u.factor_milli),
          barcode: u.barcode,
        })),
      ]
    : [];

  return (
    <Screen
      screenId={T}
      state={state}
      title={card ? `${card.name} ${tx(T, "— الوحدات")}` : tx(T, "الوحدات")}
    >
      {offline ? (
        <StateView state="offline" title={tx("ACC-01", "بلا اتصال")}>
          <Button label={tx("ACC-01", "أعد المحاولة")} onPress={() => void load()} />
        </StateView>
      ) : null}

      {saved ? (
        <StateView state="success" title={tx(T, "حُفظت الوحدات")}>
          <AppText variant="secondary">
            {tx(T, "البيع بال")}
            {card?.base_unit_name} {tx(T, "وبال")}
            {saved.unit.name} {tx(T, "معاً")}
            {saved.unit.barcode ? ` ${tx(T, "· باركود لكل وحدة")}` : ""}
          </AppText>
          {saved.old ? (
            <AppText variant="secondary">
              {tx(T, "يسري من الآن ·")} <M>{saved.prior}</M> {tx(T, "سطر بيع سابق يستخدم المعامل")}{" "}
              <M>{factorText(saved.old)}</M>
            </AppText>
          ) : null}
        </StateView>
      ) : null}

      {card ? (
        <GroupedList title={tx(T, "الوحدات")}>
          {rows.map((r, i) => (
            <CatRow
              key={r.key}
              title={
                r.unit === null ? (
                  <>
                    {r.name}{" "}
                    <AppText variant="note" style={{ color: c.state.ready.fg }}>
                      {tx(T, "الأساس")}
                    </AppText>
                  </>
                ) : (
                  r.name
                )
              }
              lines={
                <>
                  <Line>
                    {tx(T, "المعامل")}: <M>{r.factor}</M>
                    {r.unit ? ` ${card.base_unit_name}` : ""}
                  </Line>
                  <Line>
                    {tx(T, "الباركود")}: {r.barcode ? <M>{r.barcode}</M> : "—"}
                  </Line>
                </>
              }
              trailing={
                r.unit ? (
                  <Button
                    label={`${tx(T, "تغيير معامل ال")}${r.name}`}
                    variant="secondary"
                    onPress={() => {
                      setSaved(null);
                      setErrors([]);
                      setNewFactor(factorText(r.unit?.factor_milli ?? "0"));
                      setEditing(r.unit);
                    }}
                  />
                ) : undefined
              }
              last={i === rows.length - 1}
            />
          ))}
        </GroupedList>
      ) : null}

      {examples.length ? (
        <View style={{ marginBottom: SPACE["4"], gap: SPACE["2"] }}>
          <AppText variant="section" muted>
            {tx(T, "أمثلة محسوبة")}
          </AppText>
          {examples.map((x) => (
            <View key={x.u.id}>
              <AppText variant="secondary">
                {x.u.name} {tx(T, "واحدة =")} <M>{x.one}</M> {card?.base_unit_name}
              </AppText>
              {x.half ? (
                <AppText variant="secondary">
                  {tx(T, "نصف")} {x.u.name} = <M>{x.half}</M> {card?.base_unit_name}
                </AppText>
              ) : null}
              <AppText variant="secondary">
                <M>{x.sample}</M> {card?.base_unit_name} = <M>{x.inUnit}</M> {x.u.name}{" "}
                {tx(T, "— يُعرض بالوحدة الأساس")}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <Button
        label={tx(T, "إضافة وحدة")}
        onPress={() => {
          setSaved(null);
          setErrors([]);
          setAdding(true);
        }}
        disabledReason={card ? undefined : tx(T, "الوحدات")}
      />

      <Sheet
        open={adding}
        title={tx(T, "إضافة وحدة")}
        onClose={() => {
          setAdding(false);
          setErrors([]);
        }}
      >
        <SelectField
          label={tx(T, "الوحدة")}
          value={addUnitId}
          onChange={setAddUnitId}
          options={[
            { value: "", label: "" },
            ...units
              .filter((u) => u.id !== card?.base_unit_id)
              .map((u) => ({ value: u.id, label: u.name })),
          ]}
          error={errorFor("unit_id")}
        />
        <TextField
          label={tx(T, "المعامل")}
          mono
          keyboardType="decimal-pad"
          value={addFactor}
          onChangeText={setAddFactor}
          hint={card ? `${tx(T, "بال")}${card.base_unit_name}` : undefined}
          error={errorFor("factor_milli")}
          required
        />
        <TextField
          label={tx(T, "الباركود")}
          mono
          keyboardType="number-pad"
          value={addBarcode}
          onChangeText={setAddBarcode}
          error={errorFor("barcode")}
        />
        {errors
          .filter((e) => e.key === "barcode" && e.why.length)
          .map((e) => (
            <AppText key={e.key} variant="secondary" style={{ marginBottom: SPACE["3"] }}>
              {e.why.map((p, i) => (typeof p === "string" ? p : <M key={i}>{p.n}</M>))}
            </AppText>
          ))}
        <Button
          label={tx(T, "إضافة وحدة")}
          onPress={() => void addUnit()}
          loading={busy}
          disabledReason={addUnitId ? undefined : tx(T, "الوحدة")}
        />
      </Sheet>

      <Sheet
        open={editing !== null}
        title={editing ? `${tx(T, "تغيير معامل ال")}${editing.name}` : tx(T, "تغيير")}
        onClose={() => {
          setEditing(null);
          setErrors([]);
        }}
      >
        {editing && card ? (
          <View>
            <AppText variant="note" muted>
              {tx(T, "المعامل الحالي")}
            </AppText>
            <AppText style={{ marginBottom: SPACE["3"] }}>
              <M>{factorText(editing.factor_milli)}</M>
            </AppText>
            <TextField
              label={tx(T, "المعامل الجديد")}
              mono
              keyboardType="decimal-pad"
              value={newFactor}
              onChangeText={setNewFactor}
              error={errorFor("factor_milli")}
              required
            />
            {editing.prior_lines > 0 ? (
              <View
                style={{
                  backgroundColor: c.state.validation_error.bg,
                  borderColor: c.state.validation_error.border,
                  borderWidth: 1,
                  borderRadius: RADIUS.panelSm,
                  padding: SPACE["3"],
                  gap: SPACE["1"],
                  marginBottom: SPACE["3"],
                }}
              >
                <AppText variant="bodyStrong" style={{ color: c.state.validation_error.fg }}>
                  <M>{editing.prior_lines}</M> {tx(T, "سطر بيع سابق يستخدم المعامل")}{" "}
                  <M>{factorText(editing.factor_milli)}</M>
                </AppText>
                <AppText variant="secondary">
                  {tx(T, "لن تتغير. كل سطر بيع يحفظ معامله لحظة الحفظ، فتبقى فاتورة أمس «")}
                  {editing.name} = <M>{factorText(editing.factor_milli)}</M> {card.base_unit_name}
                  {tx(T, "» إلى الأبد. المعامل الجديد يسري على البيع من الآن فقط.")}
                </AppText>
              </View>
            ) : null}
            <AppText variant="section" muted style={{ marginTop: SPACE["2"] }}>
              {tx(T, "تاريخ التغيير — يظهر في بطاقة الصنف")}
            </AppText>
            {editing.changes.map((ch) => {
              const my = monthYear(ch.changed_at);
              return (
                <AppText key={ch.id} variant="secondary">
                  <M>{factorText(ch.old_factor_milli)}</M> {card.base_unit_name} {tx(T, "· حتى")}{" "}
                  {my.month} <M>{my.year}</M> · <M>{ch.prior_lines}</M> {tx(T, "سطراً")}
                </AppText>
              );
            })}
            <AppText variant="secondary">
              <M>{factorText(editing.factor_milli)}</M> {card.base_unit_name} {tx(T, "· من")}{" "}
              {editFrom?.month} <M>{editFrom?.year}</M> {tx(T, "حتى اليوم ·")}{" "}
              <M>{editing.prior_lines}</M> {tx(T, "سطراً")}
            </AppText>
            <AppText variant="secondary" style={{ marginBottom: SPACE["3"] }}>
              <M>{factorText(parseFactorInput(newFactor) ?? "0")}</M> {card.base_unit_name}{" "}
              {tx(T, "· من اليوم —")} {me}
            </AppText>
            <Button
              label={tx(T, "تأكيد تغيير المعامل")}
              onPress={() => void confirmChange()}
              loading={busy}
              disabledReason={parseFactorInput(newFactor) ? undefined : tx(T, "المعامل الجديد")}
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
