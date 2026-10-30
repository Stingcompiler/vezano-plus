// لا نافذة طرفية خلف التطبيق في ويندوز (إصدار الإنتاج)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vezano_desktop_lib::run()
}
