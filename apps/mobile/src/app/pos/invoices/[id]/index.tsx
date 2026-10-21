import { formatMinorShort, formatQty, hhmm } from "@sting/app-core";
import { type LocalSale, readSale, unitDisplay } from "@sting/sync-core";
import { tx } from "@sting/texts";
import { AppText, Button, FONT, GroupedList, ListRow, Screen, StateView } from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { dayLabel, localDateSuspect, type RowSync } from "@/lib/invoices";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "POS-09";
const LABEL: Record<RowSync, string> = {
  local: tx(T, "محفوظ محلياً"),
  pending: tx(T, "معلّق المزامنة"),
  synced: tx(T, "مؤكد خادمياً"),
  reversed: tx(T, "مؤكد خادمياً"),
};

interface Detail {
  readonly sale: LocalSale;
  readonly sync: RowSync;
  readonly source: "local" | "server";
}

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * POS-09 (تفاصيل) — الفاتورة بسطورها ودفعاتها ووضع مزامنتها وجودة تاريخها. المحلي يُقرأ فوراً؛ فاتورة جهاز
 * آخر تحتاج اتصالاً بسبب معلن. إعادة الطباعة نسخة عبر POS-08، والمرتجع الكلي أو الجزئي POS-10.
 */
export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useSession();
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const local = await readSale(storage, id);
      if (local) {
        const op = await storage.read((t) => t.getOperation(local.operation_id));
        const st = op?.state ?? "local";
        return setDetail({
          sale: local,
          sync: st === "synced" ? "synced" : st === "pending" ? "pending" : "local",
          source: "local",
        });
      }
      try {
        const { data, response } = await api.GET("/api/sales/{sale_id}", {
          params: { path: { sale_id: id } },
        });
        const body = data as unknown as
          (LocalSale & { sync_state?: "synced" | "reversed" }) | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return setDetail(null);
        }
        setDetail({ sale: body, sync: body.sync_state ?? "synced", source: "server" });
      } catch {
        setFailed(true);
        setDetail(null);
      }
    })();
  }, [api, id]);

  if (detail === undefined)
    return (
      <Screen screenId={T} state="loading" title={tx(T, "الفاتورة")}>
        {null}
      </Screen>
    );
  if (detail === null)
    return (
      <Screen screenId={T} state="offline" title={tx(T, "الفاتورة")}>
        <StateView state="offline" title={tx(T, "الفاتورة لم تصل الخادم بعد")}>
          <AppText variant="secondary">
            {failed
              ? tx(T, "المجاميع من آخر مطابقة. تعذّر جلب الفاتورة من الخادم.")
              : tx(T, "هذه الفاتورة ليست على هذا الجهاز — تحتاج اتصالاً لعرضها.")}
          </AppText>
        </StateView>
      </Screen>
    );

  const { sale: s, sync } = detail;
  const d = dayLabel(s.occurred_at);
  return (
    <Screen
      screenId={T}
      state={sync === "local" ? "saved_local" : sync === "pending" ? "pending_sync" : "ready"}
      title={`${tx(T, "الفاتورة")} ${s.invoice_number}`}
    >
      <GroupedList>
        <ListRow title={tx(T, "الإجمالي")} trailing={<M>{formatMinorShort(s.total_minor)}</M>} />
        <ListRow title={tx(T, "المزامنة")} trailing={<AppText>{LABEL[sync]}</AppText>} />
        <ListRow
          title={tx(T, "الرقم والوقت")}
          trailing={
            <AppText>
              {d.word ?? d.n} <M>{hhmm(s.occurred_at)}</M>
            </AppText>
          }
        />
        <ListRow
          title={tx(T, "العميل")}
          trailing={<AppText>{s.party_name || tx(T, "نقدي")}</AppText>}
        />
        {detail.source === "local" && localDateSuspect(s) ? (
          <ListRow title={tx(T, "تاريخ مشكوك فيه")} trailing={<M>{s.business_date}</M>} />
        ) : null}
        <ListRow title={tx(T, "المنفّذ")} trailing={<AppText>{s.user_name}</AppText>} last />
      </GroupedList>

      <GroupedList title={tx(T, "سطور الفاتورة")}>
        {s.lines.map((l, i) => (
          <ListRow
            key={l.id}
            title={l.item_name}
            subtitle={`${formatQty(l.qty_milli, l.decimal_places as 0 | 1 | 2 | 3)} ${unitDisplay(l.unit_code)} × ${formatMinorShort(l.unit_price_minor)}`}
            trailing={<M>{formatMinorShort(l.line_total_minor)}</M>}
            last={i === s.lines.length - 1}
          />
        ))}
      </GroupedList>

      <Button
        label={tx(T, "إعادة طباعة نسخة")}
        variant="secondary"
        onPress={() => router.push({ pathname: "/pos/receipt/[id]", params: { id: s.id } })}
      />
      <Button
        label={tx(T, "مرتجع كلي أو جزئي")}
        variant="secondary"
        onPress={() => router.push({ pathname: "/pos/invoices/[id]/return", params: { id: s.id } })}
      />
    </Screen>
  );
}
