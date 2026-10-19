//! Optional modules the user can switch off. App-level preferences beside the
//! library folders, so it applies to the personal and sample libraries alike.
//! Switching a module off only hides it and pauses its reminders; no data is
//! touched.
use crate::domain::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Modules {
    pub physical: bool,
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
            physical: true,
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
/// Keep the original on-disk shape: older applications reject unknown fields
/// and would otherwise replace every saved false switch with their defaults.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct LegacyModules {
    wishlist: bool,
    timeline: bool,
    stats: bool,
    wealth: bool,
    expenses: bool,
    recurring: bool,
    #[serde(rename = "virtual")]
    virtual_assets: bool,
    planning: bool,
}
impl Default for LegacyModules {
    fn default() -> Self {
        Modules::default().into()
    }
}
impl From<Modules> for LegacyModules {
    fn from(value: Modules) -> Self {
        Self {
            wishlist: value.wishlist,
            timeline: value.timeline,
            stats: value.stats,
            wealth: value.wealth,
            expenses: value.expenses,
            recurring: value.recurring,
            virtual_assets: value.virtual_assets,
            planning: value.planning,
        }
    }
}
impl From<LegacyModules> for Modules {
    fn from(value: LegacyModules) -> Self {
        Self {
            physical: true,
            wishlist: value.wishlist,
            timeline: value.timeline,
            stats: value.stats,
            wealth: value.wealth,
            expenses: value.expenses,
            recurring: value.recurring,
            virtual_assets: value.virtual_assets,
            planning: value.planning,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct InterfacePreferences {
    version: u64,
    physical: bool,
}
fn path(library_root: &Path) -> PathBuf {
    library_root.with_file_name("modules.json")
}
fn interface_path(library_root: &Path) -> PathBuf {
    library_root.with_file_name("interface-modules.json")
}
/// Legacy switches keep their defaults; a missing interface file enables
/// physical, while an unreadable/damaged/future file leaves it unavailable.
pub fn read(library_root: &Path) -> Modules {
    let mut modules = checked_original(library_root).unwrap_or_default();
    modules.physical = match checked_interface(library_root) {
        Ok(Some(prefs)) => prefs.physical,
        Ok(None) => true,
        Err(_) => false,
    };
    modules
}
pub fn write(library_root: &Path, modules: &Modules) -> Result<()> {
    checked_interface(library_root).map_err(|status| {
        crate::domain::Error::new(
            if status == FinanceStatus::UnsupportedVersion {
                "FINANCE_MODULES_VERSION"
            } else {
                "FINANCE_MODULES_REPAIR_REQUIRED"
            },
            "界面模块设置无法覆盖，请先检查或修复设置",
        )
    })?;
    write_preferences(library_root, modules)
}
fn write_preferences(root: &Path, modules: &Modules) -> Result<()> {
    crate::storage::atomic_write(
        &path(root),
        &serde_json::to_vec(&LegacyModules::from(*modules))?,
    )?;
    crate::storage::atomic_write(
        &interface_path(root),
        &serde_json::to_vec(&InterfacePreferences {
            version: 1,
            physical: modules.physical,
        })?,
    )
    .map_err(|_| {
        crate::domain::Error::new(
            "FINANCE_MODULES_PARTIAL",
            "部分模块设置可能已保存，请重新读取核对后再操作",
        )
    })
}

/// Wire snapshot merges the original eight-field file and interface preferences.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct RuntimeModules {
    #[serde(flatten)]
    pub modules: Modules,
    pub incomes: bool,
    pub movements: bool,
    pub finance_status: FinanceStatus,
    pub finance_revision: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinanceStatus {
    Ready,
    LegacyCorrupt,
    FinanceCorrupt,
    UnsupportedVersion,
    ReadError,
    WriteError,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FinancePreferences {
    version: u64,
    revision: u64,
    incomes: bool,
    movements: bool,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct FinanceUpdate {
    pub incomes: Option<bool>,
    pub movements: Option<bool>,
    pub repair: bool,
}
/// Accept legacy payloads and runtime snapshots, rejecting unknown keys.
/// Explicit top-level choices override echoed fields; omitted choices preserve.
pub fn parse_update(
    mut value: serde_json::Value,
    incomes: Option<bool>,
    movements: Option<bool>,
    repair: Option<bool>,
) -> Result<(Modules, FinanceUpdate)> {
    use crate::domain::Error;
    let object = value
        .as_object_mut()
        .ok_or_else(|| Error::new("FORMAT", "无效模块设置"))?;
    let mut take_bool = |key: &str| -> Result<Option<bool>> {
        object
            .remove(key)
            .map(|v| {
                v.as_bool()
                    .ok_or_else(|| Error::new("FORMAT", "无效模块开关"))
            })
            .transpose()
    };
    let echoed_incomes = take_bool("incomes")?;
    let echoed_movements = take_bool("movements")?;
    if let Some(status) = object.remove("finance_status") {
        serde_json::from_value::<FinanceStatus>(status)?;
    }
    if let Some(revision) = object.remove("finance_revision") {
        if revision
            .as_u64()
            .filter(|v| *v <= 9_007_199_254_740_991)
            .is_none()
        {
            return Err(Error::new("FORMAT", "无效模块修订"));
        }
    }
    Ok((
        serde_json::from_value(value)?,
        FinanceUpdate {
            incomes: incomes.or(echoed_incomes),
            movements: movements.or(echoed_movements),
            repair: repair.unwrap_or(false),
        },
    ))
}
fn finance_path(root: &Path) -> PathBuf {
    root.with_file_name("finance-modules.json")
}
fn checked_original(root: &Path) -> std::result::Result<Modules, FinanceStatus> {
    match std::fs::read(path(root)) {
        Ok(bytes) => serde_json::from_slice::<LegacyModules>(&bytes)
            .map(Modules::from)
            .map_err(|_| FinanceStatus::LegacyCorrupt),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Modules::default()),
        Err(_) => Err(FinanceStatus::ReadError),
    }
}
fn checked_interface(
    root: &Path,
) -> std::result::Result<Option<InterfacePreferences>, FinanceStatus> {
    let bytes = match std::fs::read(interface_path(root)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(FinanceStatus::ReadError),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| FinanceStatus::LegacyCorrupt)?;
    match value.get("version").and_then(|v| v.as_u64()) {
        Some(1) => (),
        Some(_) => return Err(FinanceStatus::UnsupportedVersion),
        None => return Err(FinanceStatus::LegacyCorrupt),
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|_| FinanceStatus::LegacyCorrupt)
}
fn checked_legacy(root: &Path) -> std::result::Result<Modules, FinanceStatus> {
    let mut modules = checked_original(root)?;
    modules.physical = checked_interface(root)?
        .map(|prefs| prefs.physical)
        .unwrap_or(true);
    Ok(modules)
}
fn checked_finance(root: &Path) -> std::result::Result<Option<FinancePreferences>, FinanceStatus> {
    let bytes = match std::fs::read(finance_path(root)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(FinanceStatus::ReadError),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| FinanceStatus::FinanceCorrupt)?;
    // Inspect the envelope before v1 parsing: future contents must never be repaired as v1.
    match value.get("version").and_then(|v| v.as_u64()) {
        Some(1) => (),
        Some(_) => return Err(FinanceStatus::UnsupportedVersion),
        None => return Err(FinanceStatus::FinanceCorrupt),
    }
    let prefs: FinancePreferences =
        serde_json::from_value(value).map_err(|_| FinanceStatus::FinanceCorrupt)?;
    if prefs.revision == 0 || prefs.revision > 9_007_199_254_740_991 {
        return Err(FinanceStatus::FinanceCorrupt);
    }
    Ok(Some(prefs))
}
#[cfg(test)]
thread_local! { static FAIL_FINANCE_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; static FAIL_PRESERVE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
fn save_finance(root: &Path, prefs: &FinancePreferences) -> Result<()> {
    #[cfg(test)]
    if FAIL_FINANCE_WRITE.with(|flag| flag.get()) {
        return Err(crate::domain::Error::new(
            "IO",
            "injected preference failure",
        ));
    }
    crate::storage::atomic_write(&finance_path(root), &serde_json::to_vec(prefs)?)
}
fn snapshot(modules: Modules, prefs: FinancePreferences) -> RuntimeModules {
    RuntimeModules {
        modules,
        incomes: prefs.incomes,
        movements: prefs.movements,
        finance_status: FinanceStatus::Ready,
        finance_revision: prefs.revision,
    }
}
/// Pure combined read for use within the serial owner. Missing preferences are
/// not inherited here: callers must initialize once before exposing a snapshot.
pub fn read_runtime(root: &Path) -> RuntimeModules {
    let legacy = checked_legacy(root);
    let finance = checked_finance(root);
    let status = legacy
        .as_ref()
        .err()
        .copied()
        .or_else(|| finance.as_ref().err().copied());
    let modules = legacy.unwrap_or_else(|_| read(root));
    if let Some(status) = status {
        return RuntimeModules {
            modules,
            incomes: false,
            movements: false,
            finance_status: status,
            finance_revision: 0,
        };
    }
    match finance.unwrap() {
        Some(prefs) => snapshot(modules, prefs),
        None => RuntimeModules {
            modules,
            incomes: false,
            movements: false,
            finance_status: FinanceStatus::WriteError,
            finance_revision: 0,
        },
    }
}
/// Only Worker calls this mutating initializer; a failed inheritance is closed.
pub fn initialize_runtime(root: &Path) -> RuntimeModules {
    if let (Ok(legacy), Ok(None)) = (checked_legacy(root), checked_finance(root)) {
        let prefs = FinancePreferences {
            version: 1,
            revision: 1,
            incomes: legacy.planning,
            movements: legacy.planning,
        };
        if save_finance(root, &prefs).is_err() {
            return RuntimeModules {
                modules: legacy,
                incomes: false,
                movements: false,
                finance_status: FinanceStatus::WriteError,
                finance_revision: 0,
            };
        }
    }
    read_runtime(root)
}
fn preserve(file: &Path) -> Result<()> {
    use std::io::Write;
    #[cfg(test)]
    if FAIL_PRESERVE.with(|flag| flag.get()) {
        return Err(crate::domain::Error::new(
            "IO",
            "injected preservation failure",
        ));
    }
    let bytes = std::fs::read(file)?;
    let mut copy = tempfile::Builder::new()
        .prefix("modules-corrupt-")
        .tempfile_in(file.parent().unwrap())?;
    copy.write_all(&bytes)?;
    copy.as_file().sync_all()?;
    copy.keep().map_err(|e| e.error)?;
    crate::storage::sync_dir(file.parent().unwrap())
}
/// Must be called on the same queue as initialize_runtime and legacy writes.
pub fn write_runtime(
    root: &Path,
    modules: Modules,
    update: FinanceUpdate,
) -> Result<RuntimeModules> {
    use crate::domain::Error;
    let legacy = checked_legacy(root);
    let finance = checked_finance(root);
    if finance == Err(FinanceStatus::UnsupportedVersion)
        || checked_interface(root) == Err(FinanceStatus::UnsupportedVersion)
    {
        return Err(Error::new(
            "FINANCE_MODULES_VERSION",
            "模块设置来自较新版本，不能覆盖",
        ));
    }
    let corrupt = legacy == Err(FinanceStatus::LegacyCorrupt)
        || finance == Err(FinanceStatus::FinanceCorrupt);
    if corrupt {
        if !update.repair || update.incomes.is_none() || update.movements.is_none() {
            return Err(Error::new(
                "FINANCE_MODULES_REPAIR_REQUIRED",
                "请明确选择收入和流动能力后修复设置",
            ));
        }
        // Preserve every damaged original before replacing either one.
        if checked_original(root) == Err(FinanceStatus::LegacyCorrupt) {
            preserve(&path(root))?;
        }
        if checked_interface(root) == Err(FinanceStatus::LegacyCorrupt) {
            preserve(&interface_path(root))?;
        }
        if finance == Err(FinanceStatus::FinanceCorrupt) {
            preserve(&finance_path(root))?;
        }
    } else if legacy.is_err() || finance.is_err() {
        return Err(Error::new(
            "FINANCE_MODULES_READ",
            "模块设置无法读取，原设置未覆盖",
        ));
    }
    let current = match finance {
        Ok(Some(prefs)) => prefs,
        Ok(None) if !corrupt => {
            let old = legacy.unwrap();
            let prefs = FinancePreferences {
                version: 1,
                revision: 1,
                incomes: old.planning,
                movements: old.planning,
            };
            // Freeze inheritance before the target switch changes.
            save_finance(root, &prefs)?;
            prefs
        }
        _ => FinancePreferences {
            version: 1,
            revision: 0,
            incomes: false,
            movements: false,
        },
    };
    let wealth_changed = legacy
        .as_ref()
        .is_ok_and(|old| old.wealth != modules.wealth);
    let mut next = current;
    next.incomes = update.incomes.unwrap_or(current.incomes);
    next.movements = update.movements.unwrap_or(current.movements);
    if corrupt {
        // A repair must not reuse a preview revision, even when the damaged
        // envelope still contains a previously issued revision.
        let old_revision = std::fs::read(finance_path(root))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v.get("revision").and_then(|r| r.as_u64()));
        let clock_revision = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Error::new("FINANCE_MODULES_REVISION", "无法建立模块修订"))?
            .as_millis() as u64;
        next.revision = current
            .revision
            .max(old_revision.unwrap_or(0))
            .max(clock_revision);
    }
    if corrupt || wealth_changed || next != current {
        next.revision = next
            .revision
            .checked_add(1)
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or_else(|| Error::new("FINANCE_MODULES_REVISION", "模块设置修订已超出范围"))?;
    }
    // Legacy failure cannot change effective independent preferences.
    write_preferences(root, &modules)?;
    if corrupt || wealth_changed || next != current {
        save_finance(root, &next).map_err(|_| {
            Error::new(
                "FINANCE_MODULES_PARTIAL",
                "部分模块设置可能已保存，请重新读取核对后再操作",
            )
        })?;
    }
    Ok(snapshot(modules, next))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inheritance_is_once_and_independent_choices_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let old = Modules {
            planning: false,
            ..Modules::default()
        };
        write(&root, &old).unwrap();
        let first = initialize_runtime(&root);
        assert!(!first.incomes && !first.movements);
        assert_eq!(first.finance_revision, 1);
        let enabled = write_runtime(
            &root,
            old,
            FinanceUpdate {
                incomes: Some(true),
                movements: Some(true),
                repair: false,
            },
        )
        .unwrap();
        assert_eq!(enabled.finance_revision, 2);
        let changed = write_runtime(&root, Modules::default(), FinanceUpdate::default()).unwrap();
        assert!(changed.incomes && changed.movements);
        assert_eq!(changed.finance_revision, 2);
        assert_eq!(initialize_runtime(&root), changed);
        let off = write_runtime(
            &root,
            old,
            FinanceUpdate {
                incomes: Some(false),
                ..FinanceUpdate::default()
            },
        )
        .unwrap();
        assert!(!off.incomes && off.movements);
        assert_eq!(off.finance_revision, 3);
        assert_eq!(read_runtime(&root), off);
        let bytes = std::fs::read(path(&root)).unwrap();
        assert_eq!(serde_json::from_slice::<Modules>(&bytes).unwrap(), old);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            8
        );
        assert!(!root.exists()); // Preferences are beside the library, outside its backup tree.
    }
    #[test]
    fn old_eight_field_preferences_keep_every_choice_and_default_physical_on() {
        for bytes in [
            br#"{"wishlist":false,"timeline":false,"stats":false,"wealth":false,"expenses":false,"recurring":false,"virtual":false,"planning":false}"#.as_slice(),
            br#"{"wishlist":false,"timeline":true,"stats":false,"wealth":true,"expenses":false,"recurring":true,"virtual":false,"planning":false}"#.as_slice(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("library");
            std::fs::write(path(&root), bytes).unwrap();
            let original: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            let loaded = initialize_runtime(&root);
            assert_eq!(loaded.finance_status, FinanceStatus::Ready);
            assert!(loaded.modules.physical);
            let serialized = serde_json::to_value(loaded.modules).unwrap();
            for (key, value) in original.as_object().unwrap() {
                assert_eq!(&serialized[key], value, "legacy switch {key}");
            }
            assert_eq!(loaded.incomes, loaded.modules.planning);
            assert_eq!(loaded.movements, loaded.modules.planning);
            assert_eq!(std::fs::read(path(&root)).unwrap(), bytes);
            assert_eq!(initialize_runtime(&root), loaded);
            // Old clients can still send their eight-field payloads.
            let (parsed, _) = parse_update(original, None, None, None).unwrap();
            assert_eq!(parsed, loaded.modules);
        }
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        assert!(initialize_runtime(&root).modules.physical);
        assert!(!path(&root).exists());
    }
    #[test]
    fn physical_choice_uses_standard_worker_save_and_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let worker = crate::worker::Worker::start(root.clone()).unwrap();
        let previous = worker.modules().unwrap();
        let off = Modules {
            physical: false,
            wishlist: false,
            planning: false,
            ..previous.modules
        };
        let payload = serde_json::to_value(off).unwrap();
        let (parsed, independent) = parse_update(payload, None, None, None).unwrap();
        let saved = worker
            .set_modules_with_finance(parsed, independent)
            .unwrap();
        assert_eq!(saved.modules, off);
        assert_eq!(saved.incomes, previous.incomes);
        assert_eq!(saved.movements, previous.movements);
        assert_eq!(saved.finance_revision, previous.finance_revision);
        let legacy_bytes = std::fs::read(path(&root)).unwrap();
        let old_application: LegacyModules = serde_json::from_slice(&legacy_bytes).unwrap();
        assert!(!old_application.wishlist && !old_application.planning);
        let legacy_json: serde_json::Value = serde_json::from_slice(&legacy_bytes).unwrap();
        assert_eq!(legacy_json.as_object().unwrap().len(), 8);
        assert!(legacy_json.get("physical").is_none());
        assert_eq!(
            serde_json::from_slice::<InterfacePreferences>(
                &std::fs::read(interface_path(&root)).unwrap()
            )
            .unwrap(),
            InterfacePreferences {
                version: 1,
                physical: false
            }
        );
        worker.stop_and_join();
        let restarted = crate::worker::Worker::start(root.clone()).unwrap();
        assert_eq!(restarted.modules().unwrap(), saved);
        assert_eq!(read(&root), off);
        restarted.stop_and_join();
        // An old application can rewrite its own eight switches without
        // changing the interface choice it does not understand.
        let mut old_application = old_application;
        old_application.timeline = false;
        std::fs::write(path(&root), serde_json::to_vec(&old_application).unwrap()).unwrap();
        assert!(!read_runtime(&root).modules.physical);
        assert!(!read_runtime(&root).modules.timeline);
        std::fs::remove_file(interface_path(&root)).unwrap();
        let without_interface = read_runtime(&root);
        assert!(without_interface.modules.physical);
        assert!(
            !without_interface.modules.wishlist
                && !without_interface.modules.timeline
                && !without_interface.modules.planning
        );
        assert_eq!(without_interface.incomes, saved.incomes);
        assert_eq!(without_interface.movements, saved.movements);
    }
    #[test]
    fn damaged_interface_settings_require_explicit_preserving_repair() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let off = Modules {
            physical: false,
            wishlist: false,
            planning: false,
            ..Modules::default()
        };
        write(&root, &off).unwrap();
        initialize_runtime(&root);
        let legacy_before = std::fs::read(path(&root)).unwrap();
        let finance_before = std::fs::read(finance_path(&root)).unwrap();
        let damaged = br#"{"version":1,"physical":"invalid"}"#;
        std::fs::write(interface_path(&root), damaged).unwrap();
        let unavailable = read_runtime(&root);
        assert_eq!(unavailable.finance_status, FinanceStatus::LegacyCorrupt);
        assert!(
            !unavailable.modules.physical
                && !unavailable.modules.wishlist
                && !unavailable.modules.planning
        );
        assert!(!unavailable.incomes && !unavailable.movements);
        assert!(write(&root, &Modules::default()).is_err());
        assert!(write_runtime(&root, Modules::default(), FinanceUpdate::default()).is_err());
        assert!(write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                repair: true,
                ..FinanceUpdate::default()
            }
        )
        .is_err());
        assert_eq!(std::fs::read(path(&root)).unwrap(), legacy_before);
        assert_eq!(std::fs::read(finance_path(&root)).unwrap(), finance_before);
        assert_eq!(std::fs::read(interface_path(&root)).unwrap(), damaged);
        FAIL_PRESERVE.with(|flag| flag.set(true));
        let repair = FinanceUpdate {
            incomes: Some(true),
            movements: Some(false),
            repair: true,
        };
        assert!(write_runtime(&root, off, repair).is_err());
        FAIL_PRESERVE.with(|flag| flag.set(false));
        assert_eq!(std::fs::read(interface_path(&root)).unwrap(), damaged);
        let repaired = write_runtime(&root, off, repair).unwrap();
        assert_eq!(repaired.finance_status, FinanceStatus::Ready);
        assert!(!repaired.modules.physical && repaired.incomes && !repaired.movements);
        assert_eq!(std::fs::read(path(&root)).unwrap(), legacy_before);
        assert!(std::fs::read_dir(dir.path()).unwrap().any(|entry| {
            let entry = entry.unwrap();
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("modules-corrupt-")
                && std::fs::read(entry.path()).ok().as_deref() == Some(damaged)
        }));
    }
    #[test]
    fn newer_interface_settings_are_never_overwritten_even_by_repair() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let off = Modules {
            physical: false,
            wealth: false,
            ..Modules::default()
        };
        write(&root, &off).unwrap();
        initialize_runtime(&root);
        let legacy_before = std::fs::read(path(&root)).unwrap();
        let finance_before = std::fs::read(finance_path(&root)).unwrap();
        let future = br#"{"version":2,"physical":true,"future_setting":"keep"}"#;
        std::fs::write(interface_path(&root), future).unwrap();
        let unavailable = initialize_runtime(&root);
        assert_eq!(
            unavailable.finance_status,
            FinanceStatus::UnsupportedVersion
        );
        assert!(!unavailable.modules.physical && !unavailable.modules.wealth);
        assert!(write(&root, &Modules::default()).is_err());
        for repair in [false, true] {
            let error = write_runtime(
                &root,
                Modules::default(),
                FinanceUpdate {
                    incomes: Some(true),
                    movements: Some(true),
                    repair,
                },
            )
            .unwrap_err();
            assert_eq!(error.code, "FINANCE_MODULES_VERSION");
        }
        assert_eq!(std::fs::read(interface_path(&root)).unwrap(), future);
        assert_eq!(std::fs::read(path(&root)).unwrap(), legacy_before);
        assert_eq!(std::fs::read(finance_path(&root)).unwrap(), finance_before);
    }
    #[test]
    fn physical_updates_do_not_bypass_damaged_or_newer_preference_guards() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        initialize_runtime(&root);
        let off = Modules {
            physical: false,
            ..Modules::default()
        };
        let invalid = br#"{"physical":"false","wishlist":false}"#;
        std::fs::write(path(&root), invalid).unwrap();
        assert_eq!(
            read_runtime(&root).finance_status,
            FinanceStatus::LegacyCorrupt
        );
        assert!(write_runtime(&root, off, FinanceUpdate::default()).is_err());
        assert_eq!(std::fs::read(path(&root)).unwrap(), invalid);
        write(&root, &off).unwrap();
        let future = br#"{"version":2,"new_setting":true}"#;
        std::fs::write(finance_path(&root), future).unwrap();
        assert_eq!(
            read_runtime(&root).finance_status,
            FinanceStatus::UnsupportedVersion
        );
        assert!(write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                movements: Some(true),
                repair: true,
            }
        )
        .is_err());
        assert_eq!(std::fs::read(finance_path(&root)).unwrap(), future);
        assert_eq!(read(&root), off);
    }
    #[test]
    fn account_toggle_invalidates_preview_even_when_reenabled() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        initialize_runtime(&root);
        let off = Modules {
            wealth: false,
            ..Modules::default()
        };
        assert_eq!(
            write_runtime(&root, off, FinanceUpdate::default())
                .unwrap()
                .finance_revision,
            2
        );
        assert_eq!(
            write_runtime(&root, Modules::default(), FinanceUpdate::default())
                .unwrap()
                .finance_revision,
            3
        );
        assert!(read_runtime(&root).incomes && read_runtime(&root).movements);
    }
    #[test]
    fn old_write_initializes_before_switch_and_failures_preserve_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let off = Modules {
            planning: false,
            ..Modules::default()
        };
        let changed = write_runtime(&root, off, FinanceUpdate::default()).unwrap();
        assert!(changed.incomes && changed.movements); // inherited old missing-file defaults
        let before = std::fs::read(finance_path(&root)).unwrap();
        std::fs::remove_file(path(&root)).unwrap();
        std::fs::create_dir(path(&root)).unwrap();
        assert!(write_runtime(
            &root,
            off,
            FinanceUpdate {
                incomes: Some(false),
                ..FinanceUpdate::default()
            }
        )
        .is_err());
        assert_eq!(std::fs::read(finance_path(&root)).unwrap(), before);
        let missing_parent = dir.path().join("absent/library");
        assert_eq!(
            initialize_runtime(&missing_parent).finance_status,
            FinanceStatus::WriteError
        );
        assert!(write_runtime(&missing_parent, off, FinanceUpdate::default()).is_err());
        assert!(!path(&missing_parent).exists());
        // atomic replacement of a directory fails and leaves the original intact.
        std::fs::remove_file(finance_path(&root)).unwrap();
        std::fs::create_dir(finance_path(&root)).unwrap();
        assert!(save_finance(
            &root,
            &FinancePreferences {
                version: 1,
                revision: 1,
                incomes: true,
                movements: true
            }
        )
        .is_err());
        assert!(finance_path(&root).is_dir());
    }
    #[test]
    fn corruption_requires_explicit_repair_and_future_versions_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        write(&root, &Modules::default()).unwrap();
        std::fs::write(finance_path(&root), b"broken finance").unwrap();
        let broken = initialize_runtime(&root);
        assert!(!broken.incomes && !broken.movements);
        assert_eq!(broken.finance_status, FinanceStatus::FinanceCorrupt);
        assert!(write_runtime(&root, Modules::default(), FinanceUpdate::default()).is_err());
        assert!(write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                repair: true,
                ..FinanceUpdate::default()
            }
        )
        .is_err());
        let repaired = write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(false),
                movements: Some(true),
                repair: true,
            },
        )
        .unwrap();
        assert!(!repaired.incomes && repaired.movements);
        assert!(repaired.finance_revision > 1);
        assert!(std::fs::read_dir(dir.path())
            .unwrap()
            .any(|e| std::fs::read(e.unwrap().path()).ok().as_deref() == Some(b"broken finance")));
        std::fs::write(path(&root), b"broken legacy").unwrap();
        assert_eq!(
            initialize_runtime(&root).finance_status,
            FinanceStatus::LegacyCorrupt
        );
        assert!(!read_runtime(&root).incomes && !read_runtime(&root).movements);
        write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                movements: Some(false),
                repair: true,
            },
        )
        .unwrap();
        let future = br#"{"version":2,"different":"format"}"#;
        std::fs::write(finance_path(&root), future).unwrap();
        assert_eq!(
            initialize_runtime(&root).finance_status,
            FinanceStatus::UnsupportedVersion
        );
        assert!(write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                movements: Some(true),
                repair: true
            }
        )
        .is_err());
        assert_eq!(std::fs::read(finance_path(&root)).unwrap(), future);
    }
    #[test]
    fn failed_initialization_update_and_preservation_leave_originals() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let off = Modules {
            planning: false,
            ..Modules::default()
        };
        write(&root, &off).unwrap();
        FAIL_FINANCE_WRITE.with(|flag| flag.set(true));
        assert!(write_runtime(&root, Modules::default(), FinanceUpdate::default()).is_err());
        assert_eq!(read(&root), off);
        assert!(!finance_path(&root).exists());
        assert_eq!(
            initialize_runtime(&root).finance_status,
            FinanceStatus::WriteError
        );
        FAIL_FINANCE_WRITE.with(|flag| flag.set(false));
        let initial = initialize_runtime(&root);
        FAIL_FINANCE_WRITE.with(|flag| flag.set(true));
        let error = write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                ..FinanceUpdate::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "FINANCE_MODULES_PARTIAL");
        assert!(read(&root).planning);
        FAIL_FINANCE_WRITE.with(|flag| flag.set(false));
        let after = read_runtime(&root);
        assert_eq!(after.incomes, initial.incomes);
        assert_eq!(after.movements, initial.movements);
        assert_eq!(after.finance_revision, initial.finance_revision);
        std::fs::write(finance_path(&root), b"broken").unwrap();
        let old_legacy = std::fs::read(path(&root)).unwrap();
        FAIL_PRESERVE.with(|flag| flag.set(true));
        assert!(write_runtime(
            &root,
            Modules::default(),
            FinanceUpdate {
                incomes: Some(true),
                movements: Some(true),
                repair: true
            }
        )
        .is_err());
        FAIL_PRESERVE.with(|flag| flag.set(false));
        assert_eq!(std::fs::read(finance_path(&root)).unwrap(), b"broken");
        assert_eq!(std::fs::read(path(&root)).unwrap(), old_legacy);
    }
    #[test]
    fn wire_payload_accepts_legacy_and_runtime_but_rejects_typos() {
        let legacy = serde_json::to_value(Modules::default()).unwrap();
        assert!(parse_update(legacy.clone(), None, None, None)
            .unwrap()
            .1
            .incomes
            .is_none());
        let mut runtime = legacy.clone();
        runtime["incomes"] = false.into();
        runtime["movements"] = true.into();
        runtime["finance_status"] = "ready".into();
        runtime["finance_revision"] = 2.into();
        let update = parse_update(runtime.clone(), None, None, None).unwrap().1;
        assert_eq!(update.incomes, Some(false));
        assert_eq!(update.movements, Some(true));
        assert_eq!(
            parse_update(runtime.clone(), Some(true), None, None)
                .unwrap()
                .1
                .incomes,
            Some(true)
        );
        runtime["income"] = true.into();
        assert!(parse_update(runtime, None, None, None).is_err());
        let mut invalid = legacy;
        invalid["incomes"] = "yes".into();
        assert!(parse_update(invalid, None, None, None).is_err());
    }
    #[test]
    fn queued_worker_writes_keep_independent_switches_and_revision() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let worker = crate::worker::Worker::start(root.clone()).unwrap();
        assert_eq!(read_runtime(&root).finance_revision, 1);
        assert_eq!(worker.modules().unwrap().finance_revision, 1);
        let a = worker.clone();
        let b = worker.clone();
        let one = std::thread::spawn(move || {
            a.set_modules_with_finance(
                Modules::default(),
                FinanceUpdate {
                    incomes: Some(false),
                    ..FinanceUpdate::default()
                },
            )
            .unwrap()
        });
        let two = std::thread::spawn(move || {
            b.set_modules_with_finance(
                Modules {
                    planning: false,
                    ..Modules::default()
                },
                FinanceUpdate {
                    movements: Some(false),
                    ..FinanceUpdate::default()
                },
            )
            .unwrap()
        });
        one.join().unwrap();
        two.join().unwrap();
        let last = worker.modules().unwrap();
        assert!(!last.incomes && !last.movements);
        assert_eq!(last.finance_revision, 3);
        worker.set_modules(Modules::default()).unwrap();
        assert_eq!(read_runtime(&root).finance_revision, 3);
        assert!(!initialize_runtime(&root).incomes && !initialize_runtime(&root).movements);
        worker.stop_and_join();
        let restarted = crate::worker::Worker::start(root.clone()).unwrap();
        let snapshot = restarted.modules().unwrap();
        assert_eq!(snapshot.finance_revision, 3);
        assert!(!snapshot.incomes && !snapshot.movements);
        restarted.stop_and_join();
    }
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
