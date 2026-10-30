//! غلاف Tauri لتطبيق الحاسوب: النافذة الأصلية حول شاشات الويب المضمّنة (docs/desktop-plan.md §١).
//! طبقة المنصة: مخزن المفاتيح (ط٣)، وطابعات النظام وحفظ الملفات والإشعارات (ط٤)، ثم الطباعة والتحديث.

mod menu;
mod native;
mod rawprint;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // ماك: قائمة عربية بالتفضيلات والتحرير؛ ويندوز: نافذة بلا شريط قوائم
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.enable_macos_default_menu(false);
    // التحديث التلقائي (DESK-01، ط٦): يُفعَّل حين يُبنى التطبيق بمفتاح التحقق العام
    // (VEZANO_UPDATER_PUBKEY من أسرار CI). بلا مفتاح لا يُسجَّل المحدِّث، فلا يُعلَن تحديث لا يمكن التحقق من توقيعه.
    let builder = builder.plugin(tauri_plugin_process::init());
    let builder = match option_env!("VEZANO_UPDATER_PUBKEY") {
        Some(key) if !key.is_empty() => {
            builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key).build())
        }
        _ => builder,
    };
    builder
        // الروابط الخارجية (الشروط، الباقات، صفحة الحالة) تفتح في المتصفح الافتراضي لا داخل التطبيق
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            native::list_printers,
            native::save_bytes,
            rawprint::print_raw,
            rawprint::print_network
        ])
        .run(tauri::generate_context!())
        .expect("تعذّر تشغيل تطبيق فيزانو بلص");
}
