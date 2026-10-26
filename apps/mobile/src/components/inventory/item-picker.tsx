import { type LocalItem, itemMatches } from "@sting/sync-core";
import {
  AppText,
  Button,
  GroupedList,
  ListRow,
  Sheet,
  SPACE,
  TextField,
  TOUCH,
  useColors,
} from "@sting/ui-native";
import { mtx } from "@sting/texts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useBarcodeScan, matchBarcode } from "@/components/inventory/scan";
import { INV_TEXTS } from "@/features/inventory/texts";

/**
 * اختيار الصنف بورقة سفلية (بدل `<select>` الويب): بحث بالاسم/الباركود ومسح بالكاميرا. الصف كله هدف
 * لمس ≥ 52، والخطأ نصّ تحته كحقول C-FIELD.
 */
export function ItemPicker({
  label,
  items,
  value,
  onChange,
  error,
}: {
  label: string;
  items: readonly LocalItem[];
  value: string;
  onChange: (itemId: string, unitKey?: string) => void;
  error?: string | undefined;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState(false);
  const chosen = items.find((i) => i.id === value);
  const scan = useBarcodeScan((code) => {
    const hit = matchBarcode(items, code);
    if (!hit) return setMiss(true);
    setMiss(false);
    onChange(hit.item.id, hit.unitKey);
    setOpen(false);
  });
  const list = items.filter((i) => itemMatches(i, q)).slice(0, 60);
  return (
    <View style={{ gap: SPACE["1"], marginBottom: SPACE["3"] }}>
      <AppText variant="bodyStrong">{label}</AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={{
          minHeight: TOUCH.row,
          borderWidth: 1,
          borderColor: error ? c.danger : c.border,
          borderRadius: 12,
          backgroundColor: c.surfaceCard,
          justifyContent: "center",
          paddingHorizontal: SPACE["3"],
        }}
      >
        <AppText muted={!chosen}>{chosen ? chosen.name : "—"}</AppText>
      </Pressable>
      {error ? (
        <AppText variant="note" style={{ color: c.danger }}>
          {error}
        </AppText>
      ) : null}
      <Sheet open={open} title={label} onClose={() => setOpen(false)}>
        <TextField label={INV_TEXTS.searchHint} value={q} onChangeText={setQ} autoCorrect={false} />
        <Button
          label={mtx("scanTitle")}
          variant="secondary"
          onPress={() => {
            setOpen(false);
            scan.start();
          }}
        />
        {miss ? (
          <AppText variant="note" style={{ color: c.danger, marginTop: SPACE["2"] }}>
            {INV_TEXTS.noMatch}
          </AppText>
        ) : null}
        <View style={{ height: SPACE["3"] }} />
        <GroupedList>
          {list.map((i, idx) => (
            <ListRow
              key={i.id}
              title={i.name}
              last={idx === list.length - 1}
              onPress={() => {
                onChange(i.id);
                setOpen(false);
                setQ("");
              }}
            />
          ))}
        </GroupedList>
      </Sheet>
      {scan.element}
    </View>
  );
}
