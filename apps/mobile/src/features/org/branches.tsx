import { formatMinor } from "@sting/app-core";
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
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Actions, Ago, Heading, Item, Lead, N, Note, Strong, Word } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import type { DeviceRow } from "./devices";
import { fetched, useReport } from "./use-report";

const T = "ORG-03";
type State = "ready" | "empty" | "validation_error" | "permission_denied";

export interface BranchRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  is_default: boolean;
  code_locked: boolean;
  ledger: {
    invoices: number;
    shifts: number;
    open_shifts: number;
    stock_items: number;
    receivables_minor: string;
    has_ledger: boolean;
  };
  devices: DeviceRow[];
  staff: number;
}
export interface BranchesPayload {
  branches: BranchRow[];
  can_create: boolean;
}

/** ملاحظة الجهاز في تفاصيل الفرع المحجوب (نظير `deviceNote` في الويب). */
function deviceNote(d: DeviceRow): {
  label: string;
  tone: "expired" | "disabled" | "active";
  text: React.ReactNode;
} {
  if (d.pending > 0)
    return {
      label: tx(T, "معلّق"),
      tone: "expired",
      text: (
        <>
          <N>{d.pending}</N> {tx(T, "عمليات محفوظة محلياً لم تُرفع. فصله الآن يفقدها.")}
        </>
      ),
    };
  if (d.connectivity === "stale" || d.connectivity === "silent")
    return {
      label: tx(T, "صامت"),
      tone: "disabled",
      text: tx(T, "لا نفترض فقده ولا نفصله تلقائياً. نعرض آخر ظهوره وتقرر أنت."),
    };
  if (!d.sells)
    return {
      label: tx(T, "نظيف"),
      tone: "active",
      text: tx(T, "متصل · قراءة تقارير فقط بحكم دور مستخدمه"),
    };
  return { label: tx(T, "نظيف"), tone: "active", text: tx(T, "متصل · لا معلّق") };
}

/** خطأ الإنشاء كما في الويب. */
export function createError(detail: string | undefined, name: string): string {
  return detail === "code_taken"
    ? tx(T, "الرمز مستعمل لفرع آخر")
    : detail === "code_invalid"
      ? tx(T, "الرمز حرفان إلى ستة، لاتينية وأرقام")
      : detail === "branch_limit"
        ? tx(T, "بلغت حدّ الفروع في باقتك — رقِّ الباقة أو أضف فرعاً من شاشة الاشتراك")
        : detail === "name_required" || !name.trim()
          ? tx(T, "اكتب اسم الفرع")
          : tx(T, "تعذّر إنشاء الفرع");
}

/**
 * ORG-03 — الفروع وتفاصيلها (نظير `branches-client.tsx`): الحذف غير موجود — فرعٌ له دفتر يُقفل بعد
 * تحويل المخزون ويبقى تاريخه؛ الرمز ثابت بعد أول فاتورة؛ الإنشاء للمالك ومدير الفرع يرى فرعه.
 */
export function Branches() {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(
    async () => fetched<BranchesPayload>(await api.GET("/api/org/branches", {})),
    [api],
  );
  const { data, denied, failed, reload } = useReport<BranchesPayload>({ load });
  const [blocked, setBlocked] = useState<BranchRow | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);

  const payload: BranchesPayload | null =
    data ?? (denied || failed ? { branches: [], can_create: false } : null);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { error, response } = await api.POST("/api/org/branches", { body: { name, code } });
      if (!response.ok) {
        const e = error as unknown as { detail?: string } | undefined;
        setErr(createError(e?.detail, name));
        return;
      }
      setOpen(false);
      setName("");
      setCode("");
      await reload();
    } catch {
      setErr(tx(T, "تعذّر إنشاء الفرع"));
    } finally {
      setBusy(false);
    }
  };

  const close = async (b: BranchRow) => {
    if (busy) return;
    setBusy(true);
    setCloseErr(null);
    try {
      const { error, response } = await api.POST("/api/org/branches/{branch_id}/{action}", {
        params: { path: { branch_id: b.id, action: "close" } },
      });
      if (!response.ok) {
        const e = error as unknown as { detail?: string; extra?: unknown } | undefined;
        setCloseErr(
          e?.detail === "stock_remaining"
            ? `${tx(T, "المخزون المتبقي لم يُحوَّل بعد —")} ${String(e.extra)} ${tx(T, "صنفاً")}`
            : e?.detail === "open_shift"
              ? tx(T, "وردية مفتوحة في هذا الفرع — أغلقها أولاً")
              : e?.detail === "devices_pending"
                ? tx(T, "جهاز في هذا الفرع يحمل معلّقاً لم يُرفع")
                : e?.detail === "default_branch"
                  ? tx(T, "الفرع الرئيسي لا يُقفل")
                  : tx(T, "تعذّر الإقفال"),
        );
        return;
      }
      setBlocked(null);
      await reload();
    } catch {
      setCloseErr(tx(T, "تعذّر الإقفال"));
    } finally {
      setBusy(false);
    }
  };

  const branches = payload?.branches ?? [];
  const state: State = !payload
    ? "ready"
    : blocked
      ? "validation_error"
      : !payload.can_create
        ? "permission_denied"
        : branches.length <= 1
          ? "empty"
          : "ready";

  return (
    <Screen screenId={T} state={state} title={tx(T, "الفروع")} onRefresh={() => void reload()}>
      <AppText variant="section">{tx(T, "الفروع وتفاصيلها")}</AppText>
      <Note>{tx(T, "الفرع وحدة مخزون وصندوق لا عنوان.")}</Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "فرع واحد")}>
          <Lead>{tx(T, "أغلب المحلات فرعٌ واحد.")}</Lead>
        </StateView>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "مدير الفرع يرى فرعه")}>
          <Lead>{tx(T, "يرى تفاصيل فرعه ويعدّل ما يخصّه، ولا يرى الفروع الأخرى ولا يُنشئ.")}</Lead>
          <Note>
            <Strong>{tx(T, "الإنشاء للمالك")}</Strong>{" "}
            {tx(T, "· الفرع يستهلك من الباقة ويُنشئ مخزناً وصندوقاً — التزامٌ مالي وتشغيلي.")}
          </Note>
        </StateView>
      ) : null}

      {state === "validation_error" && blocked ? (
        <StateView state="validation_error" title={tx(T, "إجراء محجوب")}>
          <Lead>
            <Strong>
              {tx(T, "لا يمكن حذف «")}
              {blocked.name}»
            </Strong>{" "}
            {tx(T, "· الحذف يترك فواتير بلا فرع وأرصدة بلا موضع، ويكسر تقارير أشهر مضت.")}
          </Lead>
          <Note>
            <Strong>{tx(T, "ما يحمله هذا الفرع")}</Strong> {tx(T, "· فواتير صادرة")}{" "}
            <N>{blocked.ledger.invoices}</N> {tx(T, "· ورديات مسجَّلة")}{" "}
            <N>{blocked.ledger.shifts}</N> {tx(T, "· مخزون حالي")}{" "}
            <N>{blocked.ledger.stock_items}</N> {tx(T, "صنفاً · ذمم منسوبة لمعاملاته")}{" "}
            <N>{formatMinor(blocked.ledger.receivables_minor, 2, false)}</N>
          </Note>
          <Note>
            <Strong>{tx(T, "البديل: إقفال الفرع.")}</Strong>{" "}
            {tx(
              T,
              "يتوقف البيع والفتح فيه، ويبقى في التقارير التاريخية وفي كل فاتورة تحمل اسمه. المخزون المتبقي يُحوَّل عبر «التحويلات» لا يختفي، والذمم تبقى منسوبة لأطرافها.",
            )}
          </Note>
          {closeErr ? <Note>{closeErr}</Note> : null}
          <Heading>{tx(T, "الأجهزة المرتبطة")}</Heading>
          <Note>
            <Strong>{tx(T, "الجهاز يحمل معلّقاً محلياً — فصله ليس إلغاء اشتراك")}</Strong>{" "}
            {tx(
              T,
              "· قبل فصل أي جهاز نعرض ما عليه من معلّق غير مزامَن ونطلب مزامنته أو الإقرار بفقده كتابةً.",
            )}
          </Note>
          {blocked.devices.map((d) => {
            const n = deviceNote(d);
            return (
              <View key={d.id} style={{ marginTop: SPACE["1"] }}>
                <AppText variant="note">
                  <Strong>{d.name}</Strong> · {n.text} {tx(T, "· آخر مزامنة")}{" "}
                  <Ago iso={d.last_seen_at} /> · <Word tone={n.tone}>{n.label}</Word>
                </AppText>
              </View>
            );
          })}
          <Actions>
            <Button
              label={tx(T, "إقفال الفرع بعد تحويل المخزون")}
              loading={busy}
              disabledReason={
                blocked.ledger.stock_items > 0
                  ? tx(T, "المخزون المتبقي يُحوَّل أولاً")
                  : blocked.ledger.open_shifts > 0
                    ? tx(T, "وردية مفتوحة")
                    : undefined
              }
              onPress={() => void close(blocked)}
            />
            <Button
              variant="secondary"
              label={tx(T, "حذف — غير متاح")}
              disabledReason={tx(T, "الحذف يترك فواتير بلا فرع")}
              onPress={() => undefined}
            />
            <Button variant="quiet" label={tx(T, "رجوع")} onPress={() => setBlocked(null)} />
          </Actions>
        </StateView>
      ) : null}

      {payload ? (
        <>
          <Heading>{tx(T, "الفروع ومخازنها")}</Heading>
          <Note>
            {tx(
              T,
              "لكل فرع مخزنه وصناديقه وأجهزته وموظفوه. والحذف غير موجود: الفرع يُعطَّل ويبقى تاريخه.",
            )}
          </Note>
          {payload.can_create ? (
            <View style={{ marginVertical: SPACE["3"] }}>
              <Button label={tx(T, "فرع جديد")} onPress={() => setOpen(true)} />
            </View>
          ) : (
            <View style={{ height: SPACE["3"] }} />
          )}
          <GroupedList>
            {branches.map((b, i) => (
              <Item key={b.id} title={b.name} last={i === branches.length - 1}>
                <AppText variant="secondary" muted>
                  {tx(T, "· رمز")} <N>{b.code}</N>
                  {b.is_default ? ` ${tx(T, "· الرئيسي")}` : ""}
                  {!b.is_active ? ` ${tx(T, "· مُقفل")}` : ""}
                </AppText>
                <Note>
                  {tx(T, "فواتير")} <N>{b.ledger.invoices}</N> {tx(T, "· ورديات")}{" "}
                  <N>{b.ledger.shifts}</N> {tx(T, "· أصناف برصيد")} <N>{b.ledger.stock_items}</N>{" "}
                  {tx(T, "· موظفون")} <N>{b.staff}</N> {tx(T, "· أجهزة")} <N>{b.devices.length}</N>
                  {b.code_locked ? ` ${tx(T, "· الرمز ثابت بعد أول فاتورة")}` : ""}
                </Note>
                {payload.can_create && b.is_active && !b.is_default ? (
                  <Actions>
                    <Button
                      variant="quiet"
                      label={tx(T, "حذف")}
                      onPress={() => {
                        setCloseErr(null);
                        setBlocked(b);
                      }}
                    />
                  </Actions>
                ) : null}
              </Item>
            ))}
          </GroupedList>
          <Note>
            <Strong>{tx(T, "لا حذف")}</Strong>{" "}
            {tx(
              T,
              "· فرعٌ باع سنةً لا يُحذف — حذفه يُيتّم فواتير ومخزوناً. التعطيل يمنع الجديد ويُبقي القديم مقروءاً.",
            )}
          </Note>
        </>
      ) : null}

      <View style={{ height: SPACE["3"] }} />
      <Button
        variant="quiet"
        label={tx(T, "الأجهزة")}
        onPress={() => router.push("/org/devices")}
      />

      <Sheet open={open} title={tx(T, "فرع جديد")} onClose={() => setOpen(false)}>
        <TextField label={tx(T, "اسم الفرع")} value={name} onChangeText={setName} required />
        <TextField
          label={tx(T, "رمز الفرع في الترقيم")}
          hint={tx(T, "حرفان إلى ستة لاتينية — يدخل رقم كل فاتورة ولا يتغيّر بعد أولها")}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          mono
          required
          error={err ?? undefined}
        />
        <Note>
          <Strong>{tx(T, "الإنشاء للمالك")}</Strong>{" "}
          {tx(T, "· الفرع يستهلك من الباقة ويُنشئ مخزناً وصندوقاً — التزامٌ مالي وتشغيلي.")}
        </Note>
        <View style={{ height: SPACE["3"] }} />
        <Button
          label={tx(T, "إنشاء الفرع")}
          loading={busy}
          disabledReason={name.trim() ? undefined : tx(T, "اكتب اسم الفرع")}
          onPress={() => void create()}
        />
      </Sheet>
    </Screen>
  );
}
