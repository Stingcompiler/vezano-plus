import { NAV_GROUPS, NAV_ITEMS } from "@sting/app-core";
import { mtx } from "@sting/texts";
import { GroupedList, ListRow, Screen } from "@sting/ui-native";
import { useRouter } from "expo-router";

import { openHref } from "@/lib/home";

/**
 * «المزيد»: كل بنود تنقّل الويب بمجموعاتها نفسها (من `@sting/app-core`) — لا شاشة في الويب تغيب عن
 * الجوال. المبني يُفتح داخل التطبيق، وما لم يُبنَ بعد يفتح على الويب.
 */
export default function More() {
  const router = useRouter();
  const groups = Object.values(NAV_GROUPS);
  return (
    <Screen screenId="MOB-MORE" state="ready" title={mtx("more")}>
      {groups.map((g) => {
        const items = NAV_ITEMS.filter((i) => i.group === g);
        return (
          <GroupedList key={g} title={g}>
            {items.map((i, n) => (
              <ListRow
                key={i.id}
                title={i.label}
                last={n === items.length - 1}
                // المبني على الهاتف يُفتح داخله (المزامنة…)، وما سواه على الويب
                onPress={() => openHref(i.href, (p) => router.push(p))}
              />
            ))}
          </GroupedList>
        );
      })}
    </Screen>
  );
}
