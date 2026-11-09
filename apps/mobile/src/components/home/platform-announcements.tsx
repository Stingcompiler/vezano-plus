import { dayMonth, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import { AppText, Button, Card, SPACE } from "@sting/ui-native";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";

import { openHref } from "@/lib/home";
import { useSession } from "@/lib/session";

/**
 * شريط إعلانات المنصة في رئيسية الجوال (0005 §٢٣٤) — نظير شريط الويب: ما أرسلته المنصة إلى هذا
 * المتجر ولم تنتهِ نافذته، بزرّه إن وُجد. «إخفاء» لجلسة التطبيق، والإعلان يبقى في صندوق الوارد.
 * الإشعار الفوري الأصلي ينتظر وحدة `expo-notifications` في بناء قادم (NAT-03).
 */
interface Ann {
  id: string;
  kind_label: string;
  title: string;
  body: string;
  starts_at: string;
  ends_at: string;
  active: boolean;
  cta_label: string;
  cta_url: string;
}

const K = "shared:features/home/platform-announcements.tsx";
const hidden = new Set<string>();

const when = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return `${day} ${month} ${hhmm(iso)}`;
};

export function PlatformAnnouncements({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { api } = useSession();
  const [rows, setRows] = useState<Ann[]>([]);
  const [, bump] = useState(0);

  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const { data, response } = await api.GET("/api/org/announcements");
        const b = data as unknown as { announcements: Ann[] } | undefined;
        if (!gone && response.ok && b) setRows(b.announcements);
      } catch {
        // بلا اتصال: لا شريط، والرئيسية تعمل كما هي
      }
    })();
    return () => {
      gone = true;
    };
  }, [api]);

  const shown = rows.filter((a) => !hidden.has(a.id));
  if (!shown.length) return null;
  return (
    <View accessibilityLabel={tx(K, "إعلانات المنصة")} style={{ gap: SPACE["2"] }}>
      {shown.map((a) => (
        <Card key={a.id} title={`${a.kind_label} — ${a.title}`} lead={a.body}>
          <AppText variant="note">
            {a.active
              ? `${tx(K, "سارٍ حتى")} ${when(a.ends_at)}`
              : `${tx(K, "من")} ${when(a.starts_at)} ${tx(K, "إلى")} ${when(a.ends_at)}`}
          </AppText>
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: SPACE["2"] }}>
            {a.cta_url ? (
              <Button
                variant="secondary"
                label={a.cta_label}
                onPress={() =>
                  a.cta_url.startsWith("/")
                    ? openHref(a.cta_url, onNavigate)
                    : void Linking.openURL(a.cta_url)
                }
              />
            ) : null}
            <Button
              variant="quiet"
              label={tx(K, "إخفاء")}
              onPress={() => {
                hidden.add(a.id);
                bump((n) => n + 1);
              }}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}
