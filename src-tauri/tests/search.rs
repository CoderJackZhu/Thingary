//! Global search backend tests (§6, B03–B08 read-side conditions).
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save as AssetSave,
    modules::{self, Modules},
    photos::Selection,
    search::{Query, KINDS},
    source::Target,
    storage::Store,
    wish_plan::{Preferences, Save as WishSave},
    wishlist::Fields,
};
const TODAY: &str = "2026-10-05";
const NEEDLE: &str = "虚构needle";

fn q(s: &Store, keyword: &str, type_filter: &str, offset: u32) -> Query {
    Query {
        keyword: keyword.into(),
        type_filter: type_filter.into(),
        offset,
        limit: 30,
        generation: s.generation(),
        revision: None,
    }
}

fn asset(s: &mut Store, name: &str, notes: &str, price: Option<&str>) -> String {
    let record = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: AssetSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: name.into(),
                    price_cents: price.map(str::to_owned),
                    purchase_date: Some("2026-01-10".into()),
                },
                details: Details {
                    brand: String::new(),
                    model: String::new(),
                    serial_number: "SER-不参与搜索-0001".into(),
                    notes: notes.into(),
                },
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    record.asset.id
}

fn wish(s: &mut Store, name: &str, notes: &str) -> String {
    s.save_wish_plan(
        &WishSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: Fields {
                name: name.into(),
                category_id: None,
                estimated_price_cents: None,
                priority: None,
                target_date: None,
                external_link: String::new(),
                notes: notes.into(),
            },
            preferences: Preferences::default(),
            photos: Selection {
                ids: vec![],
                cover_id: None,
            },
            replacement_asset_id: None,
            clear_replacement: false,
        },
        TODAY,
    )
    .unwrap()
    .id
}

fn account(s: &mut Store, name: &str, notes: &str) -> String {
    s.wealth_account_save(
        &thingary_lib::wealth::AccountSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::wealth::AccountFields {
                name: name.into(),
                institution: String::new(),
                side: "asset".into(),
                kind: "cash".into(),
                counted: true,
                opened_on: "2026-01-01".into(),
                closed_on: None,
                notes: notes.into(),
            },
        },
        TODAY,
    )
    .unwrap()
    .id
}

fn virtual_asset(s: &mut Store, name: &str, notes: &str, topup: bool) -> String {
    s.virtual_save(
        &thingary_lib::virtual_assets::Save {
            plan: None,
            renewal_price_cents: None,
            renewal_from: None,
            special_end: None,
            first_topup: topup.then(|| thingary_lib::virtual_assets::TopupFields {
                topup_date: Some("2026-09-17".into()),
                paid_cents: Some("1000".into()),
                gift_cents: None,
                credit_cents: None,
                pay_method: String::new(),
                notes: notes.into(),
            }),
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::virtual_assets::Fields {
                name: name.into(),
                kind: "general".into(),
                billing: if topup { "topup" } else { "single" }.into(),
                label_id: None,
                pay_method: None,
                perpetual: None,
                provider: String::new(),
                purchase_date: None,
                price_cents: None,
                expires: None,
                plan_id: None,
                url: String::new(),
                notes: notes.into(),
                stopped_on: None,
            },
        },
        TODAY,
    )
    .unwrap()
    .id
}

#[test]
fn b03_all_nine_kinds_hit_their_defined_fields_and_targets() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    // One record per kind, the needle in a distinct field each time.
    asset(&mut s, "普通物品", NEEDLE, Some("1234567")); // 备注
    wish(&mut s, "普通心愿", NEEDLE); // 考虑理由
    let acc = account(&mut s, "普通账户", NEEDLE); // 账户备注
    let acc2 = account(&mut s, NEEDLE, ""); // 账户名称（主字段）
    let _ = acc2;
    let _snap = s
        .wealth_snapshot_save(
            &thingary_lib::wealth::SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: "2026-09-30".into(),
                notes: NEEDLE.into(),
                entries: vec![
                    thingary_lib::wealth::EntryInput {
                        account_id: acc.clone(),
                        state: "entered".into(),
                        amount_cents: Some("10000".into()),
                    },
                    thingary_lib::wealth::EntryInput {
                        account_id: acc2.clone(),
                        state: "entered".into(),
                        amount_cents: Some("20000".into()),
                    },
                ],
            },
            TODAY,
        )
        .unwrap();
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: "普通支出".into(),
                date: "2026-09-01".into(),
                amount_cents: "5000".into(),
                category: "travel".into(),
                notes: NEEDLE.into(),
                refund_cents: None,
                refund_date: None,
                asset_id: None,
            },
        },
        TODAY,
    )
    .unwrap();
    let plan = s
        .recurring_plan_save(
            &thingary_lib::recurring::PlanSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::recurring::PlanFields {
                    auto_renew: true,
                    service_start: None,
                    coverage_start: None,
                    interval_days: None,
                    trial_days: None,
                    name: NEEDLE.into(),
                    category: "rent".into(),
                    amount_cents: "300000".into(),
                    interval_months: 1,
                    first_due: "2026-09-05".into(),
                    end_date: None,
                    paused: false,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    s.recurring_payment_save(
        &thingary_lib::recurring::PaymentSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan.id.clone(),
            due_date: "2026-09-05".into(),
            state: "paid".into(),
            paid_date: Some("2026-09-05".into()),
            amount_cents: Some("300000".into()),
            notes: String::new(),
        },
        TODAY,
    )
    .unwrap();
    virtual_asset(&mut s, "普通虚拟档案", NEEDLE, true);
    let results = s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap();
    assert_eq!(results.total, 10);
    let counts: Vec<(String, i64)> = results.type_counts.clone();
    for (kind, count) in &counts {
        match kind.as_str() {
            "account" => assert_eq!(*count, 2, "notes hit + name hit"),
            "asset" | "wish" | "snapshot" | "expense" | "plan" | "virtual" | "topup"
            | "payment" => {
                assert_eq!(*count, 1, "{kind} should hit once")
            }
            _ => panic!("unknown kind {kind}"),
        }
    }
    // Every item carries a target, a matched-field label and real context.
    let mut kinds: Vec<&str> = results.items.iter().map(|i| i.kind.as_str()).collect();
    kinds.sort_unstable();
    assert_eq!(
        kinds,
        vec![
            "account", "account", "asset", "expense", "payment", "plan", "snapshot", "topup",
            "virtual", "wish"
        ]
    );
    for item in &results.items {
        assert!(!item.matched_field.is_empty());
        assert!(item.context.contains("needle"));
        s.validate_source(&item.target, &s.generation()).unwrap();
    }
    let acc_item = results.items.iter().find(|i| i.kind == "account").unwrap();
    assert!(matches!(acc_item.target, Target::Account { .. }));
    let snap_item = results.items.iter().find(|i| i.kind == "snapshot").unwrap();
    assert_eq!(snap_item.status, "完整");
    assert!(matches!(snap_item.target, Target::Snapshot { .. }));
    // The snapshot's own date is searchable (primary field).
    let by_date = s.search_all(&q(&s, "2026-09-30", "snapshot", 0)).unwrap();
    assert_eq!(by_date.total, 1);
}

#[test]
fn b04_pagination_counts_and_stable_ordering_over_the_full_set() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    for i in 0..31 {
        asset(&mut s, &format!("{NEEDLE} 物品 {i:03}"), "", None);
    }
    for i in 0..70 {
        wish(&mut s, &format!("{NEEDLE} 心愿 {i:03}"), "");
    }
    let first = s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap();
    assert_eq!(first.total, 101);
    assert_eq!(first.items.len(), 30);
    let second = s.search_all(&q(&s, NEEDLE, "all", 30)).unwrap();
    assert_eq!(second.items.len(), 30);
    let third = s.search_all(&q(&s, NEEDLE, "all", 60)).unwrap();
    assert_eq!(third.items.len(), 30);
    let fourth = s.search_all(&q(&s, NEEDLE, "all", 90)).unwrap();
    assert_eq!(fourth.items.len(), 11);
    // Counts come from the complete set, not the page.
    assert_eq!(
        first
            .type_counts
            .iter()
            .find(|(k, _)| k == "asset")
            .unwrap()
            .1,
        31
    );
    assert_eq!(
        first
            .type_counts
            .iter()
            .find(|(k, _)| k == "wish")
            .unwrap()
            .1,
        70
    );
    // The three pages are disjoint and together cover the whole set; a
    // single-type query keeps its own complete ordering.
    let mut seen: Vec<&str> = first
        .items
        .iter()
        .chain(&second.items)
        .chain(&third.items)
        .chain(&fourth.items)
        .map(|i| i.id.as_str())
        .collect();
    assert_eq!(seen.len(), 101);
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 101);
    let assets_only = q(&s, NEEDLE, "asset", 0);
    let assets = s.search_all(&assets_only).unwrap();
    assert_eq!(assets.total, 31);
    assert_eq!(assets.items.len(), 30);
    assert!(assets.items.iter().all(|i| i.kind == "asset"));
    let wishes_only = q(&s, NEEDLE, "wish", 60);
    let wishes = s.search_all(&wishes_only).unwrap();
    assert_eq!(wishes.total, 70);
    assert_eq!(wishes.items.len(), 10);
    assert!(wishes.items.iter().all(|i| i.kind == "wish"));
    // A same-named pair stays distinct by stable id.
    asset(&mut s, "同名物品", NEEDLE, None);
    asset(&mut s, "同名物品", NEEDLE, None);
    let twins = s.search_all(&q(&s, "同名物品", "asset", 0)).unwrap();
    assert_eq!(twins.total, 2);
    assert_ne!(twins.items[0].id, twins.items[1].id);
}

#[test]
fn b05_search_writes_nothing_and_keeps_page_summaries_their_own() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    asset(&mut s, &format!("{NEEDLE}a"), "", None);
    let before = s.conn_for_test().unwrap().total_changes();
    let summary_before = s.wealth_summary().unwrap().points.len();
    for _ in 0..3 {
        let _ = s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap();
    }
    assert_eq!(
        s.conn_for_test().unwrap().total_changes(),
        before,
        "search is read-only"
    );
    assert_eq!(s.wealth_summary().unwrap().points.len(), summary_before);
}

#[test]
fn b06_deleted_records_drop_out_and_validation_rejects_them() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let id = asset(&mut s, &format!("{NEEDLE} 待删物品"), "", None);
    let revision = s.record(&id).unwrap().unwrap().asset.revision;
    assert_eq!(s.search_all(&q(&s, NEEDLE, "asset", 0)).unwrap().total, 1);
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.clone(),
        expected_revision: revision,
        deleted: true,
    })
    .unwrap();
    assert_eq!(s.search_all(&q(&s, NEEDLE, "asset", 0)).unwrap().total, 0);
    assert_eq!(
        s.validate_source(&Target::Asset { id }, &s.generation())
            .unwrap_err()
            .code,
        "NOT_FOUND"
    );
    // Retired and sold items stay searchable with their status.
    let retired = asset(&mut s, &format!("{NEEDLE} 退役物品"), "", None);
    let rev = s.record(&retired).unwrap().unwrap().asset.revision;
    s.change_lifecycle(
        &thingary_lib::lifecycle::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: retired.clone(),
            expected_revision: rev,
            action: thingary_lib::lifecycle::Action::Append {
                kind: thingary_lib::lifecycle::Kind::Retire,
                date: "2026-09-01".into(),
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap();
    let found = s.search_all(&q(&s, NEEDLE, "asset", 0)).unwrap();
    assert_eq!(found.total, 1);
    assert_eq!(found.items[0].status, "已退役");
}

#[test]
fn b07_closed_modules_and_stale_generations_are_isolated() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let mut s = Store::open(&root).unwrap();
    wish(&mut s, &format!("{NEEDLE} 心愿"), "");
    asset(&mut s, &format!("{NEEDLE} 物品"), "", None);
    assert_eq!(s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap().total, 2);
    modules::write(
        &root,
        &Modules {
            wishlist: false,
            ..Modules::default()
        },
    )
    .unwrap();
    let closed = s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap();
    assert_eq!(closed.total, 1);
    assert_eq!(
        closed
            .type_counts
            .iter()
            .find(|(k, _)| k == "wish")
            .unwrap()
            .1,
        0,
        "closed-module records and counts are not returned"
    );
    let only_wish = s.search_all(&q(&s, NEEDLE, "wish", 0)).unwrap();
    assert_eq!(only_wish.total, 0);
    // A stale generation is refused outright.
    let mut stale = q(&s, NEEDLE, "all", 0);
    stale.generation = uuid::Uuid::new_v4().to_string();
    assert_eq!(s.search_all(&stale).unwrap_err().code, "STALE_DATASET");
}

#[test]
fn b08_matching_rules_keyword_bounds_and_unsearched_fields() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    // ASCII case-insensitive substring.
    asset(&mut s, "Fictional Camera", "", None);
    assert_eq!(s.search_all(&q(&s, "camera", "asset", 0)).unwrap().total, 1);
    assert_eq!(s.search_all(&q(&s, "CAMERA", "asset", 0)).unwrap().total, 1);
    // Amounts are not text-searchable.
    asset(&mut s, "价格物品", "", Some("1234567"));
    assert_eq!(
        s.search_all(&q(&s, "1234567", "asset", 0)).unwrap().total,
        0
    );
    assert_eq!(s.search_all(&q(&s, "¥", "asset", 0)).unwrap().total, 0);
    // Serial numbers stay out of scope.
    assert_eq!(
        s.search_all(&q(&s, "SER-不参与搜索", "asset", 0))
            .unwrap()
            .total,
        0
    );
    // Keyword bounds: empty, NUL and >200 chars are explicit errors.
    assert_eq!(
        s.search_all(&q(&s, "   ", "all", 0)).unwrap_err().code,
        "QUERY"
    );
    let nul = format!("{}{}", "a".repeat(10), '\0');
    assert_eq!(
        s.search_all(&q(&s, &nul, "all", 0)).unwrap_err().code,
        "SEARCH"
    );
    let long = "长".repeat(201);
    assert_eq!(
        s.search_all(&q(&s, &long, "all", 0)).unwrap_err().code,
        "SEARCH"
    );
    // No wildcard or fuzzy behaviour: % and _ stay literal.
    asset(&mut s, "100%物品", "", None);
    assert_eq!(s.search_all(&q(&s, "100%", "asset", 0)).unwrap().total, 1);
    assert_eq!(
        s.search_all(&q(&s, "100_物品", "asset", 0)).unwrap().total,
        0
    );
}

#[test]
fn b03_paid_and_skipped_payment_facts_open_their_exact_source() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    // A plan with a paid and a skipped period; both searchable, candidates are not.
    let plan = s
        .recurring_plan_save(
            &thingary_lib::recurring::PlanSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::recurring::PlanFields {
                    auto_renew: true,
                    service_start: None,
                    coverage_start: None,
                    interval_days: None,
                    trial_days: None,
                    name: format!("{NEEDLE} 视频会员"),
                    category: "subscription".into(),
                    amount_cents: "2500".into(),
                    interval_months: 1,
                    first_due: "2026-08-01".into(),
                    end_date: None,
                    paused: false,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    let _ = plan;
    // The first due period is the payment candidate; recording it makes it a fact.
    s.recurring_payment_save(
        &thingary_lib::recurring::PaymentSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan.id.clone(),
            due_date: "2026-08-01".into(),
            state: "paid".into(),
            paid_date: Some("2026-08-01".into()),
            amount_cents: Some("2500".into()),
            notes: format!("{} 付款备注", NEEDLE),
        },
        TODAY,
    )
    .unwrap();
    // An unpaid future period matches the plan name but is only a candidate.
    let all = s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap();
    let payments: Vec<_> = all.items.iter().filter(|i| i.kind == "payment").collect();
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].status, "已付");
    assert!(matches!(payments[0].target, Target::Payment { .. }));
    // Skipped periods are searchable facts too.
    s.recurring_payment_save(
        &thingary_lib::recurring::PaymentSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan.id.clone(),
            due_date: "2026-09-01".into(),
            state: "skipped".into(),
            paid_date: None,
            amount_cents: None,
            notes: format!("{} 跳过备注", NEEDLE),
        },
        TODAY,
    )
    .unwrap();
    let all = s.search_all(&q(&s, NEEDLE, "all", 0)).unwrap();
    assert_eq!(
        all.type_counts
            .iter()
            .find(|(k, _)| k == "payment")
            .unwrap()
            .1,
        2
    );
    let skipped = all.items.iter().find(|i| i.status == "已跳过").unwrap();
    assert!(matches!(skipped.target, Target::Payment { .. }));
    for payment in all.items.iter().filter(|i| i.kind == "payment") {
        s.validate_source(&payment.target, &s.generation()).unwrap();
    }
}

#[test]
fn b08_linked_expense_projection_is_not_a_second_expense_result() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let id = asset(&mut s, &format!("{NEEDLE} 主物品"), "", None);
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: format!("{NEEDLE} 关联支出"),
                date: "2026-02-01".into(),
                amount_cents: "9000".into(),
                category: "digital".into(),
                notes: String::new(),
                refund_cents: None,
                refund_date: None,
                asset_id: Some(id),
            },
        },
        TODAY,
    )
    .unwrap();
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: format!("{NEEDLE} 独立支出"),
                date: "2026-03-01".into(),
                amount_cents: "7000".into(),
                category: "other".into(),
                notes: String::new(),
                refund_cents: None,
                refund_date: None,
                asset_id: None,
            },
        },
        TODAY,
    )
    .unwrap();
    let found = s.search_all(&q(&s, NEEDLE, "expense", 0)).unwrap();
    assert_eq!(found.total, 1);
    assert_eq!(found.items[0].title, "虚构needle 独立支出");
}

#[test]
fn account_sources_validate_by_stable_id() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let id = account(&mut s, "来源账户", "");
    s.validate_source(&Target::Account { id: id.clone() }, &s.generation())
        .unwrap();
    assert_eq!(
        s.validate_source(
            &Target::Account {
                id: uuid::Uuid::new_v4().to_string()
            },
            &s.generation()
        )
        .unwrap_err()
        .code,
        "NOT_FOUND"
    );
    assert_eq!(
        s.validate_source(&Target::Account { id }, "wrong-generation")
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
}

#[test]
fn kinds_order_matches_the_design_table() {
    assert_eq!(
        KINDS,
        [
            "asset", "wish", "account", "snapshot", "expense", "plan", "payment", "virtual",
            "topup"
        ]
    );
}

#[test]
fn review_display_type_labels_are_searchable_without_any_other_field_hit() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    account(&mut s, "普通账户", "");
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: "普通开支".into(),
                date: "2026-09-01".into(),
                amount_cents: "1000".into(),
                category: "travel".into(),
                notes: String::new(),
                refund_cents: None,
                refund_date: None,
                asset_id: None,
            },
        },
        TODAY,
    )
    .unwrap();
    for category in ["utilities", "membership"] {
        s.recurring_plan_save(
            &thingary_lib::recurring::PlanSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::recurring::PlanFields {
                    auto_renew: true,
                    service_start: None,
                    coverage_start: None,
                    interval_days: None,
                    trial_days: None,
                    name: "普通计划".into(),
                    category: category.into(),
                    amount_cents: "1000".into(),
                    interval_months: 1,
                    first_due: "2026-09-01".into(),
                    end_date: None,
                    paused: false,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    }
    let v = virtual_asset(&mut s, "普通档案", "", false);
    for (keyword, kind, field) in [
        ("现金与存款", "account", "类型"),
        ("旅行", "expense", "分类"),
        ("水电网", "plan", "类别"),
        ("会员服务", "plan", "类别"),
        ("虚拟资产", "virtual", "类型"),
    ] {
        let found = s.search_all(&q(&s, keyword, kind, 0)).unwrap();
        assert_eq!(found.total, 1, "{keyword}");
        assert_eq!(found.items[0].matched_field, field);
        assert_eq!(found.items[0].context, keyword);
    }
    // Old business-type archives retain the same visible vocabulary as the UI.
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE virtual_assets SET kind='subscription' WHERE id=?1",
            [&v],
        )
        .unwrap();
    let found = s.search_all(&q(&s, "订阅服务", "virtual", 0)).unwrap();
    assert_eq!(found.total, 1);
    assert_eq!(found.items[0].context, "订阅服务");
    assert_eq!(
        s.search_all(&q(&s, "subscription", "virtual", 0))
            .unwrap()
            .total,
        0
    );
}

#[test]
fn review_unicode_context_keeps_original_utf8_boundaries_and_ascii_matching() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    asset(&mut s, "İ中 Camera Ä", "", None);
    for keyword in ["中", "İ中", "camera", "Ä"] {
        let found = s.search_all(&q(&s, keyword, "asset", 0)).unwrap();
        assert_eq!(found.total, 1);
        assert_eq!(found.items[0].context, "İ中 Camera Ä");
    }
    assert_eq!(s.search_all(&q(&s, "ä", "asset", 0)).unwrap().total, 0);
    asset(
        &mut s,
        "长备注",
        &format!("{}İ中{}", "前".repeat(90), "后".repeat(90)),
        None,
    );
    let found = s.search_all(&q(&s, "中", "asset", 0)).unwrap();
    let long = found.items.iter().find(|i| i.title == "长备注").unwrap();
    assert!(long.context.contains("İ中"));
    assert!(long.context.starts_with('…') && long.context.ends_with('…'));
}

#[test]
fn review_virtual_and_topup_fields_targets_and_parent_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let id = virtual_asset(&mut s, "虚构充值档案", "充值事实备注", true);
    let found = s.search_all(&q(&s, "充值事实备注", "all", 0)).unwrap();
    assert_eq!(found.total, 2);
    assert!(found.items.iter().any(|i| i.kind == "virtual"));
    assert!(found.items.iter().any(|i| i.kind == "topup"));
    for item in &found.items {
        s.validate_source(&item.target, &s.generation()).unwrap();
    }
    let by_date = s.search_all(&q(&s, "2026-09-17", "topup", 0)).unwrap();
    assert_eq!(by_date.total, 1);
    assert_eq!(by_date.items[0].matched_field, "充值日期");
    let by_parent = s.search_all(&q(&s, "虚构充值档案", "topup", 0)).unwrap();
    assert_eq!(by_parent.total, 1);
    s.wealth_trash(&thingary_lib::wealth::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: "virtual".into(),
        id,
        expected_revision: 1,
        deleted: true,
    })
    .unwrap();
    assert_eq!(
        s.search_all(&q(&s, "充值事实备注", "all", 0))
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        s.validate_source(&by_date.items[0].target, &s.generation())
            .unwrap_err()
            .code,
        "NOT_FOUND"
    );
}

#[test]
fn review_same_generation_writes_restart_pagination_without_mixing_versions() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    for i in 0..35 {
        asset(&mut s, &format!("匹配物品 {i}"), "", None);
    }
    let first = s.search_all(&q(&s, "匹配", "asset", 0)).unwrap();
    let mut next = q(&s, "匹配", "asset", 30);
    next.revision = Some(first.revision.clone());
    let stable = s.search_all(&next).unwrap();
    assert_eq!(stable.offset, 30);
    assert_eq!(stable.items.len(), 5);
    asset(&mut s, "匹配新物品", "", None);
    let changed = s.search_all(&next).unwrap();
    assert_eq!(changed.generation, first.generation);
    assert_ne!(changed.revision, first.revision);
    assert_eq!(changed.offset, 0);
    assert_eq!(changed.items.len(), 30);
    assert_eq!(changed.total, 36);
}

#[test]
fn review_order_is_primary_then_created_desc_then_kind_then_stable_id() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let older = asset(&mut s, "排序命中旧名称", "", None);
    let twin_a = asset(&mut s, "排序命中同名", "", None);
    let twin_b = asset(&mut s, "排序命中同名", "", None);
    let wished = wish(&mut s, "排序命中心愿", "");
    let secondary = asset(&mut s, "普通名称", "排序命中备注", None);
    let conn = s.conn_for_test().unwrap();
    for (id, created) in [
        (&older, "2026-01-01T00:00:00Z"),
        (&twin_a, "2026-02-01T00:00:00Z"),
        (&twin_b, "2026-02-01T00:00:00Z"),
        (&secondary, "2026-03-01T00:00:00Z"),
    ] {
        conn.execute(
            "UPDATE asset_profiles SET created_at=?2 WHERE asset_id=?1",
            [id, &created.to_owned()],
        )
        .unwrap();
    }
    conn.execute(
        "UPDATE wishlist_items SET created_at='2026-02-01T00:00:00Z' WHERE id=?1",
        [&wished],
    )
    .unwrap();
    let mut twins = [twin_a, twin_b];
    twins.sort();
    let expected = vec![
        format!("asset:{}", twins[0]),
        format!("asset:{}", twins[1]),
        format!("wish:{wished}"),
        format!("asset:{older}"),
        format!("asset:{secondary}"),
    ];
    let found = s.search_all(&q(&s, "排序命中", "all", 0)).unwrap();
    assert_eq!(
        found.items.iter().map(|i| i.id.clone()).collect::<Vec<_>>(),
        expected
    );
    assert_eq!(
        s.search_all(&q(&s, "排序命中", "all", 0))
            .unwrap()
            .items
            .iter()
            .map(|i| i.id.clone())
            .collect::<Vec<_>>(),
        expected
    );
}
