//! iOS-only platform bridge. File dialogs, sharing and URL opening must run on
//! a blocking worker; UIKit dispatch and UI callbacks stay on the main thread.
use crate::domain::{Error, Result};
use serde::Deserialize;
use std::{
    ffi::{c_char, c_void, CStr, CString},
    path::{Path, PathBuf},
};

extern "C" {
    fn thingary_ios_init();
    fn thingary_ios_set_privacy_cover(enabled: i32);
    fn thingary_ios_pick(kind: *const c_char) -> *mut c_char;
    fn thingary_ios_share(path: *const c_char) -> *mut c_char;
    fn thingary_ios_open_url(url: *const c_char) -> *mut c_char;
    fn thingary_ios_render_pdf(html: *const c_char, path: *const c_char) -> *mut c_char;
    fn thingary_free(bytes: *mut c_void);
}

/// Call once from Tauri's setup callback, on the UIKit main thread.
pub fn init() {
    unsafe { thingary_ios_init() };
}
pub fn set_privacy_cover(enabled: bool) {
    unsafe { thingary_ios_set_privacy_cover(i32::from(enabled)) };
}

fn string(value: *mut c_char) -> Result<String> {
    if value.is_null() {
        return Err(Error::new("IOS_PLATFORM", "系统操作没有返回结果，请重试"));
    }
    let result = unsafe { CStr::from_ptr(value) }
        .to_string_lossy()
        .into_owned();
    unsafe { thingary_free(value.cast()) };
    Ok(result)
}

#[derive(Deserialize)]
struct NativeResult {
    status: String,
    path: Option<PathBuf>,
    message: Option<String>,
}

fn result(value: *mut c_char) -> Result<NativeResult> {
    let text = string(value)?;
    let value: NativeResult = serde_json::from_str(&text)
        .map_err(|_| Error::new("IOS_PLATFORM", "系统操作返回的结果无法识别"))?;
    if value.status == "error" {
        return Err(Error::new(
            "IOS_PLATFORM",
            value.message.as_deref().unwrap_or("系统操作未完成，请重试"),
        ));
    }
    Ok(value)
}

/// `backup` accepts .thingary and .thingary.age; `workbook` accepts .xlsx;
/// `key` accepts .txt; `image` is a single image fallback for desktop callers.
/// A selected file is an owned private temporary copy, not an arbitrary path
/// from the frontend or a security-scoped external reference.
pub fn pick(kind: &str) -> Result<Option<PathBuf>> {
    if !["backup", "workbook", "key", "image"].contains(&kind) {
        return Err(Error::new("PICKER", "不支持此文件选择类型"));
    }
    let kind = CString::new(kind).map_err(|_| Error::new("PICKER", "文件类型无效"))?;
    let result = result(unsafe { thingary_ios_pick(kind.as_ptr()) })?;
    match result.status.as_str() {
        "cancelled" => Ok(None),
        "selected" => result
            .path
            .map(Some)
            .ok_or_else(|| Error::new("PICKER", "文件选择结果缺少路径")),
        _ => Err(Error::new("PICKER", "文件选择结果无法识别")),
    }
}

/// The caller must first canonicalize and validate a regular file inside App
/// Documents. Returns true on completed sharing, false on explicit cancellation.
/// Cancellation never deletes the local export.
pub fn share(path: &Path) -> Result<bool> {
    let path = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| Error::new("SHARE", "分享文件路径无效"))?;
    let result = result(unsafe { thingary_ios_share(path.as_ptr()) })?;
    match result.status.as_str() {
        "completed" => Ok(true),
        "cancelled" => Ok(false),
        _ => Err(Error::new("SHARE", "分享操作结果无法识别")),
    }
}

pub fn render_pdf(html: &str, path: &Path) -> Result<()> {
    let html = CString::new(html).map_err(|_| Error::new("EXPORT_PDF", "报告包含无效字符"))?;
    let path = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| Error::new("EXPORT_PDF", "报告路径无效"))?;
    let value = result(unsafe { thingary_ios_render_pdf(html.as_ptr(), path.as_ptr()) })?;
    if value.status == "completed" {
        Ok(())
    } else {
        Err(Error::new("EXPORT_PDF", "PDF 未生成，请重试"))
    }
}

/// Accepts only fixed help destinations or iOS's own application-settings URL.
/// No caller-provided URL or arbitrary scheme may cross this boundary.
pub fn open_url(url: &str) -> Result<()> {
    let allowed = url == "app-settings:"
        || [
            "author", "project", "guide", "site", "feedback", "backup", "sources", "mail",
        ]
        .iter()
        .any(|target| crate::support::destination(target).is_ok_and(|value| value == url));
    if !allowed {
        return Err(Error::new("OPEN", "不支持此链接"));
    }
    let url = CString::new(url).map_err(|_| Error::new("OPEN", "链接无效"))?;
    let message = string(unsafe { thingary_ios_open_url(url.as_ptr()) })?;
    if message.is_empty() {
        Ok(())
    } else {
        Err(Error::new("OPEN", &message))
    }
}
