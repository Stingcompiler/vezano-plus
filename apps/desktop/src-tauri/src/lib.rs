//! غلاف Tauri لتطبيق الحاسوب: النافذة الأصلية حول شاشات الويب المضمّنة (docs/desktop-plan.md §١).
//! طبقة المنصة: مخزن المفاتيح (ط٣)، وطابعات النظام وحفظ الملفات والإشعارات (ط٤)، ثم الطباعة والتحديث.

mod native;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // الروابط الخارجية (الشروط، الباقات، صفحة الحالة) تفتح في المتصفح الافتراضي لا داخل التطبيق
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            native::list_printers,
            native::save_bytes
        ])
        .run(tauri::generate_context!())
        .expect("تعذّر تشغيل تطبيق فيزانو بلص");
}
