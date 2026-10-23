/**
 * وحدات أصلية لا تعمل في Jest: الاختبارات تحقن تخزيناً ذاكرياً (`setStorageForTests`) ومخزن أسرار
 * ذاكرياً (`setSecretsForTests`)، فتكفي هنا بدائل فارغة تمنع تحميل الوحدة الأصلية.
 */
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-print", () => ({
  printAsync: jest.fn(() => Promise.resolve()),
  printToFileAsync: jest.fn(() => Promise.resolve({ uri: "file:///r.pdf" })),
}));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));

// التشفير الأصلي (react-native-quick-crypto) — بديله في Jest يحيل إلى node:crypto (0005 §٢٠٠)
jest.mock(
  "react-native-quick-crypto",
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require("react-native-quick-crypto/jest") as Record<string, unknown>,
);
