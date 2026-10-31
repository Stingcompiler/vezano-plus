//! أوامر المنصة لشاشات DESK (docs/desktop/plan.md §٤): طابعات النظام (DESK-02) وكتابة ملف اختاره
//! المستخدم من حوار النظام (DESK-04). الخطأ يُصنَّف لتقول الشاشة السبب لا «تعذّر» وحدها.

use serde::Serialize;
use std::io::ErrorKind;
use std::process::Command;

#[derive(Serialize)]
pub struct Printer {
    pub name: String,
    pub default: bool,
}

/// طابعات النظام كما يعرفها: CUPS في ماك، وWin32_Printer في ويندوز. القائمة الفارغة تعني «بحثنا ولم نجد».
#[tauri::command]
pub fn list_printers() -> Result<Vec<Printer>, String> {
    #[cfg(target_os = "windows")]
    {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Printer | ForEach-Object { $_.Name + '|' + $_.Default }",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout);
        return Ok(text
            .lines()
            .filter_map(|l| {
                let (name, def) = l.trim().rsplit_once('|')?;
                Some(Printer {
                    name: name.to_string(),
                    default: def.eq_ignore_ascii_case("true"),
                })
            })
            .collect());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let names = Command::new("lpstat")
            .arg("-e")
            .output()
            .map_err(|e| e.to_string())?;
        let default = Command::new("lpstat").arg("-d").output().ok();
        let default_name = default
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .and_then(|s| s.rsplit_once(": ").map(|(_, n)| n.trim().to_string()))
            .unwrap_or_default();
        Ok(String::from_utf8_lossy(&names.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|n| Printer {
                name: n.to_string(),
                default: n == default_name,
            })
            .collect())
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveResult {
    Saved { path: String },
    NotWritable { reason: String },
    Failed { reason: String },
}

/// يكتب ما صدّرته الشاشة في المسار الذي اختاره المستخدم من حوار النظام نفسه (لا مسار من الواجهة وحدها).
#[tauri::command]
pub fn save_bytes(path: String, bytes: Vec<u8>) -> SaveResult {
    match std::fs::write(&path, bytes) {
        Ok(()) => SaveResult::Saved { path },
        Err(e) => match e.kind() {
            ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => {
                SaveResult::NotWritable {
                    reason: "permission".into(),
                }
            }
            ErrorKind::NotFound => SaveResult::NotWritable {
                reason: "missing".into(),
            },
            ErrorKind::StorageFull => SaveResult::Failed {
                reason: "full".into(),
            },
            _ => SaveResult::Failed {
                reason: e.to_string(),
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_reports_missing_folder_as_not_writable() {
        let r = save_bytes("/definitely/not/here/x.csv".into(), b"a".to_vec());
        assert!(matches!(r, SaveResult::NotWritable { .. }));
    }

    #[test]
    fn save_writes_file() {
        let p = std::env::temp_dir().join("vezano-save-test.csv");
        let r = save_bytes(p.to_string_lossy().into(), b"x,y".to_vec());
        assert!(matches!(r, SaveResult::Saved { .. }));
        assert_eq!(std::fs::read(&p).unwrap(), b"x,y");
    }
}
