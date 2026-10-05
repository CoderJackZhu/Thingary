//! 2.5.0 隔离原生验收夹具（只允许路径含 local.thingary.u21.acceptance）：
//! 几件虚构物品、两个账户两次盘点、两笔重要支出（其一有退款）、两个周期计划及其付款，
//! 用来核对财富表导出、`.thingary` 备份与恢复、窄窗口物品列表。
use std::path::PathBuf;
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save as AssetSave,
    expenses::{Fields, Save as ExpenseSave},
    recurring::{PaymentSave, PlanFields, PlanSave},
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};

const TODAY: &str = "2026-10-03";

fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn main() {
    let root: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: u21_fixture <library-root>")
        .parse()
        .unwrap();
    if std::fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        panic!("refusing symlink path: {}", root.display());
    }
    let canonical = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    assert!(
        canonical
            .components()
            .any(|c| c.as_os_str() == "local.thingary.u21.acceptance"),
        "refusing non-isolated path: {}",
        canonical.display()
    );
    let mut s = Store::open(&root).expect("open store");
    if !s.wealth_accounts().unwrap().is_empty() {
        println!("already-populated");
        return;
    }
    for (name, price, date) in [
        ("虚构笔记本电脑", "1699900", "2024-03-18"),
        ("虚构相机", "979000", "2023-06-12"),
        ("虚构降噪耳机", "219900", "2024-09-01"),
        (
            "名称特别特别长的虚构物品用来检查窄窗口里是否被截断",
            "50000",
            "2025-12-25",
        ),
    ] {
        s.save_asset(
            &SaveAsset {
                options: None,
                base: AssetSave {
                    request_id: rid(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: name.into(),
                    price_cents: Some(price.into()),
                    purchase_date: Some(date.into()),
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    }
    let mut account = |name: &str, side: &str, kind: &str| {
        s.wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: name.into(),
                    institution: "虚构机构".into(),
                    side: side.into(),
                    kind: kind.into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap()
    };
    let cash = account("虚构储蓄卡", "asset", "cash");
    let card = account("虚构信用卡", "liability", "credit_card");
    for (date, cash_cents, card_cents) in [
        ("2026-08-31", "5000000", "500000"),
        ("2026-09-28", "4200000", "300000"),
    ] {
        s.wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: date.into(),
                notes: String::new(),
                entries: vec![
                    EntryInput {
                        account_id: cash.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(cash_cents.into()),
                    },
                    EntryInput {
                        account_id: card.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(card_cents.into()),
                    },
                ],
            },
            TODAY,
        )
        .unwrap();
    }
    for (title, date, amount, refund) in [
        (
            "虚构周末旅行",
            "2026-09-01",
            "250000",
            Some(("60000", "2026-09-03")),
        ),
        ("虚构摄影课程", "2026-09-19", "360000", None),
    ] {
        s.expense_save(
            &ExpenseSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    title: title.into(),
                    date: date.into(),
                    amount_cents: amount.into(),
                    category: "travel".into(),
                    notes: String::new(),
                    refund_cents: refund.map(|r| r.0.into()),
                    refund_date: refund.map(|r| r.1.into()),
                    asset_id: None,
                },
            },
            TODAY,
        )
        .unwrap();
    }
    let mut plan = |name: &str, amount: &str, months: u32, first: &str| {
        s.recurring_plan_save(
            &PlanSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: PlanFields {
                    auto_renew: true,
                    interval_days: None,
                    trial_days: None,
                    service_start: None,
                    coverage_start: None,
                    name: name.into(),
                    category: "rent".into(),
                    amount_cents: amount.into(),
                    interval_months: months,
                    first_due: first.into(),
                    end_date: None,
                    paused: false,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap()
    };
    let rent = plan("虚构房租", "300000", 1, "2026-09-01");
    plan("虚构域名续费", "12000", 12, "2026-10-09");
    s.recurring_payment_save(
        &PaymentSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: rent.id.clone(),
            due_date: "2026-09-01".into(),
            state: "paid".into(),
            paid_date: Some("2026-09-02".into()),
            amount_cents: Some("300000".into()),
            notes: String::new(),
        },
        TODAY,
    )
    .unwrap();
    println!("populated");
}
