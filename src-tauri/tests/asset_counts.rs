// U16-D5：侧栏计数与点进该入口后的列表总数一致，已删除的不计。
use possio_lib::{
    catalog::{AssetRecord, Details, Query, SaveAsset},
    domain::Save,
    lifecycle,
    photos::Selection,
    storage::Store,
    trash::TrashChange,
    warranty::{Action, Change, Fields},
};

const TODAY: &str = "2026-09-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn create(s: &mut Store, name: &str) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some("100000".into()),
                purchase_date: Some("2026-01-01".into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn cover(s: &mut Store, a: &AssetRecord) -> AssetRecord {
    s.change_warranty(
        &Change {
            reminder: None,
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action: Action::Add {
                fields: Fields {
                    kind: "manufacturer".into(),
                    provider: "虚构保障方".into(),
                    start_date: Some("2026-01-01".into()),
                    end_date: Some("2027-01-01".into()),
                    notes: String::new(),
                },
                photos: Selection {
                    ids: vec![],
                    cover_id: None,
                },
            },
        },
        TODAY,
    )
    .unwrap()
}
fn retire(s: &mut Store, a: &AssetRecord) -> AssetRecord {
    s.change_lifecycle(
        &lifecycle::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action: lifecycle::Action::Append {
                kind: lifecycle::Kind::Retire,
                date: "2026-09-01".into(),
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn list_total(s: &Store, filter: &str, warranty: &str) -> i64 {
    s.query_assets(
        &Query {
            search: String::new(),
            filter: filter.into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
            category: Default::default(),
            warranty: warranty.into(),
            label: None,
        },
        TODAY,
    )
    .unwrap()
    .total
}

#[test]
fn counts_match_the_sidebar_lists_and_skip_deleted() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构保障中笔记本");
    cover(&mut s, &a);
    let b = create(&mut s, "虚构退役相机");
    let b = cover(&mut s, &b);
    retire(&mut s, &b);
    create(&mut s, "虚构无保障耳机");
    let gone = create(&mut s, "虚构已删除键盘");
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: gone.asset.id.clone(),
        expected_revision: gone.asset.revision,
        deleted: true,
    })
    .unwrap();

    let c = s.asset_counts(TODAY).unwrap();
    assert_eq!(
        (c.all, c.active, c.covered, c.retired, c.sold),
        (3, 2, 2, 1, 0)
    );
    assert_eq!(c.all, list_total(&s, "all", "all"));
    assert_eq!(c.active, list_total(&s, "active", "all"));
    assert_eq!(c.covered, list_total(&s, "held", "covered"));
    assert_eq!(c.retired, list_total(&s, "retired", "all"));
    assert_eq!(c.sold, list_total(&s, "sold", "all"));
    assert_eq!(c.generation, s.generation());
}
