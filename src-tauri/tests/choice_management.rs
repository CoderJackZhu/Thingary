use possio_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, SaveAsset},
    choices::{Action, Change},
    domain::{Error, Save},
    preferences::{AssetOptions, AssetPreferences},
    sales,
    storage::Store,
    trash::TrashChange,
};
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
const TODAY: &str = "2026-09-29";
fn change(s: &Store, kind: &str, action: Action) -> Change {
    Change {
        request_id: id(),
        generation: s.generation(),
        expected_revision: s.choices(kind).unwrap().revision,
        kind: kind.into(),
        action,
    }
}
fn create(s: &mut Store, label: Option<String>, platform: Option<&str>) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构管理验收物品".into(),
                price_cents: Some("10000".into()),
                purchase_date: Some("2026-09-01".into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
            options: Some(AssetOptions {
                preferences: AssetPreferences {
                    label_id: label,
                    ..Default::default()
                },
                sale: platform.map(|p| sales::Fields {
                    date: "2026-09-20".into(),
                    price_cents: "6000".into(),
                    platform: p.into(),
                    buyer: "虚构买家".into(),
                    notes: "保留此备注".into(),
                }),
                ..Default::default()
            }),
        },
        TODAY,
    )
    .unwrap()
}
fn add_label(s: &mut Store, name: &str) -> String {
    let input = change(s, "label", Action::Create { name: name.into() });
    s.change_choices(&input)
        .unwrap()
        .items
        .iter()
        .find(|e| e.name == name)
        .unwrap()
        .id
        .clone()
}
fn trashed(s: &mut Store, r: &AssetRecord) -> AssetRecord {
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: r.asset.id.clone(),
        expected_revision: r.asset.revision,
        deleted: true,
    })
    .unwrap()
}
#[test]
fn rename_sale_channel_corrects_live_and_trashed_sales_and_roundtrips_backup() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, None, Some("闲鱼"));
    let b = create(&mut s, None, Some("闲鱼"));
    let b = trashed(&mut s, &b);
    let snap = s.choices("sale_channel").unwrap();
    let entry = snap.items.iter().find(|e| e.name == "闲鱼").unwrap();
    assert_eq!(entry.references, 2);
    let input = change(
        &s,
        "sale_channel",
        Action::Rename {
            id: entry.id.clone(),
            name: "虚构二手平台".into(),
        },
    );
    s.change_choices(&input).unwrap();
    s.change_choices(&input).unwrap();
    for old in [&a, &b] {
        let r = s.record(&old.asset.id).unwrap().unwrap();
        assert_eq!(r.asset.revision, old.asset.revision + 1);
        assert_eq!(r.sale.as_ref().unwrap().fields.platform, "虚构二手平台");
        assert_eq!(r.sale.as_ref().unwrap().fields.notes, "保留此备注");
        assert_eq!(r.sale.as_ref().unwrap().fields.price_cents, "6000");
        assert_eq!(r.deleted, old.deleted);
    }
    assert!(s
        .change_sale(
            &sales::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: a.asset.revision,
                action: sales::Action::Correct {
                    sale_id: a.sale.as_ref().unwrap().id.clone(),
                    fields: a.sale.as_ref().unwrap().fields.clone()
                }
            },
            TODAY
        )
        .is_err());
    let archive = root.path().join("choices.possio");
    s.backup(Some(&archive)).unwrap();
    let restored_root = tempfile::tempdir().unwrap();
    let mut restored = Store::open(restored_root.path()).unwrap();
    restored
        .restore(
            &archive,
            &archive_hash(&archive).unwrap(),
            &restored.generation(),
        )
        .unwrap();
    assert_eq!(
        restored
            .record(&b.asset.id)
            .unwrap()
            .unwrap()
            .sale
            .unwrap()
            .fields
            .platform,
        "虚构二手平台"
    );
    drop(s);
    let s = Store::open(root.path()).unwrap();
    assert_eq!(
        s.record(&a.asset.id)
            .unwrap()
            .unwrap()
            .sale
            .unwrap()
            .fields
            .platform,
        "虚构二手平台"
    );
}
#[test]
fn label_removal_replaces_and_clears_including_trash_with_stale_count_guard() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let from = add_label(&mut s, "工作用");
    let to = add_label(&mut s, "日常用");
    let a = create(&mut s, Some(from.clone()), None);
    let b = create(&mut s, Some(from.clone()), None);
    let b = trashed(&mut s, &b);
    let invalid = change(
        &s,
        "label",
        Action::Remove {
            id: from.clone(),
            replacement: Some(to.clone()),
            expected_references: 1,
        },
    );
    assert!(s.change_choices(&invalid).is_err());
    let rename = change(
        &s,
        "label",
        Action::Rename {
            id: from.clone(),
            name: "办公用".into(),
        },
    );
    s.change_choices(&rename).unwrap();
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().preferences.label_id,
        Some(from.clone())
    );
    let remove = change(
        &s,
        "label",
        Action::Remove {
            id: from.clone(),
            replacement: Some(to.clone()),
            expected_references: 2,
        },
    );
    s.change_choices(&remove).unwrap();
    s.change_choices(&remove).unwrap();
    for old in [&a, &b] {
        let r = s.record(&old.asset.id).unwrap().unwrap();
        assert_eq!(r.preferences.label_id, Some(to.clone()));
        assert_eq!(r.asset.revision, old.asset.revision + 1);
        assert_eq!(r.deleted, old.deleted);
    }
    let clear = change(
        &s,
        "label",
        Action::Remove {
            id: to,
            replacement: None,
            expected_references: 2,
        },
    );
    s.change_choices(&clear).unwrap();
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().preferences.label_id,
        None
    );
    let archive = root.path().join("labels.possio");
    s.backup(Some(&archive)).unwrap();
    s.inspect_backup(&archive).unwrap();
    let r = s.record(&b.asset.id).unwrap().unwrap();
    let restored = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: b.asset.id,
            expected_revision: r.asset.revision,
            deleted: false,
        })
        .unwrap();
    assert!(restored.preferences.label_id.is_none());
}
#[test]
fn channel_delete_replacement_clear_and_revoked_history_are_valid() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, None, Some("闲鱼"));
    let revoked = create(&mut s, None, Some("闲鱼"));
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: revoked.asset.id.clone(),
            expected_revision: revoked.asset.revision,
            action: sales::Action::Revoke {
                sale_id: revoked.sale.as_ref().unwrap().id.clone(),
            },
        },
        TODAY,
    )
    .unwrap();
    let snap = s.choices("sale_channel").unwrap();
    let from = snap.items.iter().find(|e| e.name == "闲鱼").unwrap();
    let to = snap.items.iter().find(|e| e.name == "线下").unwrap();
    assert_eq!(from.references, 1);
    let remove = change(
        &s,
        "sale_channel",
        Action::Remove {
            id: from.id.clone(),
            replacement: Some(to.id.clone()),
            expected_references: 1,
        },
    );
    s.change_choices(&remove).unwrap();
    assert_eq!(
        s.record(&a.asset.id)
            .unwrap()
            .unwrap()
            .sale
            .unwrap()
            .fields
            .platform,
        "线下"
    );
    let clear = change(
        &s,
        "sale_channel",
        Action::Remove {
            id: to.id.clone(),
            replacement: None,
            expected_references: 1,
        },
    );
    s.change_choices(&clear).unwrap();
    assert_eq!(
        s.record(&a.asset.id)
            .unwrap()
            .unwrap()
            .sale
            .unwrap()
            .fields
            .platform,
        ""
    );
    let archive = root.path().join("clear.possio");
    s.backup(Some(&archive)).unwrap();
    s.inspect_backup(&archive).unwrap();
}
#[test]
fn rejects_duplicate_reserved_cross_kind_self_target_stale_revision_and_generation() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = add_label(&mut s, "Alpha");
    let b = add_label(&mut s, "Beta");
    for name in ["beta", "保障中", ""] {
        let i = change(
            &s,
            "label",
            Action::Rename {
                id: a.clone(),
                name: name.into(),
            },
        );
        assert!(s.change_choices(&i).is_err());
    }
    let channel = s.choices("sale_channel").unwrap().items[0].id.clone();
    for target in [a.clone(), channel] {
        let i = change(
            &s,
            "label",
            Action::Remove {
                id: a.clone(),
                replacement: Some(target),
                expected_references: 0,
            },
        );
        assert!(s.change_choices(&i).is_err());
    }
    let disable = change(
        &s,
        "label",
        Action::Enable {
            id: b.clone(),
            enabled: false,
        },
    );
    s.change_choices(&disable).unwrap();
    let i = change(
        &s,
        "label",
        Action::Remove {
            id: a.clone(),
            replacement: Some(b),
            expected_references: 0,
        },
    );
    assert!(s.change_choices(&i).is_err());
    let mut i = change(
        &s,
        "label",
        Action::Rename {
            id: a,
            name: "Gamma".into(),
        },
    );
    i.expected_revision -= 1;
    assert!(s.change_choices(&i).is_err());
    i.expected_revision += 1;
    i.generation = "wrong".into();
    assert!(s.change_choices(&i).is_err());
}
#[test]
fn atomic_rollback_and_lost_reply_replay_do_not_duplicate_sale_corrections() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, None, Some("闲鱼"));
    let entry = s
        .choices("sale_channel")
        .unwrap()
        .items
        .into_iter()
        .find(|e| e.name == "闲鱼")
        .unwrap();
    let i = change(
        &s,
        "sale_channel",
        Action::Rename {
            id: entry.id,
            name: "虚构新名称".into(),
        },
    );
    s.set_hook(|p| {
        if p == "choice.before_commit" {
            Err(Error::new("INJECTED", "rollback"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_choices(&i).is_err());
    assert_eq!(
        s.record(&a.asset.id)
            .unwrap()
            .unwrap()
            .sale
            .unwrap()
            .fields
            .platform,
        "闲鱼"
    );
    s.set_hook(|p| {
        if p == "choice.after_commit" {
            Err(Error::new("INJECTED", "lost reply"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_choices(&i).is_err());
    s.set_hook(|_| Ok(()));
    s.change_choices(&i).unwrap();
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().asset.revision,
        a.asset.revision + 1
    );
    let archive = root.path().join("retry.possio");
    s.backup(Some(&archive)).unwrap();
    s.inspect_backup(&archive).unwrap();
}
