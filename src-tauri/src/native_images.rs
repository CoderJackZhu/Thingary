use crate::domain::{Error, Result};
use std::ffi::{c_char, c_void, CStr};
extern "C" {
    fn possio_preview(
        bytes: *const u8,
        count: usize,
        output: *mut *mut u8,
        length: *mut usize,
    ) -> i32;
    fn possio_pick_image() -> *mut c_char;
    fn possio_free(bytes: *mut c_void);
}
pub fn preview(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() > crate::files::MAX_IMAGE_BYTES {
        return Err(Error::new("IMAGE_SIZE", "图片不能超过 20 MiB"));
    }
    let mut output = std::ptr::null_mut();
    let mut length = 0;
    // The bridge borrows input for this call and returns one malloc allocation on success.
    let code = unsafe { possio_preview(bytes.as_ptr(), bytes.len(), &mut output, &mut length) };
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
    unsafe { possio_free(output.cast()) };
    Ok(result)
}
/// Caller must dispatch to the AppKit main thread.
pub(crate) fn pick() -> Option<std::path::PathBuf> {
    let value = unsafe { possio_pick_image() };
    if value.is_null() {
        return None;
    }
    use std::os::unix::ffi::OsStrExt;
    let path = std::path::PathBuf::from(std::ffi::OsStr::from_bytes(unsafe {
        CStr::from_ptr(value).to_bytes()
    }));
    unsafe { possio_free(value.cast()) };
    Some(path)
}
