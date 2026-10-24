import type { StoredOperation } from "@sting/platform";
import { Share } from "react-native";

import { getStorage } from "@/lib/storage";

/**
 * «صدّر نسخة محلية» على الهاتف (SYS-05/ACC-08؛ يعمل بلا اتصال): JSON بكل العمليات المحلية غير المؤكدة،
 * يُسلَّم إلى ورقة المشاركة الأصلية (حفظ في الملفات، واتساب، بريد) بدل تنزيل المتصفح. الصيغة صيغة الويب نفسها.
 */
export interface LocalBackup {
  readonly format: "sting-local-backup";
  readonly version: 1;
  readonly exported_at: string;
  readonly operations: readonly StoredOperation[];
}

export async function buildLocalBackup(): Promise<LocalBackup> {
  const storage = await getStorage();
  const operations = await storage.read(async (tx) => [
    ...(await tx.listOperationsByState("local")),
    ...(await tx.listOperationsByState("pending")),
    ...(await tx.listOperationsByState("conflict")),
  ]);
  return {
    format: "sting-local-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    operations,
  };
}

/** يعيد عدد العمليات المصدَّرة. */
export async function shareLocalBackup(): Promise<number> {
  const backup = await buildLocalBackup();
  await Share.share({
    title: `sting-backup-${backup.exported_at.replace(/[:.]/g, "-")}.json`,
    message: JSON.stringify(backup, null, 2),
  });
  return backup.operations.length;
}
