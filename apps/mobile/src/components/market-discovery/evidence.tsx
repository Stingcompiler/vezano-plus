import { mtx } from "@sting/texts";
import { AppText, Button, Sheet, SPACE, StateView } from "@sting/ui-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";

import { MD_TEXTS } from "@/features/market-discovery/texts";

export interface Evidence {
  readonly name: string;
  readonly dataUrl: string;
  /** حجم تقريبي بالبايت من طول base64 */
  readonly size: number;
}

/**
 * التقاط دليل البلاغ بالكاميرا (خطة الجوال: «الصور من الكاميرا») — بديل رفع الملف في الويب. صورة JPEG
 * مضغوطة تُرسل data-URL كما يفعل الويب؛ الإذن يُطلب عند أول استعمال ورفضه لا يعطّل غير الدليل.
 */
export function EvidenceCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (e: Evidence) => void;
}) {
  const [permission, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  const shoot = async () => {
    if (busy || !cam.current) return;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ base64: true, quality: 0.5 });
      if (pic?.base64) {
        onCapture({
          name: "evidence.jpg",
          dataUrl: `data:image/jpeg;base64,${pic.base64}`,
          size: Math.floor((pic.base64.length * 3) / 4),
        });
        onClose();
      }
    } catch {
      /* لا التقاط: يبقى الدليل غائباً ويظهر خطأ التحقق عند الإرسال */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title={MD_TEXTS.shootTitle} onClose={onClose}>
      {!permission ? null : !permission.granted ? (
        <StateView state="permission_denied" title={mtx("scanPermissionTitle")}>
          <AppText variant="secondary">
            {permission.canAskAgain ? mtx("scanPermissionBody") : mtx("scanDeniedBody")}
          </AppText>
          {permission.canAskAgain ? (
            <Button label={mtx("scanAllow")} onPress={() => void request()} />
          ) : (
            <Button label={mtx("scanOpenSettings")} onPress={() => void Linking.openSettings()} />
          )}
        </StateView>
      ) : (
        <View style={{ gap: SPACE["3"] }}>
          <View style={{ height: 320, borderRadius: 12, overflow: "hidden" }}>
            <CameraView ref={cam} style={{ flex: 1 }} facing="back" />
          </View>
          <Button label={MD_TEXTS.shutter} financial loading={busy} onPress={() => void shoot()} />
        </View>
      )}
      <Button label={mtx("scanClose")} variant="quiet" onPress={onClose} />
    </Sheet>
  );
}
