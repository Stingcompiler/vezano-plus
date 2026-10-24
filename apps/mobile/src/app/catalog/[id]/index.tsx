import { useLocalSearchParams } from "expo-router";

import { ItemPage } from "@/features/catalog/item-page";

/** `/catalog/:id` — CAT-02 بطاقة صنف قائم (تعديل بالنموذج نفسه). */
export default function ItemCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ItemPage itemId={id} />;
}
