import { formatMinor, hhmm, parseMoneyInput } from "@sting/app-core";
import { lineTotalMinor } from "@sting/domain";
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
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { M } from "@/components/catalog/parts";
import { CatRow, Line } from "@/components/catalog/row";
import {
  describeServerErrors,
  type ItemFieldError,
  monthWord,
  readCache,
  writeCache,
} from "@/features/catalog/lib";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "CAT-04";
type State = "ready" | "validation_error" | "permission_denied" | "success" | "offline" | "loading";

interface PriceRow {
  readonly id: string;
  readonly price_minor: string;
  readonly effective_from: string;
  readonly effective_to: string;
  readonly changed_by_name: string;
  readonly batch_id: string;
  readonly note: string;
}
interface PriceView {
  readonly item_id: string;
  readonly name: string;
  readonly base_unit_name: string;
  readonly sale_price_minor: string;
  readonly units: readonly {
    id: string;
    name: string;
    factor_milli: string;
    price_minor: string;
  }[];
  readonly history: readonly PriceRow[];
  readonly can_change: boolean;
  readonly can_see_cost: boolean;
  readonly average_cost_minor: string;
  readonly pending_requests: readonly {
    id: string;
    proposed_price_minor: string;
    reason: string;
    requested_by_name: string;
    requested_at: string;
  }[];
}
interface BelowCost {
  readonly average_cost_minor: string;
  readonly price_minor: string;
  readonly margin_minor: string;
}

/** «12 أغسطس» — اليوم رقماً لاتينياً في mono والشهر عربياً (القاعدة 2). */
function DayMonth({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <>
      <M>{String(d.getDate()).padStart(2, "0")}</M> {tx(T, monthWord(d.getMonth()))}
    </>
  );
}

/**
 * CAT-04 — سعر صنف وتاريخ تغييره. السعر سلسلة تواريخ لا قيمة واحدة؛ الفواتير الصادرة بالسعر القديم تبقى
 * بسعرها؛ سعر الوحدة الأكبر يتبع تلقائياً (من المجال)؛ سعر دون التكلفة تنبيهٌ لا منع لمن يرى التكلفة؛
 * التغيير للمالك (`can_change` من الخادم) ولغيره طلب تغيير. آخر ردّ صالح يُحفظ ويُعرض عند انقطاع الشبكة.
 */
export default function PriceScreen() {
  const { id: itemId = "" } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const cacheKey = `cache.catalog.price.${itemId}`;
  const [view, setView] = useState<PriceView | null>(null);
  const [price, setPrice] = useState("");
  const [belowCost, setBelowCost] = useState<BelowCost | null>(null);
  const [errors, setErrors] = useState<ItemFieldError[]>([]);
  const [saved, setSaved] = useState<PriceRow | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, response } = await api.GET("/api/catalog/items/{item_id}/price", {
        params: { path: { item_id: itemId } },
      });
      if (response.ok && data) {
        const v = data as unknown as PriceView;
        setView(v);
        setOffline(false);
        setPrice(formatMinor(v.sale_price_minor, 2, false));
        void getStorage().then((s) => writeCache(s, cacheKey, v));
      }
    } catch {
      setOffline(true);
      const cached = await readCache<PriceView>(await getStorage(), cacheKey);
      if (cached) {
        setView((cur) => cur ?? cached);
        setPrice((cur) => cur || formatMinor(cached.sale_price_minor, 2, false));
      }
    }
  }, [api, cacheKey, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const priceMinor = parseMoneyInput(price || "0");

  const save = async (confirm: boolean) => {
    if (busy || !view) return;
    setBusy(true);
    setErrors([]);
    setSaved(null);
    try {
      const { data, error, response } = await api.POST("/api/catalog/items/{item_id}/price", {
        params: { path: { item_id: itemId } },
        body: { price_minor: priceMinor ?? price, confirm_below_cost: confirm },
      });
      if (response.status === 409 && error) {
        setBelowCost((error as { detail?: string }).detail === "below_cost" ? error : null);
        return;
      }
      if (response.status === 400 && error) {
        setErrors(describeServerErrors(error));
        return;
      }
      if (response.ok && data) {
        const v = data as unknown as PriceView & { changed?: boolean };
        setView(v);
        setBelowCost(null);
        setOffline(false);
        setPrice(formatMinor(v.sale_price_minor, 2, false));
        if (v.changed && v.history[0]) setSaved(v.history[0]);
        void getStorage().then((s) => writeCache(s, cacheKey, v));
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = async () => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const { error, response } = await api.POST("/api/catalog/items/{item_id}/price-request", {
        params: { path: { item_id: itemId } },
        body: { proposed_price_minor: parseMoneyInput(proposed || "0") ?? proposed, reason },
      });
      if (response.status === 400 && error) {
        setErrors(describeServerErrors(error));
        return;
      }
      if (response.ok) {
        setRequesting(false);
        setProposed("");
        setReason("");
        await load();
      }
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = !view
    ? offline
      ? "offline"
      : "loading"
    : offline
      ? "offline"
      : !view.can_change
        ? "permission_denied"
        : saved
          ? "success"
          : belowCost || errors.length
            ? "validation_error"
            : "ready";
  const errorFor = (key: string) => errors.find((e) => e.key === key)?.msg;
  const readOnly = !view?.can_change;

  return (
    <Screen
      screenId={T}
      state={state}
      title={
        view ? `${tx(T, "سعر بيع ال")}${view.name} — ${view.base_unit_name}` : tx(T, "سعر البيع")
      }
    >
      {offline ? (
        <StateView state="offline" title={tx("ACC-01", "بلا اتصال")}>
          <Button label={tx("ACC-01", "أعد المحاولة")} onPress={() => void load()} />
        </StateView>
      ) : null}

      {view && !view.can_change ? (
        <StateView state="permission_denied" title={tx(T, "تغيير السعر للمالك")}>
          <AppText variant="secondary">
            {tx(T, "مدير الفرع يرى السعر وتاريخه ولا يغيّره. السعر قرار منشأة لا فرع.")}
          </AppText>
          {requesting ? (
            <View>
              <TextField
                label={tx(T, "السعر المقترح")}
                mono
                keyboardType="decimal-pad"
                value={proposed}
                onChangeText={setProposed}
                error={errorFor("proposed_price_minor")}
                required
              />
              <TextField
                label={tx(T, "السبب")}
                value={reason}
                onChangeText={setReason}
                error={errorFor("reason")}
              />
              <Button
                label={tx(T, "اطلب تغييراً")}
                onPress={() => void sendRequest()}
                loading={busy}
                disabledReason={proposed.trim() ? undefined : tx(T, "السعر المقترح")}
              />
            </View>
          ) : (
            <Button label={tx(T, "اطلب تغييراً")} onPress={() => setRequesting(true)} />
          )}
          {view.pending_requests.map((r) => (
            <AppText key={r.id} variant="secondary">
              {tx(T, "السعر المقترح")} <M>{formatMinor(r.proposed_price_minor)}</M>
              {r.reason ? ` · ${r.reason}` : ""}
              {r.requested_by_name ? ` — ${r.requested_by_name}` : ""}
            </AppText>
          ))}
        </StateView>
      ) : null}

      {state === "validation_error" && belowCost ? (
        <StateView state="validation_error" title={tx(T, "سعر دون التكلفة")}>
          <AppText variant="secondary">
            {tx(T, "سعرٌ يُدخَل أقلّ من متوسط التكلفة — بيعٌ بخسارة.")}
          </AppText>
          <AppText variant="secondary">
            {tx(T, "الهامش")} <M>{formatMinor(belowCost.margin_minor)}</M>{" "}
            {tx(T, "· متوسط التكلفة")} <M>{formatMinor(belowCost.average_cost_minor)}</M>
          </AppText>
          <Button
            label={tx(T, "حفظ السعر")}
            onPress={() => void save(true)}
            loading={busy}
            financial
          />
        </StateView>
      ) : null}

      {state === "success" && saved ? (
        <StateView state="success" title={tx(T, "سُجّل السعر الجديد")}>
          <AppText variant="secondary">
            {tx(T, "ومعه سريانه: من الآن، والفواتير السابقة بأسعارها.")}
          </AppText>
        </StateView>
      ) : null}

      {view ? (
        <>
          <TextField
            label={tx(T, "السعر الجديد")}
            mono
            keyboardType="decimal-pad"
            value={price}
            onChangeText={(v) => {
              setPrice(v);
              setBelowCost(null);
              setSaved(null);
            }}
            error={errorFor("price_minor")}
            editable={!readOnly && !busy}
            hint={busy ? tx(T, "جارٍ الحفظ") : undefined}
          />
          {view.units.map((u) => (
            <View
              key={u.id}
              style={{
                flexDirection: "row-reverse",
                justifyContent: "space-between",
                marginBottom: SPACE["2"],
              }}
            >
              <AppText variant="secondary">
                {tx(T, "سعر ال")}
                {u.name} {tx(T, "يتبع تلقائياً")}
              </AppText>
              <AppText>
                <M>
                  {formatMinor(
                    priceMinor
                      ? lineTotalMinor(BigInt(u.factor_milli), BigInt(priceMinor))
                      : u.price_minor,
                  )}
                </M>
              </AppText>
            </View>
          ))}

          <View style={{ marginTop: SPACE["3"] }}>
            <GroupedList title={tx(T, "تاريخ السعر")}>
              {view.history.map((h, i) => (
                <CatRow
                  key={h.id}
                  title={<M>{formatMinor(h.price_minor)}</M>}
                  lines={
                    <>
                      <Line>
                        {h.effective_to ? (
                          <>
                            <DayMonth iso={h.effective_from} /> — <DayMonth iso={h.effective_to} />
                          </>
                        ) : (
                          <>
                            {tx(T, "من")} <DayMonth iso={h.effective_from} /> {tx(T, "— سارٍ الآن")}
                          </>
                        )}
                      </Line>
                      {h.changed_by_name ? (
                        <Line>
                          {h.changed_by_name} · <M>{hhmm(h.effective_from)}</M>
                          {h.note ? ` · ${h.note}` : ""}
                        </Line>
                      ) : null}
                    </>
                  }
                  last={i === view.history.length - 1}
                />
              ))}
            </GroupedList>
          </View>
          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "الفواتير الصادرة بالسعر القديم تبقى بسعرها. لا يُعاد تسعير أي مستند محفوظ.")}
          </AppText>
          {view.can_change ? (
            <Button
              label={tx(T, "حفظ السعر")}
              onPress={() => void save(false)}
              loading={busy}
              financial
              disabledReason={
                priceMinor === null
                  ? tx(T, "اكتب سعراً بأرقام لاتينية")
                  : priceMinor === view.sale_price_minor
                    ? tx(T, "السعر نفسه")
                    : undefined
              }
            />
          ) : null}
        </>
      ) : state === "loading" ? (
        <AppText variant="secondary" muted accessibilityRole="progressbar">
          {tx(T, "جلب الأصناف")}
        </AppText>
      ) : null}
    </Screen>
  );
}
