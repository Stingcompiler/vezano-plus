import { mtx, tx } from "@sting/texts";
import {
  FONT,
  RADIUS,
  ROW_RTL,
  SPACE,
  ThemedText as Text,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { ArrowRight, Moon, Sun } from "lucide-react-native";
import { Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeToggle } from "@/lib/theme";

import icon from "../../assets/images/icon.png";

/**
 * ترويسة العلامة كما في الويب (`PublicHeader` / رأس `AppNav`): الشعار ثم «فيزانو بلص» بخط العلامة،
 * على سطح أبيض بخط سفلي، و«→ عودة» قبلهما حين توجد شاشة سابقة، وزرّ المظهر ☾/☀ في النهاية. فوق كل شاشة، وتتكفّل بمسافة شريط الحالة.
 */
export function BrandBar({ onBack }: { onBack?: (() => void) | undefined } = {}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { theme, toggle } = useThemeToggle();
  const themeLabel =
    theme === "dark"
      ? tx("shared:features/home/theme-toggle.tsx", "المظهر الفاتح")
      : tx("shared:features/home/theme-toggle.tsx", "المظهر الداكن");
  return (
    <View
      style={{
        paddingTop: insets.top + SPACE["2"],
        paddingBottom: SPACE["2"],
        paddingHorizontal: SPACE["4"],
        backgroundColor: c.surfaceCard,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        flexDirection: ROW_RTL,
        alignItems: "center",
        gap: SPACE["2"],
      }}
    >
      {onBack ? (
        // كزرّ «→ عودة» في ترويسة الويب: محدود ومعنون، لا سهم وحده
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mtx("back")}
          onPress={onBack}
          hitSlop={4}
          style={({ pressed }) => ({
            minHeight: TOUCH.min,
            paddingHorizontal: SPACE["3"],
            borderRadius: RADIUS.button,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: pressed ? c.surfaceSunken : c.surfaceCard,
            flexDirection: ROW_RTL,
            alignItems: "center",
            gap: SPACE["1"],
          })}
        >
          <ArrowRight color={c.inkStrong} size={18} />
          <Text style={{ fontFamily: FONT.bold, fontSize: 15 }}>{mtx("back")}</Text>
        </Pressable>
      ) : null}
      <Image
        source={icon}
        accessibilityIgnoresInvertColors
        style={{ width: 36, height: 36, borderRadius: 9 }}
      />
      <Text
        accessibilityRole="header"
        style={{ fontFamily: FONT.wordmark, fontSize: 22, color: c.inkStrong }}
      >
        فيزانو <Text style={{ color: c.brandPrimary }}>بلص</Text>
      </Text>
      {/* زرّ المظهر كالويب (☾/☀) عند نهاية الترويسة */}
      <View style={{ flex: 1 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={themeLabel}
        onPress={toggle}
        style={({ pressed }) => ({
          width: TOUCH.min,
          height: TOUCH.min,
          borderRadius: RADIUS.button,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: pressed ? c.surfaceSunken : c.surfaceCard,
          alignItems: "center",
          justifyContent: "center",
        })}
      >
        {/* أيقونة لا رمز نصّي: «☀» يُرسم وجهاً تعبيرياً ملوّناً في iOS */}
        {theme === "dark" ? (
          <Sun color={c.inkStrong} size={20} />
        ) : (
          <Moon color={c.inkStrong} size={20} />
        )}
      </Pressable>
    </View>
  );
}
