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
