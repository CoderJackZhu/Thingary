//! U19 隔离验收夹具：把「售出保值率」各种情形的虚构数据经业务 API 写入资料库
//! （只允许路径含 local.thingary.u19.acceptance）。
//! 参与计算：正常 70%、高于原价 110%、售价为 0 的 0%、两件同为 50% 的并列项、长名称；
//! 不参与：购入价未知、购入价为 ¥0、「不计入统计」的已售出物品、已删除的已售出物品；
//! 另有未售出物品与带维护费用的已售出物品（维护费不影响保值率）。
use std::path::PathBuf;
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save,
    sales::Fields as SaleFields,
    storage::Store,
    trash::TrashChange,
};

const TODAY: &str = "2026-10-02";

fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 创建一件物品；`sale` 为 Some 时同事务写入售出记录；`exclude_stats` 把它设为不计入统计。
fn asset(
    s: &mut Store,
    name: &str,
    price: Option<&str>,
    bought: &str,
    sale: Option<(&str, &str)>,
    exclude_stats: bool,
) -> thingary_lib::catalog::AssetRecord {
    let preferences = serde_json::json!({
        "cost_mode": "daily",
        "exclude": {"total": false, "daily": false, "statistics": exclude_stats, "timeline": false},
    });
    let sale_json = sale.map(|(date, cents)| SaleFields {
        date: date.into(),
        price_cents: cents.into(),
        platform: "闲鱼".into(),
        buyer: "虚构买家".into(),
        notes: "U19 隔离验收虚构样例".into(),
    });
    let options = serde_json::json!({
        "preferences": preferences, "warranty": null, "retired_date": null, "sale": sale_json,
    });
    let input = SaveAsset {
        options: Some(serde_json::from_value(options).unwrap()),
        base: Save {
            request_id: rid(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: name.into(),
            price_cents: price.map(str::to_owned),
            purchase_date: Some(bought.into()),
        },
        details: Details {
            brand: "虚构品牌".into(),
            model: "样例型号".into(),
            serial_number: "U19-001".into(),
            notes: "U19 隔离验收虚构样例".into(),
        },
        photos: None,
        classification: None,
    };
    s.save_asset(&input, TODAY).unwrap()
}

fn main() {
    let root: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: u19_fixture <library-root>")
        .parse()
        .unwrap();
    if std::fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        panic!("refusing symlink path: {}", root.display());
    }
    let canonical = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    assert!(
        canonical
            .components()
            .any(|c| c.as_os_str() == "local.thingary.u19.acceptance"),
        "refusing non-isolated path: {}",
        canonical.display()
    );
    let mut s = Store::open(&root).expect("open store");
    if s.has_any_asset().unwrap() {
        println!("already-populated");
        return;
    }
    // 参与保值率（金额单位：分）
    asset(
        &mut s,
        "虚构相机",
        Some("900000"),
        "2024-03-01",
        Some(("2026-05-10", "630000")),
        false,
    ); // 70%
    asset(
        &mut s,
        "虚构手机",
        Some("500000"),
        "2025-01-15",
        Some(("2026-06-01", "550000")),
        false,
    ); // 110%
    asset(
        &mut s,
        "虚构耳机",
        Some("200000"),
        "2025-06-01",
        Some(("2026-07-01", "0")),
        false,
    ); // 0%
    asset(
        &mut s,
        "虚构键盘",
        Some("100000"),
        "2025-02-01",
        Some(("2026-03-01", "50000")),
        false,
    ); // 50%
    asset(
        &mut s,
        "虚构鼠标",
        Some("20000"),
        "2025-02-01",
        Some(("2026-03-02", "10000")),
        false,
    ); // 50%，与键盘并列
    asset(
        &mut s,
        "虚构长名称物品 · 带木框的全画幅旅行镜头与整套滤镜转接环收纳套装",
        Some("300000"),
        "2024-09-01",
        Some(("2026-08-20", "240000")),
        false,
    ); // 80%
       // 不参与：购入价未知、¥0
    asset(
        &mut s,
        "虚构旧书架（购入价未知）",
        None,
        "2023-01-01",
        Some(("2026-04-01", "8000")),
        false,
    );
    asset(
        &mut s,
        "虚构赠品（购入价 ¥0）",
        Some("0"),
        "2024-01-01",
        Some(("2026-04-02", "10000")),
        false,
    );
    // 不参与：不计入统计
    asset(
        &mut s,
        "虚构台灯（不计入统计）",
        Some("50000"),
        "2025-03-01",
        Some(("2026-04-03", "25000")),
        true,
    );
    // 不参与：已删除
    let gone = asset(
        &mut s,
        "虚构音箱（已删除）",
        Some("100000"),
        "2025-03-01",
        Some(("2026-04-04", "90000")),
        false,
    );
    s.change_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        asset_id: gone.asset.id.clone(),
        expected_revision: gone.asset.revision,
        deleted: true,
    })
    .unwrap();
    // 未售出
    asset(
        &mut s,
        "虚构笔记本电脑（使用中）",
        Some("1200000"),
        "2025-04-01",
        None,
        false,
    );
    println!("u19-fixture-done");
}
