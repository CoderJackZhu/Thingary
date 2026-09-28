//! D17/D18: deletion hides a record and what exists only for it everywhere,
//! restore brings exactly that back, permanent deletion leaves nothing behind,
//! and a mistaken latest lifecycle event can be revoked.
use possio_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::Save as AssetSave,
    expenses,
    lifecycle::{self, Action, Kind},
    photos::Selection,
    purge::Purge,
    storage::Store,
    timeline::Query,
    trash::{TrashChange, TrashQuery},
    wealth,
    wish_plan::{Preferences, Save as WishSave},
    wishlist::Fields,
};
const TODAY: &str = "2026-09-28";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn asset(s: &mut Store, name: &str, photos: Option<Selection>) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: AssetSave {
                request_id: rid(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some("100000".into()),
                purchase_date: Some("2026-09-01".into()),
            },
            details: Details::default(),
            photos,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn trash_asset(s: &mut Store, a: &AssetRecord, deleted: bool) -> AssetRecord {
    s.change_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        deleted,
    })
    .unwrap()
}
fn trash(s: &mut Store, kind: &str, id: &str, revision: i64, deleted: bool) {
    s.wealth_trash(&wealth::TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: kind.into(),
        id: id.into(),
        expected_revision: revision,
        deleted,
    })
    .unwrap()
}
fn purge(
    s: &mut Store,
    kind: Option<&str>,
    id: &str,
) -> possio_lib::domain::Result<possio_lib::purge::Purged> {
    s.purge_trash(&Purge {
        request_id: rid(),
        generation: s.generation(),
        kind: kind.map(str::to_owned),
        id: id.into(),
    })
}
fn kinds(s: &Store, filter: &str) -> Vec<String> {
    let t = s
        .timeline(
            &Query {
                filter: filter.into(),
                asset_id: None,
            },
            TODAY,
        )
        .unwrap();
    t.dated
        .into_iter()
        .chain(t.undated)
        .map(|e| e.kind)
        .collect()
}
fn manual_wish(s: &mut Store, name: &str) -> possio_lib::wishlist::WishlistItem {
    s.save_wish_plan(
        &WishSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: Fields {
                name: name.into(),
                category_id: None,
                estimated_price_cents: Some("5000".into()),
                priority: None,
                target_date: None,
                external_link: String::new(),
                notes: String::new(),
            },
            preferences: Preferences {
                mode: "countdown".into(),
                ..Default::default()
            },
            photos: Selection {
                ids: vec![],
                cover_id: None,
            },
            status_intent: "manual".into(),
            achieved_date: None,
        },
        TODAY,
    )
    .unwrap()
}

#[test]
fn deleted_item_takes_its_linked_refund_and_keeps_the_wish_realization() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let cam = asset(&mut s, "虚构相机", None);
    let e = s
        .expense_save(
            &expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: expenses::Fields {
                    title: "虚构相机订金".into(),
                    date: "2026-09-01".into(),
                    amount_cents: "50000".into(),
                    category: "other".into(),
                    notes: String::new(),
                    refund_cents: Some("1000".into()),
                    refund_date: Some("2026-09-05".into()),
                    asset_id: Some(cam.asset.id.clone()),
                },
            },
            TODAY,
        )
        .unwrap();
    assert!(kinds(&s, "all").contains(&"refund".to_string()));
    assert_eq!(s.expense_view(None).unwrap().refund_cents, "1000");

    let cam = trash_asset(&mut s, &cam, true);
    assert!(!kinds(&s, "all").contains(&"refund".to_string()));
    let v = s.expense_view(None).unwrap();
    assert_eq!(v.refund_cents, "0");
    assert!(!v.lines.iter().any(|l| l.id == e.id));

    trash_asset(&mut s, &cam, false);
    assert!(kinds(&s, "all").contains(&"refund".to_string()));
    assert_eq!(s.expense_view(None).unwrap().refund_cents, "1000");

    // A realized wish keeps its realization when the item is deleted.
    let wish = manual_wish(&mut s, "虚构心愿耳机");
    let item = s
        .record(&wish.converted_asset.unwrap().id)
        .unwrap()
        .unwrap();
    assert!(!kinds(&s, "wishlist").contains(&"wish_achieved".to_string()));
    let item = trash_asset(&mut s, &item, true);
    assert!(kinds(&s, "wishlist").contains(&"wish_achieved".to_string()));
    trash_asset(&mut s, &item, false);
    assert!(!kinds(&s, "wishlist").contains(&"wish_achieved".to_string()));
}

#[test]
fn a_deleted_wish_disappears_everywhere_and_returns_whole() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = manual_wish(&mut s, "虚构心愿台灯");
    let linked = wish.converted_asset.clone().unwrap();
    let query = possio_lib::wishlist::Query {
        search: String::new(),
        filter: "all".into(),
        sort: "created".into(),
        descending: true,
        offset: 0,
    };
    assert_eq!(s.query_wishlist(&query).unwrap().total, 1);

    trash(&mut s, "wish", &wish.id, wish.revision, true);
    assert_eq!(s.query_wishlist(&query).unwrap().total, 0);
    assert!(s.wishlist_item(&wish.id).unwrap().unwrap().deleted);
    assert!(!kinds(&s, "all").contains(&"wish_added".to_string()));
    // The realized item stays and simply no longer names its wish.
    let item = s.record(&linked.id).unwrap().unwrap();
    assert!(!item.deleted);
    assert!(item.origin_wishlist.is_none());
    let entry = s
        .list_trash(&TrashQuery {
            filter: "wish".into(),
            offset: 0,
        })
        .unwrap()
        .items
        .remove(0);
    assert_eq!(
        (entry.kind.as_str(), entry.asset_name.as_deref()),
        ("wish", Some("虚构心愿台灯"))
    );

    let deleted = s.wishlist_item(&wish.id).unwrap().unwrap();
    let mut change = WishSave {
        request_id: rid(),
        generation: s.generation(),
        id: Some(wish.id.clone()),
        expected_revision: Some(deleted.revision),
        fields: deleted.fields.clone(),
        preferences: deleted.preferences.clone(),
        photos: Selection {
            ids: vec![],
            cover_id: None,
        },
        status_intent: "preserve".into(),
        achieved_date: None,
    };
    assert_eq!(
        s.save_wish_plan(&change, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );

    trash(&mut s, "wish", &wish.id, deleted.revision, false);
    assert_eq!(s.query_wishlist(&query).unwrap().total, 1);
    assert_eq!(
        s.record(&linked.id)
            .unwrap()
            .unwrap()
            .origin_wishlist
            .unwrap()
            .id,
        wish.id
    );
    change.request_id = rid();
    change.expected_revision = Some(deleted.revision + 1);
    assert!(s.save_wish_plan(&change, TODAY).is_ok());
}

#[test]
fn only_the_latest_lifecycle_event_can_be_revoked_and_never_past_a_sale() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut a = asset(&mut s, "虚构音箱", None);
    let act = |s: &mut Store, a: &AssetRecord, action: Action| {
        s.change_lifecycle(
            &lifecycle::Change {
                request_id: rid(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: a.asset.revision,
                action,
            },
            TODAY,
        )
    };
    for (kind, date) in [(Kind::Retire, "2026-09-10"), (Kind::Activate, "2026-09-12")] {
        a = act(
            &mut s,
            &a,
            Action::Append {
                kind,
                date: date.into(),
                notes: String::new(),
            },
        )
        .unwrap();
    }
    let first = a.lifecycle.events[0].id.clone();
    let err = act(&mut s, &a, Action::Revoke { event_id: first }).unwrap_err();
    assert_eq!(err.code, "NOT_LATEST");

    let latest = a.lifecycle.events[1].id.clone();
    a = act(&mut s, &a, Action::Revoke { event_id: latest }).unwrap();
    assert_eq!(a.lifecycle.state, lifecycle::State::Retired);
    assert_eq!(a.lifecycle.events.len(), 1);
    assert!(!kinds(&s, "lifecycle").contains(&"activate".to_string()));

    let retire = a.lifecycle.events[0].id.clone();
    a = act(&mut s, &a, Action::Revoke { event_id: retire }).unwrap();
    assert_eq!(a.lifecycle.state, lifecycle::State::Active);
    assert!(a.lifecycle.events.is_empty());

    // After revoking, a fresh retire starts the history over cleanly.
    a = act(
        &mut s,
        &a,
        Action::Append {
            kind: Kind::Retire,
            date: "2026-09-20".into(),
            notes: String::new(),
        },
    )
    .unwrap();
    let sold = s
        .change_sale(
            &possio_lib::sales::Change {
                request_id: rid(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: a.asset.revision,
                action: possio_lib::sales::Action::Sell {
                    fields: possio_lib::sales::Fields {
                        date: "2026-09-21".into(),
                        price_cents: "1000".into(),
                        platform: String::new(),
                        buyer: String::new(),
                        notes: String::new(),
                    },
                },
            },
            TODAY,
        )
        .unwrap();
    let retire = sold.lifecycle.events[0].id.clone();
    assert_eq!(
        act(&mut s, &sold, Action::Revoke { event_id: retire })
            .unwrap_err()
            .code,
        "STATE_CONFLICT"
    );
}

#[test]
fn permanent_deletion_removes_rows_and_unshared_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let photo = s.prepare_material("icon-phone", &s.generation()).unwrap();
    let a = asset(
        &mut s,
        "虚构旧手机",
        Some(Selection {
            ids: vec![photo.id.clone()],
            cover_id: Some(photo.id),
        }),
    );
    let files = dir.path().join("datasets");
    let count_files = || {
        walk(&files)
            .into_iter()
            .filter(|p| p.parent().is_some_and(|d| d.ends_with("files")))
            .count()
    };
    assert_eq!(count_files(), 1);
    assert_eq!(
        purge(&mut s, Some("asset"), &a.asset.id).unwrap_err().code,
        "NOT_DELETED"
    );

    trash_asset(&mut s, &a, true);
    let entry = s
        .list_trash(&TrashQuery {
            filter: "asset".into(),
            offset: 0,
        })
        .unwrap()
        .items
        .remove(0);
    assert!(entry
        .contents
        .iter()
        .any(|c| c.kind == "photo" && c.count == 1));
    // The selection was staged long ago, so no form can still be using it.
    for e in std::fs::read_dir(s_staging(&files)).unwrap().flatten() {
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 86_400);
        std::fs::File::options()
            .write(true)
            .open(e.path())
            .unwrap()
            .set_modified(old)
            .unwrap();
    }
    assert_eq!(
        purge(&mut s, Some("asset"), &a.asset.id).unwrap().removed,
        1
    );
    assert!(s.record(&a.asset.id).unwrap().is_none());
    assert_eq!(
        s.list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 0
        })
        .unwrap()
        .total,
        0
    );
    assert_eq!(count_files(), 0, "an unreferenced original is removed");

    // A file staged today may belong to an open form and stays.
    let photo = s.prepare_material("icon-phone", &s.generation()).unwrap();
    let fresh = asset(
        &mut s,
        "虚构新手机",
        Some(Selection {
            ids: vec![photo.id.clone()],
            cover_id: Some(photo.id),
        }),
    );
    trash_asset(&mut s, &fresh, true);
    purge(&mut s, Some("asset"), &fresh.asset.id).unwrap();
    assert_eq!(count_files(), 1, "a recently staged original is kept");

    // A realized item waits for its wish; emptying the list takes both in order.
    let wish = manual_wish(&mut s, "虚构心愿相框");
    let item = s
        .record(&wish.converted_asset.clone().unwrap().id)
        .unwrap()
        .unwrap();
    trash_asset(&mut s, &item, true);
    assert_eq!(
        purge(&mut s, Some("asset"), &item.asset.id)
            .unwrap_err()
            .code,
        "WISH_LINKED"
    );
    let all = purge(&mut s, None, "").unwrap();
    assert_eq!((all.removed, all.kept), (0, 1));
    trash(&mut s, "wish", &wish.id, wish.revision, true);
    let all = purge(&mut s, None, "").unwrap();
    assert_eq!((all.removed, all.kept), (2, 0));
    assert!(s.wishlist_item(&wish.id).unwrap().is_none());
    assert_eq!(s.count().unwrap(), 0);

    // The purged library reopens cleanly.
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(s.count().unwrap(), 0);
}

fn s_staging(datasets: &std::path::Path) -> std::path::PathBuf {
    walk(datasets)
        .into_iter()
        .find(|p| p.parent().is_some_and(|d| d.ends_with("staging")))
        .and_then(|p| p.parent().map(|d| d.to_owned()))
        .unwrap()
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = vec![];
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}
