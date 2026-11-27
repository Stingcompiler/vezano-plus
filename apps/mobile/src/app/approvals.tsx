import { formatMinorShort, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  Screen,
  SPACE,
  StateView,
  TextField,
  ThemedText as Text,
  useColors,
} from "@sting/ui-native";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import type { ApprovalItem } from "@/lib/approvals";
import { useSession } from "@/lib/session";

const T = "APR-01";

interface Box {
  readonly can_review: boolean;
  readonly scope: "all" | "branch";
  readonly branch_name: string;
  readonly items: readonly ApprovalItem[];
}

function M({ children }: { children: string }) {
  return <Text style={{ fontFamily: FONT.monoMedium, writingDirection: "ltr" }}>{children}</Text>;
}

/** «طلب سحب 500.00 من سالم» — نظير `ItemTitle` في الويب. */
function ItemTitle({ item }: { readonly item: ApprovalItem }) {
  const amount = <M>{formatMinorShort(item.amount_minor)}</M>;
  if (item.kind === "withdrawal")
    return (
      <AppText variant="bodyStrong">
        {tx(T, "طلب سحب")} {amount} {tx(T, "من")} {item.requested_by_name}
      </AppText>
    );
  if (item.kind === "discount")
    return (
      <AppText variant="bodyStrong">
        {tx(T, "خصم فوق السقف")} {amount} {tx(T, "من")} {item.requested_by_name}
      </AppText>
    );
  return (
    <AppText variant="bodyStrong">
      {tx(T, "تجاوز حدّ ائتمان")} {item.party_name ?? ""} {amount} {tx(T, "من")}{" "}
      {item.requested_by_name}
    </AppText>
  );
}

/**
 * APR-01 — «طلبات تنتظرك» على الهاتف (S-04؛ 0005 §٢٩٣) — نظير الويب: سحب وخصم فوق السقف وتجاوز حدّ
 * ائتمان بلا معتمد حاضر. «وافق» أو «ارفض» بسبب، وحدّ المعتمد يقرّر من يملك القرار.
 */
export default function Approvals() {
  const c = useColors();
  const { api } = useSession();
  const [box, setBox] = useState<Box | null>(null);
  const [failed, setFailed] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, response } = await api.GET("/api/approvals");
      const body = data as unknown as Box | undefined;
      if (!response.ok || !body) return setFailed(true);
      setFailed(false);
      setBox(body);
    } catch {
      setFailed(true);
    }
  }, [api]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const decide = async (item: ApprovalItem, decision: "accept" | "reject") => {
    const reason = (reasons[item.id] ?? "").trim();
    if (decision === "reject" && !reason) return setMissing(item.id);
    setMissing(null);
    setBusy(item.id);
    try {
      await api.POST("/api/approvals/{kind}/{request_id}/decide", {
        params: { path: { kind: item.kind, request_id: item.id } },
        body: { decision, reason },
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const items = box?.items ?? [];
  const state = failed
    ? "server_error"
    : !box
      ? "loading"
      : !box.can_review
        ? "permission_denied"
        : items.length === 0
          ? "empty"
          : "ready";
  return (
    <Screen screenId={T} state={state} title={tx(T, "طلبات تنتظرك")}>
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(T, "تعذّر جلب الطلبات")}>
          <AppText variant="secondary">{tx(T, "لم يتغيّر شيء. أعد المحاولة بعد قليل.")}</AppText>
          <Button label={tx(T, "أعد المحاولة")} onPress={() => void load()} />
        </StateView>
      ) : null}
      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "الطلبات للمالك ومدير الفرع")}>
          <AppText variant="secondary">{tx(T, "طلبك يصل إليهما ويظهر قرارهما في شاشتك.")}</AppText>
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "لا طلبات تنتظرك")}>
          <AppText variant="secondary">
            {tx(T, "كل طلبات السحب والخصم وتجاوز الحدّ قُرّر فيها.")}
          </AppText>
        </StateView>
      ) : null}
      {state === "ready"
        ? items.map((item) => (
            <View
              key={`${item.kind}:${item.id}`}
              style={{
                gap: SPACE["2"],
                padding: SPACE["3"],
                marginBottom: SPACE["3"],
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 16,
                backgroundColor: c.surfaceCard,
              }}
            >
              <ItemTitle item={item} />
              <AppText variant="note" muted>
                {item.branch_name} · <M>{hhmm(item.requested_at)}</M>
              </AppText>
              <AppText variant="secondary">{item.reason}</AppText>
              {item.can_decide ? (
                <>
                  <TextField
                    label={tx(T, "السبب — إلزامي للرفض")}
                    value={reasons[item.id] ?? ""}
                    onChangeText={(v) => setReasons((r) => ({ ...r, [item.id]: v }))}
                    error={missing === item.id ? tx(T, "اكتب سبب الرفض.") : undefined}
                  />
                  <Button
                    label={tx(T, "وافق")}
                    financial
                    loading={busy === item.id}
                    onPress={() => void decide(item, "accept")}
                  />
                  <Button
                    label={tx(T, "ارفض")}
                    variant="secondary"
                    onPress={() => void decide(item, "reject")}
                  />
                </>
              ) : (
                <AppText variant="note">{tx(T, "فوق حدّك — يقرّره المالك.")}</AppText>
              )}
            </View>
          ))
        : null}
    </Screen>
  );
}
