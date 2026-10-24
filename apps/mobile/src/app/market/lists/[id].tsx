import { useLocalSearchParams } from "expo-router";

import PriceListsScreen from "@/features/market-seller/lists";

/** قائمة خاصة بعينها؛ غير أهلها يرى «الرابط لم يعد صالحاً». */
export default function MarketList() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  return <PriceListsScreen listId={id} />;
}
