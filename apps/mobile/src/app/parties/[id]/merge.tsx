import { formatMinorShort } from "@sting/app-core";
import { maskPhone, storeParties } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  GroupedList,
  Screen,
  Sheet,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { M, PRow, Stack } from "@/components/parties/parts";
import { firstError } from "@/features/parties/lib";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-07";
type State = "ready" | "validation_error" | "permission_denied" | "conflict" | "success";

interface Side {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly balance_minor: string;
  readonly movements: number;
  readonly merged_into: string;
}

interface Preview {
  readonly source: Side;
  readonly target: Side;
  readonly movements_after: number;
  readonly balance_after_minor: string;
  readonly phones_differ: boolean;
}

interface MergeResult {
  readonly merge: { readonly id: string; readonly occurred_at: string };
  readonly source: Side;
  readonly target: Side;
}

/** «4 حركات» / «11 حركة» — الرقم لاتيني mono والكلمة خارجه. */
function Movements({ n }: { n: number }) {
  const word =
    n === 1
      ? tx(T, "حركة")
      : n === 2
        ? tx(T, "حركتان")
        : n >= 3 && n <= 10
          ? tx(T, "حركات")
          : tx(T, "حركة");
  return (
    <>
      <M>{n}</M> {word}
    </>
  );
}

/** «عليه 60.00» / «له 60.00» بحسب إشارة الرصيد. */
function Owed({ minor }: { minor: string }) {
  const v = BigInt(minor || "0");
  return (
    <>
      {v < 0n ? tx(T, "له") : tx(T, "عليه")} <M>{formatMinorShort((v < 0n ? -v : v).toString())}</M>
    </>
  );
}

/**
 * PTY-07 — دمج أطراف (خطة الجوال M3): المصدر يُدمج ويختفي والهدف يبقى؛ معاينة الأثر قبل التأكيد
 * المزدوج (كلمة تُكتب)؛ خريطة هوية لا إعادة كتابة للحركات — الحدث المتأخر باسم المصدر يصل إلى الهدف
 * موسوماً بمصدره؛ للمالك وحده والصلاحية قبل التأكيد لا بدلاً منه.
 */
export default function Merge() {
  const router = useRouter();
  const { id: sourceId, target } = useLocalSearchParams<{ id: string; target?: string }>();
  const targetId = target ?? "";
  const { api } = useSession();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [done, setDone] = useState<MergeResult | null>(null);

  useEffect(() => {
    if (!targetId) {
      setPreview(null);
      return;
    }
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/parties/{party_id}/merge", {
          params: { path: { party_id: sourceId }, query: { target: targetId } },
        });
        if (response.status === 403) {
          setDenied(true);
          setPreview(null);
          return;
        }
        const body = data as unknown as Preview | undefined;
        setPreview(!response.ok || !body ? null : body);
      } catch {
        setPreview(null);
      }
    })();
  }, [api, sourceId, targetId]);

  useEffect(() => {
    if (preview === null && !denied)
      router.replace({ pathname: "/parties/[id]", params: { id: sourceId } });
  }, [preview, denied, router, sourceId]);

  // تعارض: قرار دمج آخر سبقنا (المصدر مدموج، أو الهدف نفسه دُمج) — الحركات المتأخرة تُوجَّه بخريطة الهوية
  const alreadyMerged = Boolean(preview?.source.merged_into || preview?.target.merged_into);
  const conflict = alreadyMerged || rejected !== null;
  const evidenceAgainst = preview?.phones_differ ?? false;

  const state: State = done
    ? "success"
    : denied
      ? "permission_denied"
      : conflict
        ? "conflict"
        : evidenceAgainst
          ? "validation_error"
          : "ready";

  const merge = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/parties/{party_id}/merge", {
        params: { path: { party_id: preview.source.id } },
        body: { target_id: preview.target.id, confirm: "MERGE", reason: reason.trim() },
      });
      if (response.status === 403) {
        setDenied(true);
        setConfirming(false);
        return;
      }
      if (response.status === 400) {
        setRejected(firstError(error)?.code ?? "rejected");
        setConfirming(false);
        return;
      }
      const body = data as unknown as MergeResult | undefined;
      if (!response.ok || !body) return;
      await storeParties(
        await getStorage(),
        [body.source as never, body.target as never],
        new Date().toISOString(),
      );
      setDone(body);
      setConfirming(false);
    } catch {
      /* بلا شبكة: الدمج خادمي فقط — لا حفظ محلي */
    } finally {
      setBusy(false);
    }
  };

  // البديل المعروض: وسمهما «مراجَعان ومنفصلان» يُسكت التنبيه بلا دمج (PTY-03)
  const markDistinct = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const { response } = await api.POST("/api/parties/{party_id}/distinct", {
        params: { path: { party_id: preview.source.id } },
        body: { other_id: preview.target.id },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.ok)
        router.push({ pathname: "/parties/[id]", params: { id: preview.target.id } });
    } catch {
      /* بلا شبكة: يبقى التنبيه */
    } finally {
      setBusy(false);
    }
  };

  const src = preview?.source;
  const tgt = preview?.target;
  const wordOk = word.trim() === tx(T, "دمج");

  return (
    <Screen screenId={T} state={state} title={tx(T, "دمج طرفين مكررين")}>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الدمج لا يُلغى بسهولة — راجع المعاينة بدقة")}
      </AppText>

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الدمج للمالك")}>
          <AppText variant="secondary">
            {tx(T, "يوحّد دفترين ماليين. لا مدير فرع ولا محاسب.")}
          </AppText>
        </StateView>
      ) : null}

      {state === "conflict" ? (
        <StateView state="conflict" title={tx(T, "حركات متأخرة على الطرف الممحوّ")}>
          <AppText variant="secondary">
            {tx(T, "وصلت فاتورة من جهاز غير مزامن على الطرف الذي دُمج.")}
          </AppText>
          <AppText variant="note">
            {tx(T, "خريطة هوية لا إعادة كتابة")}{" "}
            {tx(
              T,
              "· الحركة المتأخرة تُوجَّه إلى الطرف الباقي بخريطةٍ تحفظ هويتها الأصلية — لا نُعيد كتابة حركة مضت.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "دمج طرفين بأرقام وعناوين مختلفة")}>
          <AppText variant="secondary">
            {tx(T, "الاسمان متقاربان والدليل ضد الدمج لا معه: رقمان مختلفان وعنوانان.")}
          </AppText>
          <AppText variant="note">
            {tx(T, "لا نقترح الدمج ولا نفعله تلقائياً. لو كانا شخصين لطالبتَ أحدهما بدين غيره.")}
          </AppText>
          <AppText variant="note">
            {tx(
              T,
              "«وسمهما مراجَعان ومنفصلان» — يُسكت التنبيه بلا دمج، وهو الصواب في أغلب الحالات.",
            )}
          </AppText>
        </StateView>
      ) : null}

      {state === "success" && done ? (
        <>
          <StateView state="success" title={tx(T, "دُمج الطرفان")}>
            <AppText variant="secondary">
              {tx(
                T,
                "رصيدٌ واحد وكشفٌ واحد، والطرف الممحوّ يبقى مرئياً في السجل بإشارةٍ إلى وارثه.",
              )}
            </AppText>
            <AppText variant="note">
              {tx(T, "التراجع محدود")} {tx(T, "· ممكن ما لم تُسجَّل حركة جديدة على المدموج.")}
            </AppText>
          </StateView>
          <GroupedList>
            <PRow title={tx(T, "الهدف — يبقى")} trailing={<AppText>{done.target.name}</AppText>} />
            <PRow
              title={tx(T, "الرصيد المجمّع")}
              trailing={<M>{formatMinorShort(done.target.balance_minor)}</M>}
            />
            <PRow
              title={tx(T, "المصدر — يُدمج ويختفي")}
              trailing={<AppText>{done.source.name}</AppText>}
              last
            />
          </GroupedList>
          <Stack>
            <Button
              label={tx(T, "كشف الحساب")}
              financial
              onPress={() =>
                router.push({
                  pathname: "/parties/[id]/statement",
                  params: { id: done.target.id },
                })
              }
            />
            <Button
              label={tx(T, "بطاقة الطرف")}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/parties/[id]", params: { id: done.target.id } })
              }
            />
          </Stack>
        </>
      ) : null}

      {preview && src && tgt && !done ? (
        <>
          <GroupedList>
            <PRow
              title={src.name}
              sub={
                <>
                  {tx(T, "المصدر — يُدمج ويختفي")}
                  {src.phone ? (
                    <>
                      {" · "}
                      <M>{maskPhone(src.phone)}</M>
                    </>
                  ) : null}
                  {"\n"}
                  <Movements n={src.movements} /> · <Owed minor={src.balance_minor} />
                </>
              }
            />
            <PRow
              title={tgt.name}
              sub={
                <>
                  {tx(T, "الهدف — يبقى")}
                  {tgt.phone ? (
                    <>
                      {" · "}
                      <M>{maskPhone(tgt.phone)}</M>
                    </>
                  ) : null}
                  {"\n"}
                  <Movements n={tgt.movements} /> · <Owed minor={tgt.balance_minor} />
                </>
              }
              last
            />
          </GroupedList>

          <GroupedList title={tx(T, "معاينة الأثر")}>
            <PRow title={tx(T, "الحركات بعد الدمج")} trailing={<M>{preview.movements_after}</M>} />
            <PRow
              title={tx(T, "الرصيد المجمّع")}
              trailing={<M strong>{formatMinorShort(preview.balance_after_minor)}</M>}
            />
            <PRow
              title={tx(T, "المستندات القديمة")}
              sub={tx(T, "تبقى بأسمائها الأصلية — لا تُعاد كتابتها")}
              last
            />
          </GroupedList>
          <StateView state="ready" title={tx(T, "الأحداث المتأخرة.")}>
            <AppText variant="secondary">
              {tx(
                T,
                "إن وصل من جهاز غير متصل سدادٌ مسجَّل باسم المصدر بعد الدمج، تُوجّهه خريطة الهوية إلى الهدف تلقائياً ويظهر في كشفه موسوماً بمصدره. لا يُفقد ولا يُنشئ طرفاً جديداً.",
              )}
            </AppText>
          </StateView>
          <TextField
            label={tx(T, "السبب")}
            value={reason}
            onChangeText={setReason}
            hint={tx(T, "اختياري — يظهر في سجل التدقيق")}
          />
          <Stack>
            <Button
              label={tx(T, "تأكيد الدمج")}
              financial
              variant="danger"
              onPress={() => setConfirming(true)}
              disabledReason={
                denied
                  ? tx(T, "الدمج للمالك")
                  : conflict
                    ? tx(T, "حركات متأخرة على الطرف الممحوّ")
                    : undefined
              }
            />
            {evidenceAgainst ? (
              <Button
                label={tx(T, "وسمهما «مراجَعان ومنفصلان»")}
                variant="secondary"
                onPress={() => void markDistinct()}
                loading={busy}
              />
            ) : null}
            <Button
              label={tx(T, "إلغاء")}
              variant="quiet"
              onPress={() => router.push({ pathname: "/parties/[id]", params: { id: tgt.id } })}
            />
          </Stack>
          <Sheet
            open={confirming}
            title={tx(T, "تأكيد الدمج")}
            onClose={() => setConfirming(false)}
          >
            <AppText style={{ marginBottom: SPACE["2"] }}>
              {src.name} → {tgt.name} · {tx(T, "الرصيد المجمّع")}{" "}
              <M>{formatMinorShort(preview.balance_after_minor)}</M>
            </AppText>
            <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
              {tx(T, "الدمج لا يُلغى بسهولة — راجع المعاينة بدقة")}
            </AppText>
            <TextField
              label={tx(T, "دمج")}
              value={word}
              onChangeText={setWord}
              autoCorrect={false}
              required
            />
            <Button
              label={tx(T, "تأكيد الدمج")}
              financial
              variant="danger"
              loading={busy}
              onPress={() => void merge()}
              disabledReason={
                wordOk ? undefined : tx(T, "الدمج لا يُلغى بسهولة — راجع المعاينة بدقة")
              }
            />
            <Button label={tx(T, "إلغاء")} variant="quiet" onPress={() => setConfirming(false)} />
          </Sheet>
        </>
      ) : null}
    </Screen>
  );
}
