//! Explicit fictional backup portability fixture. Never discovers an App library.
//! Each invocation requires a brand-new isolation root and explicit output paths.
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
};
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save,
    photos::Selection,
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const TODAY: &str = "2026-10-21";
const USAGE: &str = "Usage: ios_portability seed|inspect|restore --isolated-fictional --root ABS_NEW_DIRECTORY --backup ABS_FILE --summary ABS_NEW_JSON [--compare ABS_BASELINE_JSON]\nseed creates a fictional plaintext .thingary backup; inspect validates without restoring; restore replaces only its newly created temporary Store and compares canonical facts when --compare is supplied.";

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Table {
    columns: Vec<String>,
    row_count: usize,
    sha256: String,
    rows: Vec<serde_json::Value>,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Original {
    bytes: u64,
    sha256: String,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Canonical {
    format: u32,
    schema: u32,
    tables: BTreeMap<String, Table>,
    originals: BTreeMap<String, Original>,
    business_sha256: String,
}
struct Arguments {
    mode: String,
    root: PathBuf,
    backup: PathBuf,
    summary: PathBuf,
    compare: Option<PathBuf>,
}
fn forbidden(path: &Path) -> bool {
    let text = path.to_string_lossy().replace('\\', "/").to_lowercase();
    text.contains("local.thingary.main")
        || text.contains("/library/application support/")
        || text.contains("/library/containers/")
        || text.contains("/library/group containers/")
        || text.contains("/appdata/")
}
/// Resolve existing parents before any creation, so aliases cannot redirect
/// an apparently isolated path into an application identity directory.
fn explicit_path(text: &str) -> Result<PathBuf> {
    let path = Path::new(text);
    if !path.is_absolute()
        || path.components().any(|p| matches!(p, Component::ParentDir))
        || forbidden(path)
    {
        return Err(
            "All paths must be explicit absolute isolation paths, outside App data directories"
                .into(),
        );
    }
    let mut existing = path;
    let mut suffix = Vec::new();
    while !existing.exists() {
        suffix.push(existing.file_name().ok_or("Invalid path")?.to_owned());
        existing = existing.parent().ok_or("No existing parent")?;
    }
    let mut resolved = existing.canonicalize()?;
    for component in suffix.iter().rev() {
        resolved.push(component);
    }
    if forbidden(&resolved) {
        return Err("Refusing an App library or redirected formal identity path".into());
    }
    Ok(resolved)
}
fn parse() -> Result<Arguments> {
    let mut args = std::env::args().skip(1);
    let mode = args.next().ok_or(USAGE)?;
    if !["seed", "inspect", "restore"].contains(&mode.as_str()) {
        return Err(USAGE.into());
    }
    let mut flags = BTreeMap::new();
    let mut consent = false;
    while let Some(flag) = args.next() {
        if flag == "--isolated-fictional" && !consent {
            consent = true;
        } else if ["--root", "--backup", "--summary", "--compare"].contains(&flag.as_str()) {
            let value = args.next().ok_or(USAGE)?;
            if flags.insert(flag, value).is_some() {
                return Err("Duplicate option".into());
            }
        } else {
            return Err(USAGE.into());
        }
    }
    if !consent {
        return Err("Explicit --isolated-fictional acknowledgement is required".into());
    }
    let root = explicit_path(flags.get("--root").ok_or(USAGE)?)?;
    let backup = explicit_path(flags.get("--backup").ok_or(USAGE)?)?;
    let summary = explicit_path(flags.get("--summary").ok_or(USAGE)?)?;
    let compare = flags
        .get("--compare")
        .map(|value| explicit_path(value))
        .transpose()?;
    if root.exists() || summary.exists() || (mode == "seed" && backup.exists()) {
        return Err(
            "Isolation root and output files must not already exist; nothing is overwritten".into(),
        );
    }
    for path in [&root, &backup, &summary] {
        if !path.parent().is_some_and(Path::is_dir) {
            return Err("Create the explicit parent directories first".into());
        }
    }
    if mode != "seed" && !backup.is_file() {
        return Err("The explicitly selected input backup must be a regular file".into());
    }
    if backup.extension().and_then(|v| v.to_str()) != Some("thingary") {
        return Err(
            "This fixture supports plaintext .thingary only; encrypted portability is not verified"
                .into(),
        );
    }
    Ok(Arguments {
        mode,
        root,
        backup,
        summary,
        compare,
    })
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn seed(store: &mut Store) -> Result<()> {
    let request = id();
    let account = store.wealth_account_save(
        &AccountSave {
            request_id: request.clone(),
            generation: store.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: "虚构跨平台储蓄账户".into(),
                institution: "虚构测试银行".into(),
                side: "asset".into(),
                kind: "cash".into(),
                counted: true,
                opened_on: "2026-01-01".into(),
                closed_on: None,
                notes: "仅跨平台备份验收；非真实资料".into(),
                purchase_cents: None,
                purchased_on: None,
                group_id: None,
                currency: "CNY".into(),
                holding_mode: false,
                holding_unit: None,
            },
        },
        TODAY,
    )?;
    if store
        .wealth_request_result(&request, &store.generation())?
        .as_deref()
        != Some(&account.id)
    {
        return Err("Account receipt mismatch".into());
    }
    let request = id();
    let snapshot = store.wealth_snapshot_save(
        &SnapshotSave {
            close_accounts: Vec::new(),
            request_id: request.clone(),
            generation: store.generation(),
            id: None,
            expected_revision: None,
            date: TODAY.into(),
            notes: "虚构完整盘点，金额为整数分".into(),
            entries: vec![EntryInput {
                account_id: account.id,
                state: "entered".into(),
                amount_cents: Some("1234500".into()),
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            }],
        },
        TODAY,
    )?;
    if !snapshot.missing.is_empty()
        || store
            .wealth_request_result(&request, &store.generation())?
            .as_deref()
            != Some(&snapshot.id)
    {
        return Err("Complete check-in or receipt mismatch".into());
    }
    let mut png = Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(32, 16, image::Rgba([30, 120, 220, 255]))
        .write_to(&mut png, image::ImageFormat::Png)?;
    let photo = store.stage_photo(
        "虚构32x16蓝色图片.png",
        png.get_ref(),
        &store.generation(),
        None,
    )?;
    let request = id();
    let asset = store.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: request.clone(),
                generation: store.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构跨平台相机".into(),
                price_cents: Some("1234500".into()),
                purchase_date: Some(TODAY.into()),
            },
            details: Details {
                brand: "虚构品牌".into(),
                model: "Portability 32x16".into(),
                serial_number: String::new(),
                notes: "仅用于桌面和 iOS 互通验收".into(),
            },
            photos: Some(Selection {
                ids: vec![photo.id.clone()],
                cover_id: Some(photo.id),
            }),
            classification: None,
        },
        TODAY,
    )?;
    if store
        .saved_request(&request, &store.generation())?
        .map(|record| record.asset.id)
        != Some(asset.asset.id)
    {
        return Err("Asset receipt mismatch".into());
    }
    Ok(())
}
/// All SQLite user tables are facts or receipt history. Identity/generation,
/// active.json, staging, cached thumbnails and backup timestamps live outside
/// these tables and are deliberately absent from this canonical representation.
fn canonical(archive_path: &Path, scratch: &Path) -> Result<Canonical> {
    let mut archive = zip::ZipArchive::new(File::open(archive_path)?)?;
    let database = tempfile::NamedTempFile::new_in(scratch)?;
    let mut writer = database.reopen()?;
    std::io::copy(&mut archive.by_name("data.sqlite")?, &mut writer)?;
    writer.sync_all()?;
    drop(writer);
    let connection =
        Connection::open_with_flags(database.path(), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let schema = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let table_names = connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut tables = BTreeMap::new();
    for name in table_names {
        let escaped = name.replace('"', "\"\"");
        let mut statement = connection.prepare(&format!("SELECT * FROM \"{escaped}\""))?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let mut rows = statement.query_map([], |row| {
            let mut cells = Vec::new();
            for index in 0..columns.len() {
                let cell = match row.get_ref(index)? {
                    ValueRef::Null => serde_json::json!({"type":"null"}),
                    ValueRef::Integer(value) => serde_json::json!({"type":"integer","value":value.to_string()}),
                    ValueRef::Real(value) => serde_json::json!({"type":"real_bits","value":format!("{:016x}",value.to_bits())}),
                    ValueRef::Text(value) => match std::str::from_utf8(value) {
                        Ok(value) => serde_json::json!({"type":"text","value":value}),
                        Err(_) => serde_json::json!({"type":"text_bytes","value":hex(value)}),
                    },
                    ValueRef::Blob(value) => serde_json::json!({"type":"blob","value":hex(value)}),
                };
                cells.push(cell);
            }
            Ok(serde_json::Value::Array(cells))
        })?.collect::<std::result::Result<Vec<_>, _>>()?;
        rows.sort_by_cached_key(serde_json::Value::to_string);
        let sha256 = hash(&serde_json::to_vec(&(&columns, &rows))?);
        tables.insert(
            name,
            Table {
                columns,
                row_count: rows.len(),
                sha256,
                rows,
            },
        );
    }
    drop(connection);
    let mut originals = BTreeMap::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        if !file.name().starts_with("files/") {
            continue;
        }
        let name = file.name().to_owned();
        let mut hasher = Sha256::new();
        let bytes = std::io::copy(&mut file, &mut hasher)?;
        originals.insert(
            name,
            Original {
                bytes,
                sha256: format!("{:x}", hasher.finalize()),
            },
        );
    }
    let business_sha256 = hash(&serde_json::to_vec(&(schema, &tables, &originals))?);
    Ok(Canonical {
        format: 1,
        schema,
        tables,
        originals,
        business_sha256,
    })
}
fn main() -> Result<()> {
    let args = parse()?;
    // create_dir is the isolation guarantee: this executable cannot open any
    // pre-existing Store, even if a caller supplied a misleading path name.
    fs::create_dir(&args.root)?;
    let mut store = Store::open(&args.root)?;
    if args.mode == "seed" {
        seed(&mut store)?;
        store.backup(Some(&args.backup))?;
    }
    let inspection = store.inspect_backup(&args.backup)?;
    let actual_archive = if args.mode == "restore" {
        store.restore(&args.backup, &inspection.hash, &store.generation())?;
        let archive = args.root.join("restored-reexport.thingary");
        store.backup(Some(&archive))?;
        archive
    } else {
        args.backup.clone()
    };
    let actual = canonical(&actual_archive, &args.root)?;
    let matched = if let Some(compare) = &args.compare {
        let expected: Canonical = serde_json::from_reader(File::open(compare)?)?;
        Some(actual == expected)
    } else {
        None
    };
    let mut summary = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&args.summary)?;
    serde_json::to_writer_pretty(&mut summary, &actual)?;
    summary.write_all(b"\n")?;
    summary.sync_all()?;
    let table_counts: BTreeMap<_, _> = actual
        .tables
        .iter()
        .map(|(name, table)| (name, table.row_count))
        .collect();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "mode":args.mode,"root":args.root,"backup":args.backup,"summary":args.summary,
            "inspection":inspection,"business_sha256":actual.business_sha256,"tables":table_counts,
            "originals":actual.originals,"compare_matches":matched,"encrypted_verified":false
        }))?
    );
    if matched == Some(false) {
        return Err("Canonical business facts differ; inspect the two summary JSON files".into());
    }
    Ok(())
}
