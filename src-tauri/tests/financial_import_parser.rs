//! Financial history import parser tests (PLANNING_COMPONENT_CONTRACTS §2).
//! The standalone module is compiled here via #[path] so the real source is
//! exercised without touching lib.rs, commands or Store. All data is fictional.
#![allow(dead_code)]
#[path = "../src/financial_import_parser.rs"]
mod financial_import_parser;

use financial_import_parser::{
    parse_import_request_json, parse_import_v1, template_csv, ExistingAccountV1, GroupValidationV1,
    ImportContext, ImportContractError, ImportPreviewV1, ImportRequestV1, IncomeRowV1, SeverityV1,
    StandardRowV1, CODE_ACCOUNT_DATE_ORDER, CODE_ACCOUNT_KEY_MAPPED, CODE_ACCOUNT_NAME_CANDIDATE,
    CODE_ACCOUNT_NOT_ACTIVE, CODE_ACCOUNT_UNMAPPED, CODE_AMOUNT_INVALID, CODE_AMOUNT_NEGATIVE,
    CODE_AMOUNT_RANGE, CODE_AMOUNT_REQUIRED, CODE_BOOL_INVALID, CODE_CANCELLED,
    CODE_COLUMN_MAPPING_CONFLICT, CODE_COLUMN_MAPPING_UNKNOWN_SOURCE,
    CODE_COLUMN_MAPPING_UNKNOWN_TARGET, CODE_CONTEXT_INVALID, CODE_CONTRACT_INVALID,
    CODE_CONTRACT_VERSION_UNSUPPORTED, CODE_COVERAGE_OVERLAP, CODE_COVERAGE_RANGE_INVALID,
    CODE_CSV_COLUMN_COUNT, CODE_CSV_FORMAT, CODE_DATE_FUTURE, CODE_DATE_INVALID,
    CODE_DUPLICATE_HEADER, CODE_DUPLICATE_KEY_CONFLICT, CODE_DUPLICATE_KEY_SAME, CODE_EMPTY_FILE,
    CODE_EXTRA_COLUMN_IGNORED, CODE_GROUP_REQUIRES_CONTEXT, CODE_KEY_LENGTH, CODE_KIND_INVALID,
    CODE_KIND_UNKNOWN, CODE_LIMIT_ROWS, CODE_LIMIT_SIZE, CODE_MISSING_COLUMN, CODE_NOTE_LENGTH,
    CODE_NO_DATA_ROWS, CODE_SNAPSHOT_DATE_CONFLICT, CODE_SNAPSHOT_DUPLICATE_ACCOUNT,
    CODE_SNAPSHOT_GROUP_DATE_CONFLICT, CODE_SNAPSHOT_GROUP_NOTE_CONFLICT,
    CODE_SNAPSHOT_MISSING_ACCOUNT, CODE_STATE_INVALID, KINDS,
};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::time::Instant;

const TODAY: &str = "2026-10-07";
const SAMPLE_ACCOUNTS: &str = include_str!("../src/financial_import_parser/samples/accounts.csv");
const SAMPLE_SNAPSHOTS: &str = include_str!("../src/financial_import_parser/samples/snapshots.csv");
const SAMPLE_INCOMES: &str = include_str!("../src/financial_import_parser/samples/incomes.csv");
const SAMPLE_COVERAGE: &str =
    include_str!("../src/financial_import_parser/samples/income_coverage.csv");
const SAMPLE_NET_WORTH: &str =
    include_str!("../src/financial_import_parser/samples/net_worth_history.csv");
const FIX_BOM: &str = include_str!("fixtures/financial_import_parser/bom_crlf_quotes.csv");
const FIX_BROKEN_QUOTE: &str = include_str!("fixtures/financial_import_parser/broken_quote.csv");
const FIX_MISPLACED_QUOTE: &str =
    include_str!("fixtures/financial_import_parser/misplaced_quote.csv");
const FIX_TRAILING_QUOTE: &str =
    include_str!("fixtures/financial_import_parser/trailing_after_quote.csv");
const FIX_RAGGED: &str = include_str!("fixtures/financial_import_parser/ragged_row.csv");
const FIX_DUP_HEADER: &str = include_str!("fixtures/financial_import_parser/duplicate_header.csv");

fn no_cancel() -> bool {
    false
}
fn ctx() -> ImportContext<'static> {
    ImportContext {
        today: TODAY,
        cancel: &(no_cancel as fn() -> bool),
    }
}

fn request(kind: &str, csv: &str) -> ImportRequestV1 {
    ImportRequestV1 {
        contract_version: 1,
        kind: kind.into(),
        csv_text: csv.into(),
        column_mapping: BTreeMap::new(),
        existing_accounts: None,
    }
}

fn mapped(mut req: ImportRequestV1, pairs: &[(&str, &str)]) -> ImportRequestV1 {
    req.column_mapping = pairs
        .iter()
        .map(|(s, t)| (s.to_string(), t.to_string()))
        .collect();
    req
}

fn cataloged(mut req: ImportRequestV1, list: Vec<ExistingAccountV1>) -> ImportRequestV1 {
    req.existing_accounts = Some(list);
    req
}

fn run(req: &ImportRequestV1) -> Result<ImportPreviewV1, ImportContractError> {
    parse_import_v1(req, &ctx())
}

fn run_ok(req: &ImportRequestV1) -> ImportPreviewV1 {
    run(req).expect("parse should succeed")
}

fn run_err(req: &ImportRequestV1) -> ImportContractError {
    run(req).expect_err("parse should fail")
}

fn codes(p: &ImportPreviewV1) -> Vec<&'static str> {
    p.issues.iter().map(|i| i.code).collect()
}

fn has_code(p: &ImportPreviewV1, code: &str) -> bool {
    p.issues.iter().any(|i| i.code == code)
}

fn only_error_codes(p: &ImportPreviewV1) -> Vec<&'static str> {
    p.issues
        .iter()
        .filter(|i| i.severity == SeverityV1::Error)
        .map(|i| i.code)
        .collect()
}

fn ea(
    external_key: Option<&str>,
    id: &str,
    name: &str,
    kind: &str,
    from: &str,
    to: Option<&str>,
) -> ExistingAccountV1 {
    ExistingAccountV1 {
        external_key: external_key.map(str::to_string),
        account_id: id.into(),
        name: name.into(),
        kind: kind.into(),
        enabled_from: from.into(),
        disabled_from: to.map(str::to_string),
    }
}

/// Catalog matching the shipped samples: six accounts, credit card disabled
/// from 2026-01-01.
fn sample_catalog() -> Vec<ExistingAccountV1> {
    vec![
        ea(
            Some("acc_cash"),
            "id-cash",
            "现金钱包",
            "cash",
            "2024-01-01",
            None,
        ),
        ea(
            Some("acc_bank"),
            "id-bank",
            "工资储蓄卡",
            "cash",
            "2024-01-01",
            None,
        ),
        ea(
            Some("acc_fund"),
            "id-fund",
            "沪深300指数基金",
            "investment",
            "2024-01-01",
            None,
        ),
        ea(
            Some("acc_hpf"),
            "id-hpf",
            "公积金账户",
            "housing_fund",
            "2024-01-01",
            None,
        ),
        ea(
            Some("acc_card"),
            "id-card",
            "信用卡",
            "credit_card",
            "2024-01-01",
            Some("2026-01-01"),
        ),
        ea(
            Some("acc_loan"),
            "id-loan",
            "房贷",
            "loan",
            "2024-01-01",
            None,
        ),
    ]
}

fn income_rows(p: &ImportPreviewV1) -> Vec<&IncomeRowV1> {
    p.rows
        .iter()
        .filter_map(|r| match r {
            StandardRowV1::Incomes(i) => Some(i),
            _ => None,
        })
        .collect()
}

fn group<'a>(p: &'a ImportPreviewV1, key: &str) -> &'a financial_import_parser::SnapshotGroupV1 {
    p.groups
        .iter()
        .find(|g| g.group_key == key)
        .expect("group exists")
}

// ---- Templates and samples --------------------------------------------------

#[test]
fn templates_have_complete_headers_and_flag_no_data_rows() {
    for kind in KINDS {
        let text = template_csv(kind).unwrap();
        assert!(text.starts_with('\u{feff}'), "template should carry a BOM");
        let p = run_ok(&request(kind, &text));
        assert_eq!(only_error_codes(&p), vec![CODE_NO_DATA_ROWS], "kind {kind}");
        assert_eq!(p.counts.rows_read, 0);
        assert!(p.rows.is_empty());
    }
    assert_eq!(
        template_csv("balances").unwrap_err().code,
        CODE_KIND_UNKNOWN
    );
}

#[test]
fn shipped_account_and_income_samples_parse_clean() {
    let accounts = run_ok(&request("accounts", SAMPLE_ACCOUNTS));
    assert!(accounts.issues.is_empty(), "issues: {:?}", accounts.issues);
    assert_eq!(accounts.counts.rows_valid, 6);

    let incomes = run_ok(&request("incomes", SAMPLE_INCOMES));
    assert!(incomes.issues.is_empty(), "issues: {:?}", incomes.issues);
    assert_eq!(incomes.counts.rows_valid, 25);
    let rows = income_rows(&incomes);
    let zero = rows
        .iter()
        .find(|r| r.income_key == "income_2025_03")
        .unwrap();
    assert_eq!(zero.net_income_cents, "0");
    assert_eq!(zero.hpf_deposit_cents.as_deref(), Some("0"));
    let unknown = rows
        .iter()
        .find(|r| r.income_key == "income_2026_02")
        .unwrap();
    assert_eq!(unknown.hpf_deposit_cents, None);
    // 2025-06-10 carries salary and a bonus with different keys: both kept.
    let june10: Vec<_> = rows.iter().filter(|r| r.date == "2025-06-10").collect();
    assert_eq!(june10.len(), 2);
    assert_ne!(june10[0].income_key, june10[1].income_key);
    assert_eq!(june10[0].net_income_cents, june10[1].net_income_cents);

    let coverage = run_ok(&request("income_coverage", SAMPLE_COVERAGE));
    assert!(coverage.issues.is_empty(), "issues: {:?}", coverage.issues);
    assert_eq!(coverage.counts.rows_valid, 3);

    let net_worth = run_ok(&request("net_worth_history", SAMPLE_NET_WORTH));
    assert!(
        net_worth.issues.is_empty(),
        "issues: {:?}",
        net_worth.issues
    );
    assert_eq!(net_worth.counts.rows_valid, 4);
    let first = match &net_worth.rows[0] {
        StandardRowV1::NetWorthHistory(r) => r.net_worth_cents.clone(),
        _ => panic!("wrong row kind"),
    };
    assert_eq!(first, "-15200000", "yuan -152000.00 → integer cents");
}

#[test]
fn shipped_snapshot_sample_requires_context_then_validates_with_catalog() {
    let without = run_ok(&request("snapshots", SAMPLE_SNAPSHOTS));
    assert_eq!(without.counts.rows_valid, 136);
    assert_eq!(without.counts.groups_requires_account_context, 24);
    assert!(without
        .groups
        .iter()
        .all(|g| g.validation == GroupValidationV1::RequiresAccountContext));
    assert!(!has_code(&without, CODE_MISSING_COLUMN));
    assert_eq!(
        without
            .issues
            .iter()
            .filter(|i| i.code == CODE_GROUP_REQUIRES_CONTEXT)
            .count(),
        24
    );

    let with = run_ok(&cataloged(
        request("snapshots", SAMPLE_SNAPSHOTS),
        sample_catalog(),
    ));
    assert!(with.issues.is_empty(), "issues: {:?}", with.issues);
    assert_eq!(with.counts.groups_valid, 24);
    assert_eq!(with.counts.rows_valid, 136);
    assert!(with
        .groups
        .iter()
        .all(|g| g.validation == GroupValidationV1::Valid));
    // 16 groups still include the credit card (disabled from 2026-01-01),
    // the last 8 groups carry five accounts instead of six.
    let with_card = with
        .groups
        .iter()
        .filter(|g| g.source_rows.len() == 6)
        .count();
    assert_eq!(with_card, 16);
}

// ---- Column mapping ---------------------------------------------------------

#[test]
fn column_mapping_maps_nonstandard_headers() {
    let csv = "编号,到账日,到手金额,公积金,备注\ni1,2026-09-30,12000.50,2400,工资\n";
    let req = mapped(
        request("incomes", csv),
        &[
            ("编号", "income_key"),
            ("到账日", "date"),
            ("到手金额", "net_income"),
            ("公积金", "hpf_deposit"),
            ("备注", "note"),
        ],
    );
    let p = run_ok(&req);
    assert!(p.issues.is_empty(), "issues: {:?}", p.issues);
    let row = income_rows(&p)[0];
    assert_eq!(row.income_key, "i1");
    assert_eq!(row.date, "2026-09-30");
    assert_eq!(row.net_income_cents, "1200050");
    assert_eq!(row.hpf_deposit_cents.as_deref(), Some("240000"));
}

#[test]
fn mapping_conflicts_and_unknown_entries_block_rows() {
    let csv = "编号,序号,date,net_income\na,甲,2026-09-30,1\n";
    let req = mapped(
        request("incomes", csv),
        &[("编号", "income_key"), ("序号", "income_key")],
    );
    let p = run_ok(&req);
    assert!(has_code(&p, CODE_COLUMN_MAPPING_CONFLICT));
    assert!(p.rows.is_empty(), "fatal mapping leaves no rows");

    let req = mapped(request("incomes", csv), &[("编号", "序号")]);
    assert_eq!(
        run_ok(&req).issues[0].code,
        CODE_COLUMN_MAPPING_UNKNOWN_TARGET
    );

    let req = mapped(request("incomes", csv), &[("不存在", "note")]);
    assert_eq!(
        run_ok(&req).issues[0].code,
        CODE_COLUMN_MAPPING_UNKNOWN_SOURCE
    );
}

#[test]
fn missing_required_columns_and_extra_columns() {
    let csv = "account_key,name,kind,enabled_from,platform\na1,甲,cash,2024-01-01,平台\n";
    let p = run_ok(&request("accounts", csv));
    assert!(has_code(&p, CODE_MISSING_COLUMN));
    assert!(p.rows.is_empty());

    let csv = "income_key,date,net_income,币种\ni1,2026-09-30,10,CNY\n";
    let p = run_ok(&request("incomes", csv));
    assert!(only_error_codes(&p).is_empty());
    assert!(has_code(&p, CODE_EXTRA_COLUMN_IGNORED));
    assert_eq!(p.counts.rows_valid, 1);
}

// ---- CSV format -------------------------------------------------------------

#[test]
fn bom_crlf_quotes_and_chinese_round_trip() {
    let p = run_ok(&request("accounts", FIX_BOM));
    assert!(p.issues.is_empty(), "issues: {:?}", p.issues);
    assert_eq!(p.counts.rows_valid, 1);
    let row = match &p.rows[0] {
        StandardRowV1::Accounts(a) => a,
        _ => panic!("wrong row kind"),
    };
    assert_eq!(
        row.account_key, "acc_1",
        "BOM stripped from first header cell"
    );
    assert_eq!(row.name, "姓名, 含逗号");
    assert_eq!(row.note.as_deref(), Some("第一行\r\n第二行\"引号\"尾"));
    assert_eq!(row.source_row, 2, "record starting at physical line 2");
}

#[test]
fn format_errors_locate_physical_line_and_column() {
    let p = run_ok(&request("accounts", FIX_BROKEN_QUOTE));
    let issue = p
        .issues
        .iter()
        .find(|i| i.code == CODE_CSV_FORMAT && i.column.is_some())
        .unwrap();
    assert!(
        issue.message.contains("第 3 行"),
        "message: {}",
        issue.message
    );

    let p = run_ok(&request("accounts", FIX_MISPLACED_QUOTE));
    let issue = p
        .issues
        .iter()
        .find(|i| i.code == CODE_CSV_FORMAT && i.column.is_some())
        .unwrap();
    assert!(
        issue.message.contains("第 2 行第 8 列"),
        "message: {}",
        issue.message
    );

    let p = run_ok(&request("accounts", FIX_TRAILING_QUOTE));
    let issue = p
        .issues
        .iter()
        .find(|i| i.code == CODE_CSV_FORMAT && i.column.is_some())
        .unwrap();
    assert!(
        issue.message.contains("第 2 行第 11 列"),
        "message: {}",
        issue.message
    );
}

#[test]
fn ragged_rows_and_duplicate_headers_block() {
    let p = run_ok(&request("accounts", FIX_RAGGED));
    assert_eq!(only_error_codes(&p), vec![CODE_CSV_COLUMN_COUNT]);
    assert!(p.rows.is_empty());
    assert_eq!(p.counts.rows_error, 1);

    let p = run_ok(&request("accounts", FIX_DUP_HEADER));
    assert!(has_code(&p, CODE_DUPLICATE_HEADER));
    assert!(p.rows.is_empty());
}

#[test]
fn empty_files_never_return_empty_success() {
    for text in ["", "\u{feff}", "  \n ", "\n\n"] {
        let p = run_ok(&request("incomes", text));
        assert!(has_code(&p, CODE_EMPTY_FILE), "text {text:?}");
        assert!(p.rows.is_empty());
    }
    let p = run_ok(&request(
        "incomes",
        "income_key,date,net_income,hpf_deposit,note\n",
    ));
    assert_eq!(only_error_codes(&p), vec![CODE_NO_DATA_ROWS]);
}

// ---- Amounts ----------------------------------------------------------------

#[test]
fn amount_boundaries_and_rejections() {
    let mut csv = String::from("income_key,date,net_income,hpf_deposit,note\n");
    csv.push_str("i1,2026-09-30,999999999.99,,上限内\n");
    csv.push_str("i2,2026-09-30,1000000000,,超出上限\n");
    csv.push_str("i3,2026-09-30,0.01,,一分钱\n");
    csv.push_str("i4,2026-09-30,1.2,,一角\n");
    csv.push_str("i5,2026-09-30,1.234,,三位小数\n");
    csv.push_str("i6,2026-09-30,1e3,,指数\n");
    csv.push_str("i7,2026-09-30,\"1,000\",,千分位\n");
    csv.push_str("i8,2026-09-30,¥5,,货币符号\n");
    csv.push_str("i9,2026-09-30, 5.50 ,,外围空白\n");
    csv.push_str("i10,2026-09-30,-1,,负数\n");
    csv.push_str("i11,2026-09-30,,,空金额\n");
    let p = run_ok(&request("incomes", &csv));
    let rows = income_rows(&p);
    assert_eq!(rows.len(), 4, "i1, i3, i4, i9 survive");
    assert_eq!(rows[0].net_income_cents, "99999999999");
    assert_eq!(rows[1].net_income_cents, "1");
    assert_eq!(
        rows[2].net_income_cents, "120",
        "1.2 → 120 cents, no rounding"
    );
    assert_eq!(rows[3].net_income_cents, "550");
    let found = |code| p.issues.iter().any(|i| i.code == code);
    assert!(found(CODE_AMOUNT_RANGE));
    assert!(found(CODE_AMOUNT_INVALID));
    assert!(found(CODE_AMOUNT_NEGATIVE));
    assert!(found(CODE_AMOUNT_REQUIRED));
    assert_eq!(p.counts.rows_read, 11);
    assert_eq!(p.counts.rows_valid + p.counts.rows_error, 11);
}

#[test]
fn negative_amounts_only_for_net_worth() {
    let csv = "history_key,date,net_worth,note\n\
               h1,2025-01-01,-100.50,负债期\n\
               h2,2025-01-02,-0,负零\n\
               h3,2025-01-03,,空金额\n";
    let p = run_ok(&request("net_worth_history", csv));
    let rows: Vec<String> = p
        .rows
        .iter()
        .filter_map(|r| match r {
            StandardRowV1::NetWorthHistory(h) => Some(h.net_worth_cents.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(rows, vec!["-10050".to_string(), "0".to_string()]);
    assert!(!has_code(&p, CODE_AMOUNT_RANGE));
    assert!(
        has_code(&p, CODE_AMOUNT_REQUIRED),
        "unknown amount cannot form a trend point"
    );

    let csv = "snapshot_key,date,account_key,amount\ns1,2025-01-31,a1,-5\n";
    let p = run_ok(&request("snapshots", csv));
    assert!(has_code(&p, CODE_AMOUNT_NEGATIVE));
}

// ---- Dates ------------------------------------------------------------------

#[test]
fn strict_calendar_dates_including_leap_days() {
    let mut csv = String::from("history_key,date,net_worth,note\n");
    csv.push_str("h1,2024-02-29,1,闰日\n");
    csv.push_str("h2,2000-02-29,1,四百年仍闰\n");
    csv.push_str("h3,2025-02-29,1,平年无闰日\n");
    csv.push_str("h4,1900-02-29,1,百年非闰\n");
    csv.push_str("h5,2026-9-1,1,缺前导零\n");
    csv.push_str("h6,2026/09/01,1,斜线分隔\n");
    csv.push_str("h7,2026-13-01,1,月份越界\n");
    csv.push_str("h8,2026-04-31,1,日期越界\n");
    let p = run_ok(&request("net_worth_history", &csv));
    assert_eq!(p.counts.rows_valid, 2);
    assert_eq!(
        p.issues
            .iter()
            .filter(|i| i.code == CODE_DATE_INVALID)
            .count(),
        6
    );
}

#[test]
fn future_dates_are_rejected_with_explicit_today() {
    let csv = "income_key,date,net_income\ni1,2026-10-07,1\ni2,2026-10-08,1\n";
    let p = run_ok(&request("incomes", csv));
    assert_eq!(p.counts.rows_valid, 1, "today itself is allowed");
    let issue = p
        .issues
        .iter()
        .find(|i| i.code == CODE_DATE_FUTURE)
        .unwrap();
    assert_eq!(issue.source_row, Some(3));
    assert!(issue.message.contains("2026-10-08"));
}

// ---- Accounts ---------------------------------------------------------------

#[test]
fn account_field_rules() {
    let mut csv =
        String::from("account_key,name,kind,enabled_from,disabled_from,counted,platform,note\n");
    csv.push_str("a1,甲,cash,2024-01-01,,TRUE,平台,大写布尔\n");
    csv.push_str("a2,乙,储蓄卡,2024-01-01,,true,,非法类型\n");
    csv.push_str("a3,丙,cash,2024-01-01,,yes,,非法布尔\n");
    csv.push_str("a4,丁,cash,2024-01-01,,,,空布尔\n");
    csv.push_str("a5,戊,cash,2024-01-01,2024-01-01,true,,停用等于启用\n");
    csv.push_str("a6,己,cash,2024-01-01,2023-12-31,true,,停用早于启用\n");
    csv.push_str("a7,庚,cash,2027-01-01,,true,,未来启用\n");
    let long: String = "k".repeat(101);
    csv.push_str(&format!("{long},辛,cash,2024-01-01,,true,,键超长\n"));
    let p = run_ok(&request("accounts", &csv));
    assert_eq!(p.counts.rows_valid, 1, "only a1 survives");
    let found = |code| p.issues.iter().any(|i| i.code == code);
    assert!(found(CODE_KIND_INVALID));
    assert!(found(CODE_BOOL_INVALID));
    assert!(found(CODE_ACCOUNT_DATE_ORDER));
    assert!(found(CODE_DATE_FUTURE));
    assert!(found(CODE_KEY_LENGTH));
}

#[test]
fn note_length_limits_reuse_live_caps() {
    let mut csv =
        String::from("account_key,name,kind,enabled_from,disabled_from,counted,platform,note\n");
    csv.push_str(&format!(
        "a1,甲,cash,2024-01-01,,true,平台,{}\n",
        "长".repeat(10_001)
    ));
    let p = run_ok(&request("accounts", &csv));
    assert!(has_code(&p, CODE_NOTE_LENGTH));

    let mut csv = String::from("income_key,date,net_income,note\n");
    csv.push_str(&format!("i1,2026-09-30,1,{}\n", "注".repeat(501)));
    let p = run_ok(&request("incomes", &csv));
    assert!(has_code(&p, CODE_NOTE_LENGTH));
    assert_eq!(p.counts.rows_error, 1);
}

#[test]
fn catalog_candidates_warn_but_never_merge() {
    let catalog = vec![
        ea(Some("k1"), "id1", "已有账户", "cash", "2024-01-01", None),
        ea(Some("k2"), "id2", "同名账户", "cash", "2024-01-01", None),
    ];
    let csv = "account_key,name,kind,enabled_from,disabled_from,counted,platform,note\n\
               k1,已有账户,cash,2024-01-01,,true,,映射复用\n\
               k9,同名账户,cash,2024-01-01,,true,,同名不同键\n";
    let p = run_ok(&cataloged(request("accounts", csv), catalog));
    assert_eq!(p.counts.rows_valid, 2);
    assert!(has_code(&p, CODE_ACCOUNT_KEY_MAPPED));
    assert!(has_code(&p, CODE_ACCOUNT_NAME_CANDIDATE));
    assert!(p.issues.iter().all(|i| i.severity == SeverityV1::Warning));
    assert_eq!(p.issues.len(), 2);
}

#[test]
fn catalog_shape_failures_are_context_errors() {
    let base = "account_key,name,kind,enabled_from,disabled_from,counted,platform,note\n\
                a1,甲,cash,2024-01-01,,true,,\n";
    let cases: Vec<Vec<ExistingAccountV1>> = vec![
        vec![
            ea(Some("k1"), "id1", "甲", "cash", "2024-01-01", None),
            ea(Some("k1"), "id2", "乙", "cash", "2024-01-01", None),
        ],
        vec![
            ea(Some("k1"), "id1", "甲", "cash", "2024-01-01", None),
            ea(Some("k2"), "id1", "乙", "cash", "2024-01-01", None),
        ],
        vec![ea(Some("k1"), "id1", "甲", "储蓄卡", "2024-01-01", None)],
        vec![ea(Some("k1"), "id1", "甲", "cash", "2024/01/01", None)],
        vec![ea(
            Some("k1"),
            "id1",
            "甲",
            "cash",
            "2024-01-01",
            Some("2024-01-01"),
        )],
    ];
    for catalog in cases {
        let err = run_err(&cataloged(request("accounts", base), catalog));
        assert_eq!(err.code, CODE_CONTEXT_INVALID);
    }
}

// ---- Snapshots --------------------------------------------------------------

#[test]
fn snapshot_groups_detect_internal_conflicts() {
    let csv = "snapshot_key,date,account_key,amount,note\n\
               s1,2025-01-31,a1,100,备注一\n\
               s1,2025-02-28,a1,100,备注一\n\
               s2,2025-03-31,a1,100,备注一\n\
               s2,2025-03-31,a1,100,备注二\n\
               s3,2025-04-30,a1,100,一致\n\
               s3,2025-04-30,a2,100,一致\n\
               s3,2025-04-30,a3,100,一致\n";
    let p = run_ok(&request("snapshots", csv));
    assert_eq!(group(&p, "s1").validation, GroupValidationV1::Invalid);
    assert_eq!(group(&p, "s2").validation, GroupValidationV1::Invalid);
    // s3 is internally consistent but there is no catalog: not complete.
    assert_eq!(
        group(&p, "s3").validation,
        GroupValidationV1::RequiresAccountContext
    );
    assert!(has_code(&p, CODE_SNAPSHOT_GROUP_DATE_CONFLICT));
    assert!(has_code(&p, CODE_SNAPSHOT_GROUP_NOTE_CONFLICT));
    let s1 = group(&p, "s1");
    assert_eq!(s1.date, None, "conflicting dates null the group date");
    assert_eq!(s1.source_rows, vec![2, 3]);
}

#[test]
fn snapshot_duplicate_account_and_same_day_groups() {
    let csv = "snapshot_key,date,account_key,amount\n\
               s1,2025-01-31,a1,100\n\
               s1,2025-01-31,a1,200\n\
               s2,2025-01-31,a1,100\n";
    let p = run_ok(&request("snapshots", csv));
    assert!(has_code(&p, CODE_SNAPSHOT_DUPLICATE_ACCOUNT));
    assert!(has_code(&p, CODE_SNAPSHOT_DATE_CONFLICT));
    assert_eq!(p.counts.groups_invalid, 2);
    assert_eq!(p.counts.rows_valid, 2, "later duplicate row dropped");
    assert_eq!(p.counts.rows_read, 3);
}

#[test]
fn snapshot_missing_amount_rejects_row_and_group() {
    let csv = "snapshot_key,date,account_key,amount\n\
               s1,2025-01-31,a1,100\n\
               s1,2025-01-31,a2,\n";
    let p = run_ok(&request("snapshots", csv));
    assert!(has_code(&p, CODE_AMOUNT_REQUIRED));
    assert_eq!(group(&p, "s1").validation, GroupValidationV1::Invalid);
    assert_eq!(p.counts.rows_valid, 1);
}

#[test]
fn catalog_checks_unmapped_and_missing_due_accounts() {
    let catalog = vec![
        ea(Some("a1"), "id1", "现金", "cash", "2024-01-01", None),
        ea(Some("a2"), "id2", "基金", "investment", "2024-06-01", None),
    ];
    let csv = "snapshot_key,date,account_key,amount\n\
               s1,2025-01-31,a1,100\n\
               s1,2025-01-31,a2,50\n\
               s2,2025-02-28,a1,100\n\
               s2,2025-02-28,ghost,10\n\
               s3,2025-03-31,a1,100\n\
               s4,2024-05-31,a2,50\n";
    let p = run_ok(&cataloged(request("snapshots", csv), catalog));
    // s1: both due accounts present → valid.
    assert_eq!(group(&p, "s1").validation, GroupValidationV1::Valid);
    // s2: ghost is not in the catalog, and a2 is due but absent.
    assert!(has_code(&p, CODE_ACCOUNT_UNMAPPED));
    assert_eq!(group(&p, "s2").validation, GroupValidationV1::Invalid);
    // s3: a2 is due on 2025-03-31 but has no row.
    let missing = p
        .issues
        .iter()
        .find(|i| i.code == CODE_SNAPSHOT_MISSING_ACCOUNT)
        .expect("missing due account reported");
    assert!(
        missing.message.contains("基金"),
        "message: {}",
        missing.message
    );
    assert_eq!(group(&p, "s3").validation, GroupValidationV1::Invalid);
    // s4: a2 row dated before its enable date.
    assert!(has_code(&p, CODE_ACCOUNT_NOT_ACTIVE));
    assert_eq!(group(&p, "s4").validation, GroupValidationV1::Invalid);
    // Warnings never appear for these: they are all hard row/group errors.
    assert!(p.issues.iter().all(|i| i.severity == SeverityV1::Error));
}

#[test]
fn disabled_accounts_leave_the_due_scope() {
    let catalog = vec![
        ea(Some("a1"), "id1", "现金", "cash", "2024-01-01", None),
        ea(
            Some("a2"),
            "id2",
            "信用卡",
            "credit_card",
            "2024-01-01",
            Some("2025-01-01"),
        ),
    ];
    let csv = "snapshot_key,date,account_key,amount\n\
               s1,2024-12-31,a1,100\n\
               s1,2024-12-31,a2,50\n\
               s2,2025-01-31,a1,100\n\
               s2,2025-01-31,a2,50\n";
    let p = run_ok(&cataloged(request("snapshots", csv), catalog));
    assert_eq!(group(&p, "s1").validation, GroupValidationV1::Valid);
    // s2: a2 is disabled from 2025-01-01, so its row is not active, while a1
    // alone satisfies the due scope.
    assert!(has_code(&p, CODE_ACCOUNT_NOT_ACTIVE));
    assert_eq!(group(&p, "s2").validation, GroupValidationV1::Invalid);
    assert!(!has_code(&p, CODE_SNAPSHOT_MISSING_ACCOUNT));
}

#[test]
fn snapshot_overrides_are_validated_and_kept() {
    let csv = "snapshot_key,date,account_key,amount,note,kind_at_date,counted_at_date\n\
               s1,2025-01-31,a1,100,注,bond,true\n\
               s2,2025-02-28,a1,100,注,储蓄卡,1\n";
    let p = run_ok(&request("snapshots", csv));
    let row = match &p.rows[0] {
        StandardRowV1::Snapshots(s) => s,
        _ => panic!("wrong row kind"),
    };
    assert_eq!(row.kind_at_date.as_deref(), Some("bond"));
    assert_eq!(row.counted_at_date, Some(true));
    assert!(has_code(&p, CODE_KIND_INVALID));
    assert!(has_code(&p, CODE_BOOL_INVALID));
}

// ---- Duplicate keys ---------------------------------------------------------

#[test]
fn duplicate_keys_split_into_same_and_conflict() {
    let csv = "account_key,name,kind,enabled_from,disabled_from,counted,platform,note\n\
               a1,甲,cash,2024-01-01,,true,,\n\
               a1,甲,cash,2024-01-01,,true,,\n\
               a1,甲乙,cash,2024-01-01,,true,,不同\n";
    let p = run_ok(&request("accounts", csv));
    assert!(has_code(&p, CODE_DUPLICATE_KEY_SAME));
    assert!(has_code(&p, CODE_DUPLICATE_KEY_CONFLICT));
    assert_eq!(p.counts.duplicates_same, 1);
    assert_eq!(p.counts.duplicates_conflict, 1);
    assert_eq!(p.counts.rows_valid, 1);
    assert_eq!(
        p.counts.rows_read,
        p.counts.rows_valid
            + p.counts.rows_error
            + p.counts.duplicates_same
            + p.counts.duplicates_conflict
    );
    let row = match &p.rows[0] {
        StandardRowV1::Accounts(a) => a,
        _ => panic!("wrong row kind"),
    };
    assert_eq!(row.source_row, 2, "first occurrence wins");
}

#[test]
fn same_day_same_amount_different_income_keys_are_both_kept() {
    let csv = "income_key,date,net_income,hpf_deposit,note\n\
               salary_2025_06,2025-06-10,19800.00,4752.00,工资\n\
               bonus_2025_06,2025-06-10,19800.00,,奖金同日同额\n";
    let p = run_ok(&request("incomes", csv));
    assert!(p.issues.is_empty(), "issues: {:?}", p.issues);
    assert_eq!(p.counts.rows_valid, 2);
    assert_eq!(income_rows(&p)[1].hpf_deposit_cents, None);
}

// ---- Coverage ---------------------------------------------------------------

#[test]
fn coverage_intervals_validate_range_state_and_overlap() {
    let csv = "from_date,to_date,state,note\n\
               2025-01-31,2025-06-30,complete,衔接\n\
               2025-06-30,2025-12-31,partial,与下一段相邻\n\
               2025-12-31,2026-01-31,complete,本身合法\n\
               2025-12-01,2026-01-31,complete,与前面两段重叠\n\
               2026-02-01,2026-01-01,complete,起点不早于终点\n\
               2026-02-01,2026-03-31,全勤,非法状态\n";
    let p = run_ok(&request("income_coverage", csv));
    assert_eq!(
        p.rows.len(),
        4,
        "overlapping rows stay visible for correction"
    );
    assert_eq!(p.counts.rows_valid, 1);
    assert_eq!(p.counts.rows_error, 5);
    assert!(has_code(&p, CODE_COVERAGE_OVERLAP));
    assert_eq!(
        p.issues
            .iter()
            .filter(|i| i.code == CODE_COVERAGE_OVERLAP)
            .count(),
        3,
        "each involved row is flagged once"
    );
    assert!(has_code(&p, CODE_COVERAGE_RANGE_INVALID));
    assert!(has_code(&p, CODE_STATE_INVALID));
    assert_eq!(only_error_codes(&p).len(), 5);

    let future = "from_date,to_date,state\n2026-10-07,2026-12-31,complete\n";
    let p = run_ok(&request("income_coverage", future));
    assert!(has_code(&p, CODE_DATE_FUTURE));
}

// ---- Contract entry ---------------------------------------------------------

#[test]
fn contract_version_kind_and_context_failures() {
    let mut req = request("incomes", "income_key,date,net_income\ni1,2026-09-30,1\n");
    req.contract_version = 2;
    assert_eq!(run_err(&req).code, CODE_CONTRACT_VERSION_UNSUPPORTED);

    req.contract_version = 1;
    req.kind = "balances".into();
    assert_eq!(run_err(&req).code, CODE_KIND_UNKNOWN);

    let err = parse_import_request_json("{not json", &ctx()).unwrap_err();
    assert_eq!(err.code, CODE_CONTRACT_INVALID);

    let p = parse_import_request_json(
        r#"{"contract_version":1,"kind":"incomes","csv_text":"income_key,date,net_income\ni1,2026-09-30,1\n","future_field":true}"#,
        &ctx(),
    )
    .unwrap_or_else(|e| panic!("unknown request fields should be ignored: {e}"));
    assert_eq!(p.counts.rows_valid, 1);

    let ctx = ImportContext {
        today: "2026/10/07",
        cancel: &(no_cancel as fn() -> bool),
    };
    let err = parse_import_v1(&request("incomes", "x"), &ctx).unwrap_err();
    assert_eq!(err.code, CODE_CONTEXT_INVALID);
}

#[test]
fn cancellation_never_yields_a_successful_preview() {
    let mut csv = String::from("income_key,date,net_income,hpf_deposit,note\n");
    for i in 0..1000 {
        csv.push_str(&format!("i{i},2026-09-30,1,,行{i}\n"));
    }
    let always = ImportContext {
        today: TODAY,
        cancel: &(|| true),
    };
    let err = parse_import_v1(&request("incomes", &csv), &always).unwrap_err();
    assert_eq!(err.code, CODE_CANCELLED);

    let counter = Cell::new(0u32);
    let flip = || {
        counter.set(counter.get() + 1);
        counter.get() > 100
    };
    let ctx = ImportContext {
        today: TODAY,
        cancel: &flip,
    };
    let err = parse_import_v1(&request("incomes", &csv), &ctx).unwrap_err();
    assert_eq!(err.code, CODE_CANCELLED);
}

// ---- Limits and scale -------------------------------------------------------

#[test]
fn size_and_row_limits_reject_without_truncation() {
    let req = request("incomes", &"a".repeat(20 * 1024 * 1024 + 1));
    assert_eq!(run_err(&req).code, CODE_LIMIT_SIZE);

    let body = |rows: usize| {
        let mut s = String::from("income_key,date,net_income,hpf_deposit,note\n");
        for i in 0..rows {
            s.push_str(&format!("i{i},2026-09-30,100.55,20.10,行{i}\n"));
        }
        s
    };
    let err = run_err(&request("incomes", &body(50_001)));
    assert_eq!(err.code, CODE_LIMIT_ROWS);

    let start = Instant::now();
    let p = run_ok(&request("incomes", &body(50_000)));
    let elapsed = start.elapsed();
    assert_eq!(p.counts.rows_valid, 50_000);
    assert_eq!(p.counts.rows_read, 50_000);
    println!("max-legal 50000 data rows parsed in {elapsed:?}");
    assert!(elapsed.as_secs() < 30, "parse took {elapsed:?}");
}

// ---- Serialization shape ----------------------------------------------------

#[test]
fn preview_serializes_contract_fields() {
    let csv = "income_key,date,net_income,hpf_deposit,note\ni1,2026-09-30,12000.50,,工资\n";
    let p = run_ok(&request("incomes", csv));
    let v = serde_json::to_value(&p).unwrap();
    assert_eq!(v["contract_version"], 1);
    assert_eq!(v["kind"], "incomes");
    assert_eq!(v["rows"][0]["row_kind"], "incomes");
    assert_eq!(v["rows"][0]["source_row"], 2);
    assert_eq!(v["rows"][0]["income_key"], "i1");
    assert_eq!(v["rows"][0]["net_income_cents"], "1200050");
    assert!(v["rows"][0]["hpf_deposit_cents"].is_null());
    assert!(v["counts"]["rows_valid"].is_u64());
    assert!(v["groups"].is_array());
    assert!(v["issues"].is_array());

    let snapshots = run_ok(&request(
        "snapshots",
        "snapshot_key,date,account_key,amount\ns1,2025-01-31,a1,100\n",
    ));
    let v = serde_json::to_value(&snapshots).unwrap();
    assert_eq!(v["groups"][0]["group_key"], "s1");
    assert_eq!(v["groups"][0]["date"], "2025-01-31");
    assert_eq!(v["groups"][0]["source_rows"][0], 2);
    assert_eq!(v["groups"][0]["validation"], "requires_account_context");
}

// ---- Determinism ------------------------------------------------------------

#[test]
fn issues_are_sorted_and_output_is_deterministic() {
    let csv = "snapshot_key,date,account_key,amount\n\
               s2,2025-02-28,a1,100\n\
               s1,2025-13-01,a1,100\n\
               s2,2025-02-28,a1,\n";
    let p = run_ok(&request("snapshots", csv));
    let actual: Vec<_> = p.issues.iter().map(|i| (i.source_row, i.code)).collect();
    let mut sorted = actual.clone();
    sorted.sort();
    assert_eq!(actual, sorted, "issues sorted by (source_row, code)");
    let again = run_ok(&request("snapshots", csv));
    assert_eq!(
        serde_json::to_string(&p).unwrap(),
        serde_json::to_string(&again).unwrap()
    );
}

#[test]
fn blank_header_cells_are_formatting_noise_not_duplicates() {
    let csv = "income_key,date,net_income,hpf_deposit,note,,\ni1,2026-09-30,10,,备注,,\n";
    let p = run_ok(&request("incomes", csv));
    assert!(only_error_codes(&p).is_empty(), "issues: {:?}", p.issues);
    assert!(!has_code(&p, CODE_DUPLICATE_HEADER));
    assert_eq!(p.counts.rows_valid, 1);
}

#[test]
fn snapshot_ragged_members_invalidate_only_the_identifiable_group() {
    for bad in ["s1,2026-09-30,a,20,extra", "s1,2026-09-30,a"] {
        let csv = format!(
            "snapshot_key,date,account_key,amount\ns1,2026-09-30,a,10\n{bad}\ns2,2026-09-29,a,10\n"
        );
        let p = run_ok(&cataloged(
            request("snapshots", &csv),
            vec![ea(
                Some("a"),
                "fictional-a",
                "虚构账户",
                "cash",
                "2026-01-01",
                None,
            )],
        ));
        let bad_group = p.groups.iter().find(|g| g.group_key == "s1").unwrap();
        let good_group = p.groups.iter().find(|g| g.group_key == "s2").unwrap();
        assert_eq!(bad_group.validation, GroupValidationV1::Invalid);
        assert_eq!(bad_group.source_rows, vec![2, 3]);
        assert_eq!(good_group.validation, GroupValidationV1::Valid);
        assert_eq!(p.counts.groups_invalid, 1);
        assert_eq!(p.counts.groups_valid, 1);
        let issue = p
            .issues
            .iter()
            .find(|i| i.code == CODE_CSV_COLUMN_COUNT)
            .unwrap();
        assert_eq!(issue.source_row, Some(3));
        assert_eq!(issue.group_key.as_deref(), Some("s1"));
    }
}

#[test]
fn unassignable_or_fatal_snapshot_rows_never_leave_complete_candidates() {
    for bad in [
        ",2026-09-30,a,20",
        ",2026-09-30,a,20,extra",
        "s1,2026-09-30,a,\"20",
        "s1,2026-09-30,a,2\"0",
    ] {
        let csv = format!("snapshot_key,date,account_key,amount\ns1,2026-09-30,a,10\n{bad}\n");
        let p = run_ok(&cataloged(
            request("snapshots", &csv),
            vec![ea(
                Some("a"),
                "fictional-a",
                "虚构账户",
                "cash",
                "2026-01-01",
                None,
            )],
        ));
        assert!(!p.groups.is_empty());
        assert!(
            p.groups
                .iter()
                .all(|g| g.validation == GroupValidationV1::Invalid),
            "{bad}: {:?}",
            p.groups
        );
        assert_eq!(p.counts.groups_valid, 0);
        assert_eq!(p.counts.rows_read, 2);
        assert_eq!(p.counts.rows_valid, 1);
        assert_eq!(p.counts.rows_error, 1);
        assert!(p.issues.iter().any(|i| i.severity == SeverityV1::Error));
        if let Some(issue) = p
            .issues
            .iter()
            .find(|i| i.code == CODE_CSV_FORMAT && i.column.is_some())
        {
            assert!(
                issue.source_row.unwrap() >= 3,
                "must locate the bad record, not header"
            );
        }
    }
}

#[test]
fn coverage_counts_include_all_unique_conflicts_after_message_limit() {
    let mut csv = String::from("from_date,to_date,state\n");
    for _ in 0..350 {
        csv.push_str("2026-01-01,2026-03-01,complete\n");
    }
    csv.push_str("2026-03-01,2026-04-01,partial\n");
    let p = run_ok(&request("income_coverage", &csv));
    assert_eq!(p.rows.len(), 351);
    assert_eq!(p.counts.rows_read, 351);
    assert_eq!(p.counts.rows_error, 350);
    assert_eq!(p.counts.rows_valid, 1, "adjacent interval is valid");
    assert_eq!(
        p.issues
            .iter()
            .filter(|i| i.code == CODE_COVERAGE_OVERLAP)
            .count(),
        200
    );
    assert_eq!(
        p.counts.rows_read,
        p.counts.rows_valid + p.counts.rows_error
    );
}

#[test]
fn a_fatal_first_data_row_is_counted_as_error_not_an_empty_file() {
    let p = run_ok(&request(
        "snapshots",
        "snapshot_key,date,account_key,amount\ns1,2026-09-30,a,2\"0",
    ));
    assert_eq!(p.counts.rows_read, 1);
    assert_eq!(p.counts.rows_error, 1);
    assert_eq!(p.counts.rows_valid, 0);
    assert!(p.rows.is_empty());
    assert!(has_code(&p, CODE_CSV_FORMAT));
    assert!(!has_code(&p, CODE_NO_DATA_ROWS));
}
