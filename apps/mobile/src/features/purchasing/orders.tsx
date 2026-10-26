import { formatMinorShort } from "@sting/app-core";
import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, Chip, GroupedList, Screen, SPACE } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import {
  Head,
  Lead,
  M,
  Note,
  Notice,
  PRow,
  Strong,
  StatusWord,
  Wrap,
} from "@/components/purchasing/parts";
import { useSession } from "@/lib/session";

import { useServerView } from "./lib";
import { PUR_TEXTS } from "./texts";

const T = "PUR-01";
type State = Extract<
  StateCode,
  "ready" | "loading" | "empty" | "permission_denied" | "stale" | "offline"
>;

export interface OrderRow {
  id: string;
  number: string;
  supplier_id: string;
  supplier_name: string;
  status: string;
  status_label: string;
  status_hint: string;
  items_summary: string;
  lines_count: number;
  estimated_total_minor: string;
  value_hidden: boolean;
  created_by_name: string;
  created_at: string;
  sent_at: string;
  cancelled_reason: string;
}

export interface OrdersPayload {
  orders: OrderRow[];
  open_count: number;
  closed_count: number;
  scope: string;
  supplier_id: string;
  suppliers: { id: string; name: string }[];
  can_create: boolean;
  value_hidden: boolean;
  ask_name: string;
  last_closed: { number: string; status_label: string; at: string } | null;
  as_of: string;
}

export const STATUS_STATE: Record<string, StateCode> = {
  open: "ready",
  sent: "pending_sync",
  unsent: "server_error",
  partial: "partial",
  received: "success",
  cancelled: "expired",
  closed: "success",
};

/** «اليوم» / «أمس» / «قبل يومين» / «قبل 5 أيام» (الرقم mono) — نظير `ago` في الويب. */
export function ago(iso: string): ReactNode {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return tx(T, "اليوم");
  if (diff === 1) return tx(T, "أمس");
  if (diff === 2) return tx(T, "قبل يومين");
  return (
    <>
      {tx(T, "قبل")} <M>{diff}</M> {diff <= 10 ? tx(T, "أيام") : tx(T, "يوماً")}
    </>
  );
}

const itemsWord = (n: number) =>
  n === 1 ? tx(T, "صنف") : n === 2 ? tx(T, "صنفان") : tx(T, "أصناف");

/**
 * PUR-01 — أوامر الشراء الداخلية (32-D24): الأمر وعدٌ لا التزام — لا يحرّك مخزوناً ولا مالاً؛ «القيمة
 * التقديرية» موسومة؛ الملغى يبقى في السجل بسببه؛ أمين المخزن يرى ولا يُنشئ وعمود القيمة محجوب عنه.
 * القائمة خادمية: آخر نسخة محفوظة تُعرض «قديمة» عند انقطاع الشبكة. `selectedId` = تفاصيل أمر فوق القائمة.
 */
export function OrdersScreen({ selectedId }: { selectedId?: string | undefined }) {
  const router = useRouter();
  const { api } = useSession();
  const [scope, setScope] = useState<"open" | "all">(selectedId ? "all" : "open");
  const [supplier, setSupplier] = useState("");
  const { data, source, denied, slow } = useServerView<OrdersPayload>(
    `orders.${scope}.${supplier}`,
    () =>
      api.GET("/api/inventory/purchasing/orders", {
        params: { query: { scope, ...(supplier ? { supplier_id: supplier } : {}) } },
      }),
  );

  const orders = data?.orders ?? [];
  const hideValue = data?.value_hidden ?? false;
  const state: State =
    denied !== null
      ? "permission_denied"
      : source === "loading"
        ? "loading"
        : !data
          ? "offline"
          : data.value_hidden
            ? "permission_denied"
            : source === "cache"
              ? "stale"
              : orders.length === 0
                ? "empty"
                : "ready";
  const selected = selectedId ? orders.find((o) => o.id === selectedId) : undefined;
  const createReason =
    data && !data.can_create
      ? `${tx(T, "الإنشاء للمالك والمحاسب — اطلب من")} ${data.ask_name || tx(T, "المالك")}`
      : undefined;
  const openDocument = (o: OrderRow) =>
    router.push({ pathname: "/purchasing/orders/[id]/document", params: { id: o.id } });

  const renderRow = (o: OrderRow, i: number, list: OrderRow[]) => (
    <PRow
      key={o.id}
      last={i === list.length - 1}
      onPress={() =>
        data?.can_create && o.status !== "cancelled"
          ? openDocument(o)
          : router.push({ pathname: "/purchasing/orders/[id]", params: { id: o.id } })
      }
      trailing={
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {!hideValue ? (
            <M>{o.estimated_total_minor ? formatMinorShort(o.estimated_total_minor) : "—"}</M>
          ) : null}
          <StatusWord state={STATUS_STATE[o.status] ?? "ready"} label={o.status_label} />
        </View>
      }
    >
      <AppText>
        <M>{o.number}</M> · {o.supplier_name}
      </AppText>
      <AppText variant="note" muted>
        {tx(T, "أُنشئ")} {ago(o.created_at)} · {o.created_by_name}
      </AppText>
      <AppText variant="note" muted>
        {o.items_summary} · <M>{o.lines_count}</M> {itemsWord(o.lines_count)}
      </AppText>
      <AppText variant="note">
        {o.status === "cancelled" && o.cancelled_reason
          ? `${tx(T, "أُلغي بسبب مكتوب:")} ${o.cancelled_reason}${tx(T, ". الأمر يبقى في السجل ولا يُحذف.")}`
          : o.status_hint}
      </AppText>
    </PRow>
  );

  return (
    <Screen screenId={T} state={state} title={tx(T, "المشتريات")}>
      <Head
        title={tx(T, "أوامر الشراء الداخلية — الأمر وعدٌ لا التزام")}
        hint={tx(
          T,
          "أمر الشراء لا يحرّك مخزوناً ولا مالاً. الذي يحرّكهما مستند الشراء حين يُستلم ويُعتمد.",
        )}
      />
      <Wrap>
        <Chip label={tx(T, "مفتوحة")} on={scope === "open"} onPress={() => setScope("open")} />
        <Chip label={tx(T, "السجل كله")} on={scope === "all"} onPress={() => setScope("all")} />
      </Wrap>
      <Wrap>
        <Chip label={tx(T, "كل الموردين")} on={!supplier} onPress={() => setSupplier("")} />
        {(data?.suppliers ?? []).map((s) => (
          <Chip
            key={s.id}
            label={s.name}
            on={supplier === s.id}
            onPress={() => setSupplier(s.id)}
          />
        ))}
      </Wrap>
      {data ? (
        <Note>
          {tx(T, "أوامر الشراء —")} <M>{data.open_count}</M> {tx(T, "مفتوحة ·")}{" "}
          <M>{data.closed_count}</M> {tx(T, "في السجل")}
        </Note>
      ) : null}
      <View style={{ marginBottom: SPACE["4"] }}>
        <Button
          label={tx(T, "أمر جديد")}
          financial
          onPress={() => router.push("/purchasing/orders/new")}
          disabledReason={createReason}
        />
      </View>

      {state === "loading" ? (
        <Notice state="loading" title={tx(T, "تحميل القائمة")}>
          {slow ? <Note>{tx(T, "الشبكة بطيئة")}</Note> : null}
        </Notice>
      ) : null}
      {state === "offline" ? <Notice state="offline" title={PUR_TEXTS.offlineEmpty} /> : null}
      {state === "stale" ? <Note>{PUR_TEXTS.stale}</Note> : null}

      {denied !== null ? (
        <Notice state="permission_denied" title={tx(T, "أوامر الشراء لمن يستلم أو يلتزم")}>
          <Lead>
            {tx(
              T,
              "القائمة مرئية لأمين المخزن لأنه يستلم بناءً عليها. الإنشاء والإلغاء للمالك والمحاسب — كلاهما التزام مالي.",
            )}
            {denied ? ` ${tx(T, "دورك:")} ${denied}.` : ""}
          </Lead>
        </Notice>
      ) : null}

      {data?.value_hidden && denied === null ? (
        <Notice state="permission_denied" title={tx(T, "أمين المخزن يرى ولا يُنشئ")}>
          <Lead>
            {tx(
              T,
              "القائمة مرئية لأمين المخزن لأنه يستلم بناءً عليها. الإنشاء والإلغاء للمالك والمحاسب — كلاهما التزام مالي.",
            )}
          </Lead>
          <Lead>
            <Strong>{tx(T, "القيمة التقديرية")}</Strong>{" "}
            {tx(T, "· عمود القيمة محجوب عن أمين المخزن.")}
          </Lead>
        </Notice>
      ) : null}

      {state === "empty" && data ? (
        <Notice
          state="empty"
          title={tx(T, "لا أوامر مفتوحة")}
          action={
            scope === "open" && data.closed_count > 0 ? (
              <Button
                label={tx(T, "السجل المغلق")}
                variant="secondary"
                onPress={() => setScope("all")}
              />
            ) : undefined
          }
        >
          <Lead>
            {data.closed_count > 0 ? (
              <>
                <M>{data.closed_count}</M> {tx(T, "أوامر مغلقة في السجل ولا أمر مفتوح.")}
              </>
            ) : (
              tx(T, "لم يُنشأ أمر شراء بعد.")
            )}
          </Lead>
          {data.last_closed ? (
            <Lead>
              {tx(T, "«لا أوامر مفتوحة — آخرها")} <M>{data.last_closed.number}</M>{" "}
              {data.last_closed.status_label} {ago(data.last_closed.at)}
              {tx(T, "»، والسجل المغلق على بعد ضغطة.")}
            </Lead>
          ) : null}
        </Notice>
      ) : null}

      {selected ? (
        <GroupedList title={tx(T, "الأمر والمورد")}>
          {renderRow(selected, 0, [selected])}
          {data?.can_create && selected.status !== "cancelled" ? (
            <View style={{ padding: SPACE["4"] }}>
              <Button
                label={tx("PUR-03", "مستند شراء")}
                variant="secondary"
                onPress={() => openDocument(selected)}
              />
            </View>
          ) : null}
        </GroupedList>
      ) : null}

      {data && orders.length > 0 ? (
        <GroupedList title={tx(T, "أوامر الشراء")}>{orders.map(renderRow)}</GroupedList>
      ) : null}
      {state === "ready" ? (
        <Note>{tx(T, "الرقم من آخر سعر شراء معروف، وقد يختلف عمّا يأتي في الفاتورة.")}</Note>
      ) : null}
    </Screen>
  );
}
