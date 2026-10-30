//! غلاف Tauri لتطبيق الحاسوب: النافذة الأصلية حول شاشات الويب المضمّنة (docs/desktop-plan.md §١).
//! طبقة المنصة تُضاف مرحلةً مرحلة: مخزن المفاتيح هنا (ط٣)، ثم الطباعة والملفات والإشعارات والتحديث.

mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // الروابط الخارجية (الشروط، الباقات، صفحة الحالة) تفتح في المتصفح الافتراضي لا داخل التطبيق
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("تعذّر تشغيل تطبيق فيزانو بلص");
}
