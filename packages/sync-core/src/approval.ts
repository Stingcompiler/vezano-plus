/**
 * اعتماد المدير الحاضر برمزه عند الصندوق (S-04؛ 0005 §٢٩٣): سحب من الدرج، وخصم فوق السقف، وتجاوز حدّ
 * ائتمان. الرمز هو PIN القفل نفسه (§٢٦٥) — لا سرّ جديد — ويُتحقق منه على الجهاز بمتحققات الفرع بلا
 * شبكة، ثم يُقاس حدّ صاحبه بخلايا دوره (`decidePermission`، نظير `can()` في الخادم). يُرفع مع العملية
 * صاحب الرمز وإصدار متحققه فقط، والخادم يعيد الفحص عند الرفع ويحجر ما لا يصحّ.
 *
 * المحاولات الخاطئة تُعدّ في عدّاد القفل نفسه (خمس ثم 15 دقيقة) — تخمين رمز المدير من شاشة الاعتماد
 * كتخمينه من شاشة القفل.
 */
import type { StoragePort } from "@sting/platform";

import { decidePermission, type DenialReason } from "./permissions";
import {
  type DeviceVerifiers,
  type Pbkdf2Sha256,
  PIN_LOCK_POLICY,
  PIN_STATE_KEY,
  PIN_VERIFIERS_KEY,
  type PinLockState,
  type PinVerifierRow,
  verifyPin,
} from "./pin";

export type ApprovalKind = "withdrawal" | "discount" | "credit";

export interface ApprovalRequest {
  readonly kind: ApprovalKind;
  /** المبلغ الذي يُقاس به الحدّ: السحب، أو الخصم، أو ما فوق حدّ الائتمان. */
  readonly amountMinor: bigint;
  readonly branchId: string;
  /** الطالب لا يعتمد طلبه. */
  readonly requesterId: string;
}

export type ApprovalDenial = DenialReason | "self" | "revoked";

export interface ApproverDecision {
  readonly allowed: boolean;
  readonly reason: ApprovalDenial | "";
  readonly limitMinor: bigint | null;
}

export type ApprovalOutcome =
  | { readonly kind: "approved"; readonly approver: PinVerifierRow }
  | {
      readonly kind: "not_allowed";
      readonly approver: PinVerifierRow;
      readonly reason: ApprovalDenial;
      readonly limitMinor: bigint | null;
    }
  | { readonly kind: "wrong"; readonly failed: number; readonly maxAttempts: number }
  | { readonly kind: "locked"; readonly until: string }
  | { readonly kind: "no_verifiers" };

const deny = (reason: ApprovalDenial): ApproverDecision => ({
  allowed: false,
  reason,
  limitMinor: null,
});

/** هل يحقّ لصاحب هذا الرمز هذا الاعتماد؟ — القاعدة نفسها في الخادم (`approver_decision`). */
export function approverDecision(row: PinVerifierRow, req: ApprovalRequest): ApproverDecision {
  if (row.user_id === req.requesterId) return deny("self");
  if (row.revoked) return deny("revoked");
  const owner = row.is_owner === true || row.role_code === "owner";
  // السحب للمالك وحده (لا صف له في المصفوفة — SHIFT-03)
  if (req.kind === "withdrawal")
    return owner ? { allowed: true, reason: "", limitMinor: null } : deny("role_forbidden");
  if (owner) return { allowed: true, reason: "", limitMinor: null };
  // قائمة متحققات مخزَّنة قبل هذا الإصدار بلا دور: لا يُعتمد بها حتى تتحدّث (والخادم يحكم أيضاً)
  if (!row.role_code) return deny("role_forbidden");
  const d = decidePermission(
    row.permissions,
    row.role_code,
    req.kind === "discount" ? "discount" : "view_receivables",
    {
      amountMinor: req.kind === "discount" ? req.amountMinor : undefined,
      branchId: req.branchId,
      ownBranchId: req.branchId,
    },
  );
  return { allowed: d.allowed, reason: d.reason, limitMinor: d.limitMinor };
}

/**
 * يجرّب الرمز على متحققات الفرع: أول مطابق هو المعتمد، ثم يُقاس حدّه. الخطأ يزيد عدّاد القفل.
 * لا يُخزَّن شيء غير العدّاد — العملية تحفظها الشاشة باسم المعتمد.
 */
export async function attemptApproval(
  storage: StoragePort,
  pin: string,
  req: ApprovalRequest,
  now: () => Date = () => new Date(),
  opts: { readonly kdf?: Pbkdf2Sha256 } = {},
): Promise<ApprovalOutcome> {
  const [lock, rawVerifiers] = await storage.read(async (tx) => [
    await tx.getMeta(PIN_STATE_KEY),
    await tx.getMeta(PIN_VERIFIERS_KEY),
  ]);
  const state: PinLockState = lock
    ? (JSON.parse(lock) as PinLockState)
    : { failed: 0, lockedUntil: null };
  if (state.lockedUntil && new Date(state.lockedUntil).getTime() > now().getTime())
    return { kind: "locked", until: state.lockedUntil };
  const device = rawVerifiers ? (JSON.parse(rawVerifiers) as DeviceVerifiers) : null;
  if (!device || device.verifiers.length === 0) return { kind: "no_verifiers" };
  // الطالب آخراً: رمزه يُعرف («لا تعتمد طلبك») دون أن يسبق غيره في كلفة الاشتقاق
  const ordered = [
    ...device.verifiers.filter((v) => v.user_id !== req.requesterId),
    ...device.verifiers.filter((v) => v.user_id === req.requesterId),
  ];
  for (const v of ordered) {
    if (await verifyPin(pin, v.encoded, opts.kdf)) {
      await storage.transaction((tx) =>
        tx.putMeta(PIN_STATE_KEY, JSON.stringify({ failed: 0, lockedUntil: null })),
      );
      const d = approverDecision(v, req);
      if (d.allowed) return { kind: "approved", approver: v };
      return {
        kind: "not_allowed",
        approver: v,
        reason: d.reason || "role_forbidden",
        limitMinor: d.limitMinor,
      };
    }
  }
  const failed = (state.lockedUntil ? 0 : state.failed) + 1;
  const lockedUntil =
    failed >= PIN_LOCK_POLICY.maxAttempts
      ? new Date(now().getTime() + PIN_LOCK_POLICY.lockMinutes * 60_000).toISOString()
      : null;
  await storage.transaction((tx) =>
    tx.putMeta(PIN_STATE_KEY, JSON.stringify({ failed: lockedUntil ? 0 : failed, lockedUntil })),
  );
  if (lockedUntil) return { kind: "locked", until: lockedUntil };
  return { kind: "wrong", failed, maxAttempts: PIN_LOCK_POLICY.maxAttempts };
}
