"use client";

import { Button } from "@sting/ui-web";
import { useState } from "react";

import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";

/**
 * «أنشئ باركوداً داخلياً» (0005 §٢٦٩؛ نصوص غير مرسومة اعتمدها المالك): الخادم يعطي الرقم التالي من
 * عدّاد المنشأة (EAN-13 بالبادئة 20) فيُملأ به الحقل، والحفظ يتحقق من تفرّده كأي باركود. يظهر
 * والحقل فارغ فقط — لا يستبدل باركود المصنع. يحتاج اتصالاً كإنشاء الصنف نفسه.
 */
export function GenerateBarcodeButton({
  onCode,
  disabledReason,
}: {
  onCode: (code: string) => void;
  disabledReason?: string | undefined;
}) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const generate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api().POST("/api/catalog/barcode/generate");
      const code = (data as { barcode?: string } | undefined)?.barcode;
      if (!response.ok || !code) throw new Error("generate_failed");
      onCode(code);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cat-barcode-gen">
      <Button
        variant="secondary"
        onClick={() => void generate()}
        loading={busy}
        disabledReason={disabledReason ?? (online ? undefined : "يحتاج اتصالاً")}
      >
        أنشئ باركوداً داخلياً
      </Button>
      {failed ? (
        <p className="acc-choice__note" role="alert">
          تعذّر إنشاء الباركود — حاول مرة أخرى
        </p>
      ) : null}
    </div>
  );
}

/** تحت الحقل حين يحمل باركوداً داخلياً: لا يصلح خارج المتجر. */
export function InternalBarcodeNote({ value }: { value: string }) {
  if (!/^20[0-9]{11}$/.test(value.trim())) return null;
  return (
    <p className="acc-choice__note cat-barcode-gen__note">
      باركود داخلي لمتجرك — يبدأ بـ <span className="sting-mono">20</span> ولا يصلح خارج المتجر
    </p>
  );
}
