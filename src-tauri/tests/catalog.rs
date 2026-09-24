use possio_lib::{
    backup::archive_hash,
    catalog::{Details, Query, SaveAsset},
    domain::{Error, Save},
    storage::Store,
};
fn input(s: &Store, name: &str, price: Option<&str>) -> SaveAsset {
    SaveAsset {
        classification: None,
        photos: None,
        base: Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: name.into(),
            price_cents: price.map(Into::into),
            purchase_date: None,
        },
        details: Details {
            brand: "虚构品牌".into(),
            model: "样例型号".into(),
            serial_number: "TEST-001".into(),
            notes: "旅行使用".into(),
        },
    }
}
fn query() -> Query {
    Query {
        category: Default::default(),
        search: String::new(),
        filter: "all".into(),
        sort: "price".into(),
        descending: false,
        offset: 0,
    }
}
#[test]
fn create_edit_retry_and_metadata_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let q = input(&s, "  虚构相机  ", None);
    let a = s.save_asset(&q, "2026-09-24").unwrap();
    assert_eq!(a.asset.name, "虚构相机");
    assert_eq!(a.asset.price_cents, None);
    assert_eq!(a.asset.purchase_date, None);
    assert!(a.created_at.is_some());
    assert_eq!(
        s.save_asset(&q, "2026-09-24").unwrap().created_at,
        a.created_at
    );
    assert_eq!(s.count().unwrap(), 1);
    let mut edit = q.clone();
    edit.base.request_id = uuid::Uuid::new_v4().to_string();
    edit.base.asset_id = Some(a.asset.id.clone());
    edit.base.expected_revision = Some(1);
    edit.base.price_cents = Some("0".into());
    edit.details.notes = "免费赠品".into();
    let b = s.save_asset(&edit, "2026-09-24").unwrap();
    assert_eq!(a.created_at, b.created_at);
    assert_eq!(b.asset.revision, 2);
    assert_eq!(b.asset.price_cents, Some("0".into()));
    edit.base.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        s.save_asset(&edit, "2026-09-24").unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let path = root.path().join("profile.possio");
    s.backup(Some(&path)).unwrap();
    let hash = archive_hash(&path).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut restored = Store::open(other.path()).unwrap();
    restored
        .restore(&path, &hash, &restored.generation())
        .unwrap();
    let c = restored.record(&a.asset.id).unwrap().unwrap();
    assert_eq!(c.details, b.details);
    assert_eq!(c.created_at, a.created_at);
    drop(s);
    let s = Store::open(root.path()).unwrap();
    assert_eq!(s.record(&a.asset.id).unwrap().unwrap().asset, b.asset);
}
#[test]
fn search_filters_null_last_paging_and_input_errors() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    for (name, price) in [("未知", None), ("免费", Some("0")), ("有价", Some("100"))] {
        s.save_asset(&input(&s, name, price), "2026-09-24").unwrap();
    }
    let mut q = query();
    let p = s.query_assets(&q, "2026-09-24").unwrap();
    assert_eq!(p.total, 3);
    assert_eq!(p.items[0].asset.name, "免费");
    assert_eq!(p.items[2].asset.name, "未知");
    q.descending = true;
    let p = s.query_assets(&q, "2026-09-24").unwrap();
    assert_eq!(p.items[0].asset.name, "有价");
    assert_eq!(p.items[2].asset.name, "未知");
    q.search = "test-001".into();
    assert_eq!(s.query_assets(&q, "2026-09-24").unwrap().total, 3);
    q.search = "旅行".into();
    q.filter = "missing_price".into();
    assert_eq!(s.query_assets(&q, "2026-09-24").unwrap().total, 1);
    q.offset = 1;
    assert!(s.query_assets(&q, "2026-09-24").unwrap().items.is_empty());
    q.sort = "name; DROP TABLE assets".into();
    assert!(s.query_assets(&q, "2026-09-24").is_err());
    let mut invalid = input(&s, " ", None);
    assert!(s.save_asset(&invalid, "2026-09-24").is_err());
    invalid.base.name = "未来".into();
    invalid.base.purchase_date = Some("2026-09-25".into());
    assert!(s.save_asset(&invalid, "2026-09-24").is_err());
    assert_eq!(s.count().unwrap(), 3);
}
#[test]
#[cfg(feature = "fault-injection")]
fn failed_and_unknown_results_do_not_duplicate_or_partially_edit() {
    for point in ["save.before_commit", "save.after_commit"] {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::open(root.path()).unwrap();
        let q = input(&s, "虚构耳机", None);
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "故障"))
            } else {
                Ok(())
            }
        });
        assert!(s.save_asset(&q, "2026-09-24").is_err());
        let receipt = s
            .saved_request(&q.base.request_id, &q.base.generation)
            .unwrap();
        assert_eq!(receipt.is_some(), point == "save.after_commit");
        s.set_hook(|_| Ok(()));
        let result = s.save_asset(&q, "2026-09-24").unwrap();
        assert_eq!(result.details, q.details);
        assert_eq!(s.count().unwrap(), 1);
        let mut changed = q.clone();
        changed.details.notes = "不能覆盖".into();
        assert_eq!(
            s.save_asset(&changed, "2026-09-24").unwrap_err().code,
            "REQUEST_CONFLICT"
        );
    }
}
