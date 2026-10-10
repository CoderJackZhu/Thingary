use crate::domain::{Error, Result};
use std::ffi::{c_char, c_void, CStr};
extern "C" {
    fn thingary_preview(
        bytes: *const u8,
        count: usize,
        output: *mut *mut u8,
        length: *mut usize,
    ) -> i32;
    fn thingary_pick_image() -> *mut c_char;
    fn thingary_pick_save(
        title: *const c_char,
        prompt: *const c_char,
        suggested: *const c_char,
        extension: *const c_char,
    ) -> *mut c_char;
    fn thingary_pick_backup_open() -> *mut c_char;
    fn thingary_pick_spreadsheet_open() -> *mut c_char;
    fn thingary_pick_folder() -> *mut c_char;
    fn thingary_free(bytes: *mut c_void);
}
pub fn preview(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() > crate::files::MAX_IMAGE_BYTES {
        return Err(Error::new("IMAGE_SIZE", "图片不能超过 20 MiB"));
    }
    let mut output = std::ptr::null_mut();
    let mut length = 0;
    // The bridge borrows input for this call and returns one malloc allocation on success.
    let code = unsafe { thingary_preview(bytes.as_ptr(), bytes.len(), &mut output, &mut length) };
    if code != 0 {
        return Err(match code {
            1 => Error::new("IMAGE_FORMAT", "请选择 JPEG、PNG、WebP 或 HEIC 图片"),
            2 => Error::new(
                "IMAGE_DIMENSIONS",
                "图片最长边限 12000 像素，总像素限 4000 万",
            ),
            _ => Error::new("IMAGE_CORRUPT", "图片无法完整读取，请重新选择原图"),
        });
    }
    if output.is_null() {
        return Err(Error::new("IMAGE_CORRUPT", "图片预览生成失败"));
    }
    let result = unsafe { std::slice::from_raw_parts(output, length).to_vec() };
    unsafe { thingary_free(output.cast()) };
    Ok(result)
}
fn take_path(value: *mut c_char) -> Option<std::path::PathBuf> {
    if value.is_null() {
        return None;
    }
    use std::os::unix::ffi::OsStrExt;
    let path = std::path::PathBuf::from(std::ffi::OsStr::from_bytes(unsafe {
        CStr::from_ptr(value).to_bytes()
    }));
    unsafe { thingary_free(value.cast()) };
    Some(path)
}

/// Caller must dispatch to the AppKit main thread.
pub(crate) fn pick() -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_image() })
}
/// Caller must dispatch to the AppKit main thread.
pub(crate) fn pick_save(
    title: &str,
    prompt: &str,
    suggested: &str,
    extension: &str,
) -> Option<std::path::PathBuf> {
    let c = |v: &str| std::ffi::CString::new(v).ok();
    let (t, p, n, e) = (c(title)?, c(prompt)?, c(suggested)?, c(extension)?);
    take_path(unsafe { thingary_pick_save(t.as_ptr(), p.as_ptr(), n.as_ptr(), e.as_ptr()) })
}
/// Caller must dispatch to the AppKit main thread.
pub(crate) fn pick_backup_open() -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_backup_open() })
}
/// Caller must dispatch to the AppKit main thread.
pub(crate) fn pick_spreadsheet_open() -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_spreadsheet_open() })
}
/// Caller must dispatch to the AppKit main thread.
pub(crate) fn pick_folder() -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_folder() })
}
