import { AppText, RADIUS, Sheet, SPACE, TextField, TOUCH, useColors } from "@sting/ui-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

export interface Option {
  readonly value: string;
  readonly label: string;
}

/**
 * نظير `SelectField` في الويب: تسمية ظاهرة وحقل لمس ≥ 52 يفتح ورقة سفلية بالخيارات (المنسدلة
 * لا تناسب الإبهام، قاعدة الجوال). فوق 12 خياراً تُضاف خانة بحث داخل الورقة.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  error,
  hint,
  searchLabel,
  disabledReason,
  emptyLabel = "—",
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  searchLabel?: string;
  disabledReason?: string | undefined;
  emptyLabel?: string;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const shown = q.trim() ? options.filter((o) => o.label.includes(q.trim())) : options;
  const disabled = Boolean(disabledReason);
  return (
    <View style={{ gap: SPACE["1"], marginBottom: SPACE["3"] }}>
      <AppText variant="bodyStrong" importantForAccessibility="no">
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          minHeight: TOUCH.row,
          justifyContent: "center",
          paddingHorizontal: SPACE["3"],
          borderWidth: 1,
          borderColor: error ? c.danger : c.border,
          borderRadius: RADIUS.button,
          backgroundColor: c.surfaceCard,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <AppText>{current?.label || emptyLabel}</AppText>
      </Pressable>
      {error ? (
        <AppText variant="note" style={{ color: c.danger }}>
          {error}
        </AppText>
      ) : disabledReason ? (
        <AppText variant="note" muted>
          {disabledReason}
        </AppText>
      ) : hint ? (
        <AppText variant="note" muted>
          {hint}
        </AppText>
      ) : null}
      <Sheet
        open={open}
        title={label}
        onClose={() => {
          setOpen(false);
          setQ("");
        }}
      >
        {options.length > 12 && searchLabel ? (
          <TextField label={searchLabel} value={q} onChangeText={setQ} />
        ) : null}
        {shown.map((o, i) => (
          <Pressable
            key={o.value || `empty-${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: o.value === value }}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
              setQ("");
            }}
            style={{
              minHeight: TOUCH.row,
              justifyContent: "center",
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
            }}
          >
            <AppText style={{ color: o.value === value ? c.brandStrong : c.inkStrong }}>
              {o.label || emptyLabel}
            </AppText>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}
