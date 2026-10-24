import { AppText, ThemedText } from "@sting/ui-native";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

/**
 * `Text` الخام بلا لون يُرسم أسود فيختفي في الوضع الداكن (رقم الدرج في فتح الوردية — 0005 §١٩٨).
 * القائم وحده يأخذ لون السمة، والمتداخل في نصّ يرث لون أبيه.
 */
describe("ThemedText", () => {
  it("القائم وحده يأخذ لوناً من السمة، والمتداخل لا يفرض لوناً", async () => {
    await render(
      <>
        <ThemedText testID="alone">80</ThemedText>
        <AppText muted>
          قبل <ThemedText testID="nested">12</ThemedText>
        </AppText>
      </>,
    );
    const alone = StyleSheet.flatten(screen.getByTestId("alone").props.style) as { color?: string };
    const nested = StyleSheet.flatten(screen.getByTestId("nested").props.style) as {
      color?: string;
    };
    expect(alone.color).toBeTruthy();
    expect(nested.color).toBeUndefined();
  });
});
