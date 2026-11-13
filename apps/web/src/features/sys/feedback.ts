/** «ملاحظاتك» (0005 §٢٦٤) — الأنواع المشتركة بين القسم وقائمة «ملاحظاتي». */

export const FEEDBACK_TEXT_MAX = 1000;

export const feedbackKinds = [
  { value: "suggestion", label: "اقتراح" },
  { value: "problem", label: "مشكلة" },
  { value: "opinion", label: "رأي" },
] as const;

export interface FeedbackDraft {
  readonly client_id: string;
  readonly kind: string;
  readonly text: string;
  readonly contact_ok: boolean;
  readonly screen: string;
  readonly platform: string;
  readonly app_version: string;
  readonly created_at: string;
  /** 0005 §٢٦٧: لقطة شاشة اختيارية (data URL). */
  readonly attachment: string;
  readonly attachment_name: string;
  /** صاحب المسودة على جهاز مشترك (0005 §٢٧٣) — للطابور المحلي وحده، الخادم يتجاهله. */
  readonly user_id?: string;
}

export interface FeedbackRow {
  readonly id: string;
  readonly client_id: string;
  readonly reference: string;
  readonly kind: "suggestion" | "problem" | "opinion";
  readonly kind_label: string;
  readonly text: string;
  readonly contact_ok: boolean;
  readonly status: "new" | "studying" | "done" | "declined";
  readonly status_label: string;
  readonly reply: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly unseen: boolean;
  readonly has_attachment?: boolean | undefined;
}
