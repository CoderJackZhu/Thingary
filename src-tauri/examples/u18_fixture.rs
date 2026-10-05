//! U18 隔离验收夹具（临时工具，验收后删除，不入库）：把 U18 设计 §6.1 的
//! 虚构事实经业务 API 写入指定资料库根目录（只允许 local.thingary.u18.acceptance）。
//! 心愿：2,850/850 攒钱、大金额、未知/零价格、长名称、已实现、已放弃；
//! 周期：30 条付款（含本期不付）+ 单条 + 零条计划；分类：30 个虚构分类。
use std::path::PathBuf;
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save,
    photos::Selection,
    recurring::{PaymentSave, PlanFields, PlanSave},
    storage::Store,
    taxonomy::{self, Classification},
    wish_plan::{Preferences, Save as WishSave},
    wishlist::{Change, Fields as WishFields},
};

const TODAY: &str = "2026-09-30";

fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn input(s: &Store, name: &str, price: Option<&str>, date: Option<&str>) -> SaveAsset {
    SaveAsset {
        options: Some(
            serde_json::from_value(serde_json::json!({
                "preferences": {"cost_mode": "daily"}, "warranty": null, "retired_date": null, "sale": null,
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
            serial_number: "U18-001".into(),
            notes: "U18 隔离验收虚构样例".into(),
        },
        photos: None,
        classification: None,
    }
}

fn create_category(s: &mut Store, name: &str) {
    let snap = s.taxonomy_snapshot().unwrap();
    let change: taxonomy::Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(), "generation": snap.generation, "expected_revision": snap.revision,
        "command": {"type": "create", "kind": "category", "name": name},
    }))
    .unwrap();
    s.change_taxonomy(&change).unwrap();
}

fn wish(
    s: &mut Store,
    name: &str,
    price: Option<&str>,
    mode: Option<&str>,
    saved: &str,
) -> thingary_lib::wishlist::WishlistItem {
    s.save_wish_plan(
        &WishSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: WishFields {
                name: name.into(),
                category_id: None,
                estimated_price_cents: price.map(str::to_owned),
                priority: None,
                target_date: None,
                external_link: String::new(),
                notes: "U18 虚构心愿样例".into(),
            },
            preferences: Preferences {
                added_date: Some("2026-09-01".into()),
                channel_id: None,
                mode: mode.map(str::to_owned),
                saved_cents: saved.into(),
                achievement_source: None,
                pinned: false,
                reminder: false,
            },
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
}

fn abandon_wish(s: &mut Store, item: &thingary_lib::wishlist::WishlistItem) {
    let change: Change = serde_json::from_value(serde_json::json!({
        "request_id": rid(), "generation": s.generation(), "expected_revision": item.revision,
        "action": {"type": "abandon", "wishlist_id": item.id},
    }))
    .unwrap();
    s.change_wishlist(&change).unwrap();
}

fn create_plan(
    s: &mut Store,
    name: &str,
    amount: &str,
    interval: u32,
    first: &str,
    notes: &str,
) -> thingary_lib::recurring::Plan {
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
                category: "insurance".into(),
                amount_cents: amount.into(),
                interval_months: interval,
                first_due: first.into(),
                end_date: None,
                paused: false,
                notes: notes.into(),
            },
        },
        TODAY,
    )
    .unwrap()
}

fn pay(s: &mut Store, plan_id: &str, due: &str, state: &str, amount: Option<&str>, notes: &str) {
    s.recurring_payment_save(
        &PaymentSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan_id.into(),
            due_date: due.into(),
            state: state.into(),
            paid_date: if state == "paid" {
                Some(due.into())
            } else {
                None
            },
            amount_cents: amount.map(str::to_owned),
            notes: notes.into(),
        },
        TODAY,
    )
    .unwrap();
}

fn nth_due(first: &str, months: u32, k: u32) -> String {
    use chrono::{Datelike, NaiveDate};
    let start = NaiveDate::parse_from_str(first, "%Y-%m-%d").unwrap();
    let total = start.year() * 12 + start.month0() as i32 + (months as i32) * (k as i32);
    let year = total.div_euclid(12);
    let month0 = total.rem_euclid(12) as u32;
    // 截到月末（2 月 30 日这类日期映射为当月最后一天）。
    let next_month = NaiveDate::from_ymd_opt(
        if month0 == 11 { year + 1 } else { year },
        if month0 == 11 { 1 } else { month0 + 2 },
        1,
    )
    .unwrap();
    let day = start.day().min(next_month.pred_opt().unwrap().day());
    NaiveDate::from_ymd_opt(year, month0 + 1, day)
        .unwrap()
        .format("%Y-%m-%d")
        .to_string()
}

fn main() {
    let mut args = std::env::args().skip(1);
    let root: PathBuf = args
        .next()
        .expect("usage: u18_fixture <library-root> [personal]")
        .parse()
        .unwrap();
    let personal = args.next().as_deref() == Some("personal");
    if std::fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        panic!("refusing symlink path: {}", root.display());
    }
    let canonical = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    let normalized = canonical.to_string_lossy();
    assert!(
        canonical
            .components()
            .any(|c| c.as_os_str() == "local.thingary.u18.acceptance"),
        "refusing non-isolated path: {} (from {})",
        normalized,
        root.display()
    );
    if personal {
        println!("isolation-checked {}", normalized);
    }
    let mut s = Store::open(&root).expect("open store");
    if !personal {
        println!("sample-root-prepared {}", root.display());
        return;
    }
    if s.has_any_asset().unwrap() {
        println!("already-populated");
        return;
    }
    // 30 个虚构分类（含长中英文名与无物品分类）。
    let names = [
        "便携手账与纸胶带",
        "长途骑行装备",
        "Kitchen & Dining",
        "露营照明与电源",
        "Mid-Century Furniture",
        "手冲咖啡器具",
        "桌面收纳",
        "黑胶唱片",
        "绘画颜料",
        "Model Kits",
        "瑜伽与拉伸",
        "冬季滑雪",
        "水上运动",
        "Kites & Drones",
        "望远镜与观鸟",
        "多肉植物",
        "烘焙模具",
        "茶具与茶叶",
        "香薰蜡烛",
        "Board Games",
        "拼图",
        "乐高",
        "遥控车",
        "钓鱼用具",
        "烧烤炉具",
        "工具与五金",
        "乐器配件",
        "缝纫机",
        "胶片相机",
        "超长分类名称用于验证菜单内换行的虚构条目",
    ];
    for name in names {
        create_category(&mut s, name);
    }
    // 物品：两件挂到首/尾分类（分类筛选结果可见）。
    let snapshot = s.taxonomy_snapshot().unwrap();
    let first_id = snapshot
        .categories
        .iter()
        .find(|c| c.name == names[0])
        .map(|c| c.id.clone());
    let mut asset = input(&s, "虚构样例相机", Some("979000"), Some("2026-01-10"));
    if let Some(id) = &first_id {
        asset.classification = Some(Classification {
            category_id: Some(id.clone()),
            channel_id: None,
        });
    }
    s.save_asset(&asset, TODAY).unwrap();
    s.save_asset(
        &input(&s, "虚构样例背包", Some("80000"), Some("2026-01-20")),
        TODAY,
    )
    .unwrap();
    // 心愿组合（金额仅在既有合法范围内）。
    wish(
        &mut s,
        "虚构长名称心愿 · 等待很久的木框全画幅镜头与整套滤镜系统",
        Some("285000"),
        Some("savings"),
        "85000",
    );
    wish(
        &mut s,
        "大金额心愿 · 工作室整套设备",
        Some("1234567890"),
        None,
        "0",
    );
    wish(&mut s, "价格未知心愿 · 待定型号耳机", None, None, "0");
    wish(
        &mut s,
        "零价格心愿 · 朋友转让的旧书架",
        Some("0"),
        None,
        "0",
    );
    // 购买是一次显式确认，不再是保存表单的副作用。
    let done = wish(&mut s, "已购入心愿 · 键盘", Some("29900"), None, "0");
    let _ = done;
    let given_up = wish(&mut s, "不再考虑心愿 · 跑步机", Some("399900"), None, "0");
    abandon_wish(&mut s, &given_up);
    // 周期：长名称 30 条付款（第 4、11、18、25 期为本期不付）+ 单条 + 零条。
    let long = create_plan(
        &mut s,
        "虚构超长名称周期计划 · 全屋智能安防监控与云存储订阅服务（含设备租赁与上门维护）",
        "16800",
        1,
        "2024-03-03",
        "虚构长备注：含摄像机三台、门磁两枚的租赁费，每期账单在 3 日后出账，可延期一周缴纳。",
    );
    for k in 0..30u32 {
        let due = nth_due("2024-03-03", 1, k);
        let skipped = k % 7 == 3;
        pay(
            &mut s,
            &long.id,
            &due,
            if skipped { "skipped" } else { "paid" },
            if skipped { None } else { Some("16800") },
            if skipped {
                "本期不付：外出停用一个月"
            } else {
                "虚构付款备注，用于检查长文本折行。"
            },
        );
    }
    let single = create_plan(
        &mut s,
        "单期付款计划 · 域名续费",
        "8800",
        12,
        "2025-08-30",
        "",
    );
    pay(&mut s, &single.id, "2025-08-30", "paid", Some("8800"), "");
    create_plan(
        &mut s,
        "还没有付款的计划 · 视频会员",
        "2500",
        1,
        "2026-10-05",
        "",
    );
    let overview = s.recurring_overview(TODAY).unwrap();
    println!(
        "recurring: plans={} payments={} due={}",
        overview.plans.len(),
        overview.payments.len(),
        overview.due.len()
    );
    println!("fixture-done");
}
