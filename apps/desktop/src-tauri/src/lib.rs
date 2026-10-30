//! غلاف Tauri لتطبيق الحاسوب: النافذة الأصلية حول شاشات الويب المضمّنة (docs/desktop-plan.md §١).
//! طبقة المنصة (الطباعة، مخزن المفاتيح، الملفات، الإشعارات، التحديث) تُضاف هنا مرحلةً مرحلة (ط٣–ط٦).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // الروابط الخارجية (الشروط، الباقات، صفحة الحالة) تفتح في المتصفح الافتراضي لا داخل التطبيق
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("تعذّر تشغيل تطبيق فيزانو بلص");
}
