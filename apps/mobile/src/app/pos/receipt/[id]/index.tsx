import { type StoredOperation } from "@sting/platform";
import { readLastPush, pushPending } from "@sting/app-core";
import { type LocalSale, readSale } from "@sting/sync-core";
import { hhmm } from "@sting/app-core";
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
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";

import { newId } from "@/lib/crypto";
import { printReceipt, receiptHtml, receiptLines, shareReceipt } from "@/lib/receipt-print";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "POS-08";
type State = "saved_local" | "pending_sync" | "synced" | "success" | "server_error";

/**
 * POS-08 — نجاح البيع والإيصال (خطة الجوال M2). محفوظ محلياً مقابل مؤكد خادمياً؛ الإيصال لا ينتظر المزامنة
 * (بوسم «محفوظ على الجهاز» في ذيله حتى التأكيد)؛ إعادة الطباعة نسخة بنفس الرقم دون بيع جديد. الطباعة خطوة
 * لاحقة: فشلها لا يلغي البيع. الطباعة والمشاركة بخدمة النظام (NAT-02)؛ طابعة البلوتوث الحرارية لاحقاً.
 */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useSession();
  const [sale, setSale] = useState<LocalSale | null | undefined>(undefined);
  const [op, setOp] = useState<StoredOperation | null>(null);
  const [prints, setPrints] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [shop, setShop] = useState("");

  const load = useCallback(async () => {
    const storage = await getStorage();
    const s = await readSale(storage, id);
    setSale(s);
    if (s) setOp(await storage.read((t) => t.getOperation(s.operation_id)));
    const home = await storage.read((t) => t.getMeta("home.cache"));
    if (home)
      setShop(
        (JSON.parse(home) as { summary?: { tenant_name?: string } }).summary?.tenant_name ?? "",
      );
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (sale === null) router.replace("/pos");
  }, [router, sale]);

  const opState = op?.state ?? "local";
  const rejected = opState === "quarantined" || opState === "conflict";
  const state: State = rejected
    ? "server_error"
    : opState === "synced"
      ? prints.length > 0
        ? "success"
        : "synced"
      : opState === "pending"
        ? "pending_sync"
        : "saved_local";

  if (!sale)
    return (
      <Screen screenId={T} state="loading" title={tx(T, "حُفظ البيع محلياً")}>
        {null}
      </Screen>
    );

  const html = (copy: boolean) =>
    receiptHtml({ shop, sale, copy, localOnly: opState !== "synced" });
  const print = async () => {
    const ok = await printReceipt(html(prints.length > 0));
    if (!ok) return setFailed(true);
    setFailed(false);
    setPrints((p) => [...p, new Date().toISOString()]);
  };
  const retry = async () => {
    const storage = await getStorage();
    await pushPending({ api, storage, requestId: newId });
    await load();
  };
  void readLastPush;

  const title = rejected
    ? tx(T, "رُفض الرفع")
    : state === "synced" || state === "success"
      ? tx(T, "مؤكد خادمياً")
      : state === "pending_sync"
        ? tx(T, "محفوظ — في طابور الرفع")
        : tx(T, "حُفظ البيع محلياً");

  return (
    <Screen screenId={T} state={state} title={title}>
      {state === "saved_local" ? (
        <AppText variant="secondary" style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "الفاتورة")}{" "}
          <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
            {sale.invoice_number}
          </Text>{" "}
          {tx(T, "مسجَّلة على هذا الجهاز. تُرفع تلقائياً عند عودة الاتصال — لا تُعِد البيع.").slice(
            0,
            0,
          )}
        </AppText>
      ) : null}
      {state === "pending_sync" ? (
        <StateView state="pending_sync" title={tx(T, "محفوظ — في طابور الرفع")}>
          <AppText variant="secondary">{tx(T, "البيع محفوظ محلياً وينتظر دوره.")}</AppText>
          <AppText variant="note">{tx(T, "الإيصال لا ينتظر")}</AppText>
        </StateView>
      ) : null}
      {rejected ? (
        <StateView state="server_error" title={tx(T, "رُفض الرفع")}>
          <AppText variant="secondary">
            {tx(T, "البيع محفوظ محلياً والخادم ردّه — تحقق دائم لا عطل عابر.")}
          </AppText>
          <AppText variant="note">{tx(T, "البيع لا يُلغى")}</AppText>
        </StateView>
      ) : null}
      {state === "success" ? (
        <StateView state="success" title={tx(T, "مؤكَّد خادمياً")}>
          <AppText variant="secondary">
            {tx(T, "العملية على الخادم، والإيصال بلا وسم محلي.")}
          </AppText>
        </StateView>
      ) : null}
      {failed ? (
        <StateView state="server_error" title={tx(T, "حُفظ البيع — لم تتم الطباعة")}>
          <AppText variant="secondary">{tx(T, "مسجَّلة. المشكلة في الطابعة وحدها.")}</AppText>
          <Button label={tx(T, "إعادة محاولة الطباعة")} onPress={() => void print()} />
        </StateView>
      ) : null}

      <GroupedList title={`${tx(T, "الفاتورة")} ${sale.invoice_number}`}>
        {receiptLines(sale).map((l, i, all) => (
          <ListRow
            key={`${l.label}-${i}`}
            title={l.label}
            trailing={
              <Text
                style={{
                  fontFamily: l.strong ? FONT.monoSemiBold : FONT.mono,
                  writingDirection: "ltr",
                }}
              >
                {l.value}
              </Text>
            }
            last={i === all.length - 1}
          />
        ))}
      </GroupedList>
      {prints.length > 0 ? (
        <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
          {tx(T, "طُبعت نسخة واحدة")}{" "}
          <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
            {hhmm(prints[0] ?? "")}
          </Text>
        </AppText>
      ) : null}

      <Button
        label={prints.length > 0 ? tx(T, "إعادة طباعة نسخة") : tx(T, "طباعة الإيصال")}
        financial
        onPress={() => void print()}
      />
      <Button
        label={tx(T, "مشاركة")}
        variant="secondary"
        onPress={() => void shareReceipt(html(prints.length > 0))}
      />
      {rejected || state === "pending_sync" ? (
        <Button label={tx(T, "إعادة المحاولة")} variant="secondary" onPress={() => void retry()} />
      ) : null}
      <Button
        label={tx(T, "فتح الفاتورة")}
        variant="quiet"
        onPress={() => router.push({ pathname: "/pos/invoices/[id]", params: { id: sale.id } })}
      />
      <Button label={tx(T, "بيع جديد")} variant="quiet" onPress={() => router.replace("/pos")} />
    </Screen>
  );
}
