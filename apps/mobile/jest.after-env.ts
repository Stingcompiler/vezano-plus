import { configure } from "@testing-library/react-native";

// الإقلاع البارد لأول اختبار في الملف أبطأ من المهلة الافتراضية (ثانية) — مصدر الإخفاق العابر المعروف
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(20_000);
