import { countPending, formatMinorShort, readLastPush, type LastPush } from "@sting/app-core";
import { type StoredOperation } from "@sting/platform";
import { type LocalSale, readSale } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { printReceipt, receiptHtml } from "@/lib/receipt-print";
import { getStorage } from "@/lib/storage";

const T = "POS-11";
type State = "offline" | "saved_local" | "validation_error" | "server_error";
type Tone = "ok" | "wait" | "bad";

function Act({ k, v, tone }: { k: string; v: string; tone: Tone }) {
  const c = useColors();
  const color =
    tone === "ok"
      ? c.state.success.fg
      : tone === "bad"
        ? c.state.server_error.fg
        : c.state.pending_sync.fg;
  return (
    <View style={{ flexDirection: ROW_RTL, gap: SPACE["2"], alignItems: "center", minHeight: 36 }}>
      <AppText variant="bodyStrong">{k}</AppText>
      <AppText variant="secondary" style={{ color }}>
        {v}
      </AppText>
    </View>
  );
}

/**
 * POS-11 — فشل الحفظ أو الطباعة (خطة الجوال M2): شاشة بلا `ready` — لا توجد إلا حين يقع خطأ. الحفظ والطباعة
 * والمزامنة ثلاثة أفعال منفصلة ونجاح أحدها لا يُشترط بنجاح الآخر؛ الشاشة تقول أيُّها تمّ وأيُّها لم يتمّ
 * بالاسم. البيع لا يُلغى لأن الطابعة صمتت أو الخادم ردّ — النقد قُبض والبضاعة خرجت.
 */
export default function Problem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [sale, setSale] = useState<LocalSale | null | undefined>(undefined);
  const [op, setOp] = useState<StoredOperation | null>(null);
  const [lastPush, setLastPush] = useState<LastPush | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const s = await readSale(storage, id);
      setSale(s);
      if (s) setOp(await storage.read((t) => t.getOperation(s.operation_id)));
      setLastPush(await readLastPush(storage));
      setWaiting(await countPending(storage));
    })();
    void fetch(`${process.env.EXPO_PUBLIC_API_URL ?? ""}/api/health`)
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, [id]);
  useEffect(() => {
    if (sale === null) router.replace("/pos");
  }, [router, sale]);

  const opState = op?.state ?? "local";
  const rejected = opState === "quarantined" || opState === "conflict";
  const serverError = lastPush?.kind === "retry" && (lastPush.status ?? 0) >= 500;
  const state: State = rejected
    ? "validation_error"
    : !online
      ? "offline"
      : serverError
        ? "server_error"
        : "saved_local";
  if (!sale)
    return (
      <Screen screenId={T} state="loading" title={tx(T, "محفوظ محلياً")}>
        {null}
      </Screen>
    );

  const title =
    state === "offline"
      ? tx(T, "بلا اتصال")
      : state === "saved_local"
        ? tx(T, "محفوظ محلياً")
        : state === "validation_error"
          ? tx(T, "الخادم رفض الفاتورة")
          : tx(T, "خطأ خادم");
  const newSale = () => router.replace("/pos");
  const printAndNew = async () => {
    await printReceipt(receiptHtml({ shop: "", sale, copy: false, localOnly: true }));
    newSale();
  };

  return (
    <Screen screenId={T} state={state} title={title}>
      <AppText variant="note" muted>
        <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>
          {sale.invoice_number}
        </Text>
      </AppText>
      <Text
        style={{
          fontFamily: FONT.monoSemiBold,
          fontSize: 28,
          writingDirection: "ltr",
          marginVertical: SPACE["3"],
        }}
      >
        {formatMinorShort(sale.total_minor)} {tx(T, "ج.س")}
      </Text>

      {state === "offline" ? (
        <>
          <Act k={tx(T, "الحفظ")} v={tx(T, "تمّ على الجهاز")} tone="ok" />
          <Act k={tx(T, "الطباعة")} v={tx(T, "تمّت")} tone="ok" />
          <Act k={tx(T, "المزامنة")} v={tx(T, "متوقّفة")} tone="wait" />
          <AppText variant="note" muted>
            {waiting} {tx(T, "فواتير تنتظر")}
          </AppText>
          <AppText variant="secondary">
            {tx(T, "الشبكة ساقطة والبيع تمّ كاملاً: النقد في الدرج والورقة بيد الزبون.")}
          </AppText>
        </>
      ) : state === "saved_local" ? (
        <>
          <Act k={tx(T, "الحفظ")} v={tx(T, "على الجهاز")} tone="ok" />
          <Act k={tx(T, "الرقم النهائي")} v={tx(T, "بانتظار الخادم")} tone="wait" />
          <Act k={tx(T, "الطباعة")} v={tx(T, "برقم مؤقت")} tone="wait" />
        </>
      ) : state === "validation_error" ? (
        <>
          <Act k={tx(T, "النقد")} v={tx(T, "في الدرج")} tone="ok" />
          <Act k={tx(T, "الطباعة")} v={tx(T, "تمّت")} tone="ok" />
          <Act k={tx(T, "القيد في النظام")} v={tx(T, "مرفوض")} tone="bad" />
          <StateView state="server_error" title={tx(T, "الخادم رفض الفاتورة")}>
            <AppText variant="secondary">{tx(T, "البيع وقع في الواقع والنظام يرفض قيده.")}</AppText>
          </StateView>
        </>
      ) : (
        <>
          <Act k={tx(T, "الحفظ المحلي")} v={tx(T, "تمّ")} tone="ok" />
          <Act
            k={tx(T, "الخادم")}
            v={`${tx(T, "ردّ بخطأ")} ${lastPush?.status ?? 500}`}
            tone="bad"
          />
          <Act k={tx(T, "إعادة المحاولة")} v={tx(T, "بعد 30 ث")} tone="wait" />
        </>
      )}

      <AppText variant="note" muted style={{ marginVertical: SPACE["3"] }}>
        {tx(T, "الحفظ والطباعة والمزامنة ثلاثة أفعال منفصلة")}
        {tx(T, "، ونجاح أحدها لا يُشترط بنجاح الآخر. والبيع لا يُلغى لأن الطابعة صمتت.")}
      </AppText>

      {state === "offline" ? (
        <Button label={tx(T, "ابدأ بيعاً جديداً")} financial onPress={newSale} />
      ) : state === "saved_local" ? (
        <Button
          label={tx(T, "اطبع وابدأ بيعاً جديداً")}
          financial
          onPress={() => void printAndNew()}
        />
      ) : state === "validation_error" ? (
        <Button
          label={tx(T, "علّقها للمالك وابدأ بيعاً جديداً")}
          variant="danger"
          onPress={newSale}
        />
      ) : (
        <Button label={tx(T, "واصل البيع محلياً")} variant="secondary" onPress={newSale} />
      )}
      <Button
        label={`${tx(T, "الإيصال")} ${formatMinorShort(sale.total_minor)}`}
        variant="quiet"
        onPress={() => router.push({ pathname: "/pos/receipt/[id]", params: { id: sale.id } })}
      />
    </Screen>
  );
}
