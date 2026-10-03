use thingary_lib::{
    backup::archive_hash,
    catalog::{Details, Query, SaveAsset},
    domain::{held_days, Error, Save},
    lifecycle::{Action, Change, Kind, State},
    storage::Store,
    trash::TrashChange,
};
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn create(s: &mut Store) -> thingary_lib::catalog::AssetRecord {
    let q = SaveAsset {
        options: None,
        base: Save {
            request_id: id(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构状态相机".into(),
            price_cents: Some("135050".into()),
            purchase_date: Some("2026-09-01".into()),
        },
        details: Details {
            notes: "原资料".into(),
            ..Default::default()
        },
        photos: None,
        classification: None,
    };
    s.save_asset(&q, "2026-09-25").unwrap()
}
fn change(s: &Store, a: &thingary_lib::catalog::AssetRecord, action: Action) -> Change {
    Change {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        action,
    }
}
fn append(kind: Kind, date: &str) -> Action {
    Action::Append {
        kind,
        date: date.into(),
        notes: "保留状态备注".into(),
    }
}
fn query(filter: &str) -> Query {
    Query {
        category: Default::default(),
        search: "".into(),
        filter: filter.into(),
        sort: "created".into(),
        descending: false,
        offset: 0,
        warranty: "all".into(),
        label: None,
    }
}
#[test]
fn chronological_transitions_corrections_and_purchase_conflicts() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s);
    let r = change(&s, &a, append(Kind::Retire, "2026-09-10"));
    let b = s.change_lifecycle(&r, "2026-09-25").unwrap();
    assert_eq!(b.lifecycle.state, State::Retired);
    assert_eq!(
        s.query_assets(&query("active"), "2026-09-25")
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        s.query_assets(&query("held"), "2026-09-25").unwrap().total,
        1
    );
    assert_eq!(
        s.query_assets(&query("retired"), "2026-09-25")
            .unwrap()
            .total,
        1
    );
    for (action, code) in [
        (append(Kind::Activate, "2026-09-09"), "DATE_CONFLICT"),
        (append(Kind::Activate, "2026-09-26"), "FUTURE"),
        (append(Kind::Retire, "2026-09-10"), "STATE_CONFLICT"),
        (append(Kind::Activate, "2026-08-31"), "DATE_CONFLICT"),
    ] {
        let req = change(&s, &b, action);
        assert_eq!(
            s.change_lifecycle(&req, "2026-09-25").unwrap_err().code,
            code
        );
        assert!(s
            .saved_request(&req.request_id, &s.generation())
            .unwrap()
            .is_none());
    }
    let c = s
        .change_lifecycle(
            &change(&s, &b, append(Kind::Activate, "2026-09-10")),
            "2026-09-25",
        )
        .unwrap();
    assert_eq!(c.lifecycle.state, State::Active);
    assert_eq!(c.lifecycle.events.len(), 2);
    let first = c.lifecycle.events[0].id.clone();
    let bad = change(
        &s,
        &c,
        Action::CorrectDate {
            event_id: first.clone(),
            date: "2026-09-11".into(),
        },
    );
    assert_eq!(
        s.change_lifecycle(&bad, "2026-09-25").unwrap_err().code,
        "DATE_CONFLICT"
    );
    let d = s
        .change_lifecycle(
            &change(
                &s,
                &c,
                Action::CorrectDate {
                    event_id: first.clone(),
                    date: "2026-09-05".into(),
                },
            ),
            "2026-09-25",
        )
        .unwrap();
    assert_eq!(d.lifecycle.events[0].id, first);
    assert_eq!(d.lifecycle.events[1], c.lifecycle.events[1]);
    assert_eq!(d.lifecycle.state, State::Active);
    assert_eq!(d.asset.purchase_date, a.asset.purchase_date);
    assert_eq!(d.asset.price_cents, a.asset.price_cents);
    assert_eq!(d.details, a.details);
    assert_eq!(d.created_at, a.created_at);
    assert_eq!(
        held_days(d.asset.purchase_date.as_deref(), "2026-09-25").unwrap(),
        Some(25)
    );
    let edit = SaveAsset {
        options: None,
        base: Save {
            request_id: id(),
            generation: s.generation(),
            asset_id: Some(d.asset.id.clone()),
            expected_revision: Some(d.asset.revision),
            name: d.asset.name.clone(),
            price_cents: d.asset.price_cents.clone(),
            purchase_date: Some("2026-09-06".into()),
        },
        details: d.details.clone(),
        photos: None,
        classification: None,
    };
    let err = s.save_asset(&edit, "2026-09-25").unwrap_err();
    assert_eq!(err.code, "DATE_CONFLICT");
    assert!(err.message.contains("2026-09-05"));
    assert_eq!(s.record(&a.asset.id).unwrap().unwrap().asset, d.asset);
    // Late receipt confirms the old operation without replay over later dates/status.
    assert_eq!(
        s.change_lifecycle(&r, "2026-09-25").unwrap().lifecycle,
        d.lifecycle
    );
}
#[test]
fn faults_receipts_conflicts_reopen_trash_and_backup() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s);
    let q = change(&s, &a, append(Kind::Retire, "2026-09-10"));
    s.set_hook(|p| {
        if p == "lifecycle.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_lifecycle(&q, "2026-09-25").is_err());
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().lifecycle.state,
        State::Active
    );
    assert!(s
        .saved_request(&q.request_id, &s.generation())
        .unwrap()
        .is_none());
    s.set_hook(|p| {
        if p == "lifecycle.after_commit" {
            Err(Error::new("INJECTED", "回执丢失"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_lifecycle(&q, "2026-09-25").is_err());
    let b = s
        .saved_request(&q.request_id, &s.generation())
        .unwrap()
        .unwrap();
    assert_eq!(b.lifecycle.events.len(), 1);
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.change_lifecycle(&q, "2026-09-25").unwrap().asset.revision,
        2
    );
    let mut conflict = q.clone();
    conflict.action = append(Kind::Retire, "2026-09-11");
    assert_eq!(
        s.change_lifecycle(&conflict, "2026-09-25")
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
    conflict.request_id = id();
    assert_eq!(
        s.change_lifecycle(&conflict, "2026-09-25")
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    let deleted = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: b.asset.id.clone(),
            expected_revision: 2,
            deleted: true,
        })
        .unwrap();
    assert_eq!(
        s.change_lifecycle(
            &change(&s, &deleted, append(Kind::Activate, "2026-09-10")),
            "2026-09-25"
        )
        .unwrap_err()
        .code,
        "REVISION_CONFLICT"
    );
    let archive = root.path().join("state.thingary");
    s.backup(Some(&archive)).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut restored = Store::open(other.path()).unwrap();
    restored
        .restore(
            &archive,
            &archive_hash(&archive).unwrap(),
            &restored.generation(),
        )
        .unwrap();
    assert_eq!(
        restored.record(&a.asset.id).unwrap().unwrap().lifecycle,
        b.lifecycle
    );
    drop(s);
    let mut s = Store::open(root.path()).unwrap();
    let c = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: 3,
            deleted: false,
        })
        .unwrap();
    assert_eq!(c.lifecycle, b.lifecycle);
    assert_eq!(c.created_at, a.created_at);
    let mut stale = change(&s, &c, append(Kind::Activate, "2026-09-11"));
    stale.generation = "old".into();
    assert_eq!(
        s.change_lifecycle(&stale, "2026-09-25").unwrap_err().code,
        "STALE_DATASET"
    );
}
