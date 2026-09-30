//! U17 · 标签投入分析数据层验收（D23 基准与 U17-AC 的数据断言）。
//! 每个用例从干净基准开始（AC06 的“更正后撤销”除外）；预期值来自产品设计
//! D23 的人工计算，不与前端展示共用代码。常规写入无法表达的坏状态
//! （售出不一致、聚合溢出）在隔离测试库直接注入 SQL（ADR 25.7）。
use possio_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    choices,
    domain::Save,
    lifecycle, maintenance, sales,
    storage::Store,
    trash::{RecordChange, TrashChange},
};
use rusqlite::Connection;

const TODAY: &str = "2026-09-10";

fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn input(
    s: &Store,
    name: &str,
    price: Option<&str>,
    date: Option<&str>,
    prefs: serde_json::Value,
) -> SaveAsset {
    SaveAsset {
        options: Some(
            serde_json::from_value(serde_json::json!({
                "preferences": prefs,
                "warranty": null,
                "retired_date": null,
                "sale": null,
            }))
            .unwrap(),
        ),
        base: Save {
            request_id: rid(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: name.into(),
            price_cents: price.map(str::to_owned),
            purchase_date: date.map(str::to_owned),
        },
        details: Details {
            brand: "虚构品牌".into(),
            model: "样例型号".into(),
            serial_number: "TEST-001".into(),
            notes: "虚构投入分析样例".into(),
        },
        photos: None,
        classification: None,
    }
}

fn create_label(s: &mut Store, name: &str) -> String {
    let snap = s.choices("label").unwrap();
    let change: choices::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "expected_revision": snap.revision,
        "kind": "label",
        "action": {"type": "create", "name": name},
    }))
    .unwrap();
    s.change_choices(&change)
        .unwrap()
        .items
        .into_iter()
        .find(|e| e.name == name)
        .unwrap()
        .id
}

fn labeled(
    s: &mut Store,
    name: &str,
    price: Option<&str>,
    date: Option<&str>,
    tag: &str,
) -> AssetRecord {
    let prefs = serde_json::json!({"cost_mode": "daily", "label_id": tag});
    s.save_asset(&input(s, name, price, date, prefs), TODAY)
        .unwrap()
}

fn add_maintenance(s: &mut Store, record: &AssetRecord, cost: Option<&str>) -> AssetRecord {
    let change: maintenance::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "asset_id": record.asset.id,
        "expected_revision": record.asset.revision,
        "action": {"type": "add", "fields": {
            "date": "2026-09-01", "kind": "repair", "title": "虚构维护",
            "description": "", "cost_cents": cost, "provider": ""
        }, "photos": {"ids": [], "cover_id": null}},
    }))
    .unwrap();
    s.change_maintenance(&change, TODAY).unwrap()
}

fn sell(s: &mut Store, record: &AssetRecord, price: &str) -> AssetRecord {
    let change: sales::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "asset_id": record.asset.id,
        "expected_revision": record.asset.revision,
        "action": {"type": "sell", "fields": {
            "date": TODAY, "price_cents": price, "platform": "", "buyer": "", "notes": ""
        }},
    }))
    .unwrap();
    s.change_sale(&change, TODAY).unwrap()
}

fn retire(s: &mut Store, record: &AssetRecord) -> AssetRecord {
    let change: lifecycle::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "asset_id": record.asset.id,
        "expected_revision": record.asset.revision,
        "action": {"type": "append", "kind": "retire", "date": "2026-09-05", "notes": ""},
    }))
    .unwrap();
    s.change_lifecycle(&change, TODAY).unwrap()
}

fn set_exclude(s: &mut Store, record: &AssetRecord, key: &str, value: bool) {
    let mut prefs = record.preferences.clone();
    match key {
        "total" => prefs.exclude.total = value,
        "daily" => prefs.exclude.daily = value,
        "statistics" => prefs.exclude.statistics = value,
        "timeline" => prefs.exclude.timeline = value,
        _ => panic!("unknown exclusion {key}"),
    }
    let mut i = input(
        s,
        &record.asset.name,
        record.asset.price_cents.as_deref(),
        record.asset.purchase_date.as_deref(),
        serde_json::to_value(&prefs).unwrap(),
    );
    i.base.asset_id = Some(record.asset.id.clone());
    i.base.expected_revision = Some(record.asset.revision);
    s.save_asset(&i, TODAY).unwrap();
}

/// 隔离注入用原始连接：datasets 下唯一数据集的 data.sqlite（WAL，允许并发连接）。
fn raw_db(root: &std::path::Path) -> Connection {
    let dir = std::fs::read_dir(root.join("datasets"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.join("data.sqlite").exists())
        .expect("one dataset directory");
    Connection::open(dir.join("data.sqlite")).unwrap()
}

/// D23 基准四件：机身 12,000＋维护 1,000；镜头 15,000；配件 3,000（退役）；
/// 旧机身 5,000（已售出，回收 5,000）。
fn baseline(s: &mut Store, tag: &str) -> Vec<AssetRecord> {
    let mut body = labeled(s, "机身", Some("1200000"), Some("2026-01-01"), tag);
    body = add_maintenance(s, &body, Some("100000"));
    let lens = labeled(s, "镜头", Some("1500000"), Some("2026-02-01"), tag);
    let part = labeled(s, "配件", Some("300000"), Some("2026-03-01"), tag);
    let part = retire(s, &part);
    let old = labeled(s, "旧机身", Some("500000"), Some("2026-04-01"), tag);
    let old = sell(s, &old, "500000");
    vec![body, lens, part, old]
}

#[test]
fn ac01_baseline_scopes_totals_and_ranking() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "摄影");
    let records = baseline(&mut s, &tag);
    assert_eq!(records.len(), 4);
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(history.generation, s.generation());
    assert_eq!(
        (
            history.counts.matched,
            history.counts.included,
            history.counts.excluded
        ),
        (4, 4, 0)
    );
    assert_eq!(
        (
            history.counts.active,
            history.counts.retired,
            history.counts.sold
        ),
        (2, 1, 1)
    );
    assert_eq!(history.totals.known_purchase_cents, "3500000");
    assert_eq!(history.totals.known_maintenance_cents, "100000");
    assert_eq!(history.totals.known_investment_cents, "3600000");
    assert_eq!(history.totals.sale_proceeds_cents, "500000");
    assert_eq!(history.totals.known_net_cents, "3100000");
    assert_eq!(
        history.totals.complete_investment_cents.as_deref(),
        Some("3600000")
    );
    assert_eq!(
        history.totals.complete_net_cents.as_deref(),
        Some("3100000")
    );
    assert!(
        history.totals.has_known_purchase
            && history.totals.has_known_maintenance_record
            && history.totals.has_known_investment
    );
    let names: Vec<_> = history.items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(
        names,
        ["镜头", "机身", "旧机身", "配件"],
        "D23 排行 15,000/13,000/5,000/3,000"
    );
    // 当前持有：三件 ¥31,000，回收为零，旧机身不在匹配集合。
    let held = s.tag_investment_view(&tag, "held", TODAY).unwrap();
    assert_eq!(
        (held.counts.matched, held.counts.included, held.counts.sold),
        (3, 3, 0)
    );
    assert_eq!(held.totals.known_investment_cents, "3100000");
    assert_eq!(held.totals.sale_proceeds_cents, "0");
    assert_eq!(held.totals.known_net_cents, "3100000");
    assert_eq!(held.items.len(), 3);
    assert!(history.label.id == tag && !history.label.inactive);
    assert_eq!(history.label.name, "摄影");
}

#[test]
fn ac02_multiple_maintenances_and_sale_count_once_without_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "摄影");
    let body = labeled(&mut s, "机身", Some("1200000"), Some("2026-01-01"), &tag);
    let body = add_maintenance(&mut s, &body, Some("60000"));
    add_maintenance(&mut s, &body, Some("40000"));
    let sold_record = labeled(&mut s, "旧机身", Some("500000"), Some("2026-04-01"), &tag);
    let old = sell(&mut s, &sold_record, "500000");
    let expense_before = s.expense_view(None).unwrap().spent_cents;
    let generation = s.generation();
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    // 每条有效维护只加一次：600+400=1,000，不是 JOIN 倍增的 2,000。
    assert_eq!(history.totals.known_maintenance_cents, "100000");
    assert_eq!(history.totals.known_investment_cents, "1800000");
    let body_row = history.items.iter().find(|i| i.name == "机身").unwrap();
    assert_eq!(body_row.known_maintenance_cents, "100000");
    assert_eq!(body_row.known_maintenance_record_count, 2);
    // 有效售出只减一次。
    assert_eq!(history.totals.sale_proceeds_cents, "500000");
    assert_eq!(history.totals.known_net_cents, "1300000");
    drop(old);
    // 读取只读：支出投影与资料代数不变。
    assert_eq!(s.expense_view(None).unwrap().spent_cents, expense_before);
    assert_eq!(s.generation(), generation);
}

#[test]
fn ac03_unknown_amounts_keep_missing_semantics_then_recover() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "摄影");
    let body = labeled(&mut s, "机身", Some("1200000"), Some("2026-01-01"), &tag);
    add_maintenance(&mut s, &body, Some("100000"));
    let lens = labeled(&mut s, "镜头", Some("1500000"), Some("2026-02-01"), &tag);
    let sold_record = labeled(&mut s, "旧机身", Some("500000"), Some("2026-04-01"), &tag);
    sell(&mut s, &sold_record, "500000");
    labeled(&mut s, "配件", Some("300000"), Some("2026-03-01"), &tag);
    // 购入未知且无维护：购入、累计与净投入待补录；维护是确定的 ¥0。
    let unknown = labeled(&mut s, "备用机身", None, Some("2026-05-01"), &tag);
    let unknown = add_maintenance(&mut s, &unknown, Some("20000"));
    // 镜头加一条未知费用维护。
    let lens = add_maintenance(&mut s, &lens, None);
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    let t = &history.totals;
    assert_eq!(t.known_purchase_cents, "3500000");
    assert_eq!(t.known_maintenance_cents, "120000");
    assert_eq!(t.known_investment_cents, "3620000");
    assert_eq!(t.known_net_cents, "3120000");
    assert_eq!(
        (
            t.missing_purchase_count,
            t.missing_maintenance_count,
            t.incomplete_asset_count
        ),
        (1, 1, 2)
    );
    assert_eq!(t.complete_investment_cents, None);
    assert_eq!(t.complete_net_cents, None);
    assert!(t.has_known_purchase && t.has_known_maintenance_record && t.has_known_investment);
    // 完整行在前按累计投入降序；不完整行组按已知投入降序（镜头 15,000 → 备用机身 无分量）。
    let ordered: Vec<_> = history
        .items
        .iter()
        .map(|i| {
            (
                i.name.as_str(),
                i.known_investment_cents.as_str(),
                i.incomplete,
            )
        })
        .collect();
    assert_eq!(
        ordered,
        [
            ("机身", "1300000", false),
            ("旧机身", "500000", false),
            ("配件", "300000", false),
            ("镜头", "1500000", true),
            ("备用机身", "20000", true),
        ]
    );
    let lens_row = history.items.iter().find(|i| i.name == "镜头").unwrap();
    assert_eq!(lens_row.complete_investment_cents, None);
    assert!(
        lens_row.has_known_investment,
        "购入已知即为已知分量，维护未知不掩盖它"
    );
    let unknown_row = history.items.iter().find(|i| i.name == "备用机身").unwrap();
    assert_eq!(unknown_row.purchase_cents, None);
    assert_eq!(unknown_row.known_maintenance_cents, "20000");
    assert_eq!(unknown_row.known_maintenance_record_count, 1);
    assert!(
        unknown_row.has_known_investment,
        "购入未知但维护已知，是已知分量"
    );
    assert_eq!(unknown_row.complete_investment_cents, None);
    assert_eq!(unknown_row.sale_proceeds_cents, "0");
    // 补录后恢复完整口径：备用机身 200、镜头未知维护更正为 200。
    let mut fix = input(
        &s,
        "备用机身",
        Some("20000"),
        Some("2026-05-01"),
        serde_json::json!({"cost_mode": "daily", "label_id": tag}),
    );
    fix.base.asset_id = Some(unknown.asset.id.clone());
    fix.base.expected_revision = Some(unknown.asset.revision);
    s.save_asset(&fix, TODAY).unwrap();
    let record = s.record(&lens.asset.id).unwrap().unwrap();
    let pending = record
        .maintenances
        .iter()
        .find(|m| m.fields.cost_cents.is_none())
        .unwrap()
        .id
        .clone();
    let correct: maintenance::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "asset_id": lens.asset.id,
        "expected_revision": record.asset.revision,
        "action": {"type": "correct", "maintenance_id": pending, "fields": {
            "date": "2026-09-01", "kind": "repair", "title": "虚构维护",
            "description": "", "cost_cents": "20000", "provider": ""
        }, "photos": {"ids": [], "cover_id": null}},
    }))
    .unwrap();
    s.change_maintenance(&correct, TODAY).unwrap();
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(history.totals.incomplete_asset_count, 0);
    assert_eq!(
        history.totals.complete_investment_cents.as_deref(),
        Some("3660000"),
        "36,200 + 备用机身 200 + 镜头 200"
    );
    assert_eq!(
        history.totals.complete_net_cents.as_deref(),
        Some("3160000")
    );
}

#[test]
fn ac04_empty_excluded_all_unknown_zero_and_mixed_states() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    // 空标签：零计数、空集合、无已知分量，不伪装成“零成本”。
    let empty_tag = create_label(&mut s, "空标签");
    let empty = s.tag_investment_view(&empty_tag, "all", TODAY).unwrap();
    assert_eq!(
        (
            empty.counts.matched,
            empty.counts.included,
            empty.counts.excluded,
            empty.counts.active,
            empty.counts.retired,
            empty.counts.sold
        ),
        (0, 0, 0, 0, 0, 0)
    );
    assert!(empty.items.is_empty());
    assert_eq!(empty.totals.known_investment_cents, "0");
    assert!(!empty.totals.has_known_investment);

    let tag = create_label(&mut s, "摄影");
    labeled(&mut s, "赠品包", Some("0"), Some("2026-01-01"), &tag);
    labeled(&mut s, "赠品布", Some("0"), Some("2026-01-02"), &tag);
    labeled(&mut s, "镜头", Some("1500000"), Some("2026-02-01"), &tag);

    // 全部排除：单列件数，不伪装无物品。
    let excluded_tag = create_label(&mut s, "全部排除");
    let x1 = labeled(&mut s, "排除一", Some("10000"), None, &excluded_tag);
    let x2 = labeled(&mut s, "排除二", Some("20000"), None, &excluded_tag);
    set_exclude(&mut s, &x1, "statistics", true);
    set_exclude(&mut s, &x2, "statistics", true);
    let all_excluded = s.tag_investment_view(&excluded_tag, "all", TODAY).unwrap();
    assert_eq!(
        (
            all_excluded.counts.matched,
            all_excluded.counts.included,
            all_excluded.counts.excluded
        ),
        (2, 0, 2)
    );
    assert!(all_excluded.items.is_empty());

    // 全部未知：内部小计为零但没有任何已知分量标志。
    let unknown_tag = create_label(&mut s, "全未知");
    labeled(&mut s, "未知一", None, None, &unknown_tag);
    labeled(&mut s, "未知二", None, None, &unknown_tag);
    let all_unknown = s.tag_investment_view(&unknown_tag, "all", TODAY).unwrap();
    assert_eq!(all_unknown.totals.known_purchase_cents, "0");
    assert_eq!(all_unknown.totals.missing_purchase_count, 2);
    assert_eq!(all_unknown.totals.complete_investment_cents, None);
    assert!(!all_unknown.totals.has_known_purchase);
    assert!(!all_unknown.totals.has_known_investment);
    for row in &all_unknown.items {
        assert_eq!(row.purchase_cents, None);
        assert_eq!(
            row.known_maintenance_cents, "0",
            "没有维护记录时维护分项是确定的零"
        );
        assert_eq!(row.known_maintenance_record_count, 0);
        assert!(!row.has_known_investment, "已知维护小计为零不构成已知分量");
        assert_eq!(row.complete_investment_cents, None);
        assert_eq!(row.sale_proceeds_cents, "0");
    }

    // 全部明确零价：完整、合计 ¥0、已知零投入。
    let zero_tag = create_label(&mut s, "全零");
    labeled(&mut s, "零一", Some("0"), None, &zero_tag);
    labeled(&mut s, "零二", Some("0"), None, &zero_tag);
    let all_zero = s.tag_investment_view(&zero_tag, "all", TODAY).unwrap();
    assert_eq!(all_zero.totals.known_investment_cents, "0");
    assert_eq!(
        all_zero.totals.complete_investment_cents.as_deref(),
        Some("0")
    );
    assert!(all_zero.totals.has_known_purchase && all_zero.totals.has_known_investment);
    assert!(all_zero
        .items
        .iter()
        .all(|i| i.known_investment_cents == "0" && !i.incomplete));

    // 零价与正金额混合：零价行完整且已知投入为零（占比由前端按 0% 展示）。
    let mixed = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(mixed.totals.known_investment_cents, "1500000");
    let zero_rows: Vec<_> = mixed
        .items
        .iter()
        .filter(|i| i.known_investment_cents == "0")
        .collect();
    assert_eq!(zero_rows.len(), 2);
    assert!(
        zero_rows
            .iter()
            .all(|i| i.has_known_investment && !i.incomplete),
        "明确零价是已知值"
    );
    assert_eq!(mixed.items[0].name, "镜头");
}

#[test]
fn ac05_statistics_exclusion_only() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "摄影");
    let body = labeled(&mut s, "机身", Some("1200000"), Some("2026-01-01"), &tag);
    add_maintenance(&mut s, &body, Some("100000"));
    let lens = labeled(&mut s, "镜头", Some("1500000"), Some("2026-02-01"), &tag);
    labeled(&mut s, "配件", Some("300000"), Some("2026-03-01"), &tag);
    let sold_record = labeled(&mut s, "旧机身", Some("500000"), Some("2026-04-01"), &tag);
    sell(&mut s, &sold_record, "500000");
    set_exclude(&mut s, &lens, "statistics", true);
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(
        (
            history.counts.matched,
            history.counts.included,
            history.counts.excluded
        ),
        (4, 3, 1)
    );
    assert_eq!(history.totals.known_investment_cents, "2100000");
    assert_eq!(history.totals.sale_proceeds_cents, "500000");
    assert_eq!(history.totals.known_net_cents, "1600000");
    assert!(!history.items.iter().any(|i| i.name == "镜头"));
    // 其他三项排除开关不改变本页资格。
    let part_id = history
        .items
        .iter()
        .find(|i| i.name == "配件")
        .unwrap()
        .id
        .clone();
    let part = s.record(&part_id).unwrap().unwrap();
    set_exclude(&mut s, &part, "total", true);
    let part = s.record(&part_id).unwrap().unwrap();
    set_exclude(&mut s, &part, "daily", true);
    let part = s.record(&part_id).unwrap().unwrap();
    set_exclude(&mut s, &part, "timeline", true);
    let again = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(again.counts.included, 3);
    assert_eq!(again.totals.known_investment_cents, "2100000");
    drop(body);
}

#[test]
fn ac06_sale_correction_revoke_and_negative_net() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "摄影");
    let sold_record = labeled(&mut s, "旧机身", Some("500000"), Some("2026-04-01"), &tag);
    let old = sell(&mut s, &sold_record, "500000");
    let body = labeled(&mut s, "机身", Some("1200000"), Some("2026-01-01"), &tag);
    add_maintenance(&mut s, &body, Some("100000"));
    labeled(&mut s, "镜头", Some("1500000"), Some("2026-02-01"), &tag);
    labeled(&mut s, "配件", Some("300000"), Some("2026-03-01"), &tag);
    // 更正售价 6,000：投入仍 36,000，净投入 30,000。
    let record = s.record(&old.asset.id).unwrap().unwrap();
    let sale_id = record.sale.as_ref().unwrap().id.clone();
    let correct: sales::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "asset_id": old.asset.id,
        "expected_revision": record.asset.revision,
        "action": {"type": "correct", "sale_id": sale_id, "fields": {
            "date": TODAY, "price_cents": "600000", "platform": "", "buyer": "", "notes": ""
        }},
    }))
    .unwrap();
    s.change_sale(&correct, TODAY).unwrap();
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(history.totals.known_investment_cents, "3600000");
    assert_eq!(history.totals.sale_proceeds_cents, "600000");
    assert_eq!(history.totals.known_net_cents, "3000000");
    // 撤销售出：回收归零，当前持有含该件。
    let record = s.record(&old.asset.id).unwrap().unwrap();
    let sale_id = record.sale.as_ref().unwrap().id.clone();
    let revoke: sales::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "asset_id": old.asset.id,
        "expected_revision": record.asset.revision,
        "action": {"type": "revoke", "sale_id": sale_id},
    }))
    .unwrap();
    s.change_sale(&revoke, TODAY).unwrap();
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(history.totals.sale_proceeds_cents, "0");
    assert_eq!(history.counts.sold, 0);
    let held = s.tag_investment_view(&tag, "held", TODAY).unwrap();
    assert_eq!(held.counts.included, 4);
    assert!(held.items.iter().any(|i| i.name == "旧机身"));
    // 单件回收超过总投入：净投入如实为负，不截零。
    let loss_tag = create_label(&mut s, "亏损");
    let loss_record = labeled(
        &mut s,
        "折价机",
        Some("100000"),
        Some("2026-01-01"),
        &loss_tag,
    );
    let loss = sell(&mut s, &loss_record, "300000");
    let history = s.tag_investment_view(&loss_tag, "all", TODAY).unwrap();
    assert_eq!(history.totals.known_investment_cents, "100000");
    assert_eq!(history.totals.sale_proceeds_cents, "300000");
    assert_eq!(history.totals.known_net_cents, "-200000");
    assert_eq!(
        history.totals.complete_net_cents.as_deref(),
        Some("-200000")
    );
    drop(loss);
}

#[test]
fn ac07_label_identity_rename_disable_move_and_trash() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "摄影");
    let other = create_label(&mut s, "工作用");
    let body = labeled(&mut s, "机身", Some("1200000"), Some("2026-01-01"), &tag);
    add_maintenance(&mut s, &body, Some("100000"));
    // 改名保留 ID。
    let rename: choices::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "expected_revision": s.choices("label").unwrap().revision,
        "kind": "label",
        "action": {"type": "rename", "id": tag, "name": "摄影器材"},
    }))
    .unwrap();
    s.change_choices(&rename).unwrap();
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(history.label.name, "摄影器材");
    assert_eq!(history.label.id, tag);
    assert_eq!(history.counts.included, 1);
    // 停用标签保留历史关系与分析能力。
    let disable: choices::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "expected_revision": s.choices("label").unwrap().revision,
        "kind": "label",
        "action": {"type": "enable", "id": tag, "enabled": false},
    }))
    .unwrap();
    s.change_choices(&disable).unwrap();
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert!(history.label.inactive);
    assert_eq!(history.counts.included, 1);
    // 删除标签后 ID 失效：不按同名替代，空与非法 ID 被拒绝。
    let remove: choices::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(),
        "generation": s.generation(),
        "expected_revision": s.choices("label").unwrap().revision,
        "kind": "label",
        "action": {"type": "remove", "id": tag, "replacement": null, "expected_references": 1},
    }))
    .unwrap();
    s.change_choices(&remove).unwrap();
    assert_eq!(
        s.tag_investment_view(&tag, "all", TODAY).unwrap_err().code,
        "LABEL"
    );
    assert_eq!(
        s.tag_investment_view("", "all", TODAY).unwrap_err().code,
        "QUERY"
    );
    assert_eq!(
        s.tag_investment_view("x' OR 1=1 --", "all", TODAY)
            .unwrap_err()
            .code,
        "QUERY"
    );
    // 同名标签被现有约束拒绝：不存在“同名不同 ID”分支可测（记录既有约束）。
    let dup = s.change_choices(
        &serde_json::from_value::<choices::Change>(serde_json::json!({
            "request_id": rid(),
            "generation": s.generation(),
            "expected_revision": s.choices("label").unwrap().revision,
            "kind": "label",
            "action": {"type": "create", "name": "工作用"},
        }))
        .unwrap(),
    );
    let dup_err = match dup {
        Err(e) => e,
        Ok(_) => panic!("同名标签应被既有约束拒绝"),
    };
    assert_eq!(dup_err.code, "CHOICE_NAME");
    // 改标签：物品及其维护整体转移到新标签。
    let restored_tag = create_label(&mut s, "回顾");
    let mut item = labeled(&mut s, "镜头", Some("1500000"), Some("2026-02-01"), &other);
    item = add_maintenance(&mut s, &item, Some("50000"));
    let mut i = input(
        &s,
        "镜头",
        Some("1500000"),
        Some("2026-02-01"),
        serde_json::json!({"cost_mode": "daily", "label_id": restored_tag}),
    );
    i.base.asset_id = Some(item.asset.id.clone());
    i.base.expected_revision = Some(item.asset.revision);
    let moved = s.save_asset(&i, TODAY).unwrap();
    let history = s.tag_investment_view(&restored_tag, "all", TODAY).unwrap();
    assert_eq!(history.counts.included, 1);
    assert_eq!(
        history.totals.known_investment_cents, "1550000",
        "维护随物品整体转移到新标签"
    );
    assert!(s
        .tag_investment_view(&other, "all", TODAY)
        .unwrap()
        .items
        .is_empty());
    // 独立删除维护 → 删除物品 → 恢复物品：维护不复活。
    let record = s.record(&moved.asset.id).unwrap().unwrap();
    let record_trash = RecordChange {
        request_id: rid(),
        generation: s.generation(),
        asset_id: moved.asset.id.clone(),
        record_id: record.maintenances[0].id.clone(),
        kind: "maintenance".into(),
        expected_revision: record.asset.revision,
        deleted: true,
    };
    s.change_record_trash(&record_trash, TODAY).unwrap();
    let record = s.record(&moved.asset.id).unwrap().unwrap();
    s.change_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        asset_id: moved.asset.id.clone(),
        expected_revision: record.asset.revision,
        deleted: true,
    })
    .unwrap();
    assert!(s
        .tag_investment_view(&restored_tag, "all", TODAY)
        .unwrap()
        .items
        .is_empty());
    let record = s.record(&moved.asset.id).unwrap().unwrap();
    s.change_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        asset_id: moved.asset.id.clone(),
        expected_revision: record.asset.revision,
        deleted: false,
    })
    .unwrap();
    let history = s.tag_investment_view(&restored_tag, "all", TODAY).unwrap();
    assert_eq!(history.counts.included, 1);
    assert_eq!(
        history.totals.known_maintenance_cents, "0",
        "独立删除的维护不因恢复父物品重新累计"
    );
    assert_eq!(history.totals.known_investment_cents, "1500000");
}

#[test]
fn ac08_full_collection_beyond_one_page_ties_and_search_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "批量");
    // 103 件：100 件递增金额 + 两件同额（稳定 ID 排序）+ 末件可被关键词唯一命中。
    for i in 1..=100 {
        labeled(
            &mut s,
            &format!("常规{i:03}"),
            Some(&(i as i64 * 10000).to_string()),
            None,
            &tag,
        );
    }
    labeled(&mut s, "同额甲", Some("99999900"), None, &tag);
    labeled(&mut s, "同额乙", Some("99999900"), None, &tag);
    let marker = labeled(&mut s, "末件标记物", Some("432100"), None, &tag);
    let history = s.tag_investment_view(&tag, "all", TODAY).unwrap();
    assert_eq!(
        history.items.len(),
        103,
        "完整响应包含全部纳入集合，不只一页"
    );
    assert_eq!(history.counts.included, 103);
    let total: i64 = history
        .items
        .iter()
        .map(|i| i.known_investment_cents.parse::<i64>().unwrap())
        .sum();
    assert_eq!(
        total,
        (1..=100).map(|i| i * 10000).sum::<i64>() + 99999900 * 2 + 432100
    );
    assert_eq!(
        history.totals.known_investment_cents,
        total.to_string(),
        "汇总覆盖全部，不是当前页"
    );
    // 同额按稳定 ID 升序。
    let ids: Vec<_> = history
        .items
        .iter()
        .filter(|i| i.known_investment_cents == "99999900")
        .map(|i| i.id.as_str())
        .collect();
    assert_eq!(ids.len(), 2);
    assert!(ids[0] < ids[1]);
    assert!(history
        .items
        .iter()
        .any(|i| i.id == marker.asset.id && i.known_investment_cents == "432100"));
    // 搜索所需字段齐全（沿用列表匹配习惯：名称、品牌、型号、分类、备注、序列号）。
    let row = history
        .items
        .iter()
        .find(|i| i.id == marker.asset.id)
        .unwrap();
    assert!(row.name.contains("末件"));
    assert_eq!(row.brand, "虚构品牌");
    assert_eq!(row.serial_number, "TEST-001");
    assert!(row.notes.contains("虚构"));
    assert_eq!(row.category_name, "未分类");
}

#[test]
fn ac10_errors_overflow_and_inconsistent_sale() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let tag = create_label(&mut s, "溢出");
    labeled(&mut s, "大额一", Some("99999999999"), None, &tag);
    labeled(&mut s, "大额二", Some("99999999999"), None, &tag);
    // 常规写入各自合法；聚合用 checked sum：2×1e11 仍在 i64 内，
    // 因此用隔离 SQL 注入超出常规写入上限的坏值验证溢出路径。
    raw_db(tmp.path())
        .execute(
            "UPDATE assets SET price_cents=9000000000000000000 WHERE name IN ('大额一','大额二')",
            [],
        )
        .unwrap();
    assert_eq!(
        s.tag_investment_view(&tag, "all", TODAY).unwrap_err().code,
        "OVERFLOW"
    );
    assert_eq!(
        s.tag_investment_view(&tag, "held", TODAY).unwrap_err().code,
        "OVERFLOW"
    );
    // 已售出但读不到有效销售：可重试的读取错误，不静默当零。
    let loss_tag = create_label(&mut s, "坏状态");
    labeled(&mut s, "坏售价", Some("100000"), None, &loss_tag);
    raw_db(tmp.path())
        .execute(
            "UPDATE assets SET lifecycle_state='sold' WHERE name='坏售价'",
            [],
        )
        .unwrap();
    assert_eq!(
        s.tag_investment_view(&loss_tag, "all", TODAY)
            .unwrap_err()
            .code,
        "SALE"
    );
    // 有效销售挂在未售出物品上：同样是不一致错误。
    {
        let raw = raw_db(tmp.path());
        raw.execute(
            "UPDATE assets SET lifecycle_state='active' WHERE name='坏售价'",
            [],
        )
        .unwrap();
        raw.execute(
            "INSERT INTO sales(id,asset_id,previous_state,date,price_cents,platform,buyer,notes,created_at,updated_at,revoked_at) \
             VALUES('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',(SELECT id FROM assets WHERE name='坏售价'),'active','2026-09-10',500,'','','','2026-09-10T00:00:00Z','2026-09-10T00:00:00Z',NULL)",
            [],
        )
        .unwrap();
    }
    assert_eq!(
        s.tag_investment_view(&loss_tag, "all", TODAY)
            .unwrap_err()
            .code,
        "SALE"
    );
    // 非法 scope 与观察日期被拒绝。
    assert_eq!(
        s.tag_investment_view(&loss_tag, "future", TODAY)
            .unwrap_err()
            .code,
        "QUERY"
    );
    assert_eq!(
        s.tag_investment_view(&loss_tag, "all", "2026-13-01")
            .unwrap_err()
            .code,
        "DATE"
    );
}

#[test]
fn u17b_demo_sample_carries_photography_tag() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    possio_lib::demo::import(&mut s, TODAY).unwrap();
    let snap = s.choices("label").unwrap();
    let photo = snap
        .items
        .iter()
        .find(|e| e.name == "摄影")
        .expect("统一样例含虚构摄影标签");
    let history = s.tag_investment_view(&photo.id, "all", TODAY).unwrap();
    assert!(
        history.counts.included >= 2,
        "样例摄影标签至少两件（相机与录音设备）"
    );
    assert!(
        history
            .totals
            .known_investment_cents
            .parse::<i64>()
            .unwrap()
            > 0
    );
}
