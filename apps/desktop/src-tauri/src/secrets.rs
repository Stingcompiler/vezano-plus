//! مخزن مفاتيح النظام (ARCHITECTURE §المصادقة: «مخزن نظام للديسكتوب»): Keychain في ماك وCredential
//! Manager في ويندوز. يحلّ محلّ Cookie `HttpOnly` الذي يحفظ فيه الويب رمز التجديد — أصل التطبيق المحلي
//! لا يحمل Cookies الخادم. الأسماء محصورة في قائمة، فلا تقرأ الواجهة أي سرّ آخر في المخزن.

const SERVICE: &str = "app.vezano.plus";
const ALLOWED: &[&str] = &["refresh"];

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if !ALLOWED.contains(&key) {
        return Err("مفتاح غير مسموح".into());
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_keys_are_reachable() {
        assert!(entry("refresh").is_ok());
        assert!(entry("anything-else").is_err());
    }
}
