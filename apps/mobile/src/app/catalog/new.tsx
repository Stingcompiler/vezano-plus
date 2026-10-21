import { useLocalSearchParams } from "expo-router";

import { ItemPage } from "@/features/catalog/item-page";

/** `/catalog/new` — CAT-02 إنشاء صنف؛ `?name=` يملأ الاسم من «أنشئ صنفاً بهذا الاسم». */
export default function NewItem() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  return <ItemPage initialName={typeof name === "string" ? name : undefined} />;
}
