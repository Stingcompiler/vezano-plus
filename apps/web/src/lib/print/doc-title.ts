/**
 * اسم المستند المطبوع (عنوان حوار الطباعة واسم ملف PDF): النوع والرقم واسم المنشأة — لا عنوان الصفحة
 * ولا رابطها. يُعطى لـ`PrintDoc` في كل شاشة تطبع.
 */
export function docTitle(kind: string, number?: string | null, shop?: string | null): string {
  return [number ? `${kind} ${number}` : kind, shop || null].filter(Boolean).join(" — ");
}
