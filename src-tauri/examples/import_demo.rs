//! Explicit developer tool for the legacy isolated fictional acceptance library only.
//! The application imports into its separate demo library through `demo::import`.
#[cfg(test)]
use possio_lib::{catalog::SaveAsset, domain::Save, lifecycle};
use possio_lib::{demo, storage::Store};
#[cfg(test)]
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn import(
    s: &mut Store,
    today: &str,
) -> possio_lib::domain::Result<Vec<possio_lib::catalog::AssetRecord>> {
    demo::import(s, today)
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
                warranty: "all".into(),
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
