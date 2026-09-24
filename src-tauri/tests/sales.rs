use possio_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, Query, SaveAsset},
    domain::{daily_cents, held_days, Error, Save},
    lifecycle::{self, State},
    sales::{Action, Change, Fields},
    storage::Store,
    trash::TrashChange,
};
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
const TODAY: &str = "2026-09-25";
fn create(s: &mut Store, price: Option<&str>) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构售出相机".into(),
                price_cents: price.map(str::to_string),
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
fn fields(date: &str, price: &str) -> Fields {
    Fields {
        date: date.into(),
        price_cents: price.into(),
        platform: "虚构平台".into(),
        buyer: "虚构买家".into(),
        notes: "虚构备注".into(),
    }
}
fn request(s: &Store, a: &AssetRecord, action: Action) -> Change {
    Change {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        action,
    }
}
fn query(filter: &str) -> Query {
    Query {
        search: "".into(),
        filter: filter.into(),
        sort: "created".into(),
        descending: false,
        offset: 0,
        category: Default::default(),
    }
}
#[test]
fn sell_correct_revoke_preserve_identity_and_source_states() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    for retired in [false, true] {
        let original = create(&mut s, Some("100000"));
        let mut a = original.clone();
        if retired {
            a = s
                .change_lifecycle(
                    &lifecycle::Change {
                        request_id: id(),
                        generation: s.generation(),
                        asset_id: a.asset.id.clone(),
                        expected_revision: a.asset.revision,
                        action: lifecycle::Action::Append {
                            kind: lifecycle::Kind::Retire,
                            date: "2026-09-05".into(),
                            notes: "原退役".into(),
                        },
                    },
                    TODAY,
                )
                .unwrap();
        }
        let sell = request(
            &s,
            &a,
            Action::Sell {
                fields: fields("2026-09-10", "30000"),
            },
        );
        let b = s.change_sale(&sell, TODAY).unwrap();
        let sale = b.sale.clone().unwrap();
        assert_eq!(b.lifecycle.state, State::Sold);
        assert_eq!(b.asset.id, original.asset.id);
        assert_eq!(b.created_at, original.created_at);
        assert_eq!(
            held_days(b.asset.purchase_date.as_deref(), &sale.fields.date).unwrap(),
            Some(10)
        );
        assert_eq!(
            daily_cents(Some(100000), 0, 30000, Some(10)).unwrap(),
            Some(7000)
        );
        assert_eq!(
            sale.previous_state,
            if retired {
                State::Retired
            } else {
                State::Active
            }
        );
        assert!(s
            .change_sale(
                &request(
                    &s,
                    &b,
                    Action::Sell {
                        fields: fields("2026-09-10", "0")
                    }
                ),
                TODAY
            )
            .is_err());
        assert!(s
            .change_lifecycle(
                &lifecycle::Change {
                    request_id: id(),
                    generation: s.generation(),
                    asset_id: b.asset.id.clone(),
                    expected_revision: b.asset.revision,
                    action: lifecycle::Action::Append {
                        kind: lifecycle::Kind::Activate,
                        date: "2026-09-10".into(),
                        notes: "".into()
                    }
                },
                TODAY
            )
            .is_err());
        let c = s
            .change_sale(
                &request(
                    &s,
                    &b,
                    Action::Correct {
                        sale_id: sale.id.clone(),
                        fields: fields("2026-09-10", "140000"),
                    },
                ),
                TODAY,
            )
            .unwrap();
        assert_eq!(c.sale.as_ref().unwrap().id, sale.id);
        assert_eq!(
            daily_cents(Some(100000), 0, 140000, Some(10)).unwrap(),
            Some(-4000)
        );
        // Late request returns current corrected data, without replaying its old sale values.
        assert_eq!(s.change_sale(&sell, TODAY).unwrap().sale, c.sale);
        let d = s
            .change_sale(
                &request(
                    &s,
                    &c,
                    Action::Revoke {
                        sale_id: sale.id.clone(),
                    },
                ),
                TODAY,
            )
            .unwrap();
        assert_eq!(d.lifecycle, a.lifecycle);
        assert!(d.sale.is_none());
        assert_eq!(d.asset.purchase_date, a.asset.purchase_date);
        assert_eq!(
            s.change_sale(&sell, TODAY).unwrap().lifecycle.state,
            a.lifecycle.state
        );
        // A second real sale after correcting an erroneous one is a new effective fact.
        let e = s
            .change_sale(
                &request(
                    &s,
                    &d,
                    Action::Sell {
                        fields: fields("2026-09-12", "0"),
                    },
                ),
                TODAY,
            )
            .unwrap();
        assert_ne!(e.sale.as_ref().unwrap().id, sale.id);
    }
    assert_eq!(s.query_assets(&query("sold"), TODAY).unwrap().total, 2);
    assert_eq!(s.query_assets(&query("held"), TODAY).unwrap().total, 0);
    let bought_again = create(&mut s, None);
    assert_eq!(s.query_assets(&query("held"), TODAY).unwrap().total, 1);
    assert_eq!(s.query_assets(&query("all"), TODAY).unwrap().total, 3);
    assert_eq!(bought_again.lifecycle.state, State::Active);
    let archive = root.path().join("sales.possio");
    s.backup(Some(&archive)).unwrap();
}
#[test]
fn validation_conflicts_unknown_price_and_date_corrections() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, None);
    for f in [
        fields("2026-09-10", ""),
        fields("2026-09-10", "-1"),
        fields("2026-09-10", "1.1"),
        fields("2026-08-31", "0"),
        fields("2026-09-26", "0"),
        fields("", "0"),
    ] {
        let q = request(&s, &a, Action::Sell { fields: f });
        assert!(s.change_sale(&q, TODAY).is_err());
        assert!(s
            .saved_request(&q.request_id, &q.generation)
            .unwrap()
            .is_none());
    }
    let b = s
        .change_sale(
            &request(
                &s,
                &a,
                Action::Sell {
                    fields: fields("2026-09-10", "0"),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert!(b.asset.price_cents.is_none());
    assert_eq!(b.sale.as_ref().unwrap().fields.price_cents, "0");
    let bad = Save {
        request_id: id(),
        generation: s.generation(),
        asset_id: Some(a.asset.id.clone()),
        expected_revision: Some(b.asset.revision),
        name: a.asset.name.clone(),
        price_cents: None,
        purchase_date: Some("2026-09-11".into()),
    };
    assert!(s
        .save(&bad, TODAY)
        .unwrap_err()
        .message
        .contains("售出记录"));
    let mut stale = request(
        &s,
        &b,
        Action::Revoke {
            sale_id: b.sale.as_ref().unwrap().id.clone(),
        },
    );
    stale.generation = "old".into();
    assert_eq!(
        s.change_sale(&stale, TODAY).unwrap_err().code,
        "STALE_DATASET"
    );
    let mut bad_revision = stale.clone();
    bad_revision.generation = s.generation();
    bad_revision.expected_revision = 1;
    assert_eq!(
        s.change_sale(&bad_revision, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let a = create(&mut s, Some("0"));
    let r = s
        .change_lifecycle(
            &lifecycle::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: 1,
                action: lifecycle::Action::Append {
                    kind: lifecycle::Kind::Retire,
                    date: "2026-09-10".into(),
                    notes: "".into(),
                },
            },
            TODAY,
        )
        .unwrap();
    assert!(s
        .change_sale(
            &request(
                &s,
                &r,
                Action::Sell {
                    fields: fields("2026-09-09", "0")
                }
            ),
            TODAY
        )
        .is_err());
    let sold = s
        .change_sale(
            &request(
                &s,
                &r,
                Action::Sell {
                    fields: fields("2026-09-10", "0"),
                },
            ),
            TODAY,
        )
        .unwrap();
    let correction = |date: &str| lifecycle::Change {
        request_id: id(),
        generation: sold_generation(&s),
        asset_id: sold.asset.id.clone(),
        expected_revision: sold.asset.revision,
        action: lifecycle::Action::CorrectDate {
            event_id: sold.lifecycle.events[0].id.clone(),
            date: date.into(),
        },
    };
    let invalid = correction("2026-09-11");
    let valid = correction("2026-09-05");
    assert!(s.change_lifecycle(&invalid, TODAY).is_err());
    let corrected = s.change_lifecycle(&valid, TODAY).unwrap();
    assert_eq!(corrected.sale, sold.sale);
    assert_eq!(corrected.lifecycle.state, State::Sold);
    assert!(s
        .change_sale(
            &request(
                &s,
                &corrected,
                Action::Correct {
                    sale_id: sold.sale.unwrap().id,
                    fields: fields("2026-09-04", "0")
                }
            ),
            TODAY
        )
        .is_err());
}
fn sold_generation(s: &Store) -> String {
    s.generation()
}
#[test]
fn atomic_failure_receipts_photos_trash_backup_and_reopen() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let mut a = create(&mut s, Some("100000"));
    let photo = s
        .stage_photo(
            "camera.heic",
            include_bytes!("fixtures/camera.heic"),
            &s.generation(),
            None,
        )
        .unwrap();
    a = s
        .save_asset(
            &SaveAsset {
                base: Save {
                    request_id: id(),
                    generation: s.generation(),
                    asset_id: Some(a.asset.id.clone()),
                    expected_revision: Some(a.asset.revision),
                    name: a.asset.name.clone(),
                    price_cents: a.asset.price_cents.clone(),
                    purchase_date: a.asset.purchase_date.clone(),
                },
                details: a.details.clone(),
                photos: Some(possio_lib::photos::Selection {
                    ids: vec![photo.id.clone()],
                    cover_id: Some(photo.id.clone()),
                }),
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    let q = request(
        &s,
        &a,
        Action::Sell {
            fields: fields("2026-09-10", "30000"),
        },
    );
    s.set_hook(|point| {
        if point == "sale.before_commit" {
            Err(Error::new("INJECTED", "失败"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_sale(&q, TODAY).is_err());
    assert!(s.record(&a.asset.id).unwrap().unwrap().sale.is_none());
    assert!(s
        .saved_request(&q.request_id, &q.generation)
        .unwrap()
        .is_none());
    s.set_hook(|point| {
        if point == "sale.after_commit" {
            Err(Error::new("INJECTED", "丢回执"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_sale(&q, TODAY).is_err());
    s.set_hook(|_| Ok(()));
    let b = s.change_sale(&q, TODAY).unwrap();
    assert_eq!(b.asset.revision, a.asset.revision + 1);
    assert_eq!(
        s.saved_request(&q.request_id, &q.generation)
            .unwrap()
            .unwrap()
            .sale,
        b.sale
    );
    let mut conflict = q.clone();
    conflict.action = Action::Sell {
        fields: fields("2026-09-10", "1"),
    };
    assert_eq!(
        s.change_sale(&conflict, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let d = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: b.asset.revision,
            deleted: true,
        })
        .unwrap();
    assert!(s
        .change_sale(
            &request(
                &s,
                &d,
                Action::Revoke {
                    sale_id: b.sale.as_ref().unwrap().id.clone()
                }
            ),
            TODAY
        )
        .is_err());
    let archive = root.path().join("sold.possio");
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
    let restored_record = restored.record(&a.asset.id).unwrap().unwrap();
    assert!(restored_record.deleted);
    assert_eq!(restored_record.sale, b.sale);
    drop(s);
    let mut s = Store::open(root.path()).unwrap();
    let e = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: d.asset.revision,
            deleted: false,
        })
        .unwrap();
    assert_eq!(e.sale, b.sale);
    assert_eq!(e.lifecycle.state, State::Sold);
    assert_eq!(e.photos, a.photos);
    assert_eq!(e.cover_id, a.cover_id);
    assert_eq!(e.created_at, a.created_at);
}
