//! All data is fictional and kept in temporary stores.
use calamine::{Reader, Xlsx};
use std::{collections::BTreeMap, io::Cursor};
use thingary_lib::{
    account_groups::{Delete, Reorder, Save},
    financial_import::{BatchInput, CommitInput, FileInput},
    storage::Store,
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave, TrashChange},
};
const TODAY: &str = "2026-10-17";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn group(s: &mut Store, name: &str) -> thingary_lib::account_groups::Group {
    s.account_group_save(&Save {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        name: name.into(),
    })
    .unwrap()
}
fn account(s: &mut Store, group_id: Option<String>, closed: bool) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: "虚构账户".into(),
                institution: String::new(),
                side: "asset".into(),
                kind: "cash".into(),
                counted: true,
                opened_on: "2020-01-01".into(),
                closed_on: closed.then(|| "2026-10-01".into()),
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
                group_id,
                currency: "CNY".into(),
                holding_mode: false,
                holding_unit: None,
            },
        },
        TODAY,
    )
    .unwrap()
}
#[test]
fn names_revisions_reorder_receipts_and_deleted_references_are_safe() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let input = Save {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        name: "  虚构应急金  ".into(),
    };
    let g = s.account_group_save(&input).unwrap();
    assert_eq!(g.name, "虚构应急金");
    assert_eq!(s.account_group_save(&input).unwrap().id, g.id);
    let mut bad = input.clone();
    bad.request_id = id();
    assert_eq!(s.account_group_save(&bad).unwrap_err().code, "GROUP_NAME");
    for name in ["", "\n", &"虚".repeat(41), "虚构\0名称"] {
        bad.name = name.into();
        assert_eq!(s.account_group_save(&bad).unwrap_err().code, "GROUP_NAME");
    }
    let mut conflict = input.clone();
    conflict.name = "虚构冲突".into();
    assert_eq!(
        s.account_group_save(&conflict).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let rename = Save {
        request_id: id(),
        generation: s.generation(),
        id: Some(g.id.clone()),
        expected_revision: Some(g.revision),
        name: "虚构长期".into(),
    };
    let g = s.account_group_save(&rename).unwrap();
    assert_eq!(g.revision, 2);
    assert!(s.account_group_save(&rename).is_ok());
    let h = group(&mut s, "虚构另一组");
    for ids in [
        vec![g.id.clone()],
        vec![g.id.clone(), g.id.clone()],
        vec![g.id.clone(), id()],
    ] {
        assert_eq!(
            s.account_groups_reorder(&Reorder {
                request_id: id(),
                generation: s.generation(),
                ids
            })
            .unwrap_err()
            .code,
            "GROUP_ORDER"
        );
    }
    let reorder = Reorder {
        request_id: id(),
        generation: s.generation(),
        ids: vec![h.id.clone(), g.id.clone()],
    };
    s.account_groups_reorder(&reorder).unwrap();
    s.account_groups_reorder(&reorder).unwrap();
    assert_eq!(s.account_groups_list().unwrap().groups[0].id, h.id);
    let a = account(&mut s, Some(g.id.clone()), false);
    let b = account(&mut s, Some(g.id.clone()), true);
    let c = account(&mut s, Some(g.id.clone()), false);
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "account".into(),
        id: c.id.clone(),
        expected_revision: c.revision,
        deleted: true,
    })
    .unwrap();
    let current = s
        .account_groups_list()
        .unwrap()
        .groups
        .into_iter()
        .find(|x| x.id == g.id)
        .unwrap();
    assert_eq!(current.accounts, 3);
    let mut delete = Delete {
        request_id: id(),
        generation: s.generation(),
        id: g.id.clone(),
        expected_revision: current.revision,
        expected_accounts: 2,
    };
    assert_eq!(
        s.account_group_delete(&delete).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    delete.expected_accounts = 3;
    s.account_group_delete(&delete).unwrap();
    s.account_group_delete(&delete).unwrap();
    for before in [a, b] {
        let a = s
            .wealth_accounts()
            .unwrap()
            .into_iter()
            .find(|x| x.id == before.id)
            .unwrap();
        assert!(a.fields.group_id.is_none());
        assert_eq!(a.revision, before.revision + 1);
    }
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "account".into(),
        id: c.id.clone(),
        expected_revision: c.revision + 2,
        deleted: false,
    })
    .unwrap();
    assert!(s
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .find(|x| x.id == c.id)
        .unwrap()
        .fields
        .group_id
        .is_none());
    // A successful create receipt stays replayable even after its group was deleted.
    assert_eq!(s.account_group_save(&input).unwrap().id, g.id);
    let invalid = AccountSave {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: AccountFields {
            currency: "CNY".into(),
            holding_mode: false,
            holding_unit: None,
            group_id: Some(id()),
            ..s.wealth_accounts().unwrap()[0].fields.clone()
        },
    };
    assert_eq!(
        s.wealth_account_save(&invalid, TODAY).unwrap_err().code,
        "GROUP_NOT_FOUND"
    );
    let mut stale = reorder;
    stale.generation = id();
    assert_eq!(
        s.account_groups_reorder(&stale).unwrap_err().code,
        "STALE_DATASET"
    );
}
#[test]
fn every_group_write_rolls_back_with_no_receipt() {
    for point in [
        "account_group_save.before_commit",
        "account_group_delete.before_commit",
        "account_groups_reorder.before_commit",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        let g = group(&mut s, "虚构故障组");
        let a = account(&mut s, Some(g.id.clone()), false);
        let before = serde_json::to_value(s.account_groups_list().unwrap()).unwrap();
        let request = id();
        s.set_hook(move |p| {
            if p == point {
                Err(thingary_lib::domain::Error::new("INJECTED", "虚构故障"))
            } else {
                Ok(())
            }
        });
        let result = match point {
            "account_group_save.before_commit" => s
                .account_group_save(&Save {
                    request_id: request.clone(),
                    generation: s.generation(),
                    id: Some(g.id.clone()),
                    expected_revision: Some(g.revision),
                    name: "虚构改名".into(),
                })
                .map(|_| ()),
            "account_group_delete.before_commit" => s.account_group_delete(&Delete {
                request_id: request.clone(),
                generation: s.generation(),
                id: g.id.clone(),
                expected_revision: g.revision,
                expected_accounts: 1,
            }),
            _ => s.account_groups_reorder(&Reorder {
                request_id: request.clone(),
                generation: s.generation(),
                ids: vec![g.id.clone()],
            }),
        };
        assert_eq!(result.unwrap_err().code, "INJECTED");
        assert_eq!(
            serde_json::to_value(s.account_groups_list().unwrap()).unwrap(),
            before
        );
        assert_eq!(s.wealth_accounts().unwrap()[0].revision, a.revision);
        assert_eq!(
            s.wealth_request_result(&request, &s.generation()).unwrap(),
            None
        );
    }
}
fn batch(s: &Store) -> BatchInput {
    BatchInput{generation:s.generation(),source_name:"虚构分组导入".into(),mapping_set_id:"虚构映射".into(),files:vec![FileInput{kind:"accounts".into(),name:"虚构.csv".into(),csv_text:"account_key,name,kind,enabled_from,counted,分组\na,虚构现金,cash,2020-01-01,true,虚构导入组\nb,虚构另一现金,cash,2020-01-01,true,虚构导入组\n".into(),column_mapping:BTreeMap::new()}],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0}
}
fn commit(s: &Store, batch: BatchInput) -> CommitInput {
    let p = s
        .financial_import_preview(&batch, TODAY, &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    assert_eq!(p.new_groups, vec!["虚构导入组"]);
    CommitInput {
        request_id: id(),
        batch,
        context_digest: p.context_digest,
        normalized_digest: p.normalized_digest,
        file_fingerprints: p.file_fingerprints,
    }
}
#[test]
fn import_preview_is_private_groups_reuse_and_exports_and_backup_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    thingary_lib::modules::initialize_runtime(dir.path());
    let input = commit(&s, batch(&s));
    let preview = s
        .financial_import_preview(&input.batch, TODAY, &|| false)
        .unwrap();
    assert!(s.account_groups_list().unwrap().groups.is_empty());
    let receipt = s.financial_import_commit(&input, TODAY).unwrap();
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap().request_id,
        receipt.request_id
    );
    let groups = s.account_groups_list().unwrap().groups;
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].accounts, 2);
    let accounts = s.wealth_accounts().unwrap();
    for a in &accounts {
        assert_eq!(a.fields.group_id.as_ref(), Some(&groups[0].id));
        assert_eq!(
            a.fields.group_id.as_deref(),
            preview.objects.iter().find(|x| x.id == a.id).unwrap().after["group_id"].as_str()
        );
    }
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: TODAY.into(),
            notes: "虚构".into(),
            entries: accounts
                .iter()
                .map(|a| EntryInput {
                    account_id: a.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some("12300".into()),
                    original_minor: None,
                    fx_rate_micro: None,
                    quantity_e8: None,
                    unit_price_e6: None,
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap();
    let csv = dir.path().join("虚构分组.csv");
    s.export_finance_csv("wealth", &csv).unwrap();
    let text = std::fs::read_to_string(csv).unwrap();
    assert!(text
        .lines()
        .next()
        .unwrap()
        .ends_with("购入日期,分组,币种,原币金额,汇率,份额,单价"));
    assert_eq!(text.matches("虚构导入组").count(), 2);
    let xlsx = dir.path().join("虚构分组.xlsx");
    s.export_workbook(&xlsx).unwrap();
    let mut book: Xlsx<_> = Xlsx::new(Cursor::new(std::fs::read(xlsx).unwrap())).unwrap();
    let sheet = book.worksheet_range("账户").unwrap();
    assert_eq!(sheet.rows().next().unwrap()[10].to_string(), "分组");
    assert!(sheet.rows().skip(1).all(|r| r[10] == "虚构导入组"));
    // Consume the actual exported workbook through the production reader, then
    // import its account sheet into an independent fictional store.
    let mut target = Store::open(&dir.path().join("虚构往返目标")).unwrap();
    let files = thingary_lib::spreadsheet::read_finance(
        &std::fs::read(dir.path().join("虚构分组.xlsx")).unwrap(),
    )
    .unwrap();
    thingary_lib::modules::initialize_runtime(&dir.path().join("虚构往返目标"));
    let roundtrip = BatchInput {
        generation: target.generation(),
        source_name: "虚构导出往返".into(),
        mapping_set_id: "虚构新映射".into(),
        files: files
            .into_iter()
            .filter(|f| f.kind == "accounts")
            .map(|f| FileInput {
                kind: f.kind,
                name: f.name,
                csv_text: f.csv_text,
                column_mapping: f.column_mapping,
            })
            .collect(),
        mappings: BTreeMap::new(),
        actions: BTreeMap::new(),
        page: 0,
    };
    let p = target
        .financial_import_preview(&roundtrip, TODAY, &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    assert_eq!(p.new_groups, vec!["虚构导入组"]);
    target
        .financial_import_commit(
            &CommitInput {
                request_id: id(),
                batch: roundtrip,
                context_digest: p.context_digest,
                normalized_digest: p.normalized_digest,
                file_fingerprints: p.file_fingerprints,
            },
            TODAY,
        )
        .unwrap();
    let target_groups = target.account_groups_list().unwrap().groups;
    assert_eq!(target_groups.len(), 1);
    assert_eq!(target_groups[0].name, "虚构导入组");
    assert_eq!(target_groups[0].accounts, 2);
    assert!(target
        .wealth_accounts()
        .unwrap()
        .iter()
        .all(|a| a.fields.group_id.as_ref() == Some(&target_groups[0].id)));
    let archive = dir.path().join("虚构分组.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&dir.path().join("虚构恢复")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.account_groups_list().unwrap().groups[0].name,
        "虚构导入组"
    );
    assert_eq!(
        restored.wealth_accounts().unwrap()[0].fields.group_id,
        Some(groups[0].id.clone())
    );
}
#[test]
fn group_changes_invalidate_preview_and_failed_import_does_not_leave_groups() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    thingary_lib::modules::initialize_runtime(dir.path());
    let input = commit(&s, batch(&s));
    group(&mut s, "虚构并发组");
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let input = commit(&s, batch(&s));
    s.set_hook(|p| {
        if p == "financial_import.after_accounts" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap_err().code,
        "INJECTED"
    );
    assert_eq!(s.account_groups_list().unwrap().groups.len(), 1);
    assert!(s.wealth_accounts().unwrap().is_empty());
}
#[test]
fn readonly_entry_projections_use_distinct_snapshot_facts_without_last_known_filling() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, None, false);
    let b = account(&mut s, None, false);
    for (date, first, second) in [
        ("2026-10-01", Some("10000"), Some("20000")),
        (TODAY, None, Some("50000")),
    ] {
        s.wealth_snapshot_save(
            &SnapshotSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: date.into(),
                notes: "虚构".into(),
                entries: [(&a, first), (&b, second)]
                    .into_iter()
                    .map(|(a, value)| EntryInput {
                        account_id: a.id.clone(),
                        state: if value.is_some() {
                            "entered"
                        } else {
                            "missing"
                        }
                        .into(),
                        amount_cents: value.map(str::to_owned),
                        original_minor: None,
                        fx_rate_micro: None,
                        quantity_e8: None,
                        unit_price_e6: None,
                    })
                    .collect(),
            },
            TODAY,
        )
        .unwrap();
    }
    let summary = s.wealth_summary().unwrap();
    assert_eq!(summary.structure_date.as_deref(), Some("2026-10-01"));
    assert_eq!(
        summary.structure_entries[0].amount_cents.as_deref(),
        Some("10000")
    );
    assert_eq!(summary.latest_entries[0].amount_cents, None);
    assert_eq!(
        summary.latest_entries[1].amount_cents.as_deref(),
        Some("50000")
    );
    assert_eq!(
        s.wealth_accounts().unwrap()[0]
            .latest
            .as_ref()
            .unwrap()
            .amount_cents,
        "10000"
    );
}

#[test]
fn rename_delete_and_reorder_all_invalidate_a_pending_import_preview() {
    for action in ["rename", "delete", "reorder"] {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        thingary_lib::modules::initialize_runtime(dir.path());
        let g = group(&mut s, "虚构现有组");
        let h = group(&mut s, "虚构另一组");
        let input = commit(&s, batch(&s));
        match action {
            "rename" => {
                s.account_group_save(&Save {
                    request_id: id(),
                    generation: s.generation(),
                    id: Some(g.id),
                    expected_revision: Some(g.revision),
                    name: "虚构已改名".into(),
                })
                .unwrap();
            }
            "delete" => {
                s.account_group_delete(&Delete {
                    request_id: id(),
                    generation: s.generation(),
                    id: g.id,
                    expected_revision: g.revision,
                    expected_accounts: 0,
                })
                .unwrap();
            }
            _ => {
                s.account_groups_reorder(&Reorder {
                    request_id: id(),
                    generation: s.generation(),
                    ids: vec![h.id, g.id],
                })
                .unwrap();
            }
        }
        assert_eq!(
            s.financial_import_commit(&input, TODAY).unwrap_err().code,
            "REVISION_CONFLICT",
            "{action}"
        );
        assert!(s.wealth_accounts().unwrap().is_empty());
    }
}
