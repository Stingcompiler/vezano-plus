import { formatQty, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  ListRow,
  Screen,
  SPACE,
  StateView,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { dayLabel } from "@/lib/invoices";
import { useSession } from "@/lib/session";

import { M, Wrap } from "./common";

const TL = "INV-12";
const TD = "INV-11";
type State = "loading" | "ready" | "empty" | "offline" | "server_error" | "permission_denied";

export interface ReceiptView {
  readonly id: string;
  readonly receipt_number: string;
  readonly supplier_name: string;
  readonly reference: string;
  readonly user_name: string;
  readonly occurred_at: string;
  readonly order_number: string;
  readonly lines: readonly {
    readonly id: string;
    readonly item_name: string;
    readonly unit_name: string;
    readonly qty_milli: string;
  }[];
  readonly document: {
    readonly id: string;
    readonly number: string;
    readonly status: string;
    readonly status_label: string;
  } | null;
  readonly can_convert: boolean;
}

/** «4 كرتونة» — الكمية بوحدة الاستلام؛ الكسور تُعرض حين تقع. */
const qty = (milli: string) => formatQty(milli, BigInt(milli || "0") % 1000n === 0n ? 0 : 3);

function When({ iso }: { iso: string }) {
  const day = dayLabel(iso);
  return (
    <>
      {day.word ?? ""}
      {day.n ? <M>{day.n}</M> : null} <M>{hhmm(iso)}</M>
    </>
  );
}

/**
 * INV-12 — الاستلامات (I-02، 0005 §٢٩٥؛ نظير الويب): ما استلمه أمين المخزن ودخل المخزون، بمستند شرائه أو
 * «بلا مستند شراء». المدير يحوّله إلى مستند شراء فتُضاف الأسعار والذمّة بلا مخزون ثانٍ. أونلاين.
 */
export function ReceiptsScreen() {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const [scope, setScope] = useState<"unpriced" | "all">("unpriced");
  const [data, setData] = useState<{ receipts: ReceiptView[]; unpriced_count: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d, response } = await api.GET("/api/inventory/receipts", {
        params: { query: { scope } },
      });
      if (response.status === 403) return setDenied(true);
      const body = d as unknown as { receipts: ReceiptView[]; unpriced_count: number } | undefined;
      if (!response.ok || !body) return setFailed(true);
      setFailed(false);
      setOffline(false);
      setData(body);
    } catch {
      setOffline(true);
    }
  }, [api, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.receipts ?? [];
  const state: State = denied
    ? "permission_denied"
    : offline && !data
      ? "offline"
      : failed
        ? "server_error"
        : !data
          ? "loading"
          : rows.length === 0
            ? "empty"
            : "ready";
  const open = (id: string) =>
    router.push({ pathname: "/inventory/receipts/[id]", params: { id } });

  return (
    <Screen screenId={TL} state={state} title={tx(TL, "الاستلامات")} onRefresh={() => void load()}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(TL, "الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.")}
      </AppText>
      <AppText variant="secondary" muted style={{ marginBottom: SPACE["2"] }}>
        {tx(TL, "بلا مستند شراء")} <M>{data?.unpriced_count ?? 0}</M>
      </AppText>
      <Wrap>
        <Chip
          label={tx(TL, "بلا مستند شراء")}
          on={scope === "unpriced"}
          onPress={() => setScope("unpriced")}
        />
        <Chip
          label={tx(TL, "كل الاستلامات")}
          on={scope === "all"}
          onPress={() => setScope("all")}
        />
      </Wrap>
      {state === "permission_denied" ? (
        <StateView
          state="permission_denied"
          title={tx(TL, "الاستلامات للمالك والمدير وأمين المخزن")}
        >
          {null}
        </StateView>
      ) : null}
      {state === "offline" ? (
        <StateView state="offline" title={tx(TL, "بلا اتصال")}>
          <AppText variant="secondary">{tx(TL, "يحتاج اتصالاً")}</AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(TL, "تعذّر التحميل. أعد المحاولة.")}>
          {null}
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(TL, "جارٍ التحميل")}>
          {null}
        </StateView>
      ) : null}
      {state === "empty" ? (
        <StateView state="empty" title={tx(TL, "لا استلامات بلا مستند شراء")}>
          <Button
            label={tx(TL, "استلام بضاعة")}
            onPress={() => router.push("/inventory/receive")}
          />
        </StateView>
      ) : null}
      {rows.length > 0 ? (
        <GroupedList title={tx(TL, "الاستلامات")}>
          {rows.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={r.receipt_number}
              onPress={() => open(r.id)}
              style={{
                padding: SPACE["4"],
                gap: SPACE["1"],
                minHeight: 52,
                borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <AppText variant="bodyStrong">
                <M>{r.receipt_number}</M>
              </AppText>
              <AppText variant="note" muted>
                {r.supplier_name} · {r.user_name} · {tx(TL, "استُلم")} <When iso={r.occurred_at} />
              </AppText>
              <AppText
                variant="note"
                style={{
                  color: r.document
                    ? c.state[r.document.status === "approved" ? "synced" : "pending_sync"].fg
                    : c.state.stale.fg,
                }}
              >
                {r.document ? (
                  <>
                    {tx(TL, "مستند الشراء")} <M>{r.document.number}</M> · {r.document.status_label}
                  </>
                ) : (
                  tx(TL, "بلا مستند شراء")
                )}
              </AppText>
            </Pressable>
          ))}
        </GroupedList>
      ) : null}
    </Screen>
  );
}

/**
 * INV-11 — استلام مسجَّل (I-02، 0005 §٢٩٥؛ نظير الويب): ما كتبه أمين المخزن كما كتبه، و«حوّل إلى مستند
 * شراء» للمالك والمدير. الاستلام لا يُعدَّل.
 */
export function ReceiptScreen({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const { api } = useSession();
  const [rc, setRc] = useState<ReceiptView | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/inventory/receipts/{receipt_id}", {
          params: { path: { receipt_id: receiptId } },
        });
        if (response.status === 403) return setDenied(true);
        if (response.status === 404) return router.replace("/inventory/receipts");
        const body = data as unknown as { receipt: ReceiptView } | undefined;
        if (!response.ok || !body) return setFailed(true);
        setRc(body.receipt);
      } catch {
        setOffline(true);
      }
    })();
  }, [api, receiptId, router]);

  const convert = async () => {
    if (!rc || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api.POST("/api/inventory/receipts/{receipt_id}/document", {
        params: { path: { receipt_id: rc.id } },
      });
      const body = data as unknown as { document: { id: string } } | undefined;
      if (response.ok && body)
        router.push({ pathname: "/purchasing/documents/[id]", params: { id: body.document.id } });
      else setFailed(true);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : offline && !rc
      ? "offline"
      : failed
        ? "server_error"
        : !rc
          ? "loading"
          : "ready";
  const doc = rc?.document ?? null;

  return (
    <Screen screenId={TD} state={state} title={tx(TD, "استلام")}>
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(TD, "الاستلام يُدخل المخزون فقط.")}
      </AppText>
      {state === "permission_denied" ? (
        <StateView
          state="permission_denied"
          title={tx(TD, "الاستلامات للمالك والمدير وأمين المخزن")}
        >
          {null}
        </StateView>
      ) : null}
      {state === "offline" || (offline && rc) ? (
        <StateView state="offline" title={tx(TD, "بلا اتصال")}>
          <AppText variant="secondary">{tx(TD, "يحتاج اتصالاً")}</AppText>
        </StateView>
      ) : null}
      {state === "server_error" ? (
        <StateView state="server_error" title={tx(TD, "تعذّر التحميل. أعد المحاولة.")}>
          {null}
        </StateView>
      ) : null}
      {state === "loading" ? (
        <StateView state="loading" title={tx(TD, "جارٍ التحميل")}>
          {null}
        </StateView>
      ) : null}
      {rc ? (
        <>
          <AppText variant="title" style={{ marginBottom: SPACE["2"] }}>
            <M>{rc.receipt_number}</M>
          </AppText>
          <GroupedList>
            <ListRow title={tx(TD, "المورد")} trailing={<AppText>{rc.supplier_name}</AppText>} />
            <ListRow title={tx(TD, "مرجع المستند")} trailing={<AppText>{rc.reference}</AppText>} />
            <ListRow
              title={tx(TD, "المسؤول")}
              last={!rc.order_number}
              trailing={
                <AppText>
                  {rc.user_name} · <When iso={rc.occurred_at} />
                </AppText>
              }
            />
            {rc.order_number ? (
              <ListRow title={tx(TD, "أمر الشراء")} last trailing={<M>{rc.order_number}</M>} />
            ) : null}
          </GroupedList>
          <GroupedList>
            {rc.lines.map((ln, i) => (
              <ListRow
                key={ln.id}
                title={ln.item_name}
                last={i === rc.lines.length - 1}
                trailing={
                  <AppText>
                    <M>{qty(ln.qty_milli)}</M> {ln.unit_name}
                  </AppText>
                }
              />
            ))}
          </GroupedList>
          {doc ? (
            <StateView
              state={doc.status === "approved" ? "success" : "pending_sync"}
              title={`${tx(TD, "مستند شراء")} — ${doc.status_label}`}
            >
              <AppText variant="bodyStrong">
                <M>{doc.number}</M>
              </AppText>
              <AppText variant="secondary">
                {tx(TD, "المخزون")} {tx(TD, "· دخل من الاستلام")} <M>{rc.receipt_number}</M>{" "}
                {tx(TD, "— لا يدخل مرة ثانية.")}
              </AppText>
              <Button
                label={tx(TD, "افتح مستند الشراء")}
                financial
                onPress={() =>
                  router.push({ pathname: "/purchasing/documents/[id]", params: { id: doc.id } })
                }
              />
            </StateView>
          ) : (
            <StateView state="stale" title={tx(TD, "بلا مستند شراء")}>
              <AppText variant="secondary">
                {tx(
                  TD,
                  "الاستلام يُدخل المخزون فقط. للذمّة حوّله إلى مستند شراء — لا تسجّله مرة ثانية.",
                )}
              </AppText>
            </StateView>
          )}
          <View style={{ gap: SPACE["2"] }}>
            {!doc && rc.can_convert ? (
              <Button
                label={tx(TD, "حوّل إلى مستند شراء")}
                financial
                loading={busy}
                onPress={() => void convert()}
              />
            ) : null}
            {!doc && !rc.can_convert ? (
              <AppText variant="note" muted>
                {tx(TD, "الاعتماد للمالك والمحاسب")}
              </AppText>
            ) : null}
            <Button
              label={tx(TD, "الاستلامات")}
              variant="quiet"
              onPress={() => router.push("/inventory/receipts")}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
