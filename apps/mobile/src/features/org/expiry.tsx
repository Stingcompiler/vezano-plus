import { dayMonth } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, GroupedList, Screen, SPACE, StateView } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Actions, Item, Lead, N, Note, Strong } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-08";
type State = "ready" | "expired" | "permission_denied";

export interface ExpiryPayload {
  state: "pending_approval" | "trial" | "active" | "grace" | "expired" | "suspended";
  expired: boolean;
  expired_at: string;
  days_since_expiry: number;
  continues: string[];
  stops: string[];
  can_renew: boolean;
  can_see_amounts: boolean;
  plan_name: string;
}

/**
 * ORG-08 — انتهاء الاشتراك (نظير `expiry-client.tsx`): القائمة الصريحة — البيع يستمر والسوق والحملات
 * والتقارير تُحجب؛ لا حجب للبيانات والتصدير يبقى عاملاً؛ التجديد للمالك والموظف يرى أثر الانتهاء.
 * المصدر واحد مع الويب (`continues`/`stops` من الخادم).
 */
export function Expiry() {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(
    async () => fetched<ExpiryPayload>(await api.GET("/api/org/subscription/expiry", {})),
    [api],
  );
  const { data: p, reload } = useReport<ExpiryPayload>({ load });

  const state: State = !p
    ? "ready"
    : p.expired && !p.can_renew
      ? "permission_denied"
      : p.expired
        ? "expired"
        : "ready";
  const at = p ? dayMonth(p.expired_at) : null;

  return (
    <Screen
      screenId={T}
      state={state}
      title={tx(T, "انتهاء الاشتراك")}
      onRefresh={() => void reload()}
    >
      {state === "expired" && p && at ? (
        <StateView state="expired" title={tx(T, "انتهى اشتراكك في")}>
          <AppText variant="bodyStrong">
            <N>{at.day}</N> {at.month}
          </AppText>
          <Lead>
            {tx(
              T,
              "بياناتك كاملة ولم يُحجب منها شيء. البيع وإدارة الذمم والورديات تعمل كالمعتاد. ما توقّف هو السوق والحملات والتقارير التحليلية.",
            )}
          </Lead>
          <Note>
            <Strong>{tx(T, "تصدير نسخة محلية")}</Strong> <Strong>{tx(T, "وتصدير التقارير")}</Strong>{" "}
            {tx(
              T,
              "يبقيان متاحين دائماً. لن نحتجز بياناتك مقابل التجديد، وتستطيع أخذها كاملة في أي وقت.",
            )}
          </Note>
          <Actions>
            <Button
              label={tx(T, "تجديد الاشتراك")}
              onPress={() => router.push("/org/subscription/renew")}
            />
            <Button
              variant="secondary"
              label={tx(T, "تصدير نسخة كاملة")}
              onPress={() => router.push("/device")}
            />
          </Actions>
        </StateView>
      ) : null}

      {state === "permission_denied" && p && at ? (
        <StateView state="permission_denied" title={tx(T, "التجديد للمالك")}>
          <Lead>
            {tx(T, "الموظف يرى أن الاشتراك انتهى وأثر ذلك على عمله، ولا يرى الفواتير ولا يجدّد.")}
          </Lead>
        </StateView>
      ) : null}

      {state === "ready" ? (
        <StateView state="ready" title={tx(T, "ما يستمر وما يتوقف")}>
          <Lead>
            {tx(
              T,
              "البيع والذمم والورديات والتصدير تستمر؛ السوق والتقارير الخادمية والحملات تتوقف.",
            )}
          </Lead>
          <Note>
            <Strong>{tx(T, "لا حجب للبيانات")}</Strong>{" "}
            {tx(T, "· انتهاء الاشتراك لا يحجب دفترك عنك. التصدير يبقى عاملاً — بياناتك بياناتك.")}
          </Note>
        </StateView>
      ) : null}

      {p ? (
        <>
          <GroupedList title={tx(T, "يستمر بالكامل")}>
            {p.continues.map((t, i) => (
              <Item key={t} title={<AppText>{t}</AppText>} last={i === p.continues.length - 1} />
            ))}
          </GroupedList>
          <GroupedList title={tx(T, "محجوب حتى التجديد")}>
            {p.stops.map((t, i) => (
              <Item key={t} title={<AppText>{t}</AppText>} last={i === p.stops.length - 1} />
            ))}
          </GroupedList>
        </>
      ) : null}
      <View style={{ height: SPACE["2"] }} />
      <Button
        variant="quiet"
        label={tx(T, "الاشتراك والباقات")}
        onPress={() => router.push("/org/subscription")}
      />
    </Screen>
  );
}
