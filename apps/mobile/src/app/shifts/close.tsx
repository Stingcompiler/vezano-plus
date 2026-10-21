import { formatMinorShort, hhmm, pushPending } from "@sting/app-core";
import {
  type ClosedShift,
  closeShiftLocally,
  type LocalShift,
  readOpenShift,
  readReceiptCashRows,
  readReturnCashRows,
  readSaleCashRows,
  readShiftCash,
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
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

import { newId } from "@/lib/crypto";
import { useShiftContext } from "@/lib/pos";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "SHIFT-04";
const FACES = ["50000", "10000", "5000", "1000", "500", "100"] as const;

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/**
 * SHIFT-04 — إغلاق وعدّ الصندوق (خطة الجوال M2). عدّ الفئات بمحددات (العدد × الفئة) بلا حقل مبلغ واحد؛ كل
 * فئة تحتاج إدخالاً صريحاً ولو كان صفراً — الفراغ ليس صفراً. المتوقَّع يُحسب بعد تأكيد العدّ فقط من بيانات
 * الجهاز لقطةً ثابتة، ثم يظهر الفارق (نقصاً أو زيادةً) واقعةً تُراجَع لا تُطالَب تلقائياً. الشهادة وقائع لا
 * تحتاج شبكة.
 */
export default function CloseShift() {
  const router = useRouter();
  const { api } = useSession();
  const ctx = useShiftContext();
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [emptyFaces, setEmptyFaces] = useState<readonly string[]>([]);
  const [closed, setClosed] = useState<ClosedShift | null>(null);
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = useRef({ operationId: newId(), countId: newId(), closeId: newId() });

  useEffect(() => {
    void getStorage().then((s) => readOpenShift(s).then(setShift));
  }, []);
  useEffect(() => {
    if (shift === null) router.replace("/shifts/open");
  }, [router, shift]);

  const parsed = FACES.map((face) => {
    const raw = (counts[face] ?? "")
      .trim()
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const n = /^\d+$/.test(raw) ? Number(raw) : null;
    return { face, n, sum: n === null ? null : BigInt(face) * BigInt(n) };
  });
  const allFilled = parsed.every((c) => c.n !== null);
  const countedMinor = allFilled ? parsed.reduce((a, c) => a + (c.sum ?? 0n), 0n) : null;

  const confirm = async () => {
    if (busy || !shift || !ctx) return;
    const empty = parsed.filter((c) => c.n === null).map((c) => c.face);
    if (empty.length) return setEmptyFaces(empty);
    setBusy(true);
    setEmptyFaces([]);
    try {
      const storage = await getStorage();
      const cash = await readShiftCash(storage, shift, [
        ...(await readSaleCashRows(storage, shift.id)),
        ...(await readReturnCashRows(storage, shift.id)),
        ...(await readReceiptCashRows(storage, shift.id)),
      ]);
      const { shift: done } = await closeShiftLocally(storage, {
        ...ids.current,
        shift,
        countedCashMinor: (countedMinor ?? 0n).toString(),
        denominations: parsed.map((c) => ({ face_minor: c.face, count: c.n ?? 0 })),
        expectedCashAtCloseMinor: cash.expectedCashMinor.toString(),
        actorUserId: ctx.userId,
        actorName: ctx.userName,
        occurredAt: new Date().toISOString(),
      });
      setClosed(done as ClosedShift);
      try {
        const out = await pushPending({ api, storage, requestId: newId });
        if (out.kind === "applied" || out.kind === "idle") {
          const op = await storage.read((t) => t.getOperation(ids.current.operationId));
          setSynced(op?.state === "synced");
        }
      } catch {
        /* بلا اتصال: تُرفع مع عملياتها */
      }
    } finally {
      setBusy(false);
    }
  };

  const state = closed
    ? synced
      ? "success"
      : "saved_local"
    : emptyFaces.length
      ? "validation_error"
      : "ready";

  if (closed) {
    const expected = BigInt(closed.expected_cash_at_close_minor);
    const counted = closed.count_status === "counted" ? BigInt(closed.counted_cash_minor) : null;
    const variance = counted === null ? null : counted - expected;
    return (
      <Screen screenId={T} state={state} title={tx(T, "أُقفلت الوردية")}>
        <StateView
          state={synced ? "success" : "saved_local"}
          title={tx(T, "العدّ محفوظ بلا اتصال")}
        >
          <AppText variant="secondary">
            {tx(T, "مقفلة بشهادة الكاشير")} · <M>{hhmm(closed.closed_at)}</M>
          </AppText>
        </StateView>
        <GroupedList title={tx(T, "شهادة العدّ")}>
          <ListRow
            title={tx(T, "المتوقَّع")}
            trailing={<M>{formatMinorShort(expected.toString())}</M>}
          />
          <ListRow
            title={tx(T, "المعدود")}
            trailing={
              counted === null ? (
                <AppText>{tx(T, "لم أعدّ")}</AppText>
              ) : (
                <M>{formatMinorShort(counted.toString())}</M>
              )
            }
          />
          <ListRow
            title={tx(T, "الفارق")}
            trailing={
              variance === null ? (
                <AppText>{tx(T, "بلا عدّ — الفارق غير معروف.")}</AppText>
              ) : variance === 0n ? (
                <AppText>{tx(T, "مطابقة.")}</AppText>
              ) : (
                <AppText>
                  {variance < 0n ? tx(T, "نقصاً") : tx(T, "زيادةً")}{" "}
                  <M>{formatMinorShort((variance < 0n ? -variance : variance).toString())}</M>
                </AppText>
              )
            }
            last
          />
        </GroupedList>
        <Button
          label={tx(T, "افتح وردية جديدة")}
          financial
          onPress={() => router.replace("/shifts/open")}
        />
        <Button
          label={tx(T, "الورديات")}
          variant="quiet"
          onPress={() => router.replace("/shifts/review")}
        />
      </Screen>
    );
  }

  return (
    <Screen
      screenId={T}
      state={state}
      title={shift ? `${tx(T, "عدّ صندوق وردية")} ${shift.user_name}` : tx(T, "عدّ الصندوق")}
    >
      {emptyFaces.length ? (
        <StateView state="validation_error" title={tx(T, "عدٌّ غير مكتمل")}>
          <AppText variant="secondary">
            <M>{String(emptyFaces.length)}</M>{" "}
            {tx(
              T,
              "فئات تُركت فارغة والإقفال مطلوب. الفراغ ليس صفراً: «لم أعدّ» تختلف عن «عددتُ فوجدتُ صفراً».",
            )}
          </AppText>
        </StateView>
      ) : null}
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(
          T,
          "كل فئة تحتاج إدخالاً صريحاً ولو كان صفراً. الحقل الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة.",
        )}
      </AppText>
      {FACES.map((face) => (
        <TextField
          key={face}
          label={`${tx(T, "عدد فئة")} ${formatMinorShort(face)}`}
          value={counts[face] ?? ""}
          onChangeText={(v) => setCounts({ ...counts, [face]: v })}
          keyboardType="number-pad"
          mono
          error={emptyFaces.includes(face) ? tx(T, "عدّ الفئات") : undefined}
        />
      ))}
      <AppText variant="secondary" style={{ marginVertical: SPACE["2"] }}>
        {tx(T, "المعدود")}:{" "}
        {countedMinor === null ? (
          tx(T, "يظهر بعد تأكيد العدّ، ومعه الفارق.")
        ) : (
          <M>{formatMinorShort(countedMinor.toString())}</M>
        )}
      </AppText>
      <Button
        label={tx(T, "أكّد العدّ واعرض الفارق")}
        financial
        loading={busy}
        onPress={() => void confirm()}
      />
    </Screen>
  );
}
