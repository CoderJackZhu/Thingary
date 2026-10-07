use thingary_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Error, Save as AssetSave},
    expenses::{Fields, Save},
    maintenance::{self, Action},
    photos::Selection,
    preferences::{AssetOptions, AssetPreferences, Exclusions},
    sales,
    storage::Store,
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn asset(
    s: &mut Store,
    name: &str,
    price: Option<&str>,
    date: Option<&str>,
    excluded: bool,
) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: excluded.then(|| AssetOptions {
                preferences: AssetPreferences {
                    exclude: Exclusions {
                        statistics: true,
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ..Default::default()
            }),
            base: AssetSave {
                request_id: rid(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: price.map(str::to_owned),
                purchase_date: date.map(str::to_owned),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn reprice(s: &mut Store, a: &AssetRecord, price: &str) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: AssetSave {
                request_id: rid(),
                generation: s.generation(),
                asset_id: Some(a.asset.id.clone()),
                expected_revision: Some(a.asset.revision),
                name: a.asset.name.clone(),
                price_cents: Some(price.into()),
                purchase_date: a.asset.purchase_date.clone(),
            },
            details: a.details.clone(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn fields(title: &str, date: &str, amount: &str) -> Fields {
    Fields {
        title: title.into(),
        date: date.into(),
        amount_cents: amount.into(),
        category: "travel".into(),
        notes: String::new(),
        refund_cents: None,
        refund_date: None,
        asset_id: None,
    }
}
fn new(s: &Store, f: Fields) -> Save {
    Save {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: f,
    }
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}

#[test]
fn x_ac06_purchases_are_read_from_the_item_and_follow_corrections() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let pc = asset(
        &mut s,
        "虚构电脑",
        Some("1200000"),
        Some("2026-03-10"),
        false,
    );
    asset(
        &mut s,
        "不计入的物品",
        Some("50000"),
        Some("2026-03-11"),
        true,
    );
    asset(&mut s, "日期未知", Some("30000"), None, false);
    asset(&mut s, "金额未知", None, Some("2026-04-01"), false);
    s.change_maintenance(
        &maintenance::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: pc.asset.id.clone(),
            expected_revision: pc.asset.revision,
            action: Action::Add {
                fields: maintenance::Fields {
                    date: Some("2026-05-02".into()),
                    kind: "repair".into(),
                    title: "换电池".into(),
                    description: String::new(),
                    cost_cents: Some("80000".into()),
                    provider: String::new(),
                },
                photos: Selection {
                    ids: vec![],
                    cover_id: None,
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let v = s.expense_view(Some(2026)).unwrap();
    assert_eq!(
        v.spent_cents, "1280000",
        "purchase + maintenance; excluded item left out"
    );
    assert_eq!(v.undated_cents, "30000");
    assert_eq!(v.undated.len(), 1);
    assert_eq!(v.unknown_amount_count, 1);
    assert_eq!(v.months.len(), 12);
    assert_eq!(v.months[2].spent_cents, "1200000");
    assert_eq!(v.months[4].spent_cents, "80000");
    assert_eq!(v.years, vec![2026]);
    let pc = s.record_at(&pc.asset.id, TODAY).unwrap().unwrap();
    reprice(&mut s, &pc, "1150000");
    assert_eq!(s.expense_view(Some(2026)).unwrap().spent_cents, "1230000");
    assert_eq!(s.expense_view(Some(2025)).unwrap().spent_cents, "0");
}

#[test]
fn x_ac12_refund_counts_in_its_own_period_and_net_spans_periods() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut f = fields("虚构培训", "2026-11-20", "200000");
    f.category = "education".into();
    f.refund_cents = Some("50000".into());
    f.refund_date = Some("2026-12-05".into());
    s.expense_save(&new(&s, f), TODAY).unwrap();
    let v = s.expense_view(Some(2026)).unwrap();
    assert_eq!(
        (
            v.spent_cents.as_str(),
            v.refund_cents.as_str(),
            v.net_cents.as_str()
        ),
        ("200000", "50000", "150000")
    );
    assert_eq!(v.months[10].spent_cents, "200000");
    assert_eq!(v.months[11].refund_cents, "50000");
    let sources: Vec<_> = v.lines.iter().map(|l| l.source.as_str()).collect();
    assert_eq!(sources, vec!["refund", "expense"]);
}

#[test]
fn x_d08_linked_expense_stops_counting_but_its_refund_still_counts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut f = fields("先记下的相机", "2026-06-01", "500000");
    f.refund_cents = Some("20000".into());
    f.refund_date = Some("2026-06-10".into());
    let e = s.expense_save(&new(&s, f.clone()), TODAY).unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "500000");
    let cam = asset(
        &mut s,
        "虚构相机",
        Some("500000"),
        Some("2026-06-01"),
        false,
    );
    f.asset_id = Some(cam.asset.id.clone());
    let mut link = new(&s, f.clone());
    link.id = Some(e.id.clone());
    link.expected_revision = Some(e.revision);
    let linked = s.expense_save(&link, TODAY).unwrap();
    assert_eq!(linked.asset_name.as_deref(), Some("虚构相机"));
    let v = s.expense_view(None).unwrap();
    assert_eq!(
        v.spent_cents, "500000",
        "counted once, as the item's purchase"
    );
    assert_eq!(v.refund_cents, "20000");
    assert!(v.lines.iter().any(|l| l.source == "linked" && l.id == e.id));

    // Unlinking makes the expense count on its own again.
    f.asset_id = None;
    let mut unlink = new(&s, f);
    unlink.id = Some(e.id.clone());
    unlink.expected_revision = Some(linked.revision);
    s.expense_save(&unlink, TODAY).unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "1000000");
}

#[test]
fn sales_are_listed_apart_and_never_reduce_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = asset(
        &mut s,
        "虚构平板",
        Some("400000"),
        Some("2026-01-05"),
        false,
    );
    s.change_sale(
        &sales::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-10-01".into(),
                    price_cents: "150000".into(),
                    platform: "虚构".into(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let v = s.expense_view(Some(2026)).unwrap();
    assert_eq!(
        (
            v.spent_cents.as_str(),
            v.sale_cents.as_str(),
            v.net_cents.as_str()
        ),
        ("400000", "150000", "400000")
    );
}

#[test]
fn input_rules_and_request_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    for (f, want) in [
        (fields("", "2026-01-01", "1"), "EXPENSE_TITLE"),
        (fields("x", "2027-01-01", "1"), "EXPENSE_DATE"),
        (fields("x", "2026-01-01", "0"), "EXPENSE_AMOUNT"),
        (fields("x", "2026-01-01", "-5"), "EXPENSE_AMOUNT"),
        (
            Fields {
                category: "food".into(),
                ..fields("x", "2026-01-01", "1")
            },
            "EXPENSE_CATEGORY",
        ),
        (
            Fields {
                refund_cents: Some("2".into()),
                refund_date: Some("2026-01-02".into()),
                ..fields("x", "2026-01-01", "1")
            },
            "EXPENSE_REFUND",
        ),
        (
            Fields {
                refund_cents: Some("1".into()),
                refund_date: Some("2025-12-31".into()),
                ..fields("x", "2026-01-01", "1")
            },
            "EXPENSE_REFUND",
        ),
        (
            Fields {
                refund_cents: Some("1".into()),
                refund_date: None,
                ..fields("x", "2026-01-01", "1")
            },
            "EXPENSE_REFUND",
        ),
        (
            Fields {
                asset_id: Some(rid()),
                ..fields("x", "2026-01-01", "1")
            },
            "EXPENSE_ASSET",
        ),
    ] {
        assert_eq!(code(s.expense_save(&new(&s, f), TODAY)), want);
    }
    let input = new(&s, fields("虚构机票", "2026-02-01", "300000"));
    s.set_hook(|p| {
        if p == "expense.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.expense_save(&input, TODAY)), "INJECTED");
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    s.set_hook(|_| Ok(()));
    let first = s.expense_save(&input, TODAY).unwrap();
    let again = s.expense_save(&input, TODAY).unwrap();
    assert_eq!((first.id.as_str(), again.revision), (again.id.as_str(), 1));
    let mut other = input.clone();
    other.fields.title = "别的内容".into();
    assert_eq!(code(s.expense_save(&other, TODAY)), "REQUEST_CONFLICT");
    let mut stale = new(&s, fields("虚构机票", "2026-02-01", "310000"));
    stale.id = Some(first.id.clone());
    stale.expected_revision = Some(9);
    assert_eq!(code(s.expense_save(&stale, TODAY)), "REVISION_CONFLICT");
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "300000");
}

#[test]
fn backups_carry_expenses_and_schema_fifteen_backups_migrate() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a")).unwrap();
    a.expense_save(&new(&a, fields("虚构旅行", "2026-07-01", "880000")), TODAY)
        .unwrap();
    let file = dir.path().join("备份.thingary");
    a.backup(Some(&file)).unwrap();
    drop(a);
    let mut b = Store::open(&dir.path().join("b")).unwrap();
    let summary = b.inspect_backup(&file).unwrap();
    assert_eq!(
        (summary.schema, summary.expenses),
        (thingary_lib::storage::SCHEMA_VERSION as u32, 1)
    );
    b.restore(&file, &summary.hash, &b.generation()).unwrap();
    assert_eq!(b.expense_view(None).unwrap().spent_cents, "880000");

    // A 1.2.0 (schema 15) backup restores and migrates with no expenses.
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let v15 = dir.path().join("v15.sqlite");
    let db = rusqlite::Connection::open(&v15).unwrap();
    db.execute_batch(thingary_lib::storage::SCHEMA).unwrap();
    thingary_lib::storage::migrate_to(&db, 15, &|_| Ok(())).unwrap();
    drop(db);
    let bytes = std::fs::read(&v15).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":15,"created_at":"2026-09-28T02:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let old = dir.path().join("v15.thingary");
    let mut z = zip::ZipWriter::new(std::fs::File::create(&old).unwrap());
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("manifest.json", opts).unwrap();
    z.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    z.start_file("data.sqlite", opts).unwrap();
    z.write_all(&bytes).unwrap();
    z.finish().unwrap();
    let summary = b.inspect_backup(&old).unwrap();
    assert_eq!((summary.schema, summary.expenses), (15, 0));
    b.restore(&old, &summary.hash, &b.generation()).unwrap();
    assert_eq!(b.expense_view(None).unwrap().spent_cents, "0");
}

#[test]
fn expenses_delete_restore_and_show_on_the_timeline() {
    use thingary_lib::{timeline::Query, trash::TrashQuery, wealth::TrashChange};
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut f = fields("虚构旅行", "2026-08-01", "300000");
    f.refund_cents = Some("10000".into());
    f.refund_date = Some("2026-08-20".into());
    let trip = s.expense_save(&new(&s, f), TODAY).unwrap();
    let cam = asset(
        &mut s,
        "虚构相机",
        Some("500000"),
        Some("2026-07-01"),
        false,
    );
    let mut g = fields("先记下的相机", "2026-07-01", "500000");
    g.asset_id = Some(cam.asset.id.clone());
    g.refund_cents = Some("5000".into());
    g.refund_date = Some("2026-07-05".into());
    s.expense_save(&new(&s, g), TODAY).unwrap();

    let kinds = |s: &Store, filter: &str, asset: Option<String>| -> Vec<(String, Option<String>)> {
        s.timeline(
            &Query {
                filter: filter.into(),
                asset_id: asset,
            },
            TODAY,
        )
        .unwrap()
        .dated
        .into_iter()
        .map(|e| (e.kind, e.asset_id))
        .collect()
    };
    let all = kinds(&s, "expense", None);
    assert_eq!(
        all,
        vec![
            ("refund".into(), None),
            ("expense".into(), None),
            ("refund".into(), Some(cam.asset.id.clone())),
        ],
        "the linked expense is not its own event; its refund belongs to the item"
    );
    assert!(kinds(&s, "all", None).iter().any(|(k, _)| k == "purchase"));
    assert_eq!(
        kinds(&s, "all", Some(cam.asset.id.clone())).len(),
        2,
        "purchase + refund"
    );

    let del = TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "expense".into(),
        id: trip.id.clone(),
        expected_revision: trip.revision,
        deleted: true,
    };
    s.wealth_trash(&del).unwrap();
    s.wealth_trash(&del).unwrap();
    assert!(s.expense(&trip.id).unwrap().is_none());
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "500000");
    assert_eq!(kinds(&s, "expense", None).len(), 1);
    let listed = s
        .list_trash(&TrashQuery {
            filter: "wealth".into(),
            offset: 0,
            search: String::new(),
        })
        .unwrap()
        .items;
    assert_eq!(
        listed
            .iter()
            .map(|e| (e.kind.as_str(), e.title.as_str(), e.date.as_deref()))
            .collect::<Vec<_>>(),
        vec![("expense", "虚构旅行", Some("2026-08-01"))]
    );
    s.wealth_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "expense".into(),
        id: trip.id.clone(),
        expected_revision: trip.revision + 1,
        deleted: false,
    })
    .unwrap();
    let back = s.expense(&trip.id).unwrap().unwrap();
    assert_eq!((back.id, back.revision), (trip.id, 3));
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "800000");
}

/// E01：设计 §3.3 固定金额样例——年度桶、月桶与全部摘要的整数分一致，
/// 待补 80 元不归期，年度桶之和等于全部摘要。
#[test]
fn annual_buckets_match_design_example() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    // 2024：旅行支出 1,000 元 + 订阅实付 120 元（周期计划付款）。
    let mut trip = fields("虚构旅行", "2024-05-10", "100000");
    // 2025：退回上述旅行款 200 元（退款按退款日期归 2025）。
    trip.refund_cents = Some("20000".into());
    trip.refund_date = Some("2025-03-01".into());
    s.expense_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: trip,
        },
        TODAY,
    )
    .unwrap();
    let sub_plan = s
        .recurring_plan_save(
            &thingary_lib::recurring::PlanSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::recurring::PlanFields {
                    auto_renew: true,
                    service_start: Some("2024-06-01".into()),
                    coverage_start: Some("2024-06-01".into()),
                    interval_days: None,
                    trial_days: None,
                    name: "虚构订阅".into(),
                    category: "subscription".into(),
                    amount_cents: "12000".into(),
                    interval_months: 12,
                    first_due: "2025-06-01".into(),
                    end_date: None,
                    paused: false,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    // 2024 年的订阅实付（历史补记路径：直接写付款事实）。
    s.conn_for_test()
        .unwrap()
        .execute(
            "INSERT INTO plan_payments(id,plan_id,due_date,state,paid_date,amount_cents,notes,revision,created_at,updated_at) VALUES('e01-pay-1',?1,'2024-06-01','paid','2024-06-01',12000,'虚构样例付款',1,'2024-06-01T00:00:00Z','2024-06-01T00:00:00Z')",
            [&sub_plan.id],
        )
        .unwrap();
    // 2025：独立支出 300 元。
    s.expense_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: fields("虚构课程", "2025-08-20", "30000"),
        },
        TODAY,
    )
    .unwrap();
    // 2026：维护 50 元、一笔购入金额未知、售出回收 400 元；另有日期未知的 80 元维护。
    // 样例外的主人物品给明确 0 元购入价：是已记录事实但不增加任何金额。
    let pc = asset(&mut s, "虚构主机", Some("0"), Some("2026-01-01"), false);
    s.change_maintenance(
        &maintenance::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: pc.asset.id.clone(),
            expected_revision: pc.asset.revision,
            action: Action::Add {
                fields: maintenance::Fields {
                    date: Some("2026-02-11".into()),
                    kind: "repair".into(),
                    title: "清灰".into(),
                    description: String::new(),
                    cost_cents: Some("5000".into()),
                    provider: String::new(),
                },
                photos: Selection {
                    ids: vec![],
                    cover_id: None,
                },
            },
        },
        TODAY,
    )
    .unwrap();
    // 那笔金额未知的购入就是被售出的旧手机（购入价未知不阻止售出）。
    let sold = asset(&mut s, "虚构旧手机", None, Some("2026-07-01"), false);
    s.change_sale(
        &sales::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: sold.asset.id.clone(),
            expected_revision: sold.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-09-30".into(),
                    price_cents: "40000".into(),
                    platform: "虚构".into(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    // 日期未知的 80 元维护（挂在日期未知物品上，不归任何期间）。
    let undated_owner = asset(&mut s, "虚构配件", Some("0"), Some("2026-01-02"), false);
    s.change_maintenance(
        &maintenance::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: undated_owner.asset.id.clone(),
            expected_revision: undated_owner.asset.revision,
            action: Action::Add {
                fields: maintenance::Fields {
                    date: None,
                    kind: "repair".into(),
                    title: "日期待补维护".into(),
                    description: String::new(),
                    cost_cents: Some("8000".into()),
                    provider: String::new(),
                },
                photos: Selection {
                    ids: vec![],
                    cover_id: None,
                },
            },
        },
        TODAY,
    )
    .unwrap();

    // 全部视图：三个年度桶升序，与摘要一致。
    let all = s.expense_view(None).unwrap();
    assert_eq!(all.spent_cents, "147000");
    assert_eq!(all.refund_cents, "20000");
    assert_eq!(all.net_cents, "127000");
    assert_eq!(all.sale_cents, "40000");
    assert_eq!(all.unknown_amount_count, 1);
    assert_eq!(all.undated_cents, "8000");
    assert_eq!(all.undated.len(), 1);
    assert_eq!(all.annual_totals.len(), 3);
    let by_year: std::collections::BTreeMap<i32, &thingary_lib::expenses::AnnualTotal> =
        all.annual_totals.iter().map(|t| (t.year, t)).collect();
    let y2024 = by_year[&2024];
    assert_eq!(
        (
            y2024.spent_cents.as_str(),
            y2024.refund_cents.as_str(),
            y2024.net_cents.as_str(),
            y2024.sale_cents.as_str(),
            y2024.unknown_count
        ),
        ("112000", "0", "112000", "0", 0)
    );
    let y2025 = by_year[&2025];
    assert_eq!(
        (
            y2025.spent_cents.as_str(),
            y2025.refund_cents.as_str(),
            y2025.net_cents.as_str(),
            y2025.unknown_count
        ),
        ("30000", "20000", "10000", 0)
    );
    let y2026 = by_year[&2026];
    assert_eq!(
        (
            y2026.spent_cents.as_str(),
            y2026.unknown_count,
            y2026.sale_cents.as_str()
        ),
        ("5000", 1, "40000")
    );
    // 年度桶之和与全部摘要一致（净支出允许为负的年份单独验证）。
    let sum_spent: i64 = all
        .annual_totals
        .iter()
        .map(|t| t.spent_cents.parse::<i64>().unwrap())
        .sum();
    assert_eq!(sum_spent.to_string(), all.spent_cents);
    let sum_refund: i64 = all
        .annual_totals
        .iter()
        .map(|t| t.refund_cents.parse::<i64>().unwrap())
        .sum();
    assert_eq!(sum_refund.to_string(), all.refund_cents);
    // 跨年退款：原年不回减。
    let v2025 = s.expense_view(Some(2025)).unwrap();
    assert_eq!(
        (v2025.spent_cents.as_str(), v2025.refund_cents.as_str()),
        ("30000", "20000")
    );
    // 2026 的月桶：2 月 50 元，其余无记录；月桶合计等于该年已知支出。
    let v2026 = s.expense_view(Some(2026)).unwrap();
    assert_eq!(v2026.months.len(), 12);
    assert_eq!(v2026.months[1].spent_cents, "5000");
    assert_eq!(v2026.months[1].unknown_count, 0);
    // 1 月的两笔 0 元购入是明确已记录事实：计入笔数、不增加金额。
    assert!(v2026
        .months
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != 1 && *i != 0 && *i != 6)
        .all(|(_, m)| m.count == 0));
    assert_eq!(v2026.months[0].count, 2);
    assert_eq!(v2026.months[0].spent_cents, "0");
    // 7 月：金额未知的购入单独计笔，不冒充零。
    assert_eq!(v2026.months[6].count, 1);
    assert_eq!(v2026.months[6].unknown_count, 1);
    let month_sum: i64 = v2026
        .months
        .iter()
        .map(|m| m.spent_cents.parse::<i64>().unwrap())
        .sum();
    assert_eq!(month_sum.to_string(), v2026.spent_cents);
    // 待补 80 元不归期：任何年度桶与期间摘要都不含它。
    for t in &all.annual_totals {
        assert!(t.spent_cents.parse::<i64>().unwrap() < 155000);
    }
    assert_eq!(all.undated[0].title, "虚构配件 · 日期待补维护");
}

/// R4 场景矩阵：月桶 count=known+unknown 覆盖零元、未知、混合与退款/售出单列。
#[test]
fn month_counts_cover_zero_unknown_mixed_and_refund_sale() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let zero = asset(&mut s, "零元物品", Some("0"), Some("2026-01-05"), false);
    let _ = zero;
    asset(&mut s, "未知金额物品", None, Some("2026-01-06"), false);
    s.expense_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: fields("一月支出", "2026-01-07", "1200"),
        },
        TODAY,
    )
    .unwrap();
    let mut refunded = fields("退款支出", "2025-12-01", "9000");
    refunded.refund_cents = Some("800".into());
    refunded.refund_date = Some("2026-01-08".into());
    s.expense_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: refunded,
        },
        TODAY,
    )
    .unwrap();
    let sold = asset(&mut s, "售出物品", Some("5000"), Some("2026-01-01"), false);
    s.change_sale(
        &sales::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: sold.asset.id.clone(),
            expected_revision: sold.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-01-09".into(),
                    price_cents: "4000".into(),
                    platform: "虚构".into(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let v = s.expense_view(Some(2026)).unwrap();
    let jan = &v.months[0];
    // 支出参与：零元（known）、未知金额（unknown）、1200 支出与售出物品的 5000 购入（known）；
    // 退款与售出回收行不参与笔数。
    assert_eq!((jan.count, jan.known_count, jan.unknown_count), (4, 3, 1));
    assert_eq!(jan.spent_cents, "6200");
    assert_eq!(jan.refund_cents, "800");
    assert_eq!(v.sale_cents, "4000");
}
