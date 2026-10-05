//! Optional modules the user can switch off. App-level: one file beside the
//! library folders, so it applies to the personal and sample libraries alike.
//! Switching a module off only hides it and pauses its reminders; no data is
//! touched.
use crate::domain::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Modules {
    pub wishlist: bool,
    pub timeline: bool,
    pub stats: bool,
    pub wealth: bool,
    pub expenses: bool,
    pub recurring: bool,
    #[serde(rename = "virtual")]
    pub virtual_assets: bool,
    pub planning: bool,
}
impl Default for Modules {
    fn default() -> Self {
        Self {
            wishlist: true,
            timeline: true,
            stats: true,
            wealth: true,
            expenses: true,
            recurring: true,
            virtual_assets: true,
            planning: true,
        }
    }
}
fn path(library_root: &Path) -> PathBuf {
    library_root.with_file_name("modules.json")
}
/// A missing or unreadable file means every module is on.
pub fn read(library_root: &Path) -> Modules {
    std::fs::read(path(library_root))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
pub fn write(library_root: &Path, modules: &Modules) -> Result<()> {
    crate::storage::atomic_write(&path(library_root), &serde_json::to_vec(modules)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_or_broken_file_keeps_everything_on_and_writes_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        assert_eq!(read(&root), Modules::default());
        std::fs::write(path(&root), b"not json").unwrap();
        assert_eq!(read(&root), Modules::default());
        let off = Modules {
            wishlist: false,
            virtual_assets: false,
            ..Modules::default()
        };
        write(&root, &off).unwrap();
        assert_eq!(read(&root), off);
        assert!(std::fs::read_to_string(path(&root))
            .unwrap()
            .contains("\"virtual\":false"));
    }
}
