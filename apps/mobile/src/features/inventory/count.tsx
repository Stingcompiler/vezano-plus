import { checkReach, formatMinor, formatQty, hhmm, pushPending } from "@sting/app-core";
import {
  clearCountEntry,
  closeCountSession,
  itemMatches,
  type LocalCountSession,
  type LocalItem,
  type OpenCountSession,
  readLocalBalances,
  readLocalItems,
  readOpenCountSession,
  saveCountEntry,
  startCountSession,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Stepper } from "@/components/inventory/stepper";
import { matchBarcode, useBarcodeScan } from "@/components/inventory/scan";
import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { activeOnly, M } from "./common";
import { INV_TEXTS } from "./texts";
import { type Dp, parseQtyInput } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-05";
type State = "ready" | "saving" | "saved_local" | "partial" | "offline" | "success";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly dp: Dp;
  readonly price: bigint;
  /** رصيد النظام — لا يُرسم قبل إدخال المعدود (القاعدة 9) */
  readonly systemMilli: bigint | null;
  readonly countedMilli: bigint | null;
  readonly draft: string;
}

/**
 * INV-05 — جلسة جرد (خطة الجوال M3، انحراف عن الويب: الجرد على الهاتف بالمسح أثناء المشي بين الرفوف —
 * كل قراءة باركود تزيد عدّ الصنف واحداً والماسح يُعاد فتحه حتى «إغلاق»). المتوقَّع محجوب حتى يُدخل
 * المعدود (القاعدة 9)؛ يُحفظ بعد كل صنف ويُستأنف بعد الانقطاع؛ يعمل بلا اتصال؛ الجرد الجزئي مشروع
 * ولا نسوّي ما لم يُعدّ؛ الإغلاق يوثّق ما عُدّ ولا يُسوّي — التسوية قرار تالٍ في INV-06.
 */
export function CountScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx } = useDeviceContext();
  const [items, setItems] = useState<LocalItem[]>([]);
  const [balances, setBalances] = useState<Map<string, { qty_milli: string }>>(new Map());
  const [session, setSession] = useState<OpenCountSession | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "closed">("idle");
  const [closed, setClosed] = useState<LocalCountSession | null>(null);
  const [pushed, setPushed] = useState<"none" | "synced" | "pending">("none");
  const [online, setOnline] = useState(true);
  const [q, setQ] = useState("");
  const [last, setLast] = useState<{ name: string; n: bigint; dp: Dp } | null>(null);
  const [missed, setMissed] = useState(false);
  const sessionRef = useRef<OpenCountSession | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [its, bal] = await Promise.all([readLocalItems(storage), readLocalBalances(storage)]);
      setItems(activeOnly(its));
      setBalances(bal);
      setOnline((await checkReach(api, storage)) !== null);
    })();
  }, [api]);

  useEffect(() => {
    if (!ctx) return;
    void (async () => {
      const storage = await getStorage();
      const open =
        (await readOpenCountSession(storage)) ??
        (await startCountSession(storage, {
          branchId: ctx.branchId,
          userName: ctx.userName,
          startedAt: new Date().toISOString(),
        }));
      setSession(open);
    })();
  }, [ctx]);

  const rows: Row[] = items.map((it) => {
    const b = balances.get(it.id);
    const entry = session?.counts[it.id];
    const dp = it.base_unit_decimal_places ?? 0;
    return {
      id: it.id,
      name: it.name,
      unit: it.base_unit_name,
      dp,
      price: BigInt(it.sale_price_minor || "0"),
      systemMilli: b ? BigInt(b.qty_milli) : null,
      countedMilli: entry ? BigInt(entry.countedMilli) : null,
      draft: drafts[it.id] ?? (entry ? formatQty(entry.countedMilli, dp) : ""),
    };
  });
  const counted = rows.filter((r) => r.countedMilli !== null);
  const variances = counted.filter(
    (r) => r.systemMilli !== null && r.countedMilli !== r.systemMilli,
  );
  const varianceValue = variances.reduce(
    (a, r) => a + ((r.countedMilli! - r.systemMilli!) * r.price) / 1000n,
    0n,
  );

  const state: State = closed
    ? "success"
    : phase === "saving"
      ? "saving"
      : confirmPartial
        ? "partial"
        : !online
          ? "offline"
          : counted.length > 0
            ? "saved_local"
            : "ready";

  const commit = async (row: Row, text: string) => {
    const storage = await getStorage();
    const v = parseQtyInput(text);
    if (v === null) {
      // إدخال غير رقمي أو فارغ: لا يُحفظ ويبقى الصنف غير معدود
      const next = await clearCountEntry(storage, row.id);
      if (next) setSession(next);
      return;
    }
    const next = await saveCountEntry(storage, row.id, {
      countedMilli: v.toString(),
      systemMilli: row.systemMilli === null ? "" : row.systemMilli.toString(),
      countedAt: new Date().toISOString(),
    });
    if (next) setSession(next);
    setDrafts((d) => ({ ...d, [row.id]: formatQty(v, row.dp) }));
  };

  const step = async (row: Row, dir: 1 | -1) => {
    const cur = parseQtyInput(row.draft) ?? 0n;
    const next = cur + BigInt(dir) * 1000n;
    if (next < 0n) return;
    await commit(row, formatQty(next, row.dp));
  };

  // مسح متتابع: كل قراءة تزيد عدّ الصنف (باركود وحدة = معاملها)
  const scan = useBarcodeScan((code) => {
    const hit = matchBarcode(items, code);
    if (!hit) return setMissed(true);
    setMissed(false);
    const row = rows.find((r) => r.id === hit.item.id);
    if (!row) return;
    const unit = hit.unitKey
      ? hit.item.units.find((u) => `unit:${u.id ?? u.unit_id}` === hit.unitKey)
      : undefined;
    const inc = unit && BigInt(unit.factor_milli || "0") > 0n ? BigInt(unit.factor_milli) : 1000n;
    const cur = row.countedMilli ?? 0n;
    void commit(row, formatQty(cur + inc, row.dp)).then(() =>
      setLast({ name: row.name, n: cur + inc, dp: row.dp }),
    );
  }, true);

  const finish = async () => {
    if (!ctx || !session || phase !== "idle" || counted.length === 0) return;
    if (counted.length < rows.length && !confirmPartial) {
      setConfirmPartial(true);
      return;
    }
    setPhase("saving");
    const storage = await getStorage();
    const out = await closeCountSession(storage, {
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      totalItems: rows.length,
      itemNames: Object.fromEntries(rows.map((r) => [r.id, { name: r.name, unit: r.unit }])),
      closedAt: new Date().toISOString(),
    });
    if (!out) {
      setPhase("idle");
      return;
    }
    try {
      const res = await pushPending({ api, storage, requestId: newId });
      setPushed(res.kind === "applied" || res.kind === "idle" ? "synced" : "pending");
    } catch {
      setPushed("pending");
    }
    setClosed(out.session);
    setPhase("closed");
  };

  const startedAt = session?.startedAt ?? "";
  const shown = rows.filter((r) => {
    const it = items.find((i) => i.id === r.id);
    return it ? itemMatches(it, q) : true;
  });
  const risk = tx(
    T,
    "· بيعٌ يقع على جهاز آخر أثناء الجرد. يُكتشف عند المزامنة ويُعرض في مراجعة الفروق.",
  );

  return (
    <Screen screenId={T} state={state} title={`${tx(T, "جرد")} ${ctx?.branchName ?? ""}`}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "— بدأ")} <M>{startedAt ? hhmm(startedAt) : "—"}</M> · {tx(T, "أمين المخزن:")}{" "}
        {ctx?.userName ?? "—"}
      </AppText>

      {state === "success" && closed ? (
        <>
          <StateView state="success" title={tx(T, "أُغلقت الجلسة")}>
            <AppText variant="secondary">
              {tx(
                T,
                "المعدود والمتوقَّع والفوارق بعددها وقيمتها. والتسوية قرارٌ تالٍ في «مراجعة فروق الجرد» لا أثرٌ تلقائي.",
              )}
            </AppText>
            <AppText variant="note" muted>
              {tx(T, "الإغلاق لا يُسوّي")}{" "}
              {tx(T, "· الجرد يوثّق ما عُدّ؛ والتسوية تُحرّك المخزون وتحتاج اعتماداً.")}
            </AppText>
          </StateView>
          <GroupedList>
            <ListRow title={tx(T, "الجلسة")} trailing={<M>{closed.session_number}</M>} />
            <ListRow
              title={tx(T, "المعدود")}
              trailing={
                <AppText>
                  <M>{closed.lines.length}</M> {tx(T, "من")} <M>{closed.total_items}</M>
                </AppText>
              }
            />
            <ListRow
              title={tx(T, "الفوارق")}
              last
              trailing={
                <AppText>
                  <M>{variances.length}</M> {tx(T, "· بقيمة")}{" "}
                  <M>{formatMinor(varianceValue.toString())}</M>
                </AppText>
              }
            />
          </GroupedList>
          {pushed === "pending" ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "الخطر المُعلن")} {risk}
            </AppText>
          ) : null}
          <Button
            label={tx(T, "مراجعة الفروق")}
            financial
            onPress={() =>
              router.push({ pathname: "/inventory/count/[id]/review", params: { id: closed.id } })
            }
          />
          <Button
            label={tx(T, "أرصدة المخزون")}
            variant="quiet"
            onPress={() => router.push("/inventory")}
          />
        </>
      ) : (
        <>
          <AppText
            variant="secondary"
            style={{
              color: online ? c.state.pending_sync.fg : c.state.offline.fg,
              marginBottom: SPACE["3"],
            }}
          >
            {tx(T, "محفوظ محلياً ·")} <M>{counted.length}</M> {tx(T, "من")} <M>{rows.length}</M>
          </AppText>
          {state === "offline" ? (
            <StateView state="offline" title={tx(T, "جرد بلا اتصال")}>
              <AppText variant="secondary">
                {tx(T, "الحالة الطبيعية: المخازن بلا تغطية غالباً. العدّ محلي كاملاً.")}
              </AppText>
              <AppText variant="note" muted>
                {tx(T, "الخطر المُعلن")} {risk}
              </AppText>
            </StateView>
          ) : null}
          {state === "saving" ? (
            <StateView state="saving" title={tx(T, "حفظ العدّ")}>
              <AppText variant="secondary">{tx(T, "يُحفظ بعد كل صنف لا في النهاية.")}</AppText>
            </StateView>
          ) : null}
          {state === "partial" ? (
            <StateView state="partial" title={tx(T, "جرد جزئي")}>
              <AppText variant="secondary">
                {tx(T, "عُدّ")} <M>{counted.length}</M> {tx(T, "صنفاً من")} <M>{rows.length}</M>{" "}
                {tx(T, "وأُغلقت الجلسة. حالةٌ مشروعة: جردُ فئةٍ أو رفٍّ.")}
              </AppText>
              <AppText variant="note" muted>
                {tx(T, "لا نسوّي ما لم يُعدّ")}{" "}
                {tx(
                  T,
                  "· الأصناف غير المعدودة تبقى بأرصدتها ولا تُصفَّر. التسوية تمسّ المعدود وحده.",
                )}
              </AppText>
              <Button
                label={tx(T, "إنهاء العدّ ومراجعة الفروق")}
                financial
                onPress={() => void finish()}
              />
              <Button
                label={tx(T, "حفظ ومتابعة لاحقاً")}
                variant="secondary"
                onPress={() => setConfirmPartial(false)}
              />
            </StateView>
          ) : null}

          <View style={{ marginBottom: SPACE["3"] }}>
            <Button label={INV_TEXTS.scanItems} financial onPress={scan.start} />
            {missed ? (
              <AppText variant="note" style={{ color: c.danger, marginTop: SPACE["1"] }}>
                {INV_TEXTS.noMatch}
              </AppText>
            ) : null}
            {last ? (
              <AppText variant="secondary" style={{ marginTop: SPACE["1"] }}>
                {last.name} <M>{formatQty(last.n, last.dp)}</M>
              </AppText>
            ) : null}
          </View>
          {scan.element}
          <TextField
            label={INV_TEXTS.searchHint}
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
          />

          <GroupedList title={tx(T, "جلسة الجرد")}>
            {shown.map((r, i) => {
              const d =
                r.countedMilli !== null && r.systemMilli !== null
                  ? r.countedMilli - r.systemMilli
                  : null;
              return (
                <View
                  key={r.id}
                  style={{
                    padding: SPACE["4"],
                    gap: SPACE["2"],
                    borderBottomWidth: i === shown.length - 1 ? 0 : 1,
                    borderBottomColor: c.border,
                  }}
                >
                  <AppText variant="bodyStrong">
                    {r.name} · {r.unit}
                  </AppText>
                  <Stepper
                    value={r.draft}
                    onChangeText={(t) => setDrafts((m) => ({ ...m, [r.id]: t }))}
                    onCommit={(t) => void commit(r, t)}
                    onStep={(dir) => void step(r, dir)}
                    inputLabel={`${tx(T, "العدّ الفعلي —")} ${r.name}`}
                    minusLabel={`${tx(T, "نقص —")} ${r.name}`}
                    plusLabel={`${tx(T, "زيادة —")} ${r.name}`}
                  />
                  {r.countedMilli !== null ? (
                    <AppText variant="note" muted>
                      {tx(T, "رصيد النظام")}{" "}
                      <M>{r.systemMilli === null ? "—" : formatQty(r.systemMilli, r.dp)}</M>
                      {d !== null ? (
                        <>
                          {" · "}
                          {tx(T, "الفرق")}{" "}
                          <AppText
                            variant="note"
                            style={{
                              color: d < 0n ? c.danger : d > 0n ? c.state.synced.fg : undefined,
                              fontFamily: FONT.mono,
                              writingDirection: "ltr",
                            }}
                          >
                            {d > 0n ? "+" : ""}
                            {formatQty(d, r.dp)}
                          </AppText>
                        </>
                      ) : null}
                    </AppText>
                  ) : null}
                </View>
              );
            })}
          </GroupedList>

          <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
            {tx(T, "العدّ محفوظ على الجهاز ويستأنف بعد انقطاع الكهرباء.")}{" "}
            {tx(T, "لم يتغير أي رصيد بعد")}{" "}
            {tx(T, "— التسوية تحتاج مراجعة واعتماداً في «مراجعة فروق الجرد».")}
          </AppText>
          <Button
            label={tx(T, "إنهاء العدّ ومراجعة الفروق")}
            financial
            loading={phase === "saving"}
            disabledReason={counted.length === 0 ? tx(T, "لم يُعدّ صنف بعد") : undefined}
            onPress={() => void finish()}
          />
          <Button
            label={tx(T, "حفظ ومتابعة لاحقاً")}
            variant="secondary"
            onPress={() => router.push("/inventory")}
          />
        </>
      )}
    </Screen>
  );
}
