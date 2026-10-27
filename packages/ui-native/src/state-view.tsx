import { states, type StateCode } from "@sting/design";
import {
  CircleCheck,
  CircleX,
  Clock,
  CloudUpload,
  GitMerge,
  HardDrive,
  Inbox,
  Info,
  LoaderCircle,
  Lock,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText } from "./text";
import { RADIUS, SPACE, useColors } from "./theme";

/** أيقونة كل حالة — كأيقونات `C-NOTICE` في الويب (Inbox/XCircle/AlertTriangle/Info/WifiOff/Lock). */
const STATE_ICON: Readonly<Record<StateCode, LucideIcon>> = {
  ready: Info,
  loading: LoaderCircle,
  empty: Inbox,
  validation_error: CircleX,
  permission_denied: ShieldAlert,
  offline: WifiOff,
  stale: TriangleAlert,
  saving: LoaderCircle,
  saved_local: HardDrive,
  pending_sync: CloudUpload,
  synced: CircleCheck,
  conflict: GitMerge,
  server_error: CircleX,
  expired: Clock,
  partial: TriangleAlert,
  success: CircleCheck,
  phase_locked: Lock,
};

/**
 * C-NOTICE للجوال: إحدى الحالات الـ17 بألوانها (خلفية/نص/حدّ من الرموز) — العنوان والنص من الشاشة
 * (نصوص الويب حرفياً عبر `tx`)، والشارة من `@sting/design`. لون الحالة على الإشعار وحده لا على البطاقة.
 * أيقونة الحالة قبل العنوان كما في الويب (§٢٠٤) — بلا دائرة ولا مربع مصبوغ، والعنوان يبقى هو الكلمة.
 */
export function StateView({
  state,
  title,
  children,
}: {
  state: StateCode;
  title: string;
  children?: ReactNode;
}) {
  const c = useColors();
  const tone = c.state[state];
  const Icon = STATE_ICON[state];
  return (
    <View
      accessibilityRole="alert"
      // كـ`Notice` في الويب: العنوان والنص وحدهما مرئيّان، واسم الحالة لقارئ الشاشة
      accessibilityLabel={`${states[state].label} — ${title}`}
      style={{
        backgroundColor: tone.bg,
        borderColor: tone.border,
        borderWidth: 1,
        borderRadius: RADIUS.card,
        padding: SPACE["4"],
        gap: SPACE["2"],
        marginBottom: SPACE["4"],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE["2"] }}>
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icon size={20} color={tone.fg} />
        </View>
        <AppText variant="bodyStrong" style={{ color: tone.fg, flexShrink: 1 }}>
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}
