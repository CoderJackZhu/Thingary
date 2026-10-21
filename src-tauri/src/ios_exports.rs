//! Owned iOS exports. Frontend callers may name Documents exports, never paths.
use crate::domain::{Error, Result};
use std::path::{Path, PathBuf};

fn filename(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 180
        || name.contains(['/', '\\', '\0'])
        || name == "."
        || name == ".."
    {
        return Err(Error::new("EXPORT_NAME", "请使用不含路径的文件名"));
    }
    let lower = name.to_ascii_lowercase();
    if ![".thingary", ".thingary.age", ".xlsx", ".pdf", ".txt"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        return Err(Error::new(
            "EXPORT_NAME",
            "只支持分享备份、表格、PDF 或恢复密钥",
        ));
    }
    Ok(())
}

fn checked_file(documents: &Path, name: &str) -> Result<PathBuf> {
    filename(name)?;
    let root = documents.canonicalize()?;
    let path = documents.join(name);
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(Error::new(
            "EXPORT_PATH",
            "请选择 Documents 中的普通导出文件",
        ));
    }
    let path = path.canonicalize()?;
    if path.parent() != Some(root.as_path()) {
        return Err(Error::new(
            "EXPORT_PATH",
            "导出文件必须位于 App 的 Documents 目录",
        ));
    }
    Ok(path)
}

fn export_name(suggested: &str, extension: &str) -> Result<String> {
    // Place the nonce before the entire name, preserving .thingary.age.
    let name = format!("{}-{suggested}.{extension}", uuid::Uuid::new_v4());
    filename(&name)?;
    Ok(name)
}

#[cfg(target_os = "ios")]
static DOCUMENTS: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
pub fn configure(app: &tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    let path = app
        .path()
        .document_dir()
        .map_err(|_| Error::new("EXPORT_PATH", "无法获取 Documents 目录"))?;
    std::fs::create_dir_all(&path)?;
    DOCUMENTS
        .set(path)
        .map_err(|_| Error::new("EXPORT_PATH", "Documents 已初始化"))
}
#[cfg(target_os = "ios")]
pub fn documents() -> Result<&'static Path> {
    DOCUMENTS
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| Error::new("EXPORT_PATH", "Documents 尚未初始化"))
}

#[cfg(target_os = "ios")]
pub fn save_path(suggested: &str, extension: &str) -> Result<PathBuf> {
    Ok(documents()?.join(export_name(suggested, extension)?))
}

#[cfg(target_os = "ios")]
pub async fn ios_share_file(name: String) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = checked_file(documents()?, &name)?;
        crate::ios::share(&path)
    })
    .await
    .map_err(|_| Error::new("SHARE", "分享结果未返回，导出文件仍保留在 Documents"))?
}

/// Recovery keys are transient shares, never retained in Documents/backups.
#[cfg(target_os = "ios")]
pub async fn ios_share_text(name: String, text: String) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        filename(&name)?;
        if !name.ends_with(".txt") || text.len() > 64 * 1024 {
            return Err(Error::new("SHARE", "恢复密钥文件无效"));
        }
        use std::io::Write;
        let directory = tempfile::tempdir()?;
        let path = directory.path().join(name);
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        crate::ios::share(&path)
        // The owned directory is removed on completion, cancellation and error.
    })
    .await
    .map_err(|_| Error::new("SHARE", "密钥分享结果未返回，请重试"))?
}

#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
pub struct SharedExport {
    pub name: String,
    pub share: ShareOutcome,
}

/// The existing report renderer supplies escaped HTML; WKWebView prints it to
/// PDF without scripts or network access. No financial calculations here.
#[cfg(target_os = "ios")]
pub async fn ios_export_pdf(name: String, html: String) -> Result<SharedExport> {
    tauri::async_runtime::spawn_blocking(move || {
        filename(&name)?;
        if !name.to_ascii_lowercase().ends_with(".pdf") || html.len() > 4 * 1024 * 1024 {
            return Err(Error::new("EXPORT_PDF", "报告内容过大或文件名无效"));
        }
        let target = save_path(name.trim_end_matches(".pdf"), "pdf")?;
        let file = tempfile::NamedTempFile::new_in(documents()?)?;
        crate::ios::render_pdf(&html, file.path())?;
        file.as_file().sync_all()?;
        file.persist_noclobber(&target)
            .map_err(|_| Error::new("EXPORT_PDF", "PDF 尚未保存，请检查可用空间"))?;
        let name = target.file_name().unwrap().to_string_lossy().into_owned();
        let share = share_published(&target);
        Ok(SharedExport { name, share })
    })
    .await
    .map_err(|_| Error::new("SHARE", "导出结果未返回，请到 Documents 核对"))?
}

/// Export publication and sharing are separate outcomes. Never turn a failed
/// or cancelled share into a claim that the already-written backup failed.
#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
pub struct ShareOutcome {
    pub completed: bool,
    pub error: Option<String>,
}
#[cfg(target_os = "ios")]
pub fn share_published(path: &Path) -> ShareOutcome {
    let result = (|| {
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| Error::new("EXPORT_NAME", "导出文件名无法读取"))?;
        crate::ios::share(&checked_file(documents()?, name)?)
    })();
    match result {
        Ok(completed) => ShareOutcome {
            completed,
            error: None,
        },
        Err(error) => ShareOutcome {
            completed: false,
            error: Some(error.message),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_export_keeps_the_compound_backup_extension() {
        let name = export_name("虚构备份.thingary", "age").unwrap();
        assert!(name.ends_with("虚构备份.thingary.age"));
        assert!(export_name("../虚构备份", "thingary").is_err());
    }
    #[test]
    fn sharing_rejects_traversal_unsupported_files_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "../private.thingary",
            "/private.thingary",
            "a\\b.pdf",
            "",
            "database.sqlite",
            ".",
            "..",
        ] {
            assert!(checked_file(dir.path(), name).is_err());
        }
        std::fs::write(dir.path().join("虚构.thingary.age"), b"fiction").unwrap();
        assert!(checked_file(dir.path(), "虚构.thingary.age").is_ok());
        #[cfg(unix)]
        {
            let outside = tempfile::NamedTempFile::new().unwrap();
            std::os::unix::fs::symlink(outside.path(), dir.path().join("escape.pdf")).unwrap();
            assert!(checked_file(dir.path(), "escape.pdf").is_err());
        }
        std::fs::create_dir(dir.path().join("folder.pdf")).unwrap();
        assert!(checked_file(dir.path(), "folder.pdf").is_err());
    }
}
