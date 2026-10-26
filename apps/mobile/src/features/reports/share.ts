import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

import { API_URL } from "@/lib/session";

/** جسم ملف من الخادم (CSV أو HTML) بجلسة المستخدم — نظير `fetch` + `blob` في الويب. */
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

/**
 * يسلّم الملف إلى المشاركة الأصلية: HTML يصير PDF (expo-print) ثم ورقة المشاركة؛ CSV نصّ يُشارَك
 * عبر `Share` (لا توجد وحدة ملفات في التطبيق — لا اعتماديات جديدة). يعيد false إن فشل أو أُلغي.
 */
export async function shareReportFile(
  body: string,
  fileName: string,
  format: "html" | "csv",
): Promise<boolean> {
  try {
    if (format === "html") {
      const { uri } = await Print.printToFileAsync({ html: body });
      if (!(await Sharing.isAvailableAsync())) return false;
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fileName });
      return true;
    }
    await Share.share({ message: body, title: fileName });
    return true;
  } catch {
    return false;
  }
}

/** معاينة أصلية للصفحة الأولى: مربع الطباعة/المعاينة في النظام. */
export async function previewHtml(html: string): Promise<boolean> {
  try {
    await Print.printAsync({ html });
    return true;
  } catch {
    return false;
  }
}
