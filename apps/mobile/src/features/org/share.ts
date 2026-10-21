import { Share } from "react-native";

import { API_URL } from "@/lib/session";

/** جسم ملف نصي من الخادم (CSV) بجلسة المستخدم — نظير `fetch` + `blob` في الويب. */
export async function fetchFileText(
  pathAndQuery: string,
  access: string | undefined,
): Promise<string | null> {
  try {
    const r = await fetch(`${API_URL}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${access ?? ""}` },
    });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** ورقة المشاركة الأصلية لنص (رابط دعوة أو ملف CSV). false إن فشلت. */
export async function shareText(message: string, title: string): Promise<boolean> {
  try {
    await Share.share({ message, title });
    return true;
  } catch {
    return false;
  }
}
