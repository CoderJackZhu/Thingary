use possio_lib::{
    backup::archive_hash,
    catalog::{Details, Query, SaveAsset},
    domain::{Error, Save},
    storage::Store,
};
fn input(s: &Store, name: &str, price: Option<&str>) -> SaveAsset {
    SaveAsset {
        options: None,
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
        warranty: "all".into(),
        label: None,
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
#[test]
fn daily_cost_sort_puts_per_use_and_unknowns_last_and_tags_filter() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let today = "2026-09-24";
    let snap = s.choices("label").unwrap();
    assert!(snap.items.is_empty(), "new libraries start without tags");
    let change: possio_lib::choices::Change = serde_json::from_value(serde_json::json!({"request_id": uuid::Uuid::new_v4().to_string(), "generation": s.generation(), "expected_revision": snap.revision, "kind": "label", "action": {"type": "create", "name": "工作用"}})).unwrap();
    let tag = s.change_choices(&change).unwrap().items[0].id.clone();
    // 10 days held on 2026-09-24: 1000 → 100/day, 3000 → 300/day; sold: (5000−4000) over 5 days → 200/day.
    for (name, price, date, prefs, sale) in [
        (
            "日均一百",
            Some("1000"),
            Some("2026-09-15"),
            serde_json::json!({"cost_mode": "daily", "label_id": tag}),
            None,
        ),
        (
            "日均三百",
            Some("3000"),
            Some("2026-09-15"),
            serde_json::json!({"cost_mode": "daily"}),
            None,
        ),
        (
            "售出两百",
            Some("5000"),
            Some("2026-09-01"),
            serde_json::json!({"cost_mode": "daily"}),
            Some(
                serde_json::json!({"date": "2026-09-05", "price_cents": "4000", "platform": "", "buyer": "", "notes": ""}),
            ),
        ),
        (
            "按次",
            Some("100"),
            Some("2026-09-15"),
            serde_json::json!({"cost_mode": "per_use", "use_count": 1}),
            None,
        ),
        (
            "价格未知",
            None,
            Some("2026-09-15"),
            serde_json::json!({"cost_mode": "daily"}),
            None,
        ),
    ] {
        let mut i = input(&s, name, price);
        i.base.purchase_date = date.map(Into::into);
        i.options = Some(serde_json::from_value(serde_json::json!({"preferences": prefs, "warranty": null, "retired_date": null, "sale": sale})).unwrap());
        s.save_asset(&i, today).unwrap();
    }
    let names = |q: &Query, s: &Store| {
        s.query_assets(q, today)
            .unwrap()
            .items
            .into_iter()
            .map(|r| r.asset.name)
            .collect::<Vec<_>>()
    };
    let mut q = query();
    q.sort = "daily".into();
    assert_eq!(names(&q, &s)[..3], ["日均一百", "售出两百", "日均三百"]);
    q.descending = true;
    let desc = names(&q, &s);
    assert_eq!(desc[..3], ["日均三百", "售出两百", "日均一百"]);
    assert!(desc[3..].contains(&"按次".to_string()) && desc[3..].contains(&"价格未知".to_string()));
    q.label = Some(tag.clone());
    assert_eq!(names(&q, &s), ["日均一百"]);
    q.label = Some("none".into());
    assert_eq!(names(&q, &s).len(), 4);
    q.label = Some("x' OR 1=1 --".into());
    assert!(s.query_assets(&q, today).is_err());
}
