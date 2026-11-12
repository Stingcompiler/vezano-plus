import { normalizeSearch } from "@sting/domain";
import { expandLabels, type LabelRow, labelRows, readLocalItems } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  ROW_RTL,
  Screen,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import * as Print from "expo-print";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { M } from "@/components/catalog/parts";
import { CatRow } from "@/components/catalog/row";
import { labelsSheetHtml } from "@/lib/labels-print";
import { getStorage } from "@/lib/storage";

const T = "CAT-07";

/**
 * `/catalog/labels` — CAT-07 ملصقات الأصناف (0005 §٢٧٠) مرآة الويب: الكتالوج المحلي وحده (يعمل بلا
 * اتصال)، ورقة A4 بأربعة وعشرين ملصقاً بطباعة النظام. ورق الإيصال 58/80 مم في الويب والحاسوب وحدهما —
 * الجوال لا يملك ناقلاً إلى طابعة الإيصالات. `?item=` يحدّد وحدات صنف واحد بملصق لكلٍّ.
 */
export default function Labels() {
  const router = useRouter();
  const { item } = useLocalSearchParams<{ item?: string }>();
  const [rows, setRows] = useState<LabelRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [withPrice, setWithPrice] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = labelRows(await readLocalItems(await getStorage()));
      setRows(r.rows);
      setSkipped(r.skipped);
      if (typeof item === "string" && item) {
        setCounts(
          Object.fromEntries(r.rows.filter((x) => x.itemId === item).map((x) => [x.key, 1])),
        );
      }
    })();
  }, [item]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const n = normalizeSearch(q);
    if (!n) return rows;
    return rows.filter(
      (r) => normalizeSearch(r.label).includes(n) || r.barcode.startsWith(q.trim()),
    );
  }, [q, rows]);
  const labels = useMemo(() => expandLabels(rows ?? [], counts), [counts, rows]);
  const state = rows === null ? "loading" : rows.length === 0 ? "empty" : "ready";

  const print = async () => {
    setFailed(false);
    try {
      await Print.printAsync({
        html: labelsSheetHtml(tx(T, "ملصقات الأصناف"), labels, withPrice),
      });
    } catch {
      setFailed(true);
    }
  };

  return (
    <Screen screenId={T} state={state} title={tx(T, "ملصقات الأصناف")}>
      {state === "loading" ? <AppText variant="secondary">{tx(T, "جلب الأصناف")}</AppText> : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا صنف بباركود يُطبع")}>
          <AppText variant="secondary">
            {tx(
              T,
              "الملصق يحمل باركود EAN-13. أنشئ باركوداً داخلياً للأصناف من الكتالوج ثم عُد إلى هنا.",
            )}
          </AppText>
          <Button label={tx(T, "الكتالوج")} onPress={() => router.push("/catalog")} />
        </StateView>
      ) : null}
      {state === "ready" ? (
        <>
          <TextField label={tx(T, "بحث")} value={q} onChangeText={setQ} returnKeyType="search" />
          <View
            style={{
              flexDirection: ROW_RTL,
              flexWrap: "wrap",
              gap: SPACE["2"],
              marginBottom: SPACE["3"],
            }}
          >
            <Chip
              label={tx(T, "السعر على الملصق")}
              on={withPrice}
              onPress={() => setWithPrice((v) => !v)}
            />
          </View>
          {skipped > 0 ? (
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              <M>{skipped}</M> {tx(T, "باركود ليس EAN-13 — لا يُطبع هنا")}
            </AppText>
          ) : null}
          {shown.map((r, i) => (
            <View key={r.key}>
              <CatRow
                title={r.label}
                lines={
                  <AppText variant="note" muted>
                    <M>{r.barcode}</M>
                  </AppText>
                }
                last={i === shown.length - 1}
              />
              <TextField
                label={tx(T, "العدد")}
                accessibilityLabel={`${tx(T, "العدد —")} ${r.label}`}
                mono
                keyboardType="number-pad"
                placeholder="0"
                value={counts[r.key] ? String(counts[r.key]) : ""}
                onChangeText={(v) => {
                  const n = Number(v.replace(/[^0-9]/g, ""));
                  setCounts((c) => ({ ...c, [r.key]: Number.isFinite(n) ? n : 0 }));
                }}
              />
            </View>
          ))}
          <AppText variant="bodyStrong" style={{ marginVertical: SPACE["3"] }}>
            <M>{labels.length}</M> {tx(T, "ملصق")}
          </AppText>
          <Button
            label={tx(T, "اطبع ملصقات")}
            onPress={() => void print()}
            disabledReason={labels.length ? undefined : tx(T, "اكتب عدداً لصنف واحد على الأقل")}
          />
          {failed ? (
            <StateView state="validation_error" title={tx(T, "لم تتم الطباعة")}>
              <AppText variant="secondary">
                {tx(
                  T,
                  "تعذّر الاتصال بالطابعة أو رُفضت الكتابة — تحقّق من تشغيلها وقربها ثم أعد التجربة.",
                )}
              </AppText>
            </StateView>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
