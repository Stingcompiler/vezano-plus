import type { SecretsPort } from "@sting/platform";
import * as SecureStore from "expo-secure-store";

/**
 * الأسرار الصغيرة في مخزن النظام الآمن (Keychain/Keystore — §٩.٤، 0005 §١٦٢): رمز التجديد الطويل
 * للجهاز ومعرّفه. لا بيانات أعمال هنا. الاختبار يحقن مخزناً ذاكرياً.
 */
const secure: SecretsPort = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  delete: (key) => SecureStore.deleteItemAsync(key),
};

let current: SecretsPort = secure;

export function secrets(): SecretsPort {
  return current;
}

export function setSecretsForTests(port: SecretsPort | null): void {
  current = port ?? secure;
}

export const SECRET_KEYS = {
  deviceRefresh: "device.refresh_token",
  deviceId: "device.id",
  userId: "device.user_id",
} as const;
