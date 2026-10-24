import { formatMinor, formatQty, pushPending } from "@sting/app-core";
import { readLocalCountSession } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  Screen,
  SPACE,
  StateView,
  TextField,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

import { Delta, M, Wrap } from "./common";
import type { Dp } from "./units";
import { useDeviceContext } from "./use-ctx";

const T = "INV-06";
type State = "ready" | "validation_error" | "permission_denied" | "success";

interface ServerRow {
  readonly line_id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_name: string;
  readonly book_milli: string;
  readonly counted_milli: string;
  readonly system_at_count_milli: string;
  readonly delta_milli: string;
  readonly value_minor: string;
  readonly moved_since_count: boolean;
}
interface Adjustment {
  readonly id: string;
  readonly adjustment_number: string;
  readonly decided_by_name: string;
  readonly line_count: number;
}
interface Review {
  readonly session: {
    readonly id: string;
    readonly session_number: string;
    readonly branch_name: string;
    readonly status: "closed" | "adjusted";
    readonly user_name: string;
    readonly total_items: number;
    readonly counted_items: number;
    readonly closed_at: string;
  };
  readonly rows: readonly ServerRow[];
  readonly variance_count: number;
  readonly effect_minor: string;
  readonly suggested_reasons: readonly string[];
  readonly adjustment: Adjustment | null;
  readonly can_adjust: boolean;
}
interface Row {
  readonly id: string;
  readonly name: string;
  readonly dp: Dp;
  readonly bookMilli: bigint;
  readonly countedMilli: bigint;
  readonly deltaMilli: bigint;
  readonly moved: boolean;
}

const ddmm = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

/**
 * INV-06 — مراجعة فروق الجرد وتسوية (خطة الجوال M3): لا فرق يُمرَّر بلا سبب مكتوب ولا «قبول الكل»؛ التسوية
 * تُنشئ حركة `count` بسبب وفاعل ومستند؛ من يعدّ ليس من يسوّي (صلاحية مالية — `can_adjust` من الخادم)؛
 * العدّ الأصلي محفوظ كما أُدخل. الجلسة التي لم تُرفع تُرفع ثم يُعاد الجلب، وبلا اتصال تُعرض من اللقطة
 * المحلية والتسوية أونلاين بعد الرفع. التسوية ورقة تأكيد.
 */
export function ReviewScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const c = useColors();
  const { api } = useSession();
  const { ctx, ready } = useDeviceContext();
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [localOnly, setLocalOnly] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverMissing, setServerMissing] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Adjustment | null>(null);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const storage = await getStorage();
      const fetchReview = async () => {
        const { data, response } = await api.GET("/api/inventory/count-sessions/{session_id}", {
          params: { path: { session_id: sessionId } },
        });
        return response.ok ? (data as unknown as Review) : null;
      };
      try {
        let body = await fetchReview();
        if (!body) {
          // الجلسة لم تُرفع بعد: نرفع ثم نعيد المحاولة
          try {
            await pushPending({ api, storage, requestId: newId });
          } catch {
            /* بلا اتصال */
          }
          body = await fetchReview();
        }
        if (body) {
          setReview(body);
          return;
        }
      } catch {
        /* بلا اتصال: العرض من اللقطة المحلية */
      }
      const local = await readLocalCountSession(storage, sessionId);
      if (!local) return setReview(null);
      setLocalOnly(true);
      setReview({
        session: {
          id: local.id,
          session_number: local.session_number,
          branch_name: ctx?.branchName ?? "",
          status: "closed",
          user_name: local.user_name,
          total_items: local.total_items,
          counted_items: local.lines.length,
          closed_at: local.closed_at,
        },
        rows: local.lines.map((l) => ({
          line_id: `${local.id}:${l.item_id}`,
          item_id: l.item_id,
          item_name: l.item_name,
          unit_name: l.unit_name,
          book_milli: l.system_qty_milli || "0",
          counted_milli: l.counted_qty_milli,
          system_at_count_milli: l.system_qty_milli,
          delta_milli: (BigInt(l.counted_qty_milli) - BigInt(l.system_qty_milli || "0")).toString(),
          value_minor: "0",
          moved_since_count: false,
        })),
        variance_count: local.lines.filter(
          (l) => BigInt(l.counted_qty_milli) !== BigInt(l.system_qty_milli || "0"),
        ).length,
        effect_minor: "0",
        suggested_reasons: [tx(T, "تالف"), tx(T, "سرقة"), tx(T, "خطأ عدّ"), tx(T, "خطأ استلام")],
        adjustment: null,
        can_adjust: false,
      });
    })();
  }, [api, sessionId, ready, ctx?.branchName]);

  useEffect(() => {
    if (review === null) router.replace("/inventory");
  }, [review, router]);

  const rows: Row[] = (review?.rows ?? []).map((r) => ({
    id: r.item_id,
    name: r.unit_name ? `${r.item_name} — ${r.unit_name}` : r.item_name,
    dp: 0,
    bookMilli: BigInt(r.book_milli),
    countedMilli: BigInt(r.counted_milli),
    deltaMilli: BigInt(r.delta_milli),
    moved: r.moved_since_count,
  }));
  const diffs = rows.filter((r) => r.deltaMilli !== 0n);
  const missing = diffs.filter((r) => !(reasons[r.id] ?? "").trim() || serverMissing.has(r.id));
  const canAdjust = review?.can_adjust ?? false;
  const already = review?.session.status === "adjusted" ? review.adjustment : null;

  const state: State = done
    ? "success"
    : review && !canAdjust && !localOnly
      ? "permission_denied"
      : attempted && missing.length > 0
        ? "validation_error"
        : "ready";

  const adjust = async () => {
    if (!review || busy) return;
    setAttempted(true);
    if (missing.length > 0) return;
    setBusy(true);
    try {
      const { data, error, response } = await api.POST(
        "/api/inventory/count-sessions/{session_id}",
        {
          params: { path: { session_id: review.session.id } },
          body: { reasons: Object.fromEntries(diffs.map((r) => [r.id, reasons[r.id].trim()])) },
        },
      );
      if (response.status === 403) return setReview({ ...review, can_adjust: false });
      if (response.status === 400) {
        const errs =
          (error as { errors?: { item_id: string; code: string }[] } | undefined)?.errors ?? [];
        return setServerMissing(new Set(errs.map((e) => e.item_id)));
      }
      const body = data as unknown as Review | undefined;
      if (!response.ok || !body?.adjustment) return;
      setReview(body);
      setDone(body.adjustment);
    } catch {
      /* بلا اتصال: التسوية أونلاين */
    } finally {
      setBusy(false);
    }
  };

  const effect = review ? BigInt(review.effect_minor) : 0n;
  const s = review?.session;

  return (
    <Screen
      screenId={T}
      state={review === undefined ? "loading" : state}
      title={tx(T, "مراجعة فروق الجرد وتسوية — لا فرق يُمرَّر بلا سبب مكتوب")}
    >
      <AppText variant="note" muted style={{ marginBottom: SPACE["3"] }}>
        {tx(T, "الجرد يُنتج فروقاً؛ التسوية تُنشئ حركة بسبب وفاعل ومستند.")}
      </AppText>
      {s ? (
        <View style={{ marginBottom: SPACE["3"] }}>
          <AppText variant="bodyStrong">
            {tx(T, "جلسة جرد")} <M>{ddmm(s.closed_at)}</M> — <M>{review?.variance_count ?? 0}</M>{" "}
            {tx(T, "فروق من")} <M>{s.counted_items}</M> {tx(T, "صنفاً")}
          </AppText>
          <AppText variant="note" muted>
            {tx(T, "العدّ الفعلي محفوظ كما أُدخل. الرصيد لم يتغيّر بعد — يتغيّر عند التسوية فقط.")}
          </AppText>
          <AppText
            variant="secondary"
            style={{
              color: effect < 0n ? c.state.stale.fg : c.state.synced.fg,
              marginTop: SPACE["1"],
            }}
          >
            {tx(T, "أثر التسوية")} <M>{formatMinor(effect.toString())}</M> SDG
          </AppText>
        </View>
      ) : null}

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "من يعدّ ليس من يسوّي")}>
          <AppText variant="secondary">
            {tx(T, "أمين المخزن أدخل العدّ، والتسوية تحتاج صلاحية مالية.")}
          </AppText>
          <AppText variant="note" style={{ color: c.state.pending_sync.fg }}>
            {tx(T, "أُرسلت الفروق للمراجعة")}
          </AppText>
        </StateView>
      ) : null}
      {state === "validation_error" ? (
        <StateView state="validation_error" title={tx(T, "فرق بلا سبب.")}>
          {null}
        </StateView>
      ) : null}
      {state === "success" && done ? (
        <StateView
          state="success"
          title={`${tx(T, "سُوّيت")} ${done.line_count} ${tx(T, "فروق — مستند")} ${done.adjustment_number}`}
        >
          <AppText variant="secondary">
            {tx(
              T,
              "الرصيد تغيّر بحركة لها مستند وفاعل وسبب، وتظهر في «حركات المخزون» كسطر «تسوية جرد» لا كرصيد تغيّر بلا تفسير. العدّ الأصلي محفوظ كما أُدخل ولا يُعاد كتابته.",
            )}
          </AppText>
        </StateView>
      ) : null}
      {localOnly ? (
        <StateView state="offline" title={tx(T, "جرد بلا اتصال")}>
          <AppText variant="secondary">
            {tx(T, "الحالة الطبيعية: المخازن بلا تغطية غالباً. العدّ محلي كاملاً.")}
          </AppText>
        </StateView>
      ) : null}

      {rows.length > 0 ? (
        <GroupedList title={tx(T, "فروق الجرد")}>
          {rows.map((r, i) => {
            const bad = (attempted && !(reasons[r.id] ?? "").trim()) || serverMissing.has(r.id);
            return (
              <View
                key={r.id}
                style={{
                  padding: SPACE["4"],
                  gap: SPACE["1"],
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <AppText variant="bodyStrong">{r.name}</AppText>
                <AppText variant="secondary" muted>
                  {tx(T, "الدفتري")} <M>{formatQty(r.bookMilli, r.dp)}</M> · {tx(T, "المعدود")}{" "}
                  <M>{formatQty(r.countedMilli, r.dp)}</M> · {tx(T, "الفرق")}{" "}
                  <AppText
                    style={{
                      color:
                        r.deltaMilli < 0n
                          ? c.danger
                          : r.deltaMilli > 0n
                            ? c.state.synced.fg
                            : undefined,
                    }}
                  >
                    <Delta milli={r.deltaMilli} dp={r.dp} />
                  </AppText>
                </AppText>
                {r.moved ? (
                  <AppText variant="note" muted>
                    {tx(
                      T,
                      "بيعٌ يقع على جهاز آخر أثناء الجرد. يُكتشف عند المزامنة ويُعرض في مراجعة الفروق.",
                    )}
                  </AppText>
                ) : null}
                {r.deltaMilli === 0n ? null : already ? (
                  <AppText variant="secondary">{reasons[r.id] || "—"}</AppText>
                ) : (
                  <>
                    <TextField
                      label={`${tx(T, "السبب —")} ${r.name}`}
                      value={reasons[r.id] ?? ""}
                      onChangeText={(t) => {
                        setServerMissing((m) => {
                          const n = new Set(m);
                          n.delete(r.id);
                          return n;
                        });
                        setReasons((m) => ({ ...m, [r.id]: t }));
                      }}
                      error={bad ? tx(T, "مطلوب — أدخل سبباً لهذا الفرق") : undefined}
                      hint={canAdjust ? undefined : tx(T, "من يعدّ ليس من يسوّي")}
                      editable={canAdjust}
                      required
                    />
                    {canAdjust ? (
                      <Wrap>
                        {(review?.suggested_reasons ?? []).map((sg) => (
                          <Chip
                            key={sg}
                            label={sg}
                            on={(reasons[r.id] ?? "") === sg}
                            onPress={() => setReasons((m) => ({ ...m, [r.id]: sg }))}
                          />
                        ))}
                      </Wrap>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
        </GroupedList>
      ) : null}

      {!done && !already ? (
        <Button
          label={tx(T, "تسوية الفروق")}
          financial
          loading={busy}
          disabledReason={
            localOnly
              ? tx(T, "التسوية أونلاين بعد رفع الجلسة")
              : !canAdjust
                ? tx(T, "من يعدّ ليس من يسوّي")
                : diffs.length === 0
                  ? tx(T, "لا فروق")
                  : attempted && missing.length > 0
                    ? tx(T, "السبب — مطلوب لكل صف")
                    : undefined
          }
          onPress={() => void adjust()}
        />
      ) : null}
      <Button
        label={tx(T, "أرصدة المخزون")}
        variant="quiet"
        onPress={() => router.push("/inventory")}
      />
    </Screen>
  );
}
