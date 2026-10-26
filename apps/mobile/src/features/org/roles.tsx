import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
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

import { Actions, Heading, Item, Lead, Mono, N, Note, Strong } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-02";
type State = "ready" | "validation_error" | "permission_denied" | "success";

export type CellValue =
  "yes" | "no" | "unlimited" | "limit" | "branch" | "own_customer" | "cash_only" | "propose";
export interface Cell {
  role_id: string;
  label: string;
  value: CellValue;
  limit_minor: string | null;
  period: string;
}
interface RowT {
  key: string;
  label: string;
  note: string;
  financial: boolean;
  cells: Cell[];
}
export interface Matrix {
  tenant_name?: string;
  roles: { id: string; code: string; name: string; users: number; locked: boolean }[];
  rows: RowT[];
  can_edit: boolean;
  changed_cells?: number;
  affected_users?: number;
}

const VALUE_OPTIONS: { value: CellValue; label: string }[] = [
  { value: "yes", label: tx(T, "نعم") },
  { value: "no", label: tx(T, "لا") },
  { value: "unlimited", label: tx(T, "بلا حد") },
  { value: "limit", label: tx(T, "حد مالي") },
  { value: "branch", label: tx(T, "فرعه") },
  { value: "own_customer", label: tx(T, "عميل البيع فقط") },
  { value: "cash_only", label: tx(T, "نقداً فقط") },
  { value: "propose", label: tx(T, "اقتراح فقط") },
];

/** «الإجراء وأثره» (20-D15): كل بند جملة — من يستطيع، وما يقع من أثر. */
const EFFECTS: { action: string; effect: string; roles: [string, string, string, string] }[] = [
  {
    action: tx(T, "بيع نقدي وإصدار فاتورة"),
    effect: tx(T, "يُسجَّل باسمه وينسب لورديته"),
    roles: [tx(T, "نعم"), tx(T, "نعم"), tx(T, "نعم"), tx(T, "نعم")],
  },
  {
    action: tx(T, "بيع بالذمة"),
    effect: tx(T, "يُنشئ ديناً على طرف — أثره مالي يتجاوز الوردية"),
    roles: [tx(T, "نعم"), tx(T, "لا"), tx(T, "نعم"), tx(T, "نعم")],
  },
  {
    action: tx(T, "إلغاء فاتورة بعد إصدارها"),
    effect: tx(T, "لا حذف؛ مرتجع أو قيد عكسي بسبب مكتوب"),
    roles: [tx(T, "لا"), tx(T, "لا"), tx(T, "باعتماد"), tx(T, "نعم")],
  },
  {
    action: tx(T, "تسوية جرد وتعديل كميات"),
    effect: tx(T, "يغيّر رقم المخزون بلا حركة بيع أو شراء"),
    roles: [tx(T, "لا"), tx(T, "باعتماد"), tx(T, "نعم"), tx(T, "نعم")],
  },
  {
    action: tx(T, "اعتماد فارق الوردية"),
    effect: tx(T, "شهادة بأن العجز أو الزيادة مقبولان — لا يشهد أحد لنفسه"),
    roles: [tx(T, "لا"), tx(T, "لا"), tx(T, "نعم"), tx(T, "نعم")],
  },
  {
    action: tx(T, "حسم تعارض نسختين"),
    effect: tx(T, "يختار أي رقم يصبح الحقيقة في الدفتر"),
    roles: [tx(T, "لا"), tx(T, "لا"), tx(T, "لا"), tx(T, "نعم")],
  },
  {
    action: tx(T, "قراءة سجل التدقيق"),
    effect: tx(T, "نطاق الرؤية يتبع نطاق المسؤولية"),
    roles: [tx(T, "أفعاله"), tx(T, "أفعاله"), tx(T, "فرعه"), tx(T, "نعم")],
  },
  {
    action: tx(T, "نقل ملكية المنشأة"),
    effect: tx(T, "ينقل الدفتر كله لشخص آخر"),
    roles: [tx(T, "لا"), tx(T, "لا"), tx(T, "لا"), tx(T, "نعم")],
  },
];
const EFFECT_ROLES = [tx(T, "كاشير"), tx(T, "أمين مخزن"), tx(T, "مدير فرع"), tx(T, "مالك")];

const key = (roleId: string, k: string) => `${roleId}:${k}`;

/** حمولة التغييرات كما يرسلها الويب (`PUT /api/org/roles`). */
export function changesOf(draft: Map<string, Cell>) {
  return [...draft.entries()].map(([k, c]) => ({
    role_id: c.role_id,
    key: k.split(":")[1],
    value: c.value,
    limit_minor: c.value === "limit" ? c.limit_minor : null,
    period: c.value === "limit" ? c.period || "per_op" : "",
  }));
}

/**
 * ORG-02 — مصفوفة الأدوار والصلاحيات (نظير `roles-client.tsx`). انحراف موثَّق: جدول 13×4 لا يتّسع،
 * فتُعرض الصلاحيات دوراً دوراً (اختر الدور ← قائمة صلاحياته بقيمها) بالقيم والحدود نفسها؛ الحفظ يطابق
 * الحمولة. المصفوفة للمالك وحده؛ عمود المالك مقفل؛ الحدود المالية قيم تجريبية.
 */
export function Roles() {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(async () => fetched<Matrix>(await api.GET("/api/org/roles", {})), [api]);
  const { data, denied, failed, reload } = useReport<Matrix>({ load });
  const [saved, setSaved] = useState<{ cells: number; users: number } | null>(null);
  const [out, setOut] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Map<string, Cell>>(new Map());
  const [rejected, setRejected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleSel, setRoleSel] = useState("");
  const [editing, setEditing] = useState<{ row: RowT; cell: Cell } | null>(null);
  const [limitRaw, setLimitRaw] = useState("");

  const m: Matrix | null =
    out ?? data ?? (denied || failed ? { roles: [], rows: [], can_edit: false } : null);
  const currentRole = m?.roles.find((r) => r.id === roleSel) ?? m?.roles[0];

  const current = (row: RowT, c: Cell): Cell => draft.get(key(c.role_id, row.key)) ?? c;
  const edit = (row: RowT, c: Cell, patch: Partial<Cell>) => {
    setSaved(null);
    setRejected(null);
    setDraft((d) => new Map(d).set(key(c.role_id, row.key), { ...current(row, c), ...patch }));
  };

  const save = async () => {
    if (busy || !m) return;
    setBusy(true);
    setRejected(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.PUT("/api/org/roles", {
        body: { changes: changesOf(draft) } as never,
      });
      if (!response.ok) {
        const e = error as unknown as { detail?: string } | undefined;
        setRejected(e?.detail ?? "failed");
        return;
      }
      const o = d as unknown as Matrix;
      setOut(o);
      setDraft(new Map());
      setSaved({ cells: o.changed_cells ?? 0, users: o.affected_users ?? 0 });
    } catch {
      setRejected("failed");
    } finally {
      setBusy(false);
    }
  };

  const state: State = !m
    ? "ready"
    : !m.can_edit
      ? "permission_denied"
      : rejected
        ? "validation_error"
        : saved
          ? "success"
          : "ready";

  const rejectText =
    rejected === "owner_locked"
      ? tx(
          T,
          "لا يمكن للمالك أن يسحب صلاحيته الأخيرة عن نفسه: المنشأة بلا مالك تصبح دفتراً لا يملك أحد حسم تعارضاته.",
        )
      : rejected === "limit_required"
        ? tx(T, "الحدّ المالي يحتاج قيمة ونطاقاً (للعملية أو يومياً) قبل الحفظ.")
        : rejected
          ? tx(T, "تعذّر حفظ المصفوفة — لم يتغيّر شيء.")
          : "";

  const label = (v: CellValue) => VALUE_OPTIONS.find((o) => o.value === v)?.label ?? v;
  const limitMajor = (minor: string | null) => (minor ? String(Number(minor) / 100) : "");
  const cur = editing ? current(editing.row, editing.cell) : null;
  const period = cur?.period || "per_op";

  return (
    <Screen screenId={T} state={state} title={tx(T, "الأدوار")} onRefresh={() => void reload()}>
      <AppText variant="section">{tx(T, "مصفوفة الأدوار والصلاحيات")}</AppText>
      <Note>
        {tx(T, "الفرع والحد المالي وفصل النشر عن الاعتماد. الحدود قابلة للتحرير والقيم تجريبية.")}
      </Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "المصفوفة للمالك وحده")}>
          <Lead>
            {tx(
              T,
              "مدير الفرع يرى أدوار فريقه ولا يعدّل المصفوفة — تعديلها يُغيّر ما يستطيعه كل موظف في المنشأة.",
            )}
          </Lead>
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        <StateView
          state="validation_error"
          title={tx(T, "لا يمكن إنشاء دور بلا مالك قادر على سحبه.")}
        >
          <Lead>{rejectText}</Lead>
        </StateView>
      ) : null}

      {state === "success" && saved ? (
        <StateView state="success" title={tx(T, "حُفظت المصفوفة")}>
          <Lead>
            {tx(T, "تغيّرت صلاحيات")} <N>{saved.users}</N> {tx(T, "موظفين")}
          </Lead>
          <Note>
            <Strong>{tx(T, "يسري فوراً")}</Strong>{" "}
            {tx(
              T,
              "· ومن كان في منتصف عمل يُطبَّق عليه عند فعله التالي لا في لحظته. ولا يُقطع عليه بيعٌ جارٍ.",
            )}
          </Note>
        </StateView>
      ) : null}

      {m && m.rows.length > 0 && currentRole ? (
        <>
          <Heading>
            {tx(T, "الأدوار في")} {m.tenant_name ?? tx(T, "المنشأة")}
          </Heading>
          <Note>{tx(T, "الصلاحية تُمنح للدور، والنطاق يُمنح للمستخدم في الفرع")}</Note>
          <View style={{ height: SPACE["2"] }} />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: SPACE["2"],
              marginBottom: SPACE["3"],
            }}
          >
            {m.roles.map((r) => (
              <Chip
                key={r.id}
                label={r.name}
                on={currentRole.id === r.id}
                onPress={() => setRoleSel(r.id)}
              />
            ))}
          </View>
          <Button
            variant="secondary"
            label={tx(T, "دور مخصَّص")}
            disabledReason={tx(T, "الأدوار المخصَّصة في مرحلة لاحقة")}
            onPress={() => undefined}
          />
          <View style={{ height: SPACE["3"] }} />

          <GroupedList title={`${tx(T, "الصلاحية")} — ${currentRole.name}`}>
            {m.rows.map((row, i) => {
              const c = row.cells.find((x) => x.role_id === currentRole.id);
              if (!c) return null;
              const d = current(row, c);
              const changed = d.value !== c.value || d.limit_minor !== c.limit_minor;
              const editable = m.can_edit && !currentRole.locked;
              return (
                <Item
                  key={row.key}
                  title={row.label}
                  last={i === m.rows.length - 1}
                  status={
                    <AppText variant="secondary">
                      {changed ? (
                        <>
                          {label(d.value)}
                          {d.value === "limit" && d.limit_minor ? (
                            <>
                              {" "}
                              <N>{limitMajor(d.limit_minor)}</N>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Mono text={c.label} />
                      )}
                    </AppText>
                  }
                >
                  <Note>
                    <Mono text={row.note} />
                  </Note>
                  {editable ? (
                    <Actions>
                      <Button
                        variant="quiet"
                        label={row.label}
                        onPress={() => {
                          setEditing({ row, cell: c });
                          setLimitRaw(limitMajor(d.limit_minor));
                        }}
                      />
                    </Actions>
                  ) : null}
                </Item>
              );
            })}
          </GroupedList>
          <Note>
            <Strong>{tx(T, "الحدود المالية قيم تجريبية.")}</Strong>{" "}
            {tx(
              T,
              "كل حد يقبل قيمة ووحدة ونطاقاً (للعملية أو يومياً) ويُحرَّر هنا. لم تُعتمد أرقام فعلية بعد. وفصل «إنشاء الحملة» عن «اعتمادها ونشرها» متعمَّد: من يكتب الرسالة لا يرسلها وحده.",
            )}
          </Note>
          {m.can_edit ? (
            <Actions>
              <Button
                label={tx(T, "حفظ المصفوفة")}
                loading={busy}
                disabledReason={draft.size === 0 ? tx(T, "لا تغيير بعد") : undefined}
                onPress={() => void save()}
              />
              {draft.size > 0 ? (
                <Button
                  variant="quiet"
                  label={tx(T, "تراجع")}
                  onPress={() => setDraft(new Map())}
                />
              ) : null}
            </Actions>
          ) : null}
        </>
      ) : null}

      <View style={{ height: SPACE["4"] }} />
      <Heading>{tx(T, "الأدوار والصلاحيات — ما يراه كل دور بالضبط")}</Heading>
      <Note>
        <Strong>{tx(T, "لا يمكن إنشاء دور بلا مالك قادر على سحبه.")}</Strong>{" "}
        {tx(
          T,
          "ولا يمكن للمالك أن يسحب صلاحيته الأخيرة عن نفسه: المنشأة بلا مالك تصبح دفتراً لا يملك أحد حسم تعارضاته. ودعوة المستخدم تنتهي بمهلة معلنة: الرابط المنتهي يقول «انتهت صلاحية الدعوة» ويطلب إعادة إرسالها، ولا يمنح دخولاً صامتاً.",
        )}
      </Note>
      <View style={{ height: SPACE["2"] }} />
      <GroupedList title={tx(T, "الإجراء وأثره")}>
        {EFFECTS.map((e, i) => (
          <Item key={e.action} title={e.action} last={i === EFFECTS.length - 1}>
            <Note>{e.effect}</Note>
            <AppText variant="note">
              {e.roles.map((v, j) => `${EFFECT_ROLES[j]}: ${v}`).join(" · ")}
            </AppText>
          </Item>
        ))}
      </GroupedList>

      <Button
        variant="quiet"
        label={tx(T, "المستخدمون والدعوات")}
        onPress={() => router.push("/org/users")}
      />

      <Sheet
        open={editing !== null}
        title={editing ? `${editing.row.label} — ${currentRole?.name ?? ""}` : ""}
        onClose={() => setEditing(null)}
      >
        {editing && cur ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE["2"] }}>
              {VALUE_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  on={cur.value === o.value}
                  onPress={() =>
                    edit(editing.row, editing.cell, {
                      value: o.value,
                      period: o.value === "limit" ? cur.period || "per_op" : "",
                    })
                  }
                />
              ))}
            </View>
            {cur.value === "limit" ? (
              <View style={{ marginTop: SPACE["3"] }}>
                <TextField
                  label={tx(T, "حدّ")}
                  mono
                  keyboardType="numeric"
                  value={limitRaw}
                  onChangeText={(t) => {
                    setLimitRaw(t);
                    const n = Number(t.replace(/[^0-9.]/g, ""));
                    edit(editing.row, editing.cell, {
                      limit_minor: Number.isFinite(n) ? String(Math.round(n * 100)) : null,
                    });
                  }}
                />
                <View style={{ flexDirection: "row", gap: SPACE["2"] }}>
                  <Chip
                    label={tx(T, "للعملية")}
                    on={period === "per_op"}
                    onPress={() => edit(editing.row, editing.cell, { period: "per_op" })}
                  />
                  <Chip
                    label={tx(T, "يومياً")}
                    on={period === "daily"}
                    onPress={() => edit(editing.row, editing.cell, { period: "daily" })}
                  />
                </View>
              </View>
            ) : null}
            <View style={{ height: SPACE["3"] }} />
            <Button
              variant="secondary"
              label={tx("ORG-01", "حسناً")}
              onPress={() => setEditing(null)}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
