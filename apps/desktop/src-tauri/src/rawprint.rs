//! الطباعة الحرارية الأصلية (DESK-02، docs/desktop/plan.md §٤.٢): بتّات ESC/POS خام تُرسل للطابعة
//! مباشرة بلا حوار — CUPS (`lp -o raw`) في ماك، وWinspool بنوع RAW في ويندوز، وTCP 9100 للطابعات
//! الشبكية. البتّات نفسها التي يبنيها الويب لطابعات البلوتوث (raster من lib/print/raster.ts).

use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// يطبع على طابعة يعرفها النظام باسمها.
#[tauri::command]
pub async fn print_raw(printer: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send_to_system(&printer, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// يطبع على طابعة شبكية بعنوانها (المنفذ 9100 ما لم يُذكر غيره).
#[tauri::command]
pub async fn print_network(address: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send_to_network(&address, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

pub fn send_to_network(address: &str, bytes: &[u8]) -> Result<(), String> {
    let with_port = if address.contains(':') {
        address.to_string()
    } else {
        format!("{address}:9100")
    };
    let addr: SocketAddr = with_port
        .parse()
        .map_err(|_| "عنوان غير صالح".to_string())?;
    let mut s =
        TcpStream::connect_timeout(&addr, Duration::from_secs(4)).map_err(|e| e.to_string())?;
    s.set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;
    s.write_all(bytes).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn send_to_system(printer: &str, bytes: &[u8]) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut child = Command::new("lp")
        .args(["-d", printer, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("stdin")?
        .write_all(bytes)
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(target_os = "windows")]
fn send_to_system(printer: &str, bytes: &[u8]) -> Result<(), String> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let name = wide(printer);
    let mut doc_name = wide("فيزانو بلص");
    let mut datatype = wide("RAW");
    let mut handle: HANDLE = std::ptr::null_mut();
    unsafe {
        if OpenPrinterW(name.as_ptr(), &mut handle, std::ptr::null()) == 0 {
            return Err("تعذّر فتح الطابعة".into());
        }
        let info = DOC_INFO_1W {
            pDocName: doc_name.as_mut_ptr(),
            pOutputFile: std::ptr::null_mut(),
            pDatatype: datatype.as_mut_ptr(),
        };
        let result = (|| {
            if StartDocPrinterW(handle, 1, &info) == 0 {
                return Err("تعذّر بدء المستند".to_string());
            }
            StartPagePrinter(handle);
            let mut written = 0u32;
            let ok = WritePrinter(
                handle,
                bytes.as_ptr().cast(),
                bytes.len() as u32,
                &mut written,
            );
            EndPagePrinter(handle);
            EndDocPrinter(handle);
            if ok == 0 || written as usize != bytes.len() {
                return Err("لم تُكتب البتّات كاملة".to_string());
            }
            Ok(())
        })();
        ClosePrinter(handle);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn network_print_sends_all_bytes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let reader = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            s.read_to_end(&mut buf).unwrap();
            buf
        });
        send_to_network(&addr.to_string(), &[0x1b, 0x40, 0x41]).unwrap();
        assert_eq!(reader.join().unwrap(), vec![0x1b, 0x40, 0x41]);
    }

    #[test]
    fn bad_address_is_rejected() {
        assert!(send_to_network("not an address", b"x").is_err());
    }
}
