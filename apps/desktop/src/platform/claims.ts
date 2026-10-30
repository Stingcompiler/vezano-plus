export interface Claims {
  readonly user_id?: string;
  readonly tid?: string | null;
}

/** حمولة رمز الوصول (قراءة لا تحقق — الخادم يتحقق مع كل طلب) لمطابقة السياق المحفوظ. */
export function readClaims(access: string): Claims {
  try {
    const part = access.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Claims;
  } catch {
    return {};
  }
}
