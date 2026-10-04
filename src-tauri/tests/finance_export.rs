//! Readable finance tables: check-ins, important expenses, recurring costs.
//! Expected text is written out by hand from the fictional records below.
use thingary_lib::{
    expenses::{Fields, Save as ExpenseSave},
    recurring::{PaymentSave, PlanFields, PlanSave},
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};

const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn read(s: &Store, kind: &str, name: &str) -> (String, i64) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    let rows = s.export_finance_csv(kind, &path).unwrap();
    (std::fs::read_to_string(path).unwrap(), rows)
}

#[test]
fn check_ins_export_one_row_per_account_with_unknown_left_empty() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut open = |name: &str, side: &str, kind: &str, counted: bool| {
        s.wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: name.into(),
                    institution: "虚构平台".into(),
                    side: side.into(),
                    kind: kind.into(),
                    counted,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap()
    };
    let cash = open("虚构储蓄卡", "asset", "cash", true);
    let loan = open("虚构房贷", "liability", "loan", false);
    let entry = |a: &thingary_lib::wealth::Account, state: &str, cents: Option<&str>| EntryInput {
        account_id: a.id.clone(),
        state: state.into(),
        amount_cents: cents.map(str::to_owned),
    };
    for (date, entries) in [
        (
            "2026-08-31",
            vec![
                entry(&cash, "entered", Some("5000000")),
                entry(&loan, "entered", Some("90000000")),
            ],
        ),
        (
            "2026-09-28",
            vec![
                entry(&cash, "missing", None),
                entry(&loan, "entered", Some("89600000")),
            ],
        ),
    ] {
        s.wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: date.into(),
                notes: String::new(),
                entries,
            },
            TODAY,
        )
        .unwrap();
    }
    let (csv, rows) = read(&s, "wealth", "盘点记录.csv");
    assert_eq!(rows, 4);
    assert_eq!(
        csv,
        "\u{feff}盘点日期,账户,平台,方向,类型,计入净资产,状态,金额（元）\r\n\
         2026-08-31,虚构储蓄卡,虚构平台,资产,现金与存款,是,录入,50000.00\r\n\
         2026-08-31,虚构房贷,虚构平台,负债,贷款,否,录入,900000.00\r\n\
         2026-09-28,虚构储蓄卡,虚构平台,资产,现金与存款,是,未知,\r\n\
         2026-09-28,虚构房贷,虚构平台,负债,贷款,否,录入,896000.00\r\n"
    );
}

#[test]
fn expenses_export_with_refund_and_formula_looking_text_defused() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let save = |s: &mut Store, f: Fields| {
        s.expense_save(
            &ExpenseSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            TODAY,
        )
        .unwrap()
    };
    let base = |title: &str, date: &str, amount: &str| Fields {
        title: title.into(),
        date: date.into(),
        amount_cents: amount.into(),
        category: "travel".into(),
        notes: String::new(),
        refund_cents: None,
        refund_date: None,
        asset_id: None,
    };
    save(
        &mut s,
        Fields {
            refund_cents: Some("60000".into()),
            refund_date: Some("2026-09-03".into()),
            ..base("虚构周末旅行", "2026-09-01", "250000")
        },
    );
    save(
        &mut s,
        Fields {
            category: "digital".into(),
            notes: "含,逗号".into(),
            ..base("=虚构课程", "2026-09-19", "360000")
        },
    );
    let (csv, rows) = read(&s, "expenses", "重要支出.csv");
    assert_eq!(rows, 2);
    assert_eq!(
        csv,
        "\u{feff}日期,名称,分类,金额（元）,退款（元）,退款日期,关联物品,备注\r\n\
         2026-09-01,虚构周末旅行,旅行,2500.00,600.00,2026-09-03,,\r\n\
         2026-09-19,'=虚构课程,数字服务,3600.00,,,,\"含,逗号\"\r\n"
    );
}

#[test]
fn recurring_export_lists_each_period_and_a_plan_without_payments_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let plan = |s: &mut Store, name: &str, amount: &str, months: u32, first: &str| {
        s.recurring_plan_save(
            &PlanSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: PlanFields {
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
    let rent = plan(&mut s, "虚构房租", "300000", 1, "2026-09-01");
    plan(&mut s, "虚构域名", "12000", 12, "2026-10-09");
    for (due, amount, paid) in [
        ("2026-09-01", Some("300000"), Some("2026-09-02")),
        ("2026-10-01", None, None),
    ] {
        s.recurring_payment_save(
            &PaymentSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                plan_id: rent.id.clone(),
                due_date: due.into(),
                state: if amount.is_some() { "paid" } else { "skipped" }.into(),
                paid_date: paid.map(str::to_owned),
                amount_cents: amount.map(str::to_owned),
                notes: String::new(),
            },
            TODAY,
        )
        .unwrap();
    }
    let (csv, rows) = read(&s, "recurring", "周期费用.csv");
    assert_eq!(rows, 3);
    assert_eq!(
        csv,
        "\u{feff}计划,分类,周期,每期金额（元）,首期到期日,结束日期,计划状态,到期日,付款状态,实付日期,实付金额（元）,备注\r\n\
         虚构域名,房租,每年,120.00,2026-10-09,,进行中,,,,,\r\n\
         虚构房租,房租,每月,3000.00,2026-09-01,,进行中,2026-09-01,已付,2026-09-02,3000.00,\r\n\
         虚构房租,房租,每月,3000.00,2026-09-01,,进行中,2026-10-01,本期不付,,,\r\n"
    );
    assert!(s
        .export_finance_csv("nope", &std::env::temp_dir().join("x.csv"))
        .is_err());
}

#[test]
fn exports_are_empty_but_well_formed_without_records() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path()).unwrap();
    for kind in ["wealth", "expenses", "recurring"] {
        let (csv, rows) = read(&s, kind, "空.csv");
        assert_eq!(rows, 0, "{kind}");
        assert!(
            csv.starts_with('\u{feff}')
                && csv.ends_with("\r\n")
                && csv.matches("\r\n").count() == 1,
            "{kind}"
        );
    }
}
