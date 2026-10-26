import { formatMinor, formatQty, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, ListRow, SPACE, useColors } from "@sting/ui-native";
import { View } from "react-native";

import { dayLabel } from "@/lib/invoices";

import { M } from "./common";

const TC = "shared:features/inventory/transfer-card.tsx";

export type TransferStatus = "sent" | "partially_received" | "received" | "cancelled";

export interface TransferLineView {
  readonly id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_name: string;
  readonly factor_milli: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly received_base_milli: string;
  readonly value_minor?: string;
}

export interface TransferView {
  readonly id: string;
  readonly transfer_number: string;
  readonly branch_from_id: string;
  readonly branch_from_name: string;
  readonly branch_to_id: string;
  readonly branch_to_name: string;
  readonly status: TransferStatus;
  readonly user_name: string;
  readonly sent_at: string;
  readonly late?: boolean;
  readonly in_transit_milli?: string;
  readonly in_transit_value_minor?: string;
  readonly lines: readonly TransferLineView[];
}

/** «للرئيسي» / «لبحري»: حرف الجرّ ملتصقاً بالاسم كما في الإطار. */
export function li(name: string): string {
  return name.startsWith(tx(TC, "ال")) ? `${tx(TC, "ل")}${name.slice(1)}` : `${tx(TC, "ل")}${name}`;
}

/** «الفرع الرئيسي» / «فرع بحري» — عنوان دفتر الفرع كما في الإطار. */
export function branchTitle(name: string): string {
  if (name.includes(tx(TC, "فرع"))) return name;
  return name.startsWith(tx(TC, "ال")) ? `${tx(TC, "الفرع")} ${name}` : `${tx(TC, "فرع")} ${name}`;
}

export const STATUS_LABEL: Record<TransferStatus, string> = {
  sent: tx(TC, "أُرسل"),
  partially_received: tx(TC, "استُلم جزئياً"),
  received: tx(TC, "استُلم"),
  cancelled: tx(TC, "أُلغي"),
};

/** «6 كراتين» — الكمية بوحدة الإدخال والاسم خارج mono. */
export function QtyUnits({ lines }: { lines: readonly TransferLineView[] }) {
  const first = lines[0];
  if (!first) return <AppText>—</AppText>;
  const total = lines.reduce((a, l) => a + BigInt(l.qty_milli), 0n);
  return (
    <AppText>
      <M>{formatQty(total, 0)}</M>{" "}
      {lines.every((l) => l.unit_name === first.unit_name) ? first.unit_name : tx(TC, "وحدة")}
    </AppText>
  );
}

/**
 * بطاقة التحويل (14-D9، خطة الجوال M3): «خرج وصل، لا حركة واحدة» — دفتر المرسِل (خرج من الرصيد فوراً)،
 * ودفتر المستلم (متوقع بانتظار العدّ)، و«بضاعة في الطريق» حساب وسيط بكميته وقيمته؛ تأخّر فوق 72 ساعة
 * تنبيه للمالك؛ عند الاستلام بفارق يبقى المتبقّي «فارق تحويل» ولا يُغلق بالسهو. أقسام قوائم لا بطاقات
 * ملوّنة.
 */
export function TransferCard({
  t,
  pending,
  onReceive,
  onRemind,
  onCancel,
  cancelDisabledReason,
}: {
  t: TransferView;
  pending: boolean;
  onReceive?: (() => void) | undefined;
  onRemind?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  cancelDisabledReason?: string | undefined;
}) {
  const c = useColors();
  const sent = t.lines.reduce((a, l) => a + BigInt(l.base_qty_milli), 0n);
  const received = t.lines.reduce((a, l) => a + BigInt(l.received_base_milli), 0n);
  const inTransit = t.in_transit_milli !== undefined ? BigInt(t.in_transit_milli) : sent - received;
  const value = t.in_transit_value_minor ?? "0";
  const open = t.status === "sent" || t.status === "partially_received";
  const day = dayLabel(t.sent_at);
  const tone = pending
    ? "pending_sync"
    : t.status === "cancelled"
      ? "empty"
      : t.status === "received"
        ? "synced"
        : "pending_sync";
  const label = pending
    ? tx(TC, "معلّق هذا الجهاز")
    : t.status === "sent"
      ? tx(TC, "في الطريق — لم يُستلم بعد")
      : STATUS_LABEL[t.status];
  return (
    <View testID={`transfer-${t.id}`} style={{ marginBottom: SPACE["4"] }}>
      <AppText variant="title">
        {tx(TC, "تحويل")} <M>{t.transfer_number}</M> — {t.branch_from_name} ← {t.branch_to_name}
      </AppText>
      <AppText variant="note" muted>
        {tx(TC, "أُرسل")} {day.word ?? ""}
        {day.n ? <M>{day.n}</M> : null} <M>{hhmm(t.sent_at)}</M> {tx(TC, "· المسؤول:")}{" "}
        {t.user_name}
      </AppText>
      <AppText variant="bodyStrong" style={{ color: c.state[tone].fg, marginBottom: SPACE["3"] }}>
        {label}
      </AppText>

      <GroupedList
        title={`${tx(TC, "دفتر")} ${branchTitle(t.branch_from_name)} ${tx(TC, "— المرسِل")}`}
      >
        <ListRow
          title={tx(TC, "خرج من الرصيد")}
          trailing={
            <AppText style={{ color: c.danger }}>
              −<QtyUnits lines={t.lines} />
            </AppText>
          }
        />
        <ListRow
          title={tx(TC, "بقيمة")}
          trailing={
            <M>
              {formatMinor(
                t.lines.reduce((a, l) => a + BigInt(l.value_minor ?? "0"), 0n).toString(),
              )}
            </M>
          }
        />
        <ListRow
          title={tx(TC, "حالة القيد")}
          last
          trailing={<AppText>{pending ? tx(TC, "معلّق هذا الجهاز") : tx(TC, "مؤكد")}</AppText>}
        />
      </GroupedList>
      <AppText variant="note" muted style={{ marginTop: -SPACE["4"], marginBottom: SPACE["4"] }}>
        {tx(TC, "خرج من رصيده فوراً: البضاعة ليست عنده. لكنها لم تدخل رصيد")} {t.branch_to_name}{" "}
        {tx(TC, "بعد.")}
      </AppText>

      <GroupedList
        title={`${tx(TC, "دفتر")} ${branchTitle(t.branch_to_name)} ${tx(TC, "— المستلم")}`}
      >
        <ListRow
          title={tx(TC, "دخل الرصيد")}
          trailing={
            received > 0n ? <M>{formatQty(received, 0)}</M> : <AppText>{tx(TC, "متوقع")}</AppText>
          }
        />
        <ListRow
          title={received > 0n ? tx(TC, "المتبقّي") : (t.lines[0]?.unit_name ?? tx(TC, "وحدة"))}
          last
          trailing={
            received > 0n ? (
              <M>{formatQty(inTransit, 0)}</M>
            ) : (
              <AppText>{tx(TC, "بانتظار العدّ")}</AppText>
            )
          }
        />
      </GroupedList>
      <AppText variant="note" muted style={{ marginTop: -SPACE["4"], marginBottom: SPACE["4"] }}>
        {tx(TC, "لا يستطيع بيع ما لم يستلمه. لو باعه قبل الاستلام لصار رصيده سالباً بسبب لا يخصه.")}
      </AppText>

      <GroupedList title={tx(TC, "«بضاعة في الطريق» — حساب وسيط")}>
        <ListRow
          title={t.lines[0]?.unit_name ?? tx(TC, "وحدة")}
          last
          trailing={
            <AppText>
              <M>{formatQty(inTransit, 0)}</M> · <M>{formatMinor(value)}</M>
            </AppText>
          }
        />
      </GroupedList>
      <AppText variant="note" muted style={{ marginTop: -SPACE["4"] }}>
        {tx(TC, "تظهر في تقرير المنشأة المجمَّع ولا تُنسب لأي فرع.")}
      </AppText>
      <AppText variant="note" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(TC, "لو تأخر الاستلام فوق 72 ساعة يظهر تنبيه للمالك.")}
        {t.late ? (
          <AppText variant="note" style={{ color: c.state.stale.fg }}>
            {" "}
            {tx(TC, "تأخّر فوق 72 ساعة")}
          </AppText>
        ) : null}
      </AppText>

      {t.status === "partially_received" ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
          {tx(TC, "عند الاستلام بفارق:")}{" "}
          {tx(
            TC,
            "يُسجَّل المستلم فعلاً، ويبقى المتبقّي في «الطريق» موسوماً «فارق تحويل»، ويُحسم بجرد أو بإقرار من أحد الفرعين.",
          )}
        </AppText>
      ) : null}

      {open ? (
        <View style={{ gap: SPACE["2"] }}>
          <Button
            label={`${tx(TC, "تسجيل استلام")} ${t.branch_to_name}`}
            financial
            onPress={onReceive ?? (() => undefined)}
            disabledReason={onReceive ? undefined : tx(TC, "الاستلام من الفرع المستقبل")}
          />
          <Button
            label={tx(TC, "تذكير المستلم")}
            variant="secondary"
            onPress={onRemind ?? (() => undefined)}
            disabledReason={onRemind ? undefined : tx(TC, "التذكير مع N-01")}
          />
          <Button
            label={`${tx(TC, "إلغاء التحويل — يرجع")} ${li(t.branch_from_name)}`}
            variant="secondary"
            onPress={onCancel ?? (() => undefined)}
            disabledReason={
              cancelDisabledReason ?? (onCancel ? undefined : tx(TC, "الإلغاء للمرسِل"))
            }
          />
        </View>
      ) : null}
    </View>
  );
}
