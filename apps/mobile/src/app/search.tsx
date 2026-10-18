import { countPending, hhmm } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  AppText,
  FONT,
  GroupedList,
  ListRow,
  RADIUS,
  Screen,
  SPACE,
  StateView,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import {
  openHref,
  readHomeCache,
  SEARCH_KIND_COUNT,
  searchLocal,
  type SearchResponse,
} from "@/lib/home";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "HOME-03";

function N({ children }: { children: string | number }) {
  return <Text style={{ fontFamily: FONT.mono, writingDirection: "ltr" }}>{String(children)}</Text>;
}

/**
 * HOME-03 — البحث العام (خطة الجوال M1؛ 0005 §١٧٥): حقل بحث أعلى الشاشة، والنتائج مجمّعة بأنواعها
 * وترتيبها الثابت كالويب؛ المحجوب داخل المنشأة عدداً بلا محتوى؛ بلا اتصال بحث محلي على ما خُزّن على
 * الجهاز مع آخر مزامنة والمعلّق. (مسح الباركود داخل الحقل يأتي مع NAT-01.)
 */
export default function Search() {
  const router = useRouter();
  const { api } = useSession();
  const c = useColors();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      setPending(await countPending(storage).catch(() => 0));
      setLastSync((await readHomeCache(storage))?.savedAt ?? null);
    })();
  }, []);

  const run = useCallback(
    async (query: string) => {
      const mine = ++seq.current;
      if (!query.trim()) {
        setResult(null);
        return;
      }
      setSearching(true);
      const storage = await getStorage();
      try {
        const { data } = await api.GET("/api/search", { params: { query: { q: query } } });
        if (mine === seq.current && data) {
          setResult(data as unknown as SearchResponse);
          setOffline(false);
        }
      } catch {
        // لا ردّ من الخادم: بحث محلي على ما خُزّن على الجهاز
        if (mine === seq.current) {
          setOffline(true);
          setResult(await searchLocal(storage, query));
        }
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    },
    [api],
  );

  useEffect(() => {
    const t = setTimeout(() => void run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  const restricted = result?.restricted.reduce((n, r) => n + r.count, 0) ?? 0;
  const state = offline
    ? "offline"
    : searching
      ? "loading"
      : result && result.total === 0 && q.trim()
        ? restricted > 0
          ? "permission_denied"
          : "empty"
        : result && restricted > 0
          ? "permission_denied"
          : "ready";

  return (
    <Screen
      screenId={T}
      state={state}
      title={q.trim() ? `${tx(T, "نتائج «")}${q.trim()}»` : tx(T, "بحث")}
    >
      <TextInput
        accessibilityLabel={tx(T, "بحث")}
        value={q}
        onChangeText={setQ}
        placeholder={tx(T, "الأصناف والأطراف والمستندات")}
        placeholderTextColor={c.inkFaint}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        style={{
          minHeight: TOUCH.row,
          borderRadius: RADIUS.button,
          backgroundColor: c.surfaceCard,
          borderWidth: 1,
          borderColor: c.border,
          paddingHorizontal: SPACE["3"],
          fontFamily: FONT.regular,
          fontSize: 17,
          color: c.inkStrong,
          textAlign: "right",
          writingDirection: "rtl",
          marginBottom: SPACE["2"],
        }}
      />
      <View style={{ marginBottom: SPACE["4"] }}>
        {state === "loading" ? (
          <AppText variant="note" muted>
            {tx(T, "نبحث في")} <N>{SEARCH_KIND_COUNT}</N> {tx(T, "أنواع")}
          </AppText>
        ) : result && result.total > 0 ? (
          <AppText variant="note" muted>
            <N>{result.total}</N> {tx(T, "نتائج في")} <N>{result.kinds_with_results}</N>{" "}
            {tx(T, "أنواع ·")} <N>{(result.elapsed_ms / 1000).toFixed(1)}</N> {tx(T, "ث")}
          </AppText>
        ) : null}
        {offline ? (
          <AppText variant="note" muted>
            {tx(T, "محلي")} · {tx(T, "آخر مزامنة")} <N>{lastSync ? hhmm(lastSync) : "—"}</N>{" "}
            {tx(T, "· لم يُزامَن من جهازك")} <N>{pending}</N>
          </AppText>
        ) : null}
      </View>

      {state === "empty" && result ? (
        <StateView state="empty" title={tx(T, "لا نتائج")}>
          <AppText variant="secondary">
            {tx(T, "بحثٌ عن «")}
            {result.query}
            {tx(T, "» بلا تطابق.")}
          </AppText>
        </StateView>
      ) : null}

      {result && restricted > 0 ? (
        <StateView state="permission_denied" title={tx(T, "نتائج خارج صلاحيتك")}>
          {result.restricted.map((r) => (
            <AppText key={r.kind_label} variant="secondary">
              <N>{r.count}</N> {tx(T, "في")} {r.kind_label} {tx(T, "خارج صلاحيتك")}
            </AppText>
          ))}
        </StateView>
      ) : null}

      {result && result.total > 0
        ? result.groups
            .filter((g) => g.results.length > 0)
            .map((g) => (
              <GroupedList key={g.kind} title={g.label}>
                {g.results.map((r, i) => (
                  <ListRow
                    key={r.id}
                    title={r.title}
                    subtitle={r.meta || undefined}
                    trailing={
                      r.tag ? (
                        <AppText variant="note" muted>
                          {r.tag}
                        </AppText>
                      ) : undefined
                    }
                    onPress={r.href ? () => openHref(r.href, (p) => router.push(p)) : undefined}
                    last={i === g.results.length - 1}
                  />
                ))}
              </GroupedList>
            ))
        : null}
    </Screen>
  );
}
