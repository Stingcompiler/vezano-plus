import { MemoryStorage } from "@sting/platform/memory";
import { tx } from "@sting/texts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Appearance } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BrandBar } from "@/components/brand-bar";
import { setStorageForTests } from "@/lib/storage";
import { restoreTheme } from "@/lib/theme";

/** زرّ المظهر ☾/☀ في ترويسة العلامة كالويب، والاختيار محفوظ على الجهاز (0005 §٢٠١). */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const K = "shared:features/home/theme-toggle.tsx";

describe("زرّ المظهر", () => {
  let storage: MemoryStorage;
  let set: jest.SpyInstance;
  beforeEach(() => {
    storage = new MemoryStorage();
    setStorageForTests(storage);
    set = jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => undefined);
  });
  afterEach(() => set.mockRestore());

  it("في الفاتح يعرض «المظهر الداكن» ويقلب إلى الداكن ويحفظه", async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <BrandBar />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: tx(K, "المظهر الداكن") }));
    expect(set).toHaveBeenCalledWith("dark");
    await waitFor(async () =>
      expect(await storage.read((t) => t.getMeta("ui.theme"))).toBe("dark"),
    );
  });

  it("عند البدء يُطبَّق المحفوظ", async () => {
    await storage.transaction((t) => t.putMeta("ui.theme", "dark"));
    await restoreTheme();
    expect(set).toHaveBeenCalledWith("dark");
  });
});
