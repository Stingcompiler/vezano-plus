import { formatMinorShort } from "@sting/app-core";
import {
  type ApprovalRequest,
  attemptApproval,
  type DeviceVerifiers,
  PIN_LOCK_POLICY,
  type PinVerifierRow,
  storeVerifiers,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  FONT,
  SPACE,
  StateView,
  TextField,
  ThemedText as Text,
  useColors,
} from "@sting/ui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { devicePbkdf2 } from "@/lib/kdf";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const K = "shared:features/approvals/approver-pin.tsx";

type Problem =
  | { readonly kind: "wrong"; readonly failed: number }
  | { readonly kind: "locked" }
  | { readonly kind: "not_allowed"; readonly name: string; readonly limitMinor: bigint | null }
  | { readonly kind: "self" }
  | { readonly kind: "no_verifiers" };

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * «اعتماد مدير حاضر» على الهاتف — نظير `apps/web/src/features/approvals/approver-pin.tsx` (0005 §٢٩٣):
 * المعتمد يكتب رمزه (PIN القفل) فيُتحقق منه على الجهاز بمشتقّ الهاتف ويُقاس حدّه بخلايا دوره.
 */
export function ApproverPin({
  request,
  ownerOnly = false,
  onApproved,
}: {
  readonly request: ApprovalRequest;
  readonly ownerOnly?: boolean;
  readonly onApproved: (approver: PinVerifierRow) => void | Promise<void>;
}) {
  const c = useColors();
  const { api } = useSession();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  // المتحققات بأدوار أصحابها من الخادم إن وُجد اتصال؛ وإلا المحلية
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/devices/verifiers");
        if (!alive || !response.ok || !data) return;
        const fresh: DeviceVerifiers = { ...data, fetched_at: new Date().toISOString() };
        await storeVerifiers(await getStorage(), fresh);
      } catch {
        /* بلا اتصال: المحلية تكفي */
      }
    })();
    return () => {
      alive = false;
    };
  }, [api]);

  const approve = async () => {
    if (busy || !pin) return;
    setBusy(true);
    try {
      const out = await attemptApproval(await getStorage(), pin, request, undefined, {
        kdf: devicePbkdf2,
      });
      setPin("");
      if (out.kind === "approved") {
        setProblem(null);
        await onApproved(out.approver);
      } else if (out.kind === "not_allowed")
        setProblem(
          out.reason === "self"
            ? { kind: "self" }
            : { kind: "not_allowed", name: out.approver.display_name, limitMinor: out.limitMinor },
        );
      else if (out.kind === "wrong") setProblem({ kind: "wrong", failed: out.failed });
      else if (out.kind === "locked") setProblem({ kind: "locked" });
      else setProblem({ kind: "no_verifiers" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      accessibilityLabel={ownerOnly ? tx(K, "اعتماد المالك") : tx(K, "اعتماد مدير حاضر")}
      style={{
        gap: SPACE["2"],
        padding: SPACE["3"],
        marginVertical: SPACE["3"],
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 16,
        backgroundColor: c.surfaceCard,
      }}
    >
      <AppText variant="bodyStrong">
        {ownerOnly ? tx(K, "اعتماد المالك") : tx(K, "اعتماد مدير حاضر")}
      </AppText>
      <AppText variant="note" muted>
        {ownerOnly
          ? tx(K, "يكتب المالك رمزه هنا. يُسجَّل الإذن باسمه.")
          : tx(K, "يكتب المدير أو المالك رمزه هنا. يُسجَّل الاعتماد باسمه.")}
      </AppText>
      <TextField
        label={tx(K, "رمز المعتمد")}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        secure
        mono
        maxLength={6}
      />
      {problem?.kind === "wrong" ? (
        <StateView state="validation_error" title={tx(K, "محاولة خاطئة —")}>
          <AppText variant="secondary">
            <N>{problem.failed}</N> {tx(K, "من")} <N>{PIN_LOCK_POLICY.maxAttempts}</N> ·{" "}
            {tx(K, "بعد الخامسة يُقفل الجهاز")} <N>{PIN_LOCK_POLICY.lockMinutes}</N>{" "}
            {tx(K, "دقيقة.")}
          </AppText>
        </StateView>
      ) : null}
      {problem?.kind === "locked" ? (
        <StateView state="permission_denied" title={tx(K, "الاعتماد مقفل")} />
      ) : null}
      {problem?.kind === "not_allowed" ? (
        <StateView state="permission_denied" title={tx(K, "فوق صلاحية صاحب الرمز")}>
          <AppText variant="secondary">
            {problem.limitMinor !== null ? (
              <>
                {tx(K, "حدّ")} {problem.name}{" "}
                <N>{formatMinorShort(problem.limitMinor.toString())}</N>.{" "}
              </>
            ) : (
              <>
                {problem.name} {tx(K, "لا يملك هذا الاعتماد.")}{" "}
              </>
            )}
            {ownerOnly ? tx(K, "يعتمده المالك.") : tx(K, "يعتمده المالك أو من حدّه أعلى.")}
          </AppText>
        </StateView>
      ) : null}
      {problem?.kind === "self" ? (
        <StateView state="permission_denied" title={tx(K, "لا تعتمد طلبك")}>
          <AppText variant="secondary">{tx(K, "يعتمده غيرك: مدير حاضر أو المالك.")}</AppText>
        </StateView>
      ) : null}
      {problem?.kind === "no_verifiers" ? (
        <StateView state="offline" title={tx(K, "لا رموز على هذا الجهاز")}>
          <AppText variant="secondary">
            {tx(K, "اتصل بالإنترنت مرة لتنزل رموز مستخدمي الفرع.")}
          </AppText>
        </StateView>
      ) : null}
      <Button
        label={tx(K, "اعتمد")}
        financial
        loading={busy}
        disabledReason={
          problem?.kind === "locked"
            ? tx(K, "الاعتماد مقفل")
            : !pin
              ? tx(K, "رمز المعتمد")
              : undefined
        }
        onPress={() => void approve()}
      />
    </View>
  );
}
