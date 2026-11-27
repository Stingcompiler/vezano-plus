"use client";

import {
  type ApprovalRequest,
  attemptApproval,
  type DeviceVerifiers,
  PIN_LOCK_POLICY,
  type PinVerifierRow,
  storeVerifiers,
} from "@sting/sync-core";
import { Button, formatMinor, Notice, TextField } from "@sting/ui-web";
import { useEffect, useState } from "react";

import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type Problem =
  | { readonly kind: "wrong"; readonly failed: number }
  | { readonly kind: "locked"; readonly until: string }
  | { readonly kind: "not_allowed"; readonly name: string; readonly limitMinor: bigint | null }
  | { readonly kind: "self" }
  | { readonly kind: "no_verifiers" };

/**
 * «اعتماد مدير حاضر» (S-04؛ 0005 §٢٩٣): المعتمد يكتب رمزه (PIN القفل نفسه) على جهاز الكاشير. يُتحقق
 * منه على الجهاز بلا شبكة ويُقاس حدّه بخلايا دوره؛ الخادم يعيد الفحص عند الرفع. عند الاتصال تُحدَّث
 * المتحققات أولاً كي تحمل أدوار أصحابها.
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
  const app = useApp();
  const online = useOnline();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    if (!online || !app.device) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/devices/verifiers");
        if (cancelled || !response.ok || !data) return;
        const fresh: DeviceVerifiers = { ...data, fetched_at: new Date().toISOString() };
        await storeVerifiers(getStorage(), fresh);
      } catch {
        /* بلا اتصال فعلي: المتحققات المحلية تكفي */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, app.device]);

  const approve = async () => {
    if (busy || !pin) return;
    setBusy(true);
    try {
      const out = await attemptApproval(getStorage(), pin, request);
      setPin("");
      if (out.kind === "approved") {
        setProblem(null);
        await onApproved(out.approver);
      } else if (out.kind === "not_allowed") {
        setProblem(
          out.reason === "self"
            ? { kind: "self" }
            : { kind: "not_allowed", name: out.approver.display_name, limitMinor: out.limitMinor },
        );
      } else if (out.kind === "wrong") setProblem({ kind: "wrong", failed: out.failed });
      else if (out.kind === "locked") setProblem({ kind: "locked", until: out.until });
      else setProblem({ kind: "no_verifiers" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="c-card apr-pin"
      aria-label={ownerOnly ? "اعتماد المالك" : "اعتماد مدير حاضر"}
    >
      <h3 className="apr-pin__title">{ownerOnly ? "اعتماد المالك" : "اعتماد مدير حاضر"}</h3>
      <p className="acc-choice__note">
        {ownerOnly
          ? "يكتب المالك رمزه هنا. يُسجَّل الإذن باسمه."
          : "يكتب المدير أو المالك رمزه هنا. يُسجَّل الاعتماد باسمه."}
      </p>
      <TextField
        label="رمز المعتمد"
        kind="password"
        mono
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") void approve();
        }}
        maxLength={6}
      />
      {problem?.kind === "wrong" ? (
        <Notice
          kind="warning"
          title={
            <>
              محاولة خاطئة — <span className="sting-mono">{problem.failed}</span> من{" "}
              <span className="sting-mono">{PIN_LOCK_POLICY.maxAttempts}</span>
            </>
          }
        >
          <p className="acc-lead">
            بعد الخامسة يُقفل الجهاز{" "}
            <span className="sting-mono">{PIN_LOCK_POLICY.lockMinutes}</span> دقيقة.
          </p>
        </Notice>
      ) : null}
      {problem?.kind === "locked" ? (
        <Notice kind="locked" title="الاعتماد مقفل">
          <p className="acc-lead">
            خمس محاولات خاطئة. يُفتح <span className="sting-mono">{hhmm(problem.until)}</span>.
          </p>
        </Notice>
      ) : null}
      {problem?.kind === "not_allowed" ? (
        <Notice kind="locked" title="فوق صلاحية صاحب الرمز">
          <p className="acc-lead">
            {problem.limitMinor !== null ? (
              <>
                حدّ {problem.name}{" "}
                <span className="sting-mono">{formatMinor(problem.limitMinor.toString())}</span>.
              </>
            ) : (
              <>{problem.name} لا يملك هذا الاعتماد.</>
            )}{" "}
            {ownerOnly ? "يعتمده المالك." : "يعتمده المالك أو من حدّه أعلى."}
          </p>
        </Notice>
      ) : null}
      {problem?.kind === "self" ? (
        <Notice kind="locked" title="لا تعتمد طلبك">
          <p className="acc-lead">يعتمده غيرك: مدير حاضر أو المالك.</p>
        </Notice>
      ) : null}
      {problem?.kind === "no_verifiers" ? (
        <Notice kind="info" title="لا رموز على هذا الجهاز">
          <p className="acc-lead">اتصل بالإنترنت مرة لتنزل رموز مستخدمي الفرع.</p>
        </Notice>
      ) : null}
      <div className="cat-form__actions">
        <Button
          financial
          onClick={() => void approve()}
          loading={busy}
          disabledReason={
            problem?.kind === "locked" ? "الاعتماد مقفل" : !pin ? "رمز المعتمد" : undefined
          }
        >
          اعتمد
        </Button>
      </div>
    </section>
  );
}
