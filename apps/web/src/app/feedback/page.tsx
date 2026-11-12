import { Suspense } from "react";

import { PublicFeedbackClient } from "@/features/public/public-feedback-client";
import { pageMetadata } from "@/features/public/site";

export const metadata = pageMetadata(
  "أرسل ملاحظة",
  "اقتراح للمنصة أو مشكلة في الموقع أو ملاحظة عن محل — تصل إلى فريق فيزانو وحده.",
  "/feedback",
);

/** PUB-07 — ملاحظة زائر بلا حساب، خاصة بالفريق (0005 §٢٦٦). `?shop=` من صفحة محل. */
export default function PublicFeedbackPage() {
  return (
    <Suspense fallback={null}>
      <PublicFeedbackClient />
    </Suspense>
  );
}
