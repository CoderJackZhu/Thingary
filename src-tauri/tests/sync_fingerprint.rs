use std::time::{Duration, Instant};

use thingary_lib::{domain::Save, storage::Store, sync::fingerprint::fingerprint};

fn save(store: &mut Store, name: &str) {
    store
        .save(
            &Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: store.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some("129900".into()),
                purchase_date: Some("2026-10-23".into()),
            },
            "2026-10-23",
        )
        .unwrap();
}

#[test]
fn fingerprint_is_repeatable_and_changes_with_any_business_row() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::open(temp.path()).unwrap();
    let empty = fingerprint(&store).unwrap();
    let repeated = fingerprint(&store).unwrap();
    assert_eq!(empty, repeated);
    assert!(empty.empty);

    save(&mut store, "虚构相机");
    let changed = fingerprint(&store).unwrap();
    assert_ne!(empty.digest, changed.digest);
    assert!(!changed.empty);
    assert_eq!(
        changed.schema_version as i64,
        thingary_lib::storage::SCHEMA_VERSION
    );
    assert!(
        changed
            .table_counts
            .get("assets")
            .copied()
            .unwrap_or_default()
            >= 1
    );
    assert_eq!(changed, fingerprint(&store).unwrap());
}

#[test]
fn ten_thousand_fictional_rows_have_a_bounded_deterministic_measurement() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let generation = store.generation();
    let dataset = std::fs::read_dir(temp.path().join("datasets"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.join("data.sqlite").exists())
        .unwrap();
    let mut connection = rusqlite::Connection::open(dataset.join("data.sqlite")).unwrap();
    let tx = connection.transaction().unwrap();
    {
        let mut stmt = tx
            .prepare("INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES(?1,?2,100,'2026-10-23',1)")
            .unwrap();
        for i in 0..10_000 {
            stmt.execute((format!("fictional-{i:05}"), format!("虚构物品 {i:05}")))
                .unwrap();
        }
    }
    tx.commit().unwrap();
    assert!(!generation.is_empty());

    let started = Instant::now();
    let first = fingerprint(&store).unwrap();
    let elapsed = started.elapsed();
    assert_eq!(first, fingerprint(&store).unwrap());
    assert_eq!(first.table_counts.get("assets"), Some(&10_000));
    assert!(
        elapsed < Duration::from_secs(10),
        "fingerprint took {elapsed:?}"
    );
}
