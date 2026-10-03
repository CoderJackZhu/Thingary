//! U20 隔离验收夹具：把产品设计 17.14.6 的虚构样例经业务 API 写入资料库
//! （只允许路径含 local.thingary.u20.acceptance）。
//! 三次盘点：
//! · 2026-08-31 全部已知（W-AC01 起点）；
//! · 2026-09-20 信用卡未知、房贷临时改为计入（W-AC03 的未知与 W-AC05 的计入范围变化）；
//! · 2026-09-28 全部已知（W-AC01 终点）。
//! 基金账户 2026-09-10 启用（W-AC04「新增账户」）。默认区间＝8/31→9/28，与概览一致。
use std::path::PathBuf;
use thingary_lib::{
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};

const TODAY: &str = "2026-10-02";

fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn yuan(n: i64) -> String {
    (n * 100).to_string()
}

fn account(
    s: &mut Store,
    name: &str,
    side: &str,
    kind: &str,
    counted: bool,
    opened: &str,
) -> thingary_lib::wealth::Account {
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
                counted,
                opened_on: opened.into(),
                closed_on: None,
                notes: "U20 隔离验收虚构样例".into(),
            },
        },
        TODAY,
    )
    .unwrap()
}

fn edit_counted(s: &mut Store, a: &thingary_lib::wealth::Account, counted: bool) {
    let mut fields = a.fields.clone();
    fields.counted = counted;
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(a.id.clone()),
            expected_revision: Some(a.revision),
            fields,
        },
        TODAY,
    )
    .unwrap();
}

fn entry(a: &thingary_lib::wealth::Account, state: &str, amount: Option<i64>) -> EntryInput {
    EntryInput {
        account_id: a.id.clone(),
        state: state.into(),
        amount_cents: amount.map(yuan),
    }
}

fn check_in(s: &Store, date: &str, entries: Vec<EntryInput>) -> SnapshotSave {
    SnapshotSave {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        date: date.into(),
        notes: String::new(),
        entries,
    }
}

fn main() {
    let root: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: u20_fixture <library-root>")
        .parse()
        .unwrap();
    if std::fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        panic!("refusing symlink path: {}", root.display());
    }
    let canonical = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    assert!(
        canonical
            .components()
            .any(|c| c.as_os_str() == "local.thingary.u20.acceptance"),
        "refusing non-isolated path: {}",
        canonical.display()
    );
    let mut s = Store::open(&root).expect("open store");
    if !s.wealth_accounts().unwrap().is_empty() {
        println!("already-populated");
        return;
    }
    // 账户（17.14.6）：招行储蓄、证券账户、公积金、信用卡（负债）、房贷（负债，不计入）
    let cash = account(&mut s, "招行储蓄", "asset", "cash", true, "2026-01-01");
    let broker = account(
        &mut s,
        "证券账户",
        "asset",
        "investment",
        true,
        "2026-01-01",
    );
    let fund = account(
        &mut s,
        "公积金",
        "asset",
        "housing_fund",
        true,
        "2026-01-01",
    );
    let card = account(
        &mut s,
        "信用卡",
        "liability",
        "credit_card",
        true,
        "2026-01-01",
    );
    let mortgage = account(&mut s, "房贷", "liability", "loan", false, "2026-01-01");
    // W-AC04：9/10 新开的基金账户
    let fresh = account(&mut s, "基金账户", "asset", "fund", true, "2026-09-10");

    // 8/31：50,000／200,000／80,000／欠 5,000／欠 900,000
    s.wealth_snapshot_save(
        &check_in(
            &s,
            "2026-08-31",
            vec![
                entry(&cash, "entered", Some(50_000)),
                entry(&broker, "entered", Some(200_000)),
                entry(&fund, "entered", Some(80_000)),
                entry(&card, "entered", Some(5_000)),
                entry(&mortgage, "entered", Some(900_000)),
            ],
        ),
        TODAY,
    )
    .unwrap();

    // 9/20：信用卡未知（W-AC03 的未知态）；房贷临时改为计入（W-AC05 的计入范围变化）
    edit_counted(&mut s, &mortgage, true);
    let mortgage_at_920 = s
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.id == mortgage.id)
        .unwrap();
    s.wealth_snapshot_save(
        &check_in(
            &s,
            "2026-09-20",
            vec![
                entry(&cash, "entered", Some(46_000)),
                entry(&broker, "entered", Some(208_000)),
                entry(&fund, "entered", Some(81_000)),
                entry(&card, "missing", None),
                entry(&mortgage_at_920, "entered", Some(898_000)),
                entry(&fresh, "entered", Some(5_000)),
            ],
        ),
        TODAY,
    )
    .unwrap();

    // 9/28：42,000／215,000／82,000／欠 3,000／欠 896,000／基金 10,000
    edit_counted(&mut s, &mortgage_at_920, false);
    let mortgage_at_928 = s
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.id == mortgage.id)
        .unwrap();
    s.wealth_snapshot_save(
        &check_in(
            &s,
            "2026-09-28",
            vec![
                entry(&cash, "entered", Some(42_000)),
                entry(&broker, "entered", Some(215_000)),
                entry(&fund, "entered", Some(82_000)),
                entry(&card, "entered", Some(3_000)),
                entry(&mortgage_at_928, "entered", Some(896_000)),
                entry(&fresh, "entered", Some(10_000)),
            ],
        ),
        TODAY,
    )
    .unwrap();

    let summary = s.wealth_summary().unwrap();
    println!(
        "fixture ready: {} accounts, {} points, default compare = {} → {}",
        s.wealth_accounts().unwrap().len(),
        summary.points.len(),
        summary
            .points
            .last()
            .unwrap()
            .compared_to
            .as_deref()
            .unwrap_or("?"),
        summary.points.last().unwrap().date,
    );
}
