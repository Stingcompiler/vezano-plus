import { FONT, ROW_RTL, SPACE, useColors, ThemedText as Text } from "@sting/ui-native";
import { Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import icon from "../../assets/images/icon.png";

/**
 * ترويسة العلامة كما في الويب (`PublicHeader` / رأس `AppNav`): الشعار ثم «فيزانو بلص» بخط العلامة،
 * على سطح أبيض بخط سفلي. تُرسم فوق الشاشات بلا رأس تنقّل، وتتكفّل بمسافة شريط الحالة.
 */
export function BrandBar() {
  const c = useColors();
  const insets = useSafeAreaInsets();
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
    </View>
  );
}
