import type { StoragePort } from "@sting/platform";
import {
  type CartDraft,
  type CartDraftLine,
  cartTotals,
  type DiscountCaps,
  type LocalBalance,
  type LocalParty,
  type LocalSale,
  type LocalShift,
  readBalanceMatchedAt,
  readCartDraft,
  readLocalBalances,
  readLocalParties,
  readOpenShift,
  readPartyPendingCredit,
  type SalePaymentInput,
  saveSaleLocally,
  writeCartDraft,
} from "@sting/sync-core";
import { pushPending } from "@sting/app-core";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

/**
 * سياق الوردية على الجهاز (الفرع والجهاز والمسؤول) — من تسجيل الجهاز المحفوظ ومن آخر ما أكّده الخادم
 * في meta `shift.context`، ليعمل الفتح والبيع بلا اتصال. نظير `features/shifts/context.ts` في الويب.
 */
export const SHIFT_CONTEXT_META = "shift.context";
const DEVICE_META = "device.registration";

export interface ShiftContext {
  readonly branchId: string;
  readonly branchName: string;
  readonly branchCode?: string | undefined;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly devicePrefix?: string | undefined;
  readonly userId: string;
  readonly userName: string;
  readonly roleName: string;
  readonly canWithdraw?: boolean | undefined;
  readonly ownerName?: string | undefined;
  readonly roleCode?: string | undefined;
  readonly discountCaps?: DiscountCaps | undefined;
}

export async function readShiftContext(
  storage: StoragePort,
  who: { deviceId: string | null; userId: string | null; displayName?: string | null },
): Promise<ShiftContext | null> {
  const [ctxRaw, devRaw] = await storage.read(async (t) => [
    await t.getMeta(SHIFT_CONTEXT_META),
    await t.getMeta(DEVICE_META),
  ]);
  const cached = ctxRaw ? (JSON.parse(ctxRaw) as Partial<ShiftContext>) : {};
  const dev = devRaw
    ? (JSON.parse(devRaw) as {
        deviceId?: string;
        branchId?: string;
        prefix?: string;
        branchCode?: string;
      })
    : {};
  const deviceId = who.deviceId ?? dev.deviceId ?? cached.deviceId ?? "";
  const branchId = dev.branchId ?? cached.branchId ?? "";
  if (!deviceId && !branchId && !cached.branchName) return null;
  return {
    branchId,
    branchName: cached.branchName ?? "",
    branchCode: cached.branchCode ?? dev.branchCode,
    deviceId,
    deviceName: cached.deviceName ?? "",
    devicePrefix: dev.prefix ?? cached.devicePrefix,
    userId: who.userId ?? cached.userId ?? "",
    userName: who.displayName ?? cached.userName ?? "",
    roleName: cached.roleName ?? "",
    canWithdraw: cached.canWithdraw,
    ownerName: cached.ownerName,
    roleCode: cached.roleCode,
    discountCaps: cached.discountCaps,
  };
}

export async function storeShiftContext(storage: StoragePort, ctx: ShiftContext): Promise<void> {
  await storage.transaction((t) => t.putMeta(SHIFT_CONTEXT_META, JSON.stringify(ctx)));
}

/** هل تغيّر السياق المخزَّن؟ يُستدعى بعد `shifts/current` ليبقى الفتح بلا اتصال ممكناً. */
export function useShiftContext(): ShiftContext | null {
  const { state } = useSession();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  useEffect(() => {
    void getStorage().then((s) =>
      readShiftContext(s, {
        deviceId: state.deviceId,
        userId: state.userId,
        displayName: undefined,
      }).then(setCtx),
    );
  }, [state.deviceId, state.userId]);
  return ctx;
}

/** اليوم بتاريخ الأعمال المحلي `YYYY-MM-DD`. */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «200.00» ↔ 20000 بالوحدة الصغرى؛ الأرقام العربية تُقبل. */
export function parseAmount(text: string): bigint | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".");
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

export type SavePhase = "idle" | "saving" | "saved";
export type PushResult = "none" | "synced" | "pending" | "failed";

/**
 * ما تشترك فيه شاشات الدفع (POS-05/06/07): السلة والوردية والسياق والأرصدة والطرف، وخط الحفظ
 * الواحد (`saveSaleLocally`) بمعرّفات ثابتة لكل شاشة، ثم محاولة الرفع الأولى — النجاح بعد الحفظ
 * المحلي لا بعد الرفع. نظير `use-sale.ts` في الويب.
 */
export function useSale() {
  const router = useRouter();
  const { state, api } = useSession();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [balances, setBalances] = useState<Map<string, LocalBalance>>(new Map());
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [party, setParty] = useState<LocalParty | null>(null);
  const [pendingCredit, setPendingCredit] = useState<{ pendingMinor: bigint; count: number }>({
    pendingMinor: 0n,
    count: 0,
  });
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [sale, setSale] = useState<LocalSale | null>(null);
  const [push, setPush] = useState<PushResult>("none");
  const ids = useRef<{
    operationId: string;
    saleId: string;
    payments: string[];
    lines: string[];
    movements: string[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      const [d, s, c, b, at, parties] = await Promise.all([
        readCartDraft(storage),
        readOpenShift(storage),
        readShiftContext(storage, { deviceId: state.deviceId, userId: state.userId }),
        readLocalBalances(storage),
        readBalanceMatchedAt(storage),
        readLocalParties(storage),
      ]);
      setDraft(d);
      setShift(s);
      setCtx(c);
      setBalances(b);
      setMatchedAt(at);
      if (d.customer) {
        setParty(parties.find((p) => p.id === d.customer?.id) ?? null);
        setPendingCredit(await readPartyPendingCredit(storage, d.customer.id));
      }
    })();
  }, [state.deviceId, state.userId]);

  useEffect(() => {
    if (phase === "idle" && draft && draft.lines.length === 0) router.replace("/pos");
    if (shift === null) router.replace("/pos");
  }, [draft, phase, router, shift]);

  const save = async (
    lines: readonly CartDraftLine[],
    payments: readonly Omit<SalePaymentInput, "paymentId">[],
    extraDependencies: readonly string[] = [],
  ): Promise<LocalSale | null> => {
    if (!draft || !shift || !ctx || phase !== "idle") return null;
    setPhase("saving");
    ids.current ??= {
      operationId: newId(),
      saleId: newId(),
      payments: payments.map(() => newId()),
      lines: lines.map(() => newId()),
      movements: lines.map(() => newId()),
    };
    const id = ids.current;
    const storage = await getStorage();
    await writeCartDraft(storage, { ...draft, lines });
    const { sale: saved } = await saveSaleLocally(storage, {
      operationId: id.operationId,
      saleId: id.saleId,
      draft: { ...draft, lines },
      payments: payments.map((p, i) => ({ ...p, paymentId: id.payments[i] ?? newId() })),
      shift,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      businessDate: shift.business_date || today(),
      occurredAt: new Date().toISOString(),
      extraDependencies,
      memberIds: { lines: id.lines, movements: id.movements },
    });
    setSale(saved);
    return saved;
  };

  /** محاولة الرفع الأولى بعد الحفظ؛ فشلها لا يمسّ البيع المحفوظ. */
  const pushAfterSave = async () => {
    try {
      const storage = await getStorage();
      const out = await pushPending({ api, storage, requestId: newId });
      setPush(
        out.kind === "applied" || out.kind === "idle"
          ? "synced"
          : out.kind === "retry"
            ? "failed"
            : "pending",
      );
    } catch {
      setPush("failed");
    } finally {
      setPhase("saved");
    }
  };

  const totals = cartTotals(draft?.lines ?? [], draft?.discount);
  return {
    router,
    draft,
    shift,
    ctx,
    balances,
    matchedAt,
    party,
    pendingCredit,
    totals,
    phase,
    sale,
    push,
    save,
    pushAfterSave,
    setPhase,
  };
}
