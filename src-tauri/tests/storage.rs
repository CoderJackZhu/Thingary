use possio_lib::{
    domain::{Error, Save},
    storage::Store,
};
fn input(s: &Store) -> Save {
    Save {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: None,
        expected_revision: None,
        name: "虚构相机".into(),
        price_cents: Some("100000".into()),
        purchase_date: Some("2026-09-15".into()),
    }
}
#[test]
fn persistence_idempotency_conflicts_and_lock() {
    let temp = tempfile::tempdir().unwrap();
    let mut s = Store::open(temp.path()).unwrap();
    assert_eq!(Store::open(temp.path()).err().unwrap().code, "LOCKED");
    let q = input(&s);
    let a = s.save(&q, "2026-09-24").unwrap();
    assert_eq!(s.save(&q, "2026-09-24").unwrap(), a);
    assert_eq!(s.count().unwrap(), 1);
    let mut changed = q.clone();
    changed.name = "别的物品".into();
    assert_eq!(
        s.save(&changed, "2026-09-24").unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let mut edit = input(&s);
    edit.asset_id = Some(a.id.clone());
    edit.expected_revision = Some(1);
    edit.name = "补录".into();
    assert_eq!(s.save(&edit, "2026-09-24").unwrap().revision, 2);
    edit.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        s.save(&edit, "2026-09-24").unwrap_err().code,
        "REVISION_CONFLICT"
    );
    println!("SQLite {}", s.sqlite_version().unwrap());
    drop(s);
    let s = Store::open(temp.path()).unwrap();
    assert_eq!(s.asset(&a.id).unwrap().unwrap().name, "补录");
}
#[cfg(feature = "fault-injection")]
#[test]
fn atomic_save_and_lost_receipt() {
    for point in ["save.before_commit", "save.after_commit"] {
        let temp = tempfile::tempdir().unwrap();
        let mut s = Store::open(temp.path()).unwrap();
        let q = input(&s);
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "模拟故障"))
            } else {
                Ok(())
            }
        });
        assert!(s.save(&q, "2026-09-24").is_err());
        drop(s);
        let mut s = Store::open(temp.path()).unwrap();
        assert_eq!(
            s.count().unwrap(),
            if point == "save.before_commit" { 0 } else { 1 }
        );
        let a = s.save(&q, "2026-09-24").unwrap();
        assert_eq!(s.save(&q, "2026-09-24").unwrap(), a);
        assert_eq!(s.count().unwrap(), 1);
    }
}
#[test]
fn missing_pointer_never_recreates_existing_data() {
    let temp = tempfile::tempdir().unwrap();
    let s = Store::open(temp.path()).unwrap();
    drop(s);
    std::fs::remove_file(temp.path().join("active.json")).unwrap();
    assert_eq!(Store::open(temp.path()).err().unwrap().code, "RECOVERY");
}
