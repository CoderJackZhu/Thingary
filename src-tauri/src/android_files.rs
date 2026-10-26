//! Android-only file hand-off. Exports are written to the app's private
//! `exports/` directory and handed to the system share sheet through
//! FileProvider; a selected backup is copied into a private staging directory
//! before the existing inspection flow sees it. Desktop and iOS never compile
//! this module (only the pure validators are built for host tests).
use crate::domain::{Error, Result};
use std::path::{Path, PathBuf};

const MAX_NAME: usize = 180;

/// Same rule as `ios_exports`: callers name a file, never a path.
fn filename(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > MAX_NAME
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

/// Only a regular file directly inside the export root, never a symlink or a
/// name that resolves outside it.
fn checked_file(root: &Path, name: &str) -> Result<PathBuf> {
    filename(name)?;
    let root = root.canonicalize()?;
    let path = root.join(name);
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(Error::new("EXPORT_PATH", "请选择应用导出目录中的普通文件"));
    }
    let path = path.canonicalize()?;
    if path.parent() != Some(root.as_path()) {
        return Err(Error::new("EXPORT_PATH", "导出文件必须位于应用的导出目录"));
    }
    Ok(path)
}

fn export_name(suggested: &str, extension: &str) -> Result<String> {
    // Place the nonce before the entire name, preserving .thingary.age.
    let name = format!("{}-{suggested}.{extension}", uuid::Uuid::new_v4());
    filename(&name)?;
    Ok(name)
}

/// The backup picker may only stage files no larger than the scan limit.
fn staging_limit() -> u64 {
    crate::backup::MAX_ARCHIVE_FILE + crate::backup_crypto::MAX_CIPHER_OVERHEAD
}

fn exceeds_limit(bytes: u64) -> bool {
    bytes > staging_limit()
}

/// Provider names are untrusted. Reject paths rather than silently accepting
/// a different name, while allowing non-backup files to reach normal inspection.
fn staging_name(display: &str) -> Result<String> {
    if display.is_empty()
        || display == "."
        || display == ".."
        || display.contains(['/', '\\'])
        || display.chars().any(char::is_control)
    {
        return Err(Error::new("PICKER", "所选文件名不能包含路径"));
    }
    let start = display
        .char_indices()
        .map(|(index, _)| index)
        .find(|&index| display.len() - index <= MAX_NAME)
        .unwrap_or(0);
    Ok(display[start..].to_string())
}

// The Kotlin plugin owns the Activity, FileProvider and Storage Access
// Framework work; this side only names files and validates what comes back.
#[cfg(target_os = "android")]
mod platform {
    use super::{checked_file, exceeds_limit, export_name, staging_limit, staging_name};
    use crate::domain::{Error, Result};
    use serde::Deserialize;
    use serde_json::json;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Runtime,
    };

    const EXPORTS_DIR: &str = "exports";
    const STAGING_DIR: &str = "backup-staging";

    struct AndroidFiles<R: Runtime>(PluginHandle<R>);

    pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("thingaryFiles")
            .setup(|app, api| {
                let handle =
                    api.register_android_plugin(crate::android::PLUGIN_PACKAGE, "FilesPlugin")?;
                app.manage(AndroidFiles(handle));
                Ok(())
            })
            .build()
    }

    fn handle(app: &AppHandle) -> Result<tauri::State<'_, AndroidFiles<tauri::Wry>>> {
        app.try_state::<AndroidFiles<tauri::Wry>>()
            .ok_or_else(|| Error::new("ANDROID_FILES", "Android 文件插件尚未就绪，请重试"))
    }

    #[derive(Deserialize)]
    struct AppDirs {
        files: String,
        cache: String,
    }

    /// Ask Kotlin for the real private directories, so FileProvider's
    /// `<files-path path="exports/">` mapping always matches the written file.
    fn app_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf)> {
        let state = handle(app)?;
        let dirs: AppDirs = state
            .0
            .run_mobile_plugin("appDirs", json!({}))
            .map_err(|error| {
                Error::new("ANDROID_FILES", &format!("无法获取应用文件目录：{error}"))
            })?;
        let files = PathBuf::from(dirs.files);
        let cache = PathBuf::from(dirs.cache);
        if !files.is_absolute() || !cache.is_absolute() {
            return Err(Error::new("ANDROID_FILES", "应用文件目录不可用"));
        }
        Ok((files, cache))
    }

    fn exports_root(app: &AppHandle) -> Result<PathBuf> {
        let (files, _) = app_dirs(app)?;
        let root = files.join(EXPORTS_DIR);
        std::fs::create_dir_all(&root)?;
        root.canonicalize()
            .map_err(|_| Error::new("EXPORT_PATH", "无法创建应用的导出目录"))
    }

    fn mime(path: &Path) -> &'static str {
        match path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "pdf" => "application/pdf",
            "txt" => "text/plain",
            _ => "application/octet-stream",
        }
    }

    #[derive(Deserialize)]
    struct Shared {
        completed: bool,
    }

    fn share(app: &AppHandle, path: &Path) -> Result<bool> {
        let state = handle(app)?;
        let shared: Shared = state
            .0
            .run_mobile_plugin(
                "shareFile",
                json!({ "path": path.to_string_lossy(), "mime": mime(path) }),
            )
            .map_err(|error| Error::new("SHARE", &format!("无法打开系统分享面板：{error}")))?;
        Ok(shared.completed)
    }

    /// The Android half of `ios_exports::save_path`; no panel, a private file.
    pub fn save_path(app: &AppHandle, suggested: &str, extension: &str) -> Result<PathBuf> {
        Ok(exports_root(app)?.join(export_name(suggested, extension)?))
    }

    /// Export publication and sharing are separate outcomes. A cancelled share
    /// never turns into a claim that the already-written export failed.
    #[derive(serde::Serialize)]
    pub struct ShareOutcome {
        pub completed: bool,
        pub error: Option<String>,
    }

    pub fn share_published(app: &AppHandle, path: &Path) -> ShareOutcome {
        let result = (|| {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| Error::new("EXPORT_NAME", "导出文件名无法读取"))?;
            let root = exports_root(app)?;
            share(app, &checked_file(&root, name)?)
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

    pub async fn share_file(app: AppHandle, name: String) -> Result<bool> {
        tauri::async_runtime::spawn_blocking(move || {
            let root = exports_root(&app)?;
            share(&app, &checked_file(&root, &name)?)
        })
        .await
        .map_err(|_| Error::new("SHARE", "分享结果未返回，导出文件仍保留在应用导出目录"))?
    }

    /// Recovery keys are transient shares: private until the chosen app has had
    /// time to read the granted URI, then removed.
    pub async fn share_text(app: AppHandle, name: String, text: String) -> Result<bool> {
        tauri::async_runtime::spawn_blocking(move || {
            super::filename(&name)?;
            if !name.ends_with(".txt") || text.len() > 64 * 1024 {
                return Err(Error::new("SHARE", "恢复密钥文件无效"));
            }
            let (_, cache) = app_dirs(&app)?;
            let directory = cache.join("share");
            std::fs::create_dir_all(&directory)?;
            // Android exposes the same sandbox through /data/user/0 and
            // /data/data. Pass the canonical path, as for retained exports.
            let directory = directory.canonicalize()?;
            // Clear keys left by a process that ended inside the grace period.
            if let Ok(entries) = std::fs::read_dir(&directory) {
                for entry in entries.flatten() {
                    let stale = entry
                        .metadata()
                        .and_then(|meta| meta.modified())
                        .ok()
                        .and_then(|modified| modified.elapsed().ok())
                        .is_some_and(|age| age > std::time::Duration::from_secs(600));
                    if stale {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
            let mut file = tempfile::Builder::new()
                .prefix("thingary-share-")
                .suffix(&format!("-{name}"))
                .tempfile_in(&directory)?;
            file.write_all(text.as_bytes())?;
            file.as_file().sync_all()?;
            let path = file
                .into_temp_path()
                .keep()
                .map_err(|_| Error::new("SHARE", "恢复密钥文件尚未就绪，请重试"))?;
            let completed = share(&app, &path)?;
            if completed {
                // The chooser returns when the target activity starts, which can
                // be before that app opens the URI. Delete after a grace period
                // rather than pulling the file out from under it.
                let cleanup = path;
                let _ = std::thread::Builder::new()
                    .name("thingary-share-cleanup".into())
                    .spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(120));
                        let _ = std::fs::remove_file(cleanup);
                    });
            } else {
                let _ = std::fs::remove_file(&path);
            }
            Ok(completed)
        })
        .await
        .map_err(|_| Error::new("SHARE", "密钥分享结果未返回，请重试"))?
    }

    #[derive(Deserialize)]
    struct Picked {
        #[serde(default)]
        cancelled: bool,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        name: Option<String>,
    }

    /// Opens the system document picker, copies the chosen file into private
    /// staging while enforcing the backup size limit, and returns its path.
    /// Cancellation and every failure leave no partial file behind.
    pub fn pick_backup(app: &AppHandle) -> Result<Option<PathBuf>> {
        let (_, cache) = app_dirs(app)?;
        let staging = cache.join(STAGING_DIR);
        std::fs::create_dir_all(&staging)?;
        let directory = tempfile::Builder::new()
            .prefix("pick-")
            .tempdir_in(&staging)?;
        let staging = directory
            .path()
            .canonicalize()
            .map_err(|_| Error::new("PICKER", "无法准备备份暂存目录"))?;
        let upload = uuid::Uuid::new_v4().to_string();
        let result = (|| {
            let state = handle(app)?;
            let picked: Picked = state
                .0
                .run_mobile_plugin(
                    "pickBackup",
                    json!({
                        "stagingDir": staging.to_string_lossy(),
                        "uploadName": upload,
                        "maxBytes": staging_limit(),
                    }),
                )
                .map_err(|error| {
                    Error::new("PICKER", &format!("无法打开系统文件选择面板：{error}"))
                })?;
            if picked.cancelled {
                return Ok(None);
            }
            let expected = staging.join(&upload);
            if picked.path.as_deref() != Some(expected.to_string_lossy().as_ref()) {
                return Err(Error::new("PICKER", "文件选择结果不可信，请重试"));
            }
            let metadata = std::fs::symlink_metadata(&expected)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(Error::new("PICKER", "所选文件副本不可用，请重试"));
            }
            let path = expected
                .canonicalize()
                .map_err(|_| Error::new("PICKER", "所选文件副本不可用，请重试"))?;
            if path.parent() != Some(staging.as_path()) {
                return Err(Error::new("PICKER", "所选文件副本不在暂存目录"));
            }
            if exceeds_limit(metadata.len()) {
                return Err(Error::new("PICKER", "所选备份超过备份大小上限"));
            }
            let name = staging_name(picked.name.as_deref().unwrap_or("backup.thingary"))?;
            let target = staging.join(&name);
            if target == path {
                return Ok(Some(path));
            }
            if target.exists() && std::fs::remove_file(&target).is_err() {
                return Ok(Some(path));
            }
            match std::fs::rename(&path, &target) {
                Ok(()) => Ok(Some(target)),
                // The staged copy is still usable under its generated name.
                Err(_) => Ok(Some(path)),
            }
        })();
        if matches!(&result, Ok(Some(_))) {
            // Inspection freezes its own copy. Its Android-only guard removes
            // this picker directory on success and failure, including errors.
            let _ = directory.keep();
        }
        result
    }

    pub struct StagedBackupCleanup(PathBuf);
    impl StagedBackupCleanup {
        pub fn new(path: &Path) -> Self {
            Self(
                path.parent()
                    .expect("picker file has a parent")
                    .to_path_buf(),
            )
        }
    }
    impl Drop for StagedBackupCleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(target_os = "android")]
pub use platform::ShareOutcome;
#[cfg(target_os = "android")]
pub use platform::{
    pick_backup, plugin, save_path, share_file, share_published, share_text, StagedBackupCleanup,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_paths_are_checked_like_ios_exports() {
        assert!(export_name("虚构备份.thingary", "age")
            .unwrap()
            .ends_with("虚构备份.thingary.age"));
        assert!(export_name("../虚构备份", "thingary").is_err());

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
            assert!(checked_file(dir.path(), name).is_err(), "{name}");
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

    #[test]
    fn staged_backups_respect_the_backup_size_limit() {
        assert!(!exceeds_limit(0));
        assert!(!exceeds_limit(staging_limit()));
        assert!(exceeds_limit(staging_limit() + 1));
        // Covers both a plaintext archive and the encrypted envelope overhead.
        assert!(
            staging_limit()
                >= crate::backup::MAX_ARCHIVE_FILE + crate::backup_crypto::MAX_CIPHER_OVERHEAD
        );
    }

    #[test]
    fn a_provider_display_name_cannot_escape_the_staging_directory() {
        for name in [
            "../../etc/passwd",
            "a\\b.thingary",
            "",
            ".",
            "..",
            "a\0b.thingary",
        ] {
            assert!(staging_name(name).is_err());
        }
        assert_eq!(
            staging_name("虚构.thingary.age").unwrap(),
            "虚构.thingary.age"
        );
        assert!(staging_name(&"x".repeat(400)).unwrap().len() <= MAX_NAME);
        assert!(staging_name(&"虚".repeat(100)).unwrap().len() <= MAX_NAME);
    }
}
