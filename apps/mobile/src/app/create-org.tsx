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
  useColors,
  ThemedText as Text,
} from "@sting/ui-native";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { markFreshOrg } from "@/lib/after-setup";
import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";

const T = "ACC-04";
type State = "ready" | "validation_error" | "saving" | "success" | "server_error";

interface Option {
  readonly code: string;
  readonly name: string;
}
interface Created {
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly branch_id: string;
  readonly user_id: string;
  readonly created: { readonly items: number; readonly groups: number; readonly branches: number };
  readonly access: string;
  readonly refresh: string;
  readonly session_id: string;
}

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * ACC-04 — إنشاء المنشأة ووصفة القطاع على الهاتف (خطة الجوال M1؛ 0005 §١٧٦). منطق الويب نفسه
 * (`create-org-client.tsx`): هوية طلب ثابتة، وعند خطأ الخادم نستعلم عن الحالة أولاً ثم نُكمل — لا إعادة
 * عمياء تُنشئ منشأتين. النموذج أقسام مجمّعة، والقطاع والعملة قوائم اختيار بعلامة ✓ بدل القوائم المنسدلة.
 */
export default function CreateOrg() {
  const router = useRouter();
  const { state: session, api, signIn } = useSession();
  const c = useColors();
  const [requestId] = useState(newId);
  const [sectors, setSectors] = useState<readonly Option[]>([]);
  const [currencies, setCurrencies] = useState<readonly Option[]>([]);
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [currency, setCurrency] = useState("SDG");
  const [branchName, setBranchName] = useState("");
  const [errors, setErrors] = useState<{ name?: string; sector?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const ticket = session.selection?.ticket ?? "";
  const headers = ticket ? { "X-Select-Ticket": ticket } : {};

  useEffect(() => {
    void api
      .GET("/api/tenants/sectors")
      .then(({ data }) => {
        if (!data) return;
        setSectors(data.sectors);
        setCurrencies(data.currencies);
        if (data.currencies[0]) setCurrency(data.currencies[0].code);
      })
      .catch(() => undefined);
  }, [api]);

  // بلا حساب: التسجيل أولاً (كالويب) — الدخول لمن له حساب
  if (!created && session.status !== "selecting" && session.status !== "active")
    return <Redirect href="/register" />;

  const adopt = (data: Created) => {
    setCreated(data);
    markFreshOrg();
    signIn({
      access: data.access,
      refresh: data.refresh,
      session_id: data.session_id,
      user_id: data.user_id,
      tenant_id: data.tenant_id,
    });
  };

  const validate = () => {
    const e: { name?: string; sector?: string } = {};
    if (!name.trim()) e.name = tx(T, "اسم المنشأة فارغ");
    if (!sector) e.sector = tx(T, "القطاع غير مختار");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /** لا إعادة عمياء: نستعلم عن الحالة بهوية الطلب؛ إن وُجدت أُكمل من حيث توقّف. */
  const probeStatus = async () => {
    try {
      const { data, response } = await api.GET("/api/tenants/creation/{client_request_id}", {
        headers,
        params: { path: { client_request_id: requestId } },
      });
      if (response.ok && data) {
        adopt(data);
        return;
      }
    } catch {
      /* الخادم ما زال لا يردّ */
    }
    setFailed(true);
  };

  const submit = async () => {
    if (busy || created) return;
    if (!validate()) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, error, response } = await api.POST("/api/tenants", {
        headers,
        body: {
          client_request_id: requestId,
          name,
          sector,
          currency,
          first_branch_name: branchName,
        },
      });
      if (response.status === 400 && error) {
        const f = error.invalid_fields;
        setErrors({
          ...(f.name ? { name: tx(T, "اسم المنشأة فارغ") } : {}),
          ...(f.sector ? { sector: tx(T, "القطاع غير مختار") } : {}),
        });
        return;
      }
      if (!response.ok || !data) {
        await probeStatus();
        return;
      }
      adopt(data);
    } catch {
      await probeStatus();
    } finally {
      setBusy(false);
    }
  };

  const state: State = created
    ? "success"
    : busy
      ? "saving"
      : failed
        ? "server_error"
        : Object.keys(errors).length
          ? "validation_error"
          : "ready";
  const bothMissing = Boolean(errors.name && errors.sector);
  const check = (on: boolean) =>
    on ? <AppText style={{ color: c.brandPrimary }}>✓</AppText> : undefined;

  if (state === "success" && created) {
    return (
      <Screen screenId={T} state={state} title={tx(T, "أُنشئت المنشأة")}>
        <StateView state="success" title={created.tenant_name}>
          <AppText variant="secondary">
            {tx(T, "ومعها ما أنشأته الوصفة:")} <N>{created.created.items}</N>{" "}
            {tx(T, "صنفاً مبدئياً و")}
            <N>{created.created.groups}</N> {tx(T, "مجموعات وفرعٌ واحد.")}
          </AppText>
        </StateView>
        <Button
          label={tx(T, "جهّز هذا الجهاز")}
          financial
          onPress={() => router.replace("/setup-device")}
        />
      </Screen>
    );
  }

  return (
    <Screen screenId={T} state={state} title={tx(T, "إنشاء المنشأة")}>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["4"] }}>
        {tx(T, "وصفة القطاع تُهيّئ لك أصنافاً ووحدات شائعة — كلها قابلة للتعديل.")}
      </AppText>

      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "خطأ خادم أثناء الإنشاء")}>
          <AppText variant="secondary">
            {tx(
              T,
              "قد تكون المنشأة أُنشئت والوصفة لم تُطبَّق. نستعلم عن الحالة أولاً ثم نُكمل من حيث توقّف.",
            )}
          </AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={() => void submit()} />
        </StateView>
      ) : null}
      {bothMissing ? (
        <StateView state="validation_error" title={tx(T, "حقلان يمنعان الإنشاء")}>
          <AppText variant="secondary">{tx(T, "اسم المنشأة فارغ، والقطاع غير مختار.")}</AppText>
        </StateView>
      ) : null}
      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "جارٍ الإنشاء")}>
          <AppText variant="secondary">
            {tx(T, "المنشأة")} · {tx(T, "وصفة القطاع")} · {tx(T, "الفرع الأول")}
          </AppText>
        </StateView>
      ) : null}

      <TextField
        label={tx(T, "اسم المنشأة")}
        value={name}
        onChangeText={setName}
        error={errors.name}
        editable={!busy}
        required
      />

      <GroupedList title={tx(T, "النشاط — وصفة القطاع")}>
        {sectors.map((s, i) => (
          <ListRow
            key={s.code}
            title={s.name}
            trailing={check(sector === s.code)}
            onPress={busy ? undefined : () => setSector(s.code)}
            last={i === sectors.length - 1}
          />
        ))}
      </GroupedList>
      {errors.sector && !bothMissing ? (
        <AppText
          variant="note"
          style={{ color: c.danger, marginTop: -SPACE["2"], marginBottom: SPACE["3"] }}
        >
          {errors.sector}
        </AppText>
      ) : null}

      <GroupedList title={tx(T, "العملة — لا تُبدَّل بعد أول معاملة")}>
        {currencies.map((o, i) => (
          <ListRow
            key={o.code}
            title={o.name}
            trailing={check(currency === o.code)}
            onPress={busy ? undefined : () => setCurrency(o.code)}
            last={i === currencies.length - 1}
          />
        ))}
      </GroupedList>

      <TextField
        label={tx(T, "الفرع الأول")}
        value={branchName}
        onChangeText={setBranchName}
        editable={!busy}
      />

      {/* تنبيه قرار لا حالة شاشة: عنوان بلون الخطر وحده، بلا شريط ولا بطاقة ملوّنة */}
      <View accessibilityRole="text" style={{ gap: SPACE["1"], marginBottom: SPACE["4"] }}>
        <AppText variant="bodyStrong" style={{ color: c.danger }}>
          {tx(T, "العملة قرار نهائي")}
        </AppText>
        <AppText variant="secondary" muted>
          {tx(
            T,
            "بعد أول معاملة لا تُبدَّل العملة. تبديلها يعني إعادة تقييم كل مبلغ سابق برقم نختاره نحن — وذلك تحريف دفترك لا إعداد.",
          )}
        </AppText>
      </View>

      <Button
        label={tx(T, "إنشاء المنشأة")}
        financial
        loading={busy}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
