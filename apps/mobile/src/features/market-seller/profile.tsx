import type { StateCode } from "@sting/design";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, StateView, TextField } from "@sting/ui-native";
import { useEffect, useState } from "react";

import { Heading, Lead, Note, Row, Stack, StateWord } from "@/components/market-seller/parts";
import { FetchFail } from "@/components/market-seller/fetch-fail";
import { netState, safeGet, send, useServerGet } from "@/features/market-seller/lib";
import { MS_TEXTS } from "@/features/market-seller/texts";
import { useSession } from "@/lib/session";

const T = "MP-09";

interface Draft {
  public_name: string;
  category_line: string;
  categories: string[];
  service_areas: string[];
  fulfilment: string[];
}
interface Pub extends Draft {
  verified: boolean;
  badge_label: string;
  badge_note: string;
  published_at: string;
  is_published: boolean;
}
export interface Profile {
  draft: Draft;
  public: Pub;
  can_edit: boolean;
  role_name: string;
  portal_slug: string;
  seller_verified: boolean;
  not_published: string[];
}

const join = (xs: string[]) => xs.join(" · ");

/** MP-09 — إدارة صفحة المنشأة: المعاينة العامة هي الحقيقة (29-D22 ready/permission_denied · 43-D35 validation_error/saving/success). */
export default function ProfileScreen() {
  const { api } = useSession();
  const srv = useServerGet<Profile>("cache.market.profile", () =>
    safeGet(
      () => api.GET("/api/market/profile"),
      (b) => (b as { profile?: Profile } | undefined)?.profile,
    ),
  );
  const [p, setP] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [cats, setCats] = useState("");
  const [areas, setAreas] = useState("");
  const [ful, setFul] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [areasError, setAreasError] = useState(false);
  const [preview, setPreview] = useState(false);
  const [offlineTry, setOfflineTry] = useState(false);

  const apply = (prof: Profile) => {
    setP(prof);
    setName(prof.draft.public_name);
    setLine(prof.draft.category_line);
    setCats(join(prof.draft.categories));
    setAreas(join(prof.draft.service_areas));
    setFul(join(prof.draft.fulfilment));
  };
  useEffect(() => {
    if (srv.data) apply(srv.data);
  }, [srv.data]);

  const view = p ?? srv.shown;

  const save = async (publish: boolean) => {
    if (saving || !view) return;
    setSaved(false);
    setAreasError(false);
    setOfflineTry(false);
    if (publish && !areas.trim()) {
      setAreasError(true);
      return;
    }
    setSaving(true);
    try {
      const r = await send<{ profile?: Profile }>(() =>
        api.PUT("/api/market/profile", {
          body: {
            public_name: name,
            category_line: line,
            categories: cats,
            service_areas: areas,
            fulfilment: ful,
            publish,
          } as never,
        }),
      );
      if (r.kind === "offline") return setOfflineTry(true);
      if (r.kind === "error" && r.status === 400) return setAreasError(true);
      if (r.kind === "ok" && r.body.profile) {
        apply(r.body.profile);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const net = netState(srv.net, srv.fromCache, srv.status);
  const state: StateCode =
    view && !view.can_edit
      ? "permission_denied"
      : saving
        ? "saving"
        : areasError
          ? "validation_error"
          : saved
            ? "success"
            : (net ?? "ready");
  const pub = view?.public;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "إدارة صفحة المنشأة — المعاينة العامة هي الحقيقة")}
      onRefresh={() => void srv.reload()}
    >
      <Lead>
        {tx(
          T,
          "البائع يرى صفحته كما يراها الغريب تماماً، بما فيه حدود الشارة. ومناطق الخدمة وطرق التنفيذ تُعلَن هنا لأن المشتري يبني عليها قراره.",
        )}
      </Lead>

      <FetchFail net={net} hasData={Boolean(view)} onRetry={() => void srv.reload()} />
      {net && view ? <Note>{MS_TEXTS.cached}</Note> : null}
      {offlineTry ? <Note tone="danger">{MS_TEXTS.needsServer}</Note> : null}

      {state === "permission_denied" && view ? (
        <StateView state="permission_denied" title={tx(T, "تحرير الصفحة للمالك")}>
          <AppText variant="secondary">
            {tx(
              T,
              "مدير الفرع يحرّر عروضاً ولا يحرّر هوية المنشأة العامة. الاسم والشارة والمناطق تمثّل المنشأة كلها، فتحريرها للمالك.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {state === "saving" ? (
        <StateView state="saving" title={tx(T, "جارٍ الحفظ")}>
          <AppText variant="secondary">
            {tx(T, "الحفظ للمسودة — والمنشور لا يتغيّر حتى يكتمل.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "مناطق خدمة فارغة")}>
          <AppText variant="secondary">
            {tx(T, "ملفٌ بلا منطقة خدمة لا يظهر في أي دليل — والناشر يظن نفسه منشوراً.")}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "«بلا منطقة لن تظهر في نتائج أحد»")}
          </AppText>
        </StateView>
      ) : null}
      {state === "success" ? (
        <StateView state="success" title={tx(T, "حُفظت الصفحة")}>
          <AppText variant="secondary">
            {pub?.is_published
              ? tx(T, "نُشرت الصفحة كما في المعاينة.")
              : tx(T, "حُفظت مسوّدة — المنشور لا يتغيّر حتى تنشر.")}{" "}
            {tx(T, "المعاينة بلا صلاحياتك وأسعارك الخاصة.")}
          </AppText>
          <AppText variant="note" muted>
            <AppText variant="bodyStrong">{tx(T, "الحقول المصرّح بها فقط")}</AppText>{" "}
            {tx(
              T,
              "· ما يُنشر قائمة معلنة: الهوية والمناطق وطرق التنفيذ. العنوان التفصيلي والأرقام الداخلية لا تُنشر ولو مُلئت.",
            )}
          </AppText>
          <Button label={tx(T, "عاين كما يراها الزائر")} onPress={() => setPreview((v) => !v)} />
        </StateView>
      ) : null}

      {pub ? (
        <>
          <Heading>{tx(T, "المعاينة العامة")}</Heading>
          <Note>{tx(T, "كما يراها أي مشترٍ")}</Note>
          {pub.is_published ? (
            <GroupedList>
              <Row
                title={<AppText variant="title">{pub.public_name}</AppText>}
                sub={pub.category_line}
              />
              {pub.verified ? (
                <Row
                  title={<StateWord state="success" label={pub.badge_label} />}
                  sub={`${pub.badge_note} ${tx(T, "هذا النص يظهر للمشتري دائماً ولا يستطيع البائع إخفاءه.")}`}
                />
              ) : null}
              <Row title={tx(T, "الفئات التي تخدمها")} sub={join(pub.categories)} />
              <Row title={tx(T, "مناطق الخدمة")} sub={join(pub.service_areas)} />
              <Row title={tx(T, "طرق التنفيذ")} sub={join(pub.fulfilment)} last />
            </GroupedList>
          ) : (
            <Note>{tx(T, "لم تُنشر الصفحة بعد — الزائر لا يرى شيئاً حتى تنشر.")}</Note>
          )}
          <Note>
            <AppText variant="bodyStrong">{tx(T, "ما لا يظهر هنا")}</AppText>{" "}
            {tx(T, "· العنوان التفصيلي والهاتف — يُعطيهما البائع في الطلب لا في الدليل")}
          </Note>
        </>
      ) : null}

      {view && view.can_edit && !preview ? (
        <>
          <Heading>{tx(T, "تحرير الصفحة")}</Heading>
          <TextField label={tx(T, "اسم المنشأة العام")} value={name} onChangeText={setName} />
          <TextField
            label={tx(T, "سطر النشاط")}
            value={line}
            onChangeText={setLine}
            hint={tx(T, "مثال: جملة مواد غذائية")}
          />
          <TextField
            label={tx(T, "الفئات التي تخدمها")}
            value={cats}
            onChangeText={setCats}
            hint={tx(T, "افصل بـ «·» — سكر · شاي · زيوت · دقيق")}
          />
          <TextField
            label={tx(T, "مناطق الخدمة")}
            value={areas}
            onChangeText={setAreas}
            hint={tx(T, "افصل بـ «·» — الخرطوم بحري · الخرطوم")}
            error={
              areasError
                ? tx(T, "بلا منطقة لن تظهر في نتائج أحد — اكتب منطقة واحدة على الأقل.")
                : undefined
            }
          />
          <TextField
            label={tx(T, "طرق التنفيذ وشروطها")}
            value={ful}
            onChangeText={setFul}
            hint={tx(T, "افصل بـ «·» — توصيل بحدّ أدنى 50,000 SDG · استلام من المخزن بموعد")}
          />
          <Stack>
            <Button
              label={tx(T, "انشر الصفحة")}
              financial
              loading={saving}
              onPress={() => void save(true)}
            />
            <Button
              label={tx(T, "احفظ مسوّدة")}
              variant="secondary"
              loading={saving}
              onPress={() => void save(false)}
            />
          </Stack>
        </>
      ) : null}
      {preview ? (
        <Button
          label={tx(T, "عودة إلى التحرير")}
          variant="secondary"
          onPress={() => setPreview(false)}
        />
      ) : null}
    </Screen>
  );
}
