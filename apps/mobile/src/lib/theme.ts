import { useCallback } from "react";
import { Appearance, useColorScheme } from "react-native";

import { getStorage } from "@/lib/storage";

/**
 * المظهر الفاتح/الداكن كزرّ الويب (`theme-toggle.tsx`، `vz-theme`): بلا اختيار يتبع النظام، وبعده
 * يُفرض على التطبيق كله بـ`Appearance.setColorScheme` (فتتبعه `useColors` ورأس النظام معاً)،
 * ويُحفظ على الجهاز ليبقى بعد إغلاق التطبيق (0005 §٢٠١).
 */
type Theme = "light" | "dark";
const KEY = "ui.theme";

/** عند بدء التطبيق: يطبّق المحفوظ إن وُجد. */
export async function restoreTheme(): Promise<void> {
  try {
    const storage = await getStorage();
    const t = await storage.read((tx) => tx.getMeta(KEY));
    if (t === "light" || t === "dark") Appearance.setColorScheme(t);
  } catch {
    /* لا تخزين بعد — يتبع النظام */
  }
}

export function useThemeToggle(): { theme: Theme; toggle: () => void } {
  const theme: Theme = useColorScheme() === "dark" ? "dark" : "light";
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    Appearance.setColorScheme(next);
    void getStorage()
      .then((storage) => storage.transaction((tx) => tx.putMeta(KEY, next)))
      .catch(() => undefined);
  }, [theme]);
  return { theme, toggle };
}
