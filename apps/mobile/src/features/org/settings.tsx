import { hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  FONT,
  RADIUS,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Actions, Check, Heading, Lead, N, Note, Strong } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-09";
type State = "ready" | "validation_error" | "success" | "conflict";
type Section = "general" | "receipt" | "payment" | "ownership";
const SECTIONS: readonly (readonly [Section, string])[] = [
  ["general", tx(T, "عام")],
  ["receipt", tx(T, "الإيصال")],
  ["payment", tx(T, "الدفع")],
  ["ownership", tx(T, "الملكية")],
];

export interface SettingsPayload {
  version: number;
  updated_at: string;
  updated_by_name: string;
  name: string;
  currency: string;
  currency_exponent: number;
  receipt: { header: string; footer: string; paper_width: string; max_chars: number };
  locale: { language: string; numerals: string };
  payment_methods: {
    id: string;
    code: string;
    name: string;
    is_cash: boolean;
    is_active: boolean;
  }[];
  can_edit: boolean;
  changed?: string[];
}
export interface Ownership {
  current: {
    id: string;
    from_user_name: string;
    to_user_id: string;
    to_user_name: string;
    state: string;
    requested_at: string;
    expires_at: string;
  } | null;
  blockers: {
    open_shifts: { user_name: string; branch_name: string }[];
    pending_devices: { device_name: string; pending: number }[];
  };
  candidates: { id: string; display_name: string }[];
  can_request: boolean;
  can_confirm: boolean;
  ttl_hours: number;
}

/** عرض الحروف المتاح على الورق (58mm = 32، 80mm = 48) — النص الأطول يُمنع قبل الحفظ. */
export const CHARS: Record<string, number> = { "58": 32, "80": 48 };

/** أرقام عربية-هندية للمعاينة فقط حين يختار التاجر النمط (G-01 — الثمن معلن). */
export function arabicDigits(s: string): string {
  return s
    .replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)])
    .replace(/\./g, "٫")
    .replace(/,/g, "٬");
}

/** رقم المعاينة: mono حين النمط لاتيني، وعربي-هندي عادي حين يختار التاجر ذلك. */
function PreviewNum({ s, latin, strong = false }: { s: string; latin: boolean; strong?: boolean }) {
  return latin ? (
    <N style={strong ? { fontFamily: FONT.monoSemiBold } : {}}>{s}</N>
  ) : (
    <AppText variant="note">{s}</AppText>
  );
}

/** أول حقل أطول من عرض الورق (اسم · ترويسة · ختام) — null حين يتّسع الكل. */
export function tooWideField(
  width: string,
  fields: readonly (readonly [string, string])[],
): readonly [string, string] | null {
  const max = CHARS[width] ?? 48;
  return fields.find(([, v]) => v.trim().length > max) ?? null;
}

/**
 * ORG-09 — إعدادات المنشأة واللغة والقوالب (نظير `settings-client.tsx`): أقسام مجمّعة (عام · الإيصال ·
 * الدفع · الملكية)؛ القوالب حقول مسمّاة بمعاينة فورية؛ النص الأطول من عرض الورق يُمنع قبل الحفظ؛
 * التعديل المتزامن يُكشف بالإصدار (`conflict`)؛ العملة لا تُبدَّل؛ نقل الملكية بطلب وتأكيد من الطرفين.
 */
export function Settings() {
  const { api } = useSession();
  const c = useColors();
  const load = useCallback(
    async () => fetched<SettingsPayload>(await api.GET("/api/org/settings", {})),
    [api],
  );
  const loadOwn = useCallback(
    async () => fetched<Ownership>(await api.GET("/api/org/ownership", {})),
    [api],
  );
  const { data, reload } = useReport<SettingsPayload>({ load });
  const { data: ownData, reload: reloadOwn } = useReport<Ownership>({ load: loadOwn });

  const [p, setP] = useState<SettingsPayload | null>(null);
  const [name, setName] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [width, setWidth] = useState("80");
  const [numerals, setNumerals] = useState("latin");
  const [methods, setMethods] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState<{
    version: number;
    updated_at: string;
    updated_by_name: string;
  } | null>(null);
  const [rejected, setRejected] = useState<{ field: string; cut: string } | null>(null);
  const [own, setOwn] = useState<Ownership | null>(null);
  const [toUser, setToUser] = useState("");
  const [blocked, setBlocked] = useState<Ownership["blockers"] | null>(null);
  const [ownBusy, setOwnBusy] = useState(false);
  const [section, setSection] = useState<Section>("general");

  const apply = (d: SettingsPayload) => {
    setP(d);
    setName(d.name);
    setHeader(d.receipt.header);
    setFooter(d.receipt.footer);
    setWidth(d.receipt.paper_width);
    setNumerals(d.locale.numerals);
    setMethods(Object.fromEntries(d.payment_methods.map((m) => [m.id, m.is_active])));
  };
  useEffect(() => {
    if (data) apply(data);
  }, [data]);
  useEffect(() => {
    if (ownData) setOwn(ownData);
  }, [ownData]);

  const requestTransfer = async () => {
    if (!toUser || ownBusy) return;
    setOwnBusy(true);
    setBlocked(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/org/ownership", {
        body: { to_user_id: toUser } as never,
      });
      if (response.status === 409) {
        setBlocked((error as unknown as { extra: Ownership["blockers"] }).extra);
        return;
      }
      if (response.ok && d) setOwn(d);
    } catch {
      /* لا تغيير */
    } finally {
      setOwnBusy(false);
    }
  };

  const transferAction = async (action: "confirm" | "cancel") => {
    if (!own?.current || ownBusy) return;
    setOwnBusy(true);
    setBlocked(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/org/ownership/{transfer_id}/{action}", {
        params: { path: { transfer_id: own.current.id, action } },
      });
      if (response.status === 409) {
        setBlocked((error as unknown as { extra: Ownership["blockers"] }).extra);
        return;
      }
      if (response.ok && d) setOwn(d);
    } catch {
      /* لا تغيير */
    } finally {
      setOwnBusy(false);
    }
  };

  const max = CHARS[width] ?? 48;
  const tooWide = tooWideField(width, [
    ["name", name],
    ["header", header],
    ["footer", footer],
  ]);

  const save = async () => {
    if (!p || busy) return;
    setBusy(true);
    setSaved(null);
    setConflict(null);
    setRejected(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.PUT("/api/org/settings", {
        body: {
          version: p.version,
          name,
          header,
          footer,
          paper_width: width,
          numerals,
          payment_methods: Object.entries(methods).map(([id, is_active]) => ({ id, is_active })),
        } as never,
      });
      if (response.status === 409) {
        const e = error as unknown as {
          extra: { version: number; updated_at: string; updated_by_name: string };
        };
        setConflict(e.extra);
        return;
      }
      if (!response.ok || !d) {
        const e = error as unknown as
          { detail?: string; field?: string; extra?: { cut?: string } } | undefined;
        setRejected({ field: e?.field ?? "", cut: e?.extra?.cut ?? "" });
        // الحقل المرفوض في قسمه: الاسم في «عام»، والترويسة والختام في «الإيصال»
        setSection(e?.field === "name" ? "general" : "receipt");
        return;
      }
      const out = d as unknown as SettingsPayload;
      apply(out);
      setSaved(out.changed ?? []);
    } catch {
      setRejected({ field: "", cut: "" });
    } finally {
      setBusy(false);
    }
  };

  const reloadAll = async () => {
    setConflict(null);
    await Promise.all([reload(), reloadOwn()]);
  };

  const state: State =
    conflict || blocked
      ? "conflict"
      : tooWide || rejected
        ? "validation_error"
        : saved
          ? "success"
          : "ready";

  const showOwnership = Boolean(own && (own.can_request || own.can_confirm || own.current));
  const fmt = (s: string) => (numerals === "arabic" ? arabicDigits(s) : s);
  const cut = (s: string) => (s.trim().length > max ? `${s.trim().slice(0, max)}…` : s);
  const forOwner = p && !p.can_edit ? tx(T, "للمالك") : undefined;
  const edit = p?.can_edit ?? false;
  const field = tooWide?.[0] ?? rejected?.field;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "الإعدادات")}
      onRefresh={() => void reloadAll()}
    >
      <AppText variant="section">
        {tx(T, "إعدادات المنشأة واللغة والقوالب — لا محاسبة عامة ولا محرّر برمجي")}
      </AppText>
      <Note>{tx(T, "القوالب تُحرَّر بحقول مسمّاة ومعاينة فورية.")}</Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "conflict" && conflict ? (
        <StateView state="conflict" title={tx(T, "تعديل متزامن")}>
          <Lead>
            {tx(T, "حُفظت نسخة أحدث بواسطة")} {conflict.updated_by_name || tx(T, "مستخدم آخر")}{" "}
            {tx(T, "في")} <N>{hhmm(conflict.updated_at)}</N>{" "}
            {tx(T, "— لا نكتب فوق ما لم تقرأه. أعد التحميل وطبّق تعديلك عليها.")}
          </Lead>
          <Button label={tx(T, "أعد التحميل ثم عدّل")} onPress={() => void reloadAll()} />
        </StateView>
      ) : null}

      {state === "success" && saved ? (
        <StateView state="success" title={tx(T, "حُفظ")}>
          <Lead>
            {saved.length ? saved.join(tx(T, "،") + " ") : tx(T, "لا تغيير")}{" "}
            {tx(T, "— يسري على الشاشات والإيصالات والتقارير معاً.")}
          </Lead>
        </StateView>
      ) : null}

      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "نص أطول من عرض الورق")}>
          <Lead>
            {field === "name"
              ? tx(T, "اسم المنشأة")
              : field === "header"
                ? tx(T, "سطر الترويسة")
                : tx(T, "سطر الختام")}{" "}
            {tx(T, "يتجاوز عرض")} <N>{`${width}mm`}</N>.
          </Lead>
          <Note>
            {tx(T, "سيُطبع:")} <Strong>{rejected?.cut || cut(String(tooWide?.[1] ?? ""))}</Strong>
          </Note>
        </StateView>
      ) : null}

      {p ? (
        <>
          <View
            accessibilityLabel={tx(T, "أقسام الإعدادات")}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: SPACE["2"],
              marginBottom: SPACE["3"],
            }}
          >
            {SECTIONS.filter(([k]) => k !== "ownership" || showOwnership).map(([k, label]) => (
              <Chip key={k} label={label} on={section === k} onPress={() => setSection(k)} />
            ))}
          </View>

          {section === "general" ? (
            <>
              <TextField
                label={tx(T, "اسم المنشأة")}
                value={name}
                editable={edit}
                hint={forOwner}
                onChangeText={(t) => {
                  setName(t);
                  setSaved(null);
                }}
                required
              />
              <AppText variant="bodyStrong">{tx(T, "اللغة وأرقام الإيصال")}</AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: SPACE["2"],
                  marginVertical: SPACE["2"],
                }}
              >
                <Chip
                  label={tx(T, "العربية · أرقام لاتينية")}
                  on={numerals === "latin"}
                  onPress={() => edit && (setNumerals("latin"), setSaved(null))}
                />
                <Chip
                  label={tx(T, "العربية · أرقام عربية")}
                  on={numerals === "arabic"}
                  onPress={() => edit && (setNumerals("arabic"), setSaved(null))}
                />
              </View>
              <Note>
                {tx(
                  T,
                  "التبديل يشمل الشاشات والإيصالات والتقارير المصدَّرة معاً. تغيير النمط لا يُعدّل بيانات: هو عرض فقط. الأرقام المخزَّنة واحدة، والتصدير يحمل قيماً عددية لا نصاً.",
                )}
              </Note>
              <Note>
                <Strong>{tx(T, "لاتيني بعرض ثابت — المعتمد")}</Strong>{" "}
                {tx(
                  T,
                  "· المبالغ والكميات والمعرفات وأرقام الفواتير. النص ووصف الأصناف والتواريخ الطويلة بالعربية. مثال:",
                )}{" "}
                <N>1,180.00 SDG · INV-1047 · 12×1</N>
                {tx(T, "كغ")}
              </Note>
              <Note>
                <Strong>{tx(T, "أرقام عربية في كل شيء")}</Strong>{" "}
                {tx(
                  T,
                  "· متاح لمن يفضّله، ويُطبَّق على الشاشات والإيصالات والتقارير معاً. الثمن المعلن: ضعف المحاذاة العمودية في الجداول المالية الكثيفة.",
                )}
              </Note>
              <Note>
                {tx(T, "العملة:")} <N>{p.currency}</N> {tx(T, "— لا تُبدَّل بعد أول عملية.")}
              </Note>
            </>
          ) : null}

          {section === "receipt" ? (
            <>
              <Heading>{tx(T, "قالب الإيصال — حقول مسمّاة")}</Heading>
              <TextField
                label={tx(T, "سطر الترويسة")}
                value={header}
                editable={edit}
                hint={forOwner}
                onChangeText={(t) => {
                  setHeader(t);
                  setSaved(null);
                }}
              />
              <TextField
                label={tx(T, "سطر الختام")}
                value={footer}
                editable={edit}
                hint={forOwner}
                onChangeText={(t) => {
                  setFooter(t);
                  setSaved(null);
                }}
              />
              <AppText variant="bodyStrong">{tx(T, "عرض الورق")}</AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: SPACE["2"],
                  marginVertical: SPACE["2"],
                }}
              >
                <Chip
                  label={tx(T, "58mm (حرارية)")}
                  on={width === "58"}
                  onPress={() => edit && (setWidth("58"), setSaved(null))}
                />
                <Chip
                  label={tx(T, "80mm (حرارية)")}
                  on={width === "80"}
                  onPress={() => edit && (setWidth("80"), setSaved(null))}
                />
              </View>
            </>
          ) : null}

          {section === "payment" && p.payment_methods.length ? (
            <>
              <AppText variant="bodyStrong">{tx(T, "طرق الدفع الفعّالة")}</AppText>
              {p.payment_methods.map((m) => (
                <Check
                  key={m.id}
                  on={methods[m.id] ?? m.is_active}
                  disabled={!edit || m.is_cash}
                  onPress={() => {
                    setMethods((prev) => ({ ...prev, [m.id]: !(prev[m.id] ?? m.is_active) }));
                    setSaved(null);
                  }}
                >
                  {m.name}
                  {m.is_cash ? ` ${tx(T, "— لا يُعطَّل")}` : ""}
                </Check>
              ))}
            </>
          ) : null}

          {section !== "ownership" ? (
            <>
              {edit ? (
                <View style={{ marginTop: SPACE["3"] }}>
                  <Button
                    label={tx(T, "حفظ")}
                    loading={busy}
                    disabledReason={tooWide ? tx(T, "نص أطول من عرض الورق") : undefined}
                    onPress={() => void save()}
                  />
                </View>
              ) : (
                <Note>{tx(T, "الإعدادات للمالك — القراءة متاحة لمدير الفرع.")}</Note>
              )}

              {section !== "payment" ? (
                <>
                  <Heading>{tx(T, "معاينة فورية")}</Heading>
                  <Note>
                    <N>{`${width}mm`}</N> {tx(T, "· حرارية")}
                  </Note>
                  <View
                    testID="receipt-preview"
                    style={{
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: RADIUS.panelSm,
                      backgroundColor: c.surfaceCard,
                      padding: SPACE["3"],
                      gap: SPACE["1"],
                      marginVertical: SPACE["2"],
                    }}
                  >
                    <AppText variant="bodyStrong" style={{ textAlign: "center" }}>
                      {cut(name)}
                    </AppText>
                    <AppText variant="note" muted style={{ textAlign: "center" }}>
                      {tx(T, "فاتورة")} <PreviewNum latin={numerals === "latin"} s={fmt("1047")} />{" "}
                      · <PreviewNum latin={numerals === "latin"} s={fmt("2026-09-19 10:14")} />
                    </AppText>
                    <AppText variant="note">
                      {tx(T, "سكر 1كغ ×")}
                      {fmt("2")} <PreviewNum latin={numerals === "latin"} s={fmt("240.00")} />
                    </AppText>
                    <AppText variant="note">
                      {tx(T, "شاي 250غ")}{" "}
                      <PreviewNum latin={numerals === "latin"} s={fmt("180.00")} />
                    </AppText>
                    <AppText variant="bodyStrong">
                      {tx(T, "الإجمالي")}{" "}
                      <PreviewNum latin={numerals === "latin"} s={fmt("420.00")} strong />
                    </AppText>
                    <AppText variant="note" muted style={{ textAlign: "center" }}>
                      {cut(footer)}
                    </AppText>
                  </View>
                  <Note>{cut(header)}</Note>
                </>
              ) : null}
            </>
          ) : null}

          {section === "ownership" && own ? (
            <>
              <Heading>{tx(T, "نقل ملكية المنشأة")}</Heading>
              <Note>
                {tx(
                  T,
                  "أخطر إجراء في النظام: ينقل الدفتر كله ومعه الذمم والأجهزة والاشتراك. لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع.",
                )}
              </Note>
              <Lead>
                {tx(
                  T,
                  "المالك الجديد يجب أن يستلم دفتراً مغلق الحساب، لا نصف وردية لا يعرف من عدّها.",
                )}
              </Lead>
              <View style={{ height: SPACE["2"] }} />
              {blocked ? (
                <StateView state="conflict" title={tx(T, "مانع")}>
                  {blocked.open_shifts.map((x, i) => (
                    <Note key={`s${i}`}>
                      {tx(T, "وردية مفتوحة باسم")} {x.user_name} — {x.branch_name}{" "}
                      {tx(T, "· تُقفل إدارياً بعدّ حاضر قبل النقل، وإلا بقي صندوق بلا شهادة")}
                    </Note>
                  ))}
                  {blocked.pending_devices.map((x, i) => (
                    <Note key={`p${i}`}>
                      {tx(T, "معلّق غير مرفوع على")} {x.device_name}: <N>{x.pending}</N>
                    </Note>
                  ))}
                </StateView>
              ) : null}
              {own.current ? (
                <StateView state="pending_sync" title={tx(T, "طلب نقل قائم")}>
                  <Lead>
                    {tx(T, "من")} {own.current.from_user_name} {tx(T, "إلى")}{" "}
                    {own.current.to_user_name} {tx(T, "· ينقضي في")}{" "}
                    <N>{hhmm(own.current.expires_at)}</N>
                  </Lead>
                  <Note>
                    {tx(
                      T,
                      "تأكيد من الطرفين خلال 24 ساعة؛ انقضاؤها يلغي الطلب تلقائياً ويُسجَّل الإلغاء.",
                    )}
                  </Note>
                  <Actions>
                    {own.can_confirm ? (
                      <Button
                        label={tx(T, "أؤكّد استلام الملكية")}
                        loading={ownBusy}
                        onPress={() => void transferAction("confirm")}
                      />
                    ) : null}
                    <Button
                      variant="secondary"
                      label={tx(T, "إلغاء الطلب")}
                      loading={ownBusy}
                      onPress={() => void transferAction("cancel")}
                    />
                  </Actions>
                </StateView>
              ) : own.can_request ? (
                <>
                  <AppText variant="bodyStrong">{tx(T, "المالك الجديد")}</AppText>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: SPACE["2"],
                      marginVertical: SPACE["2"],
                    }}
                  >
                    {own.candidates.map((cd) => (
                      <Chip
                        key={cd.id}
                        label={cd.display_name}
                        on={toUser === cd.id}
                        onPress={() => setToUser(cd.id)}
                      />
                    ))}
                  </View>
                  <Note>
                    {tx(
                      T,
                      "المالك الجديد يجب أن يكون له حساب قائم ومُثبَت برقمه — لا نقل إلى بريد أو رقم غير مؤكَّد.",
                    )}
                  </Note>
                  <View style={{ height: SPACE["2"] }} />
                  <Button
                    label={tx(T, "اطلب نقل الملكية")}
                    loading={ownBusy}
                    disabledReason={toUser ? undefined : tx(T, "اختر المالك الجديد")}
                    onPress={() => void requestTransfer()}
                  />
                </>
              ) : null}
              <View style={{ height: SPACE["2"] }} />
              <Note>
                {tx(
                  T,
                  "تأكيد من الطرفين خلال 24 ساعة؛ انقضاؤها يلغي الطلب تلقائياً ويُسجَّل الإلغاء.",
                )}
              </Note>
              <Note>
                {tx(
                  T,
                  "المالك السابق يبقى في السجل بصفة «مالك سابق» بتاريخ انتهاء ولايته، ولا يُمحى من الأفعال التي فعلها.",
                )}
              </Note>
              <Note>
                {tx(
                  T,
                  "الاشتراك والأجهزة والذمم تنتقل كما هي. لا يُعاد ترقيم فاتورة ولا يُعاد حساب رصيد بسبب النقل.",
                )}
              </Note>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
