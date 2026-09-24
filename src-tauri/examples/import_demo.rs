//! Explicit developer tool for the isolated fictional acceptance library only.
//! Not registered as an IPC command and never called at application startup.
use possio_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Error, Result, Save},
    lifecycle, maintenance,
    photos::Selection,
    sales,
    storage::Store,
    taxonomy::{self, Classification},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Demo {
    key: String,
    name: String,
    brand: String,
    model: String,
    price_cents: Option<String>,
    purchase_date: Option<String>,
    category: String,
    icon: taxonomy::Icon,
    channel: Option<String>,
    notes: String,
    retired_on: Option<String>,
    sale: Option<sales::Fields>,
    maintenance: Option<maintenance::Fields>,
}
fn request(key: &str, step: &str) -> String {
    let hash = Sha256::digest(format!("possio.original-demo.v1:{key}:{step}"));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    uuid::Uuid::from_bytes(bytes).to_string()
}
fn photo(key: &str) -> &'static [u8] {
    match key {
        "laptop" => include_bytes!("../../docs/ui/demo-photos/laptop.png"),
        "camera" => include_bytes!("../../docs/ui/demo-photos/camera.png"),
        "headphones" => include_bytes!("../../docs/ui/demo-photos/headphones.png"),
        "phone" => include_bytes!("../../docs/ui/demo-photos/phone.png"),
        "tablet" => include_bytes!("../../docs/ui/demo-photos/tablet.png"),
        "keyboard" => include_bytes!("../../docs/ui/demo-photos/keyboard.png"),
        "coffee" => include_bytes!("../../docs/ui/demo-photos/coffee.png"),
        "box" => include_bytes!("../../docs/ui/demo-photos/box.png"),
        _ => unreachable!("checked-in Demo key"),
    }
}
fn option(
    s: &mut Store,
    kind: taxonomy::Kind,
    name: &str,
    icon: Option<taxonomy::Icon>,
) -> Result<String> {
    let snapshot = s.taxonomy_snapshot()?;
    let entries = match kind {
        taxonomy::Kind::Category => &snapshot.categories,
        taxonomy::Kind::Channel => &snapshot.channels,
    };
    if let Some(entry) = entries.iter().find(|e| e.name == name) {
        return Ok(entry.id.clone());
    }
    // A fresh request is appropriate here: name lookup deduplicates already-created options.
    let next = s.change_taxonomy(&taxonomy::Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: snapshot.generation,
        expected_revision: snapshot.revision,
        command: taxonomy::Command::Create {
            kind,
            name: name.into(),
            icon,
        },
    })?;
    let entries = match kind {
        taxonomy::Kind::Category => next.categories,
        taxonomy::Kind::Channel => next.channels,
    };
    entries
        .into_iter()
        .find(|e| e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| Error::new("DEMO", "示例分类未能创建"))
}
fn import_one(s: &mut Store, a: &Demo, today: &str) -> Result<AssetRecord> {
    let generation = s.generation();
    let create_request = request(&a.key, "create");
    let record = if let Some(record) = s.saved_request(&create_request, &generation)? {
        record
    } else {
        let category_id = option(s, taxonomy::Kind::Category, &a.category, Some(a.icon))?;
        let channel_id = a
            .channel
            .as_ref()
            .map(|name| option(s, taxonomy::Kind::Channel, name, None))
            .transpose()?;
        let cover = s.stage_photo(
            &format!("原始 Demo 示意图（非实物照片）-{}.png", a.key),
            photo(&a.key),
            &generation,
            None,
        )?;
        s.save_asset(
            &SaveAsset {
                base: Save {
                    request_id: create_request,
                    generation: generation.clone(),
                    asset_id: None,
                    expected_revision: None,
                    name: a.name.clone(),
                    price_cents: a.price_cents.clone(),
                    purchase_date: a.purchase_date.clone(),
                },
                details: Details {
                    brand: a.brand.clone(),
                    model: a.model.clone(),
                    serial_number: String::new(),
                    notes: format!(
                        "{}\n\n原始 Demo 虚构样例，可编辑体验；图片为示意图。",
                        a.notes
                    ),
                },
                photos: Some(Selection {
                    ids: vec![cover.id.clone()],
                    cover_id: Some(cover.id),
                }),
                classification: Some(Classification {
                    category_id: Some(category_id),
                    channel_id,
                }),
            },
            today,
        )?
    };
    // Never infer the expected revision from a subsequently edited record. Partial imports
    // resume only at their original revision; completed imports never overwrite user edits.
    let mut expected_revision = 1;
    if let Some(fields) = &a.maintenance {
        let id = request(&a.key, "maintenance");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_maintenance(
                &maintenance::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: maintenance::Action::Add {
                        fields: fields.clone(),
                        photos: Selection {
                            ids: vec![],
                            cover_id: None,
                        },
                    },
                },
                today,
            )?;
        }
        expected_revision += 1;
    }
    if let Some(date) = &a.retired_on {
        let id = request(&a.key, "retire");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_lifecycle(
                &lifecycle::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: lifecycle::Action::Append {
                        kind: lifecycle::Kind::Retire,
                        date: date.clone(),
                        notes: "原始 Demo：留作备用机".into(),
                    },
                },
                today,
            )?;
        }
        expected_revision += 1;
    }
    if let Some(fields) = &a.sale {
        let id = request(&a.key, "sale");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_sale(
                &sales::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: sales::Action::Sell {
                        fields: fields.clone(),
                    },
                },
                today,
            )?;
        }
    }
    s.record(&record.asset.id)?
        .ok_or_else(|| Error::new("DEMO", "示例档案读取失败"))
}
fn import(s: &mut Store, today: &str) -> Result<Vec<AssetRecord>> {
    let data: Vec<Demo> = serde_json::from_str(include_str!("../../src/demo-assets.json"))?;
    let mut output = Vec::new();
    for a in data.iter().rev() {
        output.push(import_one(s, a, today)?);
    }
    output.reverse();
    Ok(output)
}
fn allowed_root(home: &Path, requested: &Path) -> std::io::Result<bool> {
    let expected = home.join("Library/Application Support/local.possio.t06b.preview/library");
    // Reject symlinks as well as other library identifiers, including the main preview.
    let canonical = expected.canonicalize()?;
    Ok(requested == expected && canonical == expected)
}
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).as_deref() != Some("--isolated-preview")
        || std::env::args().len() != 2
    {
        return Err("Usage: cargo run --example import_demo -- --isolated-preview (quit the isolated App first)".into());
    }
    let home = PathBuf::from(std::env::var("HOME")?);
    let root = home.join("Library/Application Support/local.possio.t06b.preview/library");
    if !allowed_root(&home, &root)? {
        return Err("Refusing a non-isolated or redirected library".into());
    }
    let mut store = Store::open(&root)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let records = import(&mut store, &today)?;
    for r in records {
        println!(
            "{} | {} | {:?} | {} photo(s)",
            r.asset.id,
            r.asset.name,
            r.lifecycle.state,
            r.photos.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use possio_lib::catalog::Query;
    const TODAY: &str = "2026-09-25";
    fn count(s: &Store) -> i64 {
        s.query_assets(
            &Query {
                search: String::new(),
                filter: "all".into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
                category: Default::default(),
            },
            TODAY,
        )
        .unwrap()
        .total
    }
    #[test]
    fn eight_original_samples_persist_and_repeat_import_preserves_edits_and_other_assets() {
        let temp = tempfile::tempdir().unwrap();
        let mut s = Store::open(temp.path()).unwrap();
        let unrelated = s
            .save_asset(
                &SaveAsset {
                    base: Save {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        generation: s.generation(),
                        asset_id: None,
                        expected_revision: None,
                        name: "既有虚构记录".into(),
                        price_cents: None,
                        purchase_date: None,
                    },
                    details: Default::default(),
                    photos: None,
                    classification: None,
                },
                TODAY,
            )
            .unwrap();
        let first = import(&mut s, TODAY).unwrap();
        assert_eq!(count(&s), 9);
        assert_eq!(first.len(), 8);
        let mut hashes = std::collections::HashSet::new();
        for r in &first {
            assert_eq!(r.photos.len(), 1);
            assert_eq!(r.cover_id.as_deref(), Some(r.photos[0].id.as_str()));
            hashes.insert(Sha256::digest(
                s.photo_preview(&r.photos[0].id, &s.generation()).unwrap(),
            ));
        }
        assert_eq!(
            hashes.len(),
            8,
            "each object keeps its own original artwork"
        );
        assert_eq!(first[3].lifecycle.state, lifecycle::State::Retired);
        assert_eq!(first[3].costs.known_maintenance_cents, "51900");
        assert_eq!(first[4].lifecycle.state, lifecycle::State::Sold);
        assert_eq!(first[4].costs.net_cost_cents.as_deref(), Some("299900"));
        assert_eq!(first[5].asset.price_cents.as_deref(), Some("0"));
        assert!(first[6].asset.price_cents.is_none());
        assert!(first[7].asset.purchase_date.is_none());
        let edited = s
            .save_asset(
                &SaveAsset {
                    base: Save {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        generation: s.generation(),
                        asset_id: Some(first[0].asset.id.clone()),
                        expected_revision: Some(first[0].asset.revision),
                        name: "已编辑 Demo".into(),
                        price_cents: first[0].asset.price_cents.clone(),
                        purchase_date: first[0].asset.purchase_date.clone(),
                    },
                    details: first[0].details.clone(),
                    photos: None,
                    classification: None,
                },
                TODAY,
            )
            .unwrap();
        drop(s);
        let mut s = Store::open(temp.path()).unwrap();
        let again = import(&mut s, TODAY).unwrap();
        assert_eq!(count(&s), 9);
        assert_eq!(again[0].asset, edited.asset);
        for (a, b) in first.iter().zip(&again).skip(1) {
            assert_eq!(a.asset, b.asset);
            assert_eq!(a.photos, b.photos);
        }
        assert_eq!(
            s.record(&unrelated.asset.id).unwrap().unwrap().asset,
            unrelated.asset
        );
    }
    #[test]
    fn command_rejects_other_libraries_and_redirected_isolated_library() {
        let temp = tempfile::tempdir().unwrap();
        // canonicalize tempfile first, because macOS /var is itself an OS symlink.
        let home = temp.path().canonicalize().unwrap();
        let root = home.join("Library/Application Support/local.possio.t06b.preview/library");
        std::fs::create_dir_all(&root).unwrap();
        assert!(allowed_root(&home, &root).unwrap());
        assert!(!allowed_root(
            &home,
            &home.join("Library/Application Support/local.possio.preview/library")
        )
        .unwrap());
        std::fs::remove_dir(&root).unwrap();
        let other = home.join("other");
        std::fs::create_dir(&other).unwrap();
        std::os::unix::fs::symlink(&other, &root).unwrap();
        assert!(!allowed_root(&home, &root).unwrap());
    }
}
