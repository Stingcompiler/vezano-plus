//! قائمة ماك الأصلية (docs/desktop/plan.md §٤.١): قائمة التطبيق (حول، التفضيلات ⌘,، إخفاء، إنهاء ⌘Q)
//! وقائمة التحرير (النسخ واللصق والتراجع — بدونها لا تعمل اختصاراتها في حقول الكتابة على ماك).
//! ويندوز بلا شريط قوائم: الأوامر في التنقل الجانبي كما في الويب.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const NAVIGATE_EVENT: &str = "desk://navigate";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let prefs = MenuItem::with_id(app, "prefs", "التفضيلات…", true, Some("CmdOrCtrl+,"))?;
    let shortcuts = MenuItem::with_id(app, "shortcuts", "الاختصارات", true, None::<&str>)?;
    let app_menu = Submenu::with_items(
        app,
        "فيزانو بلص",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("حول فيزانو بلص"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &prefs,
            &shortcuts,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("إخفاء فيزانو بلص"))?,
            &PredefinedMenuItem::hide_others(app, Some("إخفاء الآخرين"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("إنهاء فيزانو بلص"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "تحرير",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("تراجع"))?,
            &PredefinedMenuItem::redo(app, Some("إعادة"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("قص"))?,
            &PredefinedMenuItem::copy(app, Some("نسخ"))?,
            &PredefinedMenuItem::paste(app, Some("لصق"))?,
            &PredefinedMenuItem::select_all(app, Some("تحديد الكل"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit])
}

/// عنصر القائمة ← مسار في التطبيق (يستقبله `platform/menu-events.ts`)
pub fn route_for(id: &str) -> Option<&'static str> {
    match id {
        "prefs" => Some("/desktop/setup"),
        "shortcuts" => Some("/desktop/shortcuts"),
        _ => None,
    }
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(route) = route_for(id) {
        let _ = app.emit(NAVIGATE_EVENT, route);
    }
}

#[cfg(test)]
mod tests {
    use super::route_for;

    #[test]
    fn menu_items_map_to_desktop_screens() {
        assert_eq!(route_for("prefs"), Some("/desktop/setup"));
        assert_eq!(route_for("shortcuts"), Some("/desktop/shortcuts"));
        assert_eq!(route_for("other"), None);
    }
}
