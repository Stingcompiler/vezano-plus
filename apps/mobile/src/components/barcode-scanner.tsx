import { mtx } from "@sting/texts";
import { AppText, Button, Sheet, SPACE, StateView } from "@sting/ui-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { Linking, View } from "react-native";

/**
 * NAT-01 — الماسح (خطة الجوال M2؛ قرار المالك 2026-10-17). ورقة سفلية بكاميرا تقرأ الباركود وتسلّم النص
 * كاملاً إلى البحث (الذي يتحقق منه بعينه قبل الربط). الإذن يُطلب عند أول استعمال بسببه، ورفضه لا يعطّل
 * شيئاً: البحث بالاسم يعمل. تُقرأ قراءة واحدة ثم تُغلق (لا تكرار لقراءة باركود واحد).
 */
export function BarcodeScanner({
  open,
  onScan,
  onClose,
}: {
  open: boolean;
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const [permission, request] = useCameraPermissions();
  const done = useRef(false);
  return (
    <Sheet open={open} title={mtx("scanTitle")} onClose={onClose}>
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
          <View style={{ height: 280, borderRadius: 12, overflow: "hidden" }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"],
              }}
              onBarcodeScanned={({ data }) => {
                if (done.current) return;
                done.current = true;
                onScan(data);
                onClose();
                setTimeout(() => (done.current = false), 800);
              }}
            />
          </View>
          <AppText variant="note" muted>
            {mtx("scanHint")}
          </AppText>
        </View>
      )}
      <Button label={mtx("scanClose")} variant="quiet" onPress={onClose} />
    </Sheet>
  );
}
