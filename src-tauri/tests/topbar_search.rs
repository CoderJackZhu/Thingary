//! U12 page search: backend filtering for the paginated lists (assets, recent
//! trash) must run before pagination — `total` counts every match and a
//! unique hit on a later page is still found. Tag names are searchable for
//! assets; the expense view carries standalone notes for search.

use possio_lib::{
    batch::{Change, Item},
    catalog::{AssetRecord, Details, Query, SaveAsset},
    domain::Save,
    storage::Store,
};

const TODAY: &str = "2026-09-29";

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
                purchase_date: Some("2026-09-01".into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}

fn query(search: &str, offset: u32) -> Query {
    Query {
        search: search.into(),
        filter: "all".into(),
        sort: "created".into(),
        descending: true,
        offset,
        category: Default::default(),
        warranty: "all".into(),
        label: None,
    }
}

fn create_label(s: &mut Store, name: &str) -> String {
    let snap = s.choices("label").unwrap();
    let create: possio_lib::choices::Change = serde_json::from_value(serde_json::json!({
        "request_id": uuid::Uuid::new_v4().to_string(),
        "generation": s.generation(),
        "expected_revision": snap.revision,
        "kind": "label",
        "action": {"type": "create", "name": name}
    }))
    .unwrap();
    s.change_choices(&create).unwrap().items[0].id.clone()
}

fn label_item(s: &Store, asset_id: &str, label: &str) -> Item {
    Item {
        asset_id: asset_id.into(),
        expected_revision: s.record(asset_id).unwrap().unwrap().asset.revision,
        category_id: None,
        channel_id: None,
        label_id: Some(Some(label.into())),
        exclude: None,
        date: None,
        warranty: None,
        sale: None,
    }
}

#[test]
fn asset_search_matches_tag_names() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let tagged = create(&mut s, "虚构相机");
    let plain = create(&mut s, "虚构键盘");
    let label = create_label(&mut s, "工作用");
    let change = Change {
        request_id: id(),
        generation: s.generation(),
        action: "label".into(),
        items: vec![label_item(&s, &tagged.asset.id, &label)],
    };
    s.batch_change(&change, TODAY).unwrap();
    assert_eq!(
        s.record(&tagged.asset.id)
            .unwrap()
            .unwrap()
            .preferences
            .label_id,
        Some(label)
    );
    let _ = plain;

    let page = s.query_assets(&query("工作用", 0), TODAY).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].asset.id, tagged.asset.id);

    // English case-insensitivity and trimming behave as before (3.5.2).
    let renamed = create(&mut s, "AlphaGadget");
    let page = s.query_assets(&query("  alphagadget  ", 0), TODAY).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].asset.id, renamed.asset.id);
}

#[test]
fn asset_search_runs_before_pagination_with_accurate_counts() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    // Fill the first page with non-matching rows.
    for i in 0..105 {
        create(&mut s, &format!("填充物品{i:03}"));
    }
    // A unique match that lands beyond the first page under created sorting.
    let far = create(&mut s, "深夜食堂的砂锅");

    let page = s.query_assets(&query("砂锅", 0), TODAY).unwrap();
    assert_eq!(page.total, 1, "total counts every match, not page rows");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].asset.id, far.asset.id);

    // An empty search keeps the plain pagination behaviour.
    let page = s.query_assets(&query("", 0), TODAY).unwrap();
    assert_eq!(page.total, 106);
    assert_eq!(page.items.len(), 100);
}

#[test]
fn trash_search_filters_before_pagination_and_matches_type_labels() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    // Fill the trash with rows whose names never match, so the searched ones
    // prove filtering happens before paging even when the needle rows are deep.
    for i in 0..102 {
        let filler = create(&mut s, &format!("填充删除{i:03}"));
        s.change_trash(&possio_lib::trash::TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: filler.asset.id.clone(),
            expected_revision: filler.asset.revision,
            deleted: true,
        })
        .unwrap();
    }
    let hit = create(&mut s, "待找回的三脚架");
    s.change_trash(&possio_lib::trash::TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: hit.asset.id.clone(),
        expected_revision: hit.asset.revision,
        deleted: true,
    })
    .unwrap();

    let page = s
        .list_trash(&possio_lib::trash::TrashQuery {
            filter: "all".into(),
            offset: 0,
            search: "三脚架".into(),
        })
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].title, "待找回的三脚架");

    // The type label ("物品") is searchable too, and counts every match.
    let page = s
        .list_trash(&possio_lib::trash::TrashQuery {
            filter: "all".into(),
            offset: 0,
            search: "物品".into(),
        })
        .unwrap();
    assert_eq!(page.total, 103);

    // Over-long search input is refused like the other lists.
    let err = s
        .list_trash(&possio_lib::trash::TrashQuery {
            filter: "all".into(),
            offset: 0,
            search: "字".repeat(201),
        })
        .map(|_| ())
        .unwrap_err();
    assert_eq!(err.code, "SEARCH");
}

#[test]
fn expense_view_lines_carry_standalone_notes_for_search() {
    use possio_lib::expenses::{Fields, Save};

    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let save = Save {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: Fields {
            title: "虚构旅行".into(),
            date: "2026-09-01".into(),
            amount_cents: "20000".into(),
            category: "travel".into(),
            notes: "含往返火车票".into(),
            refund_cents: None,
            refund_date: None,
            asset_id: None,
        },
    };
    s.expense_save(&save, TODAY).unwrap();

    let view = s.expense_view(Some(2026)).unwrap();
    let line = view
        .lines
        .iter()
        .find(|l| l.source == "expense")
        .expect("expense line");
    assert_eq!(line.notes.as_deref(), Some("含往返火车票"));
    // Purchase and payment rows never carry notes.
    assert!(view
        .lines
        .iter()
        .all(|l| l.source != "purchase" || l.notes.is_none()));
}
