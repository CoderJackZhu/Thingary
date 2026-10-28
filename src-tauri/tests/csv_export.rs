use thingary_lib::{
    catalog::{
        AmountKind, AmountOriginSave, AssetRecord, Details, PriceOrigin, PriceOriginSave, SaveAsset,
    },
    csv_export::HEADER,
    domain::Save,
    expenses, lifecycle, plan_income, sales,
    storage::Store,
    taxonomy::Classification,
    trash::TrashChange,
};

const TODAY: &str = "2026-09-20";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn add(
    s: &mut Store,
    name: &str,
    price: Option<&str>,
    date: Option<&str>,
    details: Details,
    class: Option<Classification>,
) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: price.map(str::to_owned),
                purchase_date: date.map(str::to_owned),
            },
            details,
            photos: None,
            classification: class,
        },
        TODAY,
    )
    .unwrap()
}
fn details(brand: &str, model: &str, notes: &str) -> Details {
    Details {
        brand: brand.into(),
        model: model.into(),
        serial_number: String::new(),
        notes: notes.into(),
    }
}
fn origin(code: &str, minor: &str, rate: &str) -> PriceOrigin {
    PriceOrigin {
        currency: code.into(),
        original_minor: minor.into(),
        fx_rate_micro: rate.into(),
    }
}
fn reprice(s: &mut Store, a: &AssetRecord, price: &str) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
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

/// Independent RFC 4180 reader: quoted fields, doubled quotes, embedded CR/LF.
fn origin_at(row: &[String], start: usize) -> (&str, &str, &str) {
    (
        row[start].as_str(),
        row[start + 1].as_str(),
        row[start + 2].as_str(),
    )
}

fn parse(csv: &str) -> Vec<Vec<String>> {
    let (mut rows, mut row, mut cell, mut quoted) = (Vec::new(), Vec::new(), String::new(), false);
    let mut chars = csv.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                chars.next();
                cell.push('"');
            }
            ('"', true) => quoted = false,
            ('"', false) if cell.is_empty() => quoted = true,
            (',', false) => row.push(std::mem::take(&mut cell)),
            ('\r', false) if chars.peek() == Some(&'\n') => {
                chars.next();
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            (c, _) => cell.push(c),
        }
    }
    assert!(
        !quoted && cell.is_empty() && row.is_empty(),
        "file ends with a complete record"
    );
    rows
}

#[test]
fn ac30_r06_csv_is_complete_safe_and_round_trips_text() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let snap = s.taxonomy_snapshot().unwrap();
    let class = Classification {
        category_id: Some(snap.categories[0].id.clone()),
        channel_id: Some(snap.channels[1].id.clone()),
    };
    let a = add(
        &mut s,
        "逗号,名称",
        Some("0"),
        Some("2026-09-01"),
        details("引号\"品牌\"", "=SUM(1,2)", "第一行\n第二行\r\n第三行"),
        Some(class),
    );
    let b = add(
        &mut s,
        "+86 电话",
        None,
        None,
        details("\t制表品牌", "-负号型号", " 前后空格 "),
        None,
    );
    let c = add(
        &mut s,
        "已售中文物品",
        Some("100000"),
        Some("2026-09-01"),
        details("", "", "@提醒"),
        None,
    );
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: c.asset.id.clone(),
            expected_revision: c.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-09-10".into(),
                    price_cents: "30005".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let d = add(
        &mut s,
        "退役物品",
        Some("12345"),
        Some("2026-09-01"),
        details("", "", "\t表格注释"),
        None,
    );
    s.change_lifecycle(
        &lifecycle::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: d.asset.id.clone(),
            expected_revision: d.asset.revision,
            action: lifecycle::Action::Append {
                kind: lifecycle::Kind::Retire,
                date: "2026-09-05".into(),
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap();
    let e = add(
        &mut s,
        "已删除不导出",
        Some("100"),
        None,
        Details::default(),
        None,
    );
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: e.asset.id.clone(),
        expected_revision: e.asset.revision,
        deleted: true,
    })
    .unwrap();

    let path = root.path().join("物品表.csv");
    assert_eq!(s.export_csv(&path).unwrap(), 4);
    let bytes = std::fs::read(&path).unwrap();
    assert!(
        bytes.starts_with(&[0xEF, 0xBB, 0xBF]),
        "UTF-8 BOM for spreadsheet apps"
    );
    let text = String::from_utf8(bytes).unwrap();
    let rows = parse(text.trim_start_matches('\u{feff}'));
    assert_eq!(rows[0], HEADER.map(str::to_owned).to_vec());
    assert_eq!(
        rows.len(),
        5,
        "4 undeleted assets incl. sold and retired; deleted excluded"
    );
    assert!(rows.iter().all(|r| r.len() == HEADER.len()));
    let by_id = |id: &str| rows.iter().find(|r| r[0] == id).unwrap().clone();

    let ra = by_id(&a.asset.id);
    assert_eq!(
        (
            ra[1].as_str(),
            ra[2].as_str(),
            ra[3].as_str(),
            ra[4].as_str()
        ),
        (
            "逗号,名称",
            snap.categories[0].name.as_str(),
            "引号\"品牌\"",
            "'=SUM(1,2)"
        )
    );
    assert_eq!(
        (
            ra[5].as_str(),
            ra[6].as_str(),
            ra[7].as_str(),
            ra[8].as_str(),
            ra[9].as_str()
        ),
        (
            "0.00",
            "CNY",
            "2026-09-01",
            snap.channels[1].name.as_str(),
            "使用中"
        )
    );
    assert_eq!(
        ra[13], "第一行\n第二行\r\n第三行",
        "line breaks survive inside one quoted field"
    );
    let rb = by_id(&b.asset.id);
    assert_eq!(
        (
            rb[1].as_str(),
            rb[3].as_str(),
            rb[4].as_str(),
            rb[13].as_str()
        ),
        ("'+86 电话", "制表品牌", "'-负号型号", " 前后空格 "),
        "brand is trimmed on save"
    );
    assert_eq!(
        (
            rb[2].as_str(),
            rb[5].as_str(),
            rb[7].as_str(),
            rb[8].as_str()
        ),
        ("", "", "", ""),
        "unknown stays empty, never 0"
    );
    let rc = by_id(&c.asset.id);
    assert_eq!(
        (
            rc[5].as_str(),
            rc[9].as_str(),
            rc[10].as_str(),
            rc[11].as_str(),
            rc[12].as_str(),
            rc[13].as_str()
        ),
        ("1000.00", "已售出", "", "2026-09-10", "300.05", "'@提醒")
    );
    let rd = by_id(&d.asset.id);
    assert_eq!(
        (
            rd[5].as_str(),
            rd[9].as_str(),
            rd[10].as_str(),
            rd[11].as_str(),
            rd[12].as_str(),
            rd[13].as_str()
        ),
        ("123.45", "已退役", "2026-09-05", "", "", "'\t表格注释")
    );
    assert!(!text.contains("已删除不导出"));
    // Overwrite after the panel's own confirmation is atomic and complete.
    assert_eq!(s.export_csv(&path).unwrap(), 4);
    assert_eq!(
        parse(
            std::fs::read_to_string(&path)
                .unwrap()
                .trim_start_matches('\u{feff}')
        )
        .len(),
        5
    );
}

#[test]
fn foreign_origins_export_only_while_they_explain_the_cny_amount() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();

    let usd = add(
        &mut s,
        "虚构美元相机",
        Some("925330"),
        Some("2026-09-01"),
        Details::default(),
        None,
    );
    s.set_price_origin(&PriceOriginSave {
        generation: s.generation(),
        asset_id: usd.asset.id.clone(),
        origin: Some(origin("USD", "129900", "7123400")),
    })
    .unwrap();
    // 150,000 JPY at 0.0471 CNY is 7,065.00 CNY; whole units, no decimals.
    let jpy = add(
        &mut s,
        "虚构日元镜头",
        Some("706500"),
        Some("2026-09-01"),
        Details::default(),
        None,
    );
    s.set_price_origin(&PriceOriginSave {
        generation: s.generation(),
        asset_id: jpy.asset.id.clone(),
        origin: Some(origin("JPY", "150000", "47100")),
    })
    .unwrap();
    add(
        &mut s,
        "虚构人民币物品",
        Some("10000"),
        Some("2026-09-01"),
        Details::default(),
        None,
    );
    let stale = add(
        &mut s,
        "虚构过期物品",
        Some("925330"),
        Some("2026-09-01"),
        Details::default(),
        None,
    );
    s.set_price_origin(&PriceOriginSave {
        generation: s.generation(),
        asset_id: stale.asset.id.clone(),
        origin: Some(origin("USD", "129900", "7123400")),
    })
    .unwrap();
    // Re-pricing elsewhere leaves the stored origin, but it no longer explains the price.
    reprice(&mut s, &stale, "900000");

    let expense = s
        .expense_save(
            &expenses::Save {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: expenses::Fields {
                    title: "虚构机票".into(),
                    date: "2026-09-02".into(),
                    amount_cents: "106851".into(),
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
    s.set_amount_origin(&AmountOriginSave {
        generation: s.generation(),
        kind: AmountKind::Expense,
        record_id: expense.id,
        origin: Some(origin("USD", "15000", "7123400")),
    })
    .unwrap();
    s.expense_save(
        &expenses::Save {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: expenses::Fields {
                title: "虚构人民币支出".into(),
                date: "2026-09-03".into(),
                amount_cents: "5000".into(),
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

    let income = s
        .plan_income_save(
            &plan_income::Save {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: plan_income::Fields {
                    date: "2026-09-04".into(),
                    net_cents: "712340".into(),
                    ..Default::default()
                },
            },
            TODAY,
        )
        .unwrap();
    s.set_amount_origin(&AmountOriginSave {
        generation: s.generation(),
        kind: AmountKind::Income,
        record_id: income.id,
        origin: Some(origin("USD", "100000", "7123400")),
    })
    .unwrap();
    s.plan_income_save(
        &plan_income::Save {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: plan_income::Fields {
                date: "2026-09-05".into(),
                net_cents: "4200".into(),
                ..Default::default()
            },
        },
        TODAY,
    )
    .unwrap();

    let folder = root.path().join("导出");
    s.export_all_csv(&folder).unwrap();
    let sheet = |name: &str| {
        parse(
            std::fs::read_to_string(folder.join(name))
                .unwrap()
                .trim_start_matches('\u{feff}'),
        )
    };
    let rows = sheet("物品.csv");
    assert_eq!(
        (
            rows[0][14].as_str(),
            rows[0][15].as_str(),
            rows[0][16].as_str()
        ),
        (HEADER[14], HEADER[15], HEADER[16])
    );
    let item = |name: &str| rows.iter().find(|r| r[1] == name).unwrap();
    assert_eq!(
        origin_at(item("虚构美元相机"), 14),
        ("USD", "1299.00", "7.123400")
    );
    assert_eq!(
        origin_at(item("虚构日元镜头"), 14),
        ("JPY", "150000", "0.047100")
    );
    assert_eq!(origin_at(item("虚构人民币物品"), 14), ("", "", ""));
    assert_eq!(origin_at(item("虚构过期物品"), 14), ("", "", ""));

    let expenses = sheet("重要支出.csv");
    assert_eq!(
        (
            expenses[0][8].as_str(),
            expenses[0][9].as_str(),
            expenses[0][10].as_str()
        ),
        ("原币币种", "原币金额", "汇率")
    );
    let expense_row = |name: &str| expenses.iter().find(|r| r[1] == name).unwrap();
    assert_eq!(
        origin_at(expense_row("虚构机票"), 8),
        ("USD", "150.00", "7.123400")
    );
    assert_eq!(origin_at(expense_row("虚构人民币支出"), 8), ("", "", ""));

    let incomes = sheet("月度收入.csv");
    assert_eq!(
        (
            incomes[0][9].as_str(),
            incomes[0][10].as_str(),
            incomes[0][11].as_str()
        ),
        ("原币币种", "原币金额", "汇率")
    );
    let income_row = |date: &str| incomes.iter().find(|r| r[0] == date).unwrap();
    assert_eq!(
        origin_at(income_row("2026-09-04"), 9),
        ("USD", "1000.00", "7.123400")
    );
    assert_eq!(origin_at(income_row("2026-09-05"), 9), ("", "", ""));
}
