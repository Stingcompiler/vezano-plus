import { useLocalSearchParams } from "expo-router";

import PriceListsScreen from "@/features/market-seller/lists";

/** قائمة خاصة جديدة على عرض (`?offer=`). */
export default function MarketListNew() {
  const { offer = "" } = useLocalSearchParams<{ offer?: string }>();
  return <PriceListsScreen offerId={offer} />;
}
