use crate::domain::{Error, Result};
#[cfg(target_os = "macos")]
use std::ffi::{c_char, c_void, CStr};
#[cfg(target_os = "macos")]
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
#[cfg(target_os = "macos")]
pub fn preview(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() > crate::files::MAX_IMAGE_BYTES {
        return Err(Error::new("IMAGE_SIZE", "图片不能超过 20 MiB"));
    }
    let mut output = std::ptr::null_mut();
    let mut length = 0;
    // The bridge borrows input for this call and returns one malloc allocation on success.
    let code = unsafe { thingary_preview(bytes.as_ptr(), bytes.len(), &mut output, &mut length) };
    if code != 0 {
        return Err(preview_error(code, true));
    }
    if output.is_null() {
        return Err(Error::new("IMAGE_CORRUPT", "图片预览生成失败"));
    }
    let result = unsafe { std::slice::from_raw_parts(output, length).to_vec() };
    unsafe { thingary_free(output.cast()) };
    Ok(result)
}
#[cfg(target_os = "macos")]
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

/// On macOS, the caller must dispatch to the AppKit main thread.
#[cfg(target_os = "macos")]
pub(crate) fn pick(_app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_image() })
}
/// On macOS, the caller must dispatch to the AppKit main thread.
#[cfg(target_os = "macos")]
pub(crate) fn pick_save(
    _app: &tauri::AppHandle,
    title: &str,
    prompt: &str,
    suggested: &str,
    extension: &str,
) -> Option<std::path::PathBuf> {
    let c = |v: &str| std::ffi::CString::new(v).ok();
    let (t, p, n, e) = (c(title)?, c(prompt)?, c(suggested)?, c(extension)?);
    take_path(unsafe { thingary_pick_save(t.as_ptr(), p.as_ptr(), n.as_ptr(), e.as_ptr()) })
}
/// On macOS, the caller must dispatch to the AppKit main thread.
#[cfg(target_os = "macos")]
pub(crate) fn pick_backup_open(_app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_backup_open() })
}
/// On macOS, the caller must dispatch to the AppKit main thread.
#[cfg(target_os = "macos")]
pub(crate) fn pick_spreadsheet_open(_app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_spreadsheet_open() })
}
/// On macOS, the caller must dispatch to the AppKit main thread.
#[cfg(target_os = "macos")]
pub(crate) fn pick_folder(_app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    take_path(unsafe { thingary_pick_folder() })
}

// Keep the bridge's error codes and messages shared with the Rust preview.
fn preview_error(code: i32, accepts_heic: bool) -> Error {
    match code {
        1 => Error::new(
            "IMAGE_FORMAT",
            if accepts_heic {
                "请选择 JPEG、PNG、WebP 或 HEIC 图片"
            } else {
                "请选择 JPEG、PNG 或 WebP 图片"
            },
        ),
        2 => Error::new(
            "IMAGE_DIMENSIONS",
            "图片最长边限 12000 像素，总像素限 4000 万",
        ),
        _ => Error::new("IMAGE_CORRUPT", "图片无法完整读取，请重新选择原图"),
    }
}

#[cfg(windows)]
pub fn preview(bytes: &[u8]) -> Result<Vec<u8>> {
    preview_rust(bytes)
}

// Compile this implementation in macOS tests as well, without changing ImageIO there.
#[cfg(any(windows, test))]
fn preview_rust(bytes: &[u8]) -> Result<Vec<u8>> {
    use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
    use std::io::Cursor;

    if bytes.len() > crate::files::MAX_IMAGE_BYTES {
        return Err(Error::new("IMAGE_SIZE", "图片不能超过 20 MiB"));
    }
    let corrupt = || preview_error(3, false);
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| corrupt())?;
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP) => {}
        Some(_) => return Err(preview_error(1, false)),
        // image does not recognize HEIC/HEIF's ISO base-media signature.
        None if bytes.get(4..8) == Some(b"ftyp") => return Err(preview_error(1, false)),
        None => return Err(corrupt()),
    }
    // image rejects zero-sized PNG headers before it exposes decoder dimensions.
    if reader.format() == Some(ImageFormat::Png)
        && bytes.get(8..16) == Some(b"\0\0\0\x0dIHDR")
        && (bytes.get(16..20) == Some(&[0; 4]) || bytes.get(20..24) == Some(&[0; 4]))
    {
        return Err(preview_error(2, false));
    }
    // The JPEG decoder deliberately tolerates missing EOI; ImageIO requires completion.
    if reader.format() == Some(ImageFormat::Jpeg) && !jpeg_is_complete(bytes) {
        return Err(corrupt());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(12000);
    limits.max_image_height = Some(12000);
    // The default 512 MiB allocation cap also bounds header/metadata processing.
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|error| match error {
        image::ImageError::Limits(ref limit)
            if limit.kind() == image::error::LimitErrorKind::DimensionError =>
        {
            preview_error(2, false)
        }
        _ => corrupt(),
    })?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > 12000
        || height > 12000
        || u64::from(width) * u64::from(height) > 40_000_000
    {
        return Err(preview_error(2, false));
    }
    let orientation = decoder.orientation().map_err(|_| corrupt())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| corrupt())?;
    image.apply_orientation(orientation);
    if image.width() > 960 || image.height() > 960 {
        image = image.thumbnail(960, 960);
    }
    let mut output = Cursor::new(Vec::new());
    // ImageIO produces an 8-bit preview; preserve alpha and keep the PNG within 4 MiB.
    DynamicImage::ImageRgba8(image.to_rgba8())
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|_| corrupt())?;
    let output = output.into_inner();
    if output.is_empty() || output.len() > 4 * 1024 * 1024 {
        return Err(corrupt());
    }
    Ok(output)
}

// Skip length-delimited metadata so an EOI-looking byte pair in Exif is not enough.
#[cfg(any(windows, test))]
fn jpeg_is_complete(bytes: &[u8]) -> bool {
    let mut offset = 2; // SOI was already recognized by ImageReader.
    while let Some(rest) = bytes.get(offset..) {
        let Some(start) = rest.iter().position(|&byte| byte == 0xff) else {
            return false;
        };
        offset += start + 1;
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let Some(&marker) = bytes.get(offset) else {
            return false;
        };
        offset += 1;
        match marker {
            0xd9 => return true,
            0x00 | 0x01 | 0xd0..=0xd8 => continue, // Stuffing and standalone markers.
            _ => {}
        }
        let Some(length) = bytes.get(offset..offset + 2) else {
            return false;
        };
        let length = usize::from(u16::from_be_bytes([length[0], length[1]]));
        if length < 2 || length > bytes.len().saturating_sub(offset) {
            return false;
        }
        offset += length;
    }
    false
}

// rfd has no button-label setter; Windows supplies its localized confirmation label.
#[cfg(windows)]
fn dialog(app: &tauri::AppHandle) -> Option<rfd::FileDialog> {
    use tauri::Manager;
    let window = app.get_webview_window("main")?;
    Some(rfd::FileDialog::new().set_parent(&window))
}

#[cfg(windows)]
pub(crate) fn pick(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    dialog(app)?
        .set_title("选择物品图片")
        .add_filter("图片", &["jpg", "jpeg", "png", "webp"])
        .pick_file()
}

#[cfg(windows)]
pub(crate) fn pick_save(
    app: &tauri::AppHandle,
    title: &str,
    prompt: &str,
    suggested: &str,
    extension: &str,
) -> Option<std::path::PathBuf> {
    let _ = prompt; // rfd uses the Windows confirmation label.
    dialog(app)?
        .set_title(title)
        .set_file_name(suggested)
        .add_filter(extension, &[extension])
        .save_file()
}

#[cfg(windows)]
pub(crate) fn pick_backup_open(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    dialog(app)?
        .set_title("选择要恢复的备份")
        .add_filter("物谱备份", &["thingary", "age"])
        .pick_file()
}

#[cfg(windows)]
pub(crate) fn pick_spreadsheet_open(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    dialog(app)?
        .set_title("选择要导入的 Excel 工作簿")
        .add_filter("Excel 工作簿", &["xlsx"])
        .pick_file()
}

#[cfg(windows)]
pub(crate) fn pick_folder(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    dialog(app)?.set_title("选择额外备份位置").pick_folder()
}

#[cfg(test)]
mod tests {
    use super::preview_rust;
    use image::{DynamicImage, ImageFormat};
    use std::io::Cursor;

    fn encoded(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::new_rgb8(width, height);
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }

    fn preview_dimensions(bytes: &[u8]) -> (u32, u32) {
        let preview = preview_rust(bytes).unwrap();
        assert_eq!(image::guess_format(&preview).unwrap(), ImageFormat::Png);
        let image = image::load_from_memory(&preview).unwrap();
        (image.width(), image.height())
    }

    fn jpeg_with_orientation(orientation: u16) -> Vec<u8> {
        let jpeg = encoded(32, 16, ImageFormat::Jpeg);
        // APP1 Exif with one little-endian TIFF IFD entry for orientation (0x0112).
        let mut exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
        exif.extend_from_slice(&orientation.to_le_bytes());
        exif.extend_from_slice(&[0; 6]); // SHORT padding and no next IFD.
        let length = u16::try_from(exif.len() + 2).unwrap();
        let mut bytes = jpeg[..2].to_vec();
        bytes.extend_from_slice(&[0xff, 0xe1]);
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(&exif);
        bytes.extend_from_slice(&jpeg[2..]);
        bytes
    }

    #[test]
    fn png_preview_preserves_small_dimensions_and_bounds_large_images() {
        assert_eq!(
            preview_dimensions(&encoded(32, 16, ImageFormat::Png)),
            (32, 16)
        );
        assert_eq!(
            preview_dimensions(&encoded(1920, 960, ImageFormat::Png)),
            (960, 480)
        );
    }

    #[test]
    fn jpeg_preview_is_png() {
        assert_eq!(
            preview_dimensions(&encoded(32, 16, ImageFormat::Jpeg)),
            (32, 16)
        );
    }

    #[test]
    fn webp_preview_is_png() {
        assert_eq!(
            preview_dimensions(&encoded(32, 16, ImageFormat::WebP)),
            (32, 16)
        );
    }

    #[test]
    fn exif_orientation_6_swaps_preview_dimensions() {
        assert_eq!(preview_dimensions(&jpeg_with_orientation(6)), (16, 32));
    }

    #[test]
    fn exif_orientation_8_swaps_preview_dimensions() {
        assert_eq!(preview_dimensions(&jpeg_with_orientation(8)), (16, 32));
    }

    #[test]
    fn excessive_longest_side_is_rejected_before_decoding() {
        let error = preview_rust(&encoded(12001, 1, ImageFormat::Png)).unwrap_err();
        assert_eq!(error.code, "IMAGE_DIMENSIONS");
        assert_eq!(error.message, "图片最长边限 12000 像素，总像素限 4000 万");
    }

    fn png_with_dimensions(width: u32, height: u32) -> Vec<u8> {
        let mut png = encoded(1, 1, ImageFormat::Png);
        png[16..20].copy_from_slice(&width.to_be_bytes());
        png[20..24].copy_from_slice(&height.to_be_bytes());
        // Recompute IHDR CRC after changing dimensions; no binary fixture or dependency.
        let mut crc = u32::MAX;
        for &byte in &png[12..29] {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        png[29..33].copy_from_slice(&(!crc).to_be_bytes());
        png
    }

    #[test]
    fn excessive_pixel_count_is_rejected_before_decoding() {
        let bytes = png_with_dimensions(8000, 5001);
        assert_eq!(preview_rust(&bytes).unwrap_err().code, "IMAGE_DIMENSIONS");
    }

    #[test]
    fn zero_dimensions_are_rejected() {
        for (width, height) in [(0, 1), (1, 0)] {
            assert_eq!(
                preview_rust(&png_with_dimensions(width, height))
                    .unwrap_err()
                    .code,
                "IMAGE_DIMENSIONS"
            );
        }
    }

    #[test]
    fn truncated_jpeg_requires_an_actual_end_marker() {
        let jpeg = encoded(32, 16, ImageFormat::Jpeg);
        assert_eq!(
            preview_rust(&jpeg[..jpeg.len() - 2]).unwrap_err().code,
            "IMAGE_CORRUPT"
        );
        let mut jpeg = jpeg;
        jpeg.extend_from_slice(b"trailing data");
        assert_eq!(preview_dimensions(&jpeg), (32, 16));
    }

    #[test]
    fn jpeg_metadata_cannot_substitute_for_an_end_marker() {
        let mut jpeg = jpeg_with_orientation(6);
        // An APP2 segment with EOI-looking bytes, followed by a truncated image.
        jpeg.splice(2..2, [0xff, 0xe2, 0x00, 0x04, 0xff, 0xd9]);
        jpeg.truncate(jpeg.len() - 2);
        assert_eq!(preview_rust(&jpeg).unwrap_err().code, "IMAGE_CORRUPT");
    }

    #[test]
    fn heic_is_rejected_with_windows_format_message() {
        let error = preview_rust(b"\0\0\0\x18ftypheic\0\0\0\0").unwrap_err();
        assert_eq!(error.code, "IMAGE_FORMAT");
        assert_eq!(error.message, "请选择 JPEG、PNG 或 WebP 图片");
    }

    #[test]
    fn corrupt_and_truncated_bytes_are_rejected() {
        assert_eq!(
            preview_rust(b"broken image").unwrap_err().code,
            "IMAGE_CORRUPT"
        );
        let png = encoded(32, 16, ImageFormat::Png);
        assert_eq!(preview_rust(&png[..24]).unwrap_err().code, "IMAGE_CORRUPT");
    }

    #[test]
    fn unsupported_format_excludes_heic_from_message() {
        // No GIF decoder feature is required to recognize its signature.
        let error = preview_rust(b"GIF89a").unwrap_err();
        assert_eq!(error.code, "IMAGE_FORMAT");
        assert_eq!(error.message, "请选择 JPEG、PNG 或 WebP 图片");
    }

    #[test]
    fn excessive_file_size_is_rejected_first() {
        let bytes = vec![0; crate::files::MAX_IMAGE_BYTES + 1];
        assert_eq!(preview_rust(&bytes).unwrap_err().code, "IMAGE_SIZE");
    }
}
