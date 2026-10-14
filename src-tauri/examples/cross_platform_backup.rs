//! Portable fictional fixture for macOS -> Windows and Windows -> macOS checks.
//! Run with --features fault-injection; every output directory must be new.
#[cfg(feature = "fault-injection")]
mod fixture {
    use sha2::{Digest, Sha256};
    use std::{collections::BTreeMap, fs, path::Path};
    use thingary_lib::{backup::archive_hash, storage::Store};

    fn snapshot(
        store: &Store,
        library: &Path,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let db = store.conn_for_test()?;
        let names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut tables = BTreeMap::new();
        for name in names {
            let quoted = name.replace('"', "\"\"");
            let count: i64 =
                db.query_row(&format!("SELECT count(*) FROM \"{quoted}\""), [], |r| {
                    r.get(0)
                })?;
            tables.insert(name, count);
        }
        let active: serde_json::Value =
            serde_json::from_slice(&fs::read(library.join("active.json"))?)?;
        let dataset = library
            .join("datasets")
            .join(active["id"].as_str().ok_or("missing dataset ID")?);
        let mut files = BTreeMap::new();
        if dataset.join("files").exists() {
            for entry in fs::read_dir(dataset.join("files"))? {
                let entry = entry?;
                if !fs::symlink_metadata(entry.path())?.is_file() {
                    return Err("unexpected non-file fixture payload".into());
                }
                let bytes = fs::read(entry.path())?;
                files.insert(
                    entry.file_name().to_string_lossy().into_owned(),
                    format!("{:x}", Sha256::digest(bytes)),
                );
            }
        }
        Ok(
            serde_json::json!({ "schema": thingary_lib::storage::SCHEMA_VERSION, "tables": tables, "files": files }),
        )
    }

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        let (mode, archive, output) = match args.as_slice() {
            [mode, output] if mode == "create" => ("create", None, output),
            [mode, archive, output] if mode == "restore" => {
                ("restore", Some(Path::new(archive)), output)
            }
            _ => return Err(
                "Usage: cross_platform_backup create NEW_DIRECTORY | restore ARCHIVE NEW_DIRECTORY"
                    .into(),
            ),
        };
        let output = Path::new(output);
        if output.exists()
            || output.components().any(|part| {
                part.as_os_str()
                    .to_string_lossy()
                    .contains("local.thingary.main")
            })
        {
            return Err(
                "fixture output must be a new directory outside the formal identity".into(),
            );
        }
        fs::create_dir_all(output)?;
        let library = output.join("fictional-library");
        let mut store = Store::open(&library)?;
        if mode == "create" {
            thingary_lib::demo::prepare_fixture(&mut store, "2026-10-13")?;
        } else {
            let archive = archive.ok_or("missing archive")?;
            let hash = archive_hash(archive)?;
            let generation = store.generation();
            store.restore(archive, &hash, &generation)?;
        }
        let summary = snapshot(&store, &library)?;
        fs::write(
            output.join("snapshot.json"),
            serde_json::to_vec_pretty(&summary)?,
        )?;
        store.backup(Some(&output.join("fixture.thingary")))?;
        println!("{}", serde_json::to_string(&summary)?);
        Ok(())
    }
}
#[cfg(feature = "fault-injection")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    fixture::run()
}
#[cfg(not(feature = "fault-injection"))]
fn main() {
    eprintln!("cross_platform_backup requires --features fault-injection");
    std::process::exit(2);
}
