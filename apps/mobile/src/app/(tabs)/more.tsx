import { NAV_GROUPS, NAV_ITEMS } from "@sting/app-core";
import { mtx } from "@sting/texts";
import { GroupedList, ListRow, Screen, useColors } from "@sting/ui-native";
import { useRouter } from "expo-router";

import { LogoutButton } from "@/components/logout-button";
import { openHref } from "@/lib/home";
import { NAV_GROUP_ICONS, NAV_ITEM_ICONS } from "@/lib/nav-icons";

/**
 * «المزيد»: كل بنود تنقّل الويب بمجموعاتها نفسها (من `@sting/app-core`) — لا شاشة في الويب تغيب عن
 * الجوال. المبني يُفتح داخل التطبيق، وما لم يُبنَ بعد يفتح على الويب. أيقونة قبل كل مجموعة وبند
 * تسرّع المسح بالعين، والتسمية باقية (§٢٠٤).
 */
export default function More() {
  const router = useRouter();
  const c = useColors();
  const groups = Object.values(NAV_GROUPS);
  return (
    <Screen screenId="MOB-MORE" state="ready" title={mtx("more")}>
      {groups.map((g) => {
        const items = NAV_ITEMS.filter((i) => i.group === g);
        const GroupIcon = NAV_GROUP_ICONS[g];
        return (
          <GroupedList
            key={g}
            title={g}
            icon={GroupIcon ? <GroupIcon size={18} color={c.inkStrong} /> : undefined}
          >
            {items.map((i, n) => {
              const Icon = NAV_ITEM_ICONS[i.id];
              return (
                <ListRow
                  key={i.id}
                  title={i.label}
                  leading={Icon ? <Icon size={20} color={c.brandPrimary} /> : undefined}
                  last={n === items.length - 1}
                  // المبني على الهاتف يُفتح داخله (المزامنة…)، وما سواه على الويب
                  onPress={() => openHref(i.href, (p) => router.push(p))}
                />
              );
            })}
          </GroupedList>
        );
      })}
      {/* كأسفل قائمة الويب: الخروج بعد كل البنود */}
      <LogoutButton />
    </Screen>
  );
}
