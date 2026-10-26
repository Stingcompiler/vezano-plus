import { formatMinor } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  SPACE,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { Block, Head, Lead, M, Note, Notice, PRow, Strong } from "@/components/purchasing/parts";
import { useSession } from "@/lib/session";

import { pct, toMinor, useServerView } from "./lib";
import { PUR_TEXTS } from "./texts";

const T = "PUR-05";
type State = Extract<
  StateCode,
  "ready" | "empty" | "permission_denied" | "phase_locked" | "loading" | "offline" | "stale"
>;

interface Row {
  item_id?: string;
  item_name: string;
  base_unit_name?: string;
  sale_price_minor: string;
  cost_minor: string;
  cost_unit_name?: string;
  method_label: string;
  docs_count?: number;
  margin_bps: number | null;
  note:
    | ""
    | "example"
    | "manual"
    | "unit_mismatch"
    | "single_doc"
    | "negative"
    | "cost_rose"
    | "stable";
  note_extra?: {
    document_number?: string;
    previous_margin_bps?: number | null;
    price_moved?: boolean;
    months?: number;
  };
}

interface Report {
  state: "ready" | "empty" | "permission_denied" | "phase_locked";
  policy: string;
  can_enable: boolean;
  rows: Row[];
  items_count: number;
}

const MONTH_WORDS = [
  "",
  tx(T, "شهر"),
  tx(T, "شهرين"),
  tx(T, "ثلاثة أشهر"),
  tx(T, "أربعة أشهر"),
  tx(T, "خمسة أشهر"),
  tx(T, "ستة أشهر"),
];
const monthsWord = (n: number): string =>
  n <= 6 ? (MONTH_WORDS[n] ?? "") : `${n} ${tx(T, "شهراً")}`;

function ItemsWord({ n }: { n: number }) {
  if (n === 1) return <>{tx(T, "صنف واحد")}</>;
  if (n === 2) return <>{tx(T, "صنفان")}</>;
  return (
    <>
      <M>{n}</M> {n <= 10 ? tx(T, "أصناف") : tx(T, "صنفاً")}
    </>
  );
}

function noteText(r: Row): ReactNode {
  switch (r.note) {
    case "unit_mismatch":
      return `${tx(T, "الوحدتان مختلفتان: التكلفة لل")}${r.cost_unit_name ?? ""} ${tx(T, "والسعر لل")}${r.base_unit_name ?? ""}${tx(T, ". لا نحسب هامشاً من وحدتين.")}`;
    case "single_doc":
      return tx(T, "مبنيّ على مستند واحد — المتوسط يصير ذا معنى بعد ثلاثة.");
    case "negative":
      return tx(T, "بيع بخسارة. قد يكون مقصوداً.");
    case "manual":
      return tx(T, "تكلفة افتتاحية يدوية — تُستبدل بأول مستند حقيقي.");
    case "cost_rose": {
      const x = r.note_extra ?? {};
      return (
        <>
          {tx(T, "التكلفة ارتفعت بمستند")} <M>{x.document_number ?? ""}</M>{" "}
          {x.price_moved ? tx(T, "وتحرّك السعر") : tx(T, "والسعر لم يتحرّك")}.
          {typeof x.previous_margin_bps === "number" ? (
            <>
              {" "}
              {tx(T, "الهامش كان")} <M>{pct(x.previous_margin_bps)}</M> {tx(T, "قبل المستند.")}
            </>
          ) : null}
        </>
      );
    }
    case "stable": {
      const m = r.note_extra?.months ?? 0;
      return m > 0 ? `${tx(T, "مستقرّ منذ")} ${monthsWord(m)}.` : tx(T, "مستقرّ.");
    }
    case "example":
      return tx(T, "مثال");
    default:
      return "";
  }
}

/**
 * PUR-05 — التكلفة والهامش (قرار أعمال لا تقرير): قائمة بالأعمدة الأساسية (الصنف، التكلفة، الهامش) وتفاصيل
 * الطريقة بالضغط — انحراف عن جدول الويب الواسع. الشاشة كلها محجوبة بلا صلاحية؛ وحدة الشراء غير المفعّلة =
 * phase_locked بمثال ظاهر وتفعيل للمالك. خادمي: آخر نسخة محفوظة تُعرض «قديمة» بلا شبكة.
 */
export function CostMarginScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { data, setData, source, denied } = useServerView<Report>("cost_margin", () =>
    api.GET("/api/inventory/purchasing/cost-margin"),
  );
  const [busy, setBusy] = useState(false);
  const [netFail, setNetFail] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<Row | null>(null);
  const [manualCost, setManualCost] = useState("");

  const act = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setNetFail(false);
    try {
      const { data: d, response } = await api.POST("/api/inventory/purchasing/cost-margin", {
        body: body as never,
      });
      const r = d as unknown as Report | undefined;
      if (response.ok && r) {
        setData(r);
        setManualFor(null);
        setManualCost("");
      }
    } catch {
      setNetFail(true);
    } finally {
      setBusy(false);
    }
  };

  const rows = data?.rows ?? [];
  const stale = source === "cache";
  const state: State =
    denied !== null
      ? "permission_denied"
      : source === "loading"
        ? "loading"
        : !data
          ? "offline"
          : netFail
            ? "offline"
            : stale && data.state === "ready"
              ? "stale"
              : data.state;
  const offlineReason = stale || netFail ? PUR_TEXTS.needsServer : undefined;
  const rowKey = (r: Row) => r.item_id ?? r.item_name;

  const list = (title: string) => (
    <GroupedList title={title}>
      {rows.map((r, i) => {
        const expanded = open === rowKey(r);
        return (
          <PRow
            key={rowKey(r)}
            last={i === rows.length - 1}
            onPress={() => setOpen(expanded ? null : rowKey(r))}
            trailing={
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <M>{r.cost_minor ? formatMinor(r.cost_minor) : "—"}</M>
                {r.margin_bps === null ? null : (
                  <AppText
                    variant="note"
                    style={{
                      color: r.margin_bps < 0 ? c.danger : c.inkMuted,
                      fontFamily: undefined,
                    }}
                  >
                    {tx(T, "الهامش")} <M>{pct(r.margin_bps)}</M>
                  </AppText>
                )}
              </View>
            }
          >
            <AppText variant="bodyStrong">{r.item_name}</AppText>
            {expanded ? (
              <>
                {r.method_label ? <Note>{r.method_label}</Note> : null}
                {r.cost_minor || r.note === "example" ? (
                  <AppText variant="note" muted>
                    {tx(T, "سعر البيع")} <M>{formatMinor(r.sale_price_minor)}</M>
                  </AppText>
                ) : null}
                {r.note ? <AppText variant="note">{noteText(r)}</AppText> : null}
              </>
            ) : null}
          </PRow>
        );
      })}
    </GroupedList>
  );

  return (
    <Screen screenId={T} state={state} title={tx(T, "المشتريات")}>
      <Head
        title={tx(T, "التكلفة والهامش — الرقم الذي لا يُعرض إلا لمن يملكه")}
        hint={tx(
          T,
          "التكلفة تتبع مستندات الشراء بالمتوسط المرجّح، وتتغيّر مع كل استلام. والهامش مشتقٌّ منها ومن سعر البيع — فمن يرى الهامش يرى التكلفة ضمناً، ولذلك صلاحيتهما واحدة.",
        )}
      />
      {state === "loading" ? <Notice state="loading" title={tx(T, "التكلفة والهامش")} /> : null}
      {state === "offline" ? (
        <Notice state="offline" title={data ? PUR_TEXTS.needsServer : PUR_TEXTS.offlineEmpty} />
      ) : null}
      {state === "stale" ? <Note>{PUR_TEXTS.stale}</Note> : null}

      {state === "permission_denied" ? (
        <Notice state="permission_denied" title={tx(T, "الشاشة كلها محجوبة")}>
          <Note>{tx(T, "للمالك والمحاسب فقط.")}</Note>
        </Notice>
      ) : null}

      {state === "phase_locked" && data ? (
        <>
          <Notice
            state="phase_locked"
            title={tx(T, "الشراء الداخلي غير مفعّل")}
            action={
              data.can_enable ? (
                <Button
                  label={tx(T, "فعّل الشراء الداخلي")}
                  financial
                  loading={busy}
                  onPress={() => void act({ action: "enable" })}
                />
              ) : undefined
            }
          >
            <Lead>
              {tx(
                T,
                "المنشأة لم تفعّل وحدة الشراء الداخلي. لا تكلفة محسوبة لأن لا مستندات شراء أصلاً.",
              )}
            </Lead>
          </Notice>
          {rows.length ? list(tx(T, "مثال — التكلفة والهامش")) : null}
        </>
      ) : null}

      {state === "empty" && data ? (
        <Notice
          state="empty"
          title={tx(T, "لا تكلفة بعد")}
          action={
            <Button
              label={tx(T, "سجّل مستند شراء")}
              financial
              onPress={() => router.push("/purchasing/orders")}
            />
          }
        >
          <Lead>
            {tx(
              T,
              "المنشأة تبيع ولم تُسجّل مستند شراء واحداً — أصنافها أُدخلت برصيد افتتاحي بلا سعر تكلفة.",
            )}
          </Lead>
          <Lead>
            <Strong>{tx(T, "المخرج")}</Strong>{" "}
            {tx(
              T,
              "· سجّل مستند شراء، أو أدخل تكلفة افتتاحية يدوية تُوسم «يدوية» وتُستبدل بأول مستند حقيقي.",
            )}
          </Lead>
        </Notice>
      ) : null}

      {(state === "ready" || state === "stale" || state === "empty") && data ? (
        <>
          <AppText variant="bodyStrong">
            {tx(T, "التكلفة والهامش —")} <ItemsWord n={data.items_count} />
          </AppText>
          <Note>{tx(T, "مرئية للمالك والمحاسب")}</Note>
          {rows.length ? list(tx(T, "التكلفة والهامش")) : null}
          {rows.some((r) => !r.cost_minor) ? (
            <>
              <Note>{tx(T, "تكلفة افتتاحية يدوية لصنف بلا مستند:")}</Note>
              <View style={{ gap: SPACE["2"], marginBottom: SPACE["3"] }}>
                {rows
                  .filter((r) => !r.cost_minor)
                  .map((r) => (
                    <Button
                      key={rowKey(r)}
                      label={r.item_name}
                      variant="secondary"
                      onPress={() => {
                        setManualFor(r);
                        setManualCost("");
                      }}
                    />
                  ))}
              </View>
              {manualFor ? (
                <Block>
                  <TextField
                    label={`${tx(T, "تكلفة")} ${manualFor.base_unit_name ?? tx(T, "الوحدة")} — ${manualFor.item_name}`}
                    mono
                    keyboardType="decimal-pad"
                    value={manualCost}
                    onChangeText={setManualCost}
                    hint={tx(T, "تُوسم «يدوية» وتُستبدل بأول مستند حقيقي.")}
                  />
                  <Button
                    label={tx(T, "احفظ التكلفة اليدوية")}
                    financial
                    loading={busy}
                    disabledReason={offlineReason}
                    onPress={() =>
                      void act({
                        action: "manual_cost",
                        item_id: manualFor.item_id,
                        unit_cost_minor: String(toMinor(manualCost)),
                      })
                    }
                  />
                  <Button
                    label={tx(T, "إلغاء")}
                    variant="quiet"
                    onPress={() => setManualFor(null)}
                  />
                </Block>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
