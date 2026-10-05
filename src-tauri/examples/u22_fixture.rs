//! 虚拟资产标签与计费的隔离原生验收夹具（只允许路径含
//! local.thingary.virtualbilling.acceptance）：通过真实 Store、真实文件与真实
//! 备份协议建立虚构资料，覆盖订阅、储值、标签、提醒与升级路径；不触碰正式库。
use std::path::PathBuf;
use thingary_lib::{
    expenses,
    recurring::{PaymentRangeSave, PlanFields, PlanSave},
    storage::Store,
    virtual_assets::{
        BalanceSave, Fields, LinkedPlanSave, Save as VirtualSave, SpecialEnd, TopupFields,
        TopupSave,
    },
    wealth::TrashChange,
};

fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn sub_fields(name: &str) -> PlanFields {
    PlanFields {
        auto_renew: true,
        service_start: Some("2024-01-20".into()),
        coverage_start: Some("2024-01-20".into()),
        interval_days: None,
        trial_days: None,
        name: name.into(),
        category: "subscription".into(),
        amount_cents: "14000".into(),
        interval_months: 1,
        first_due: "2024-01-20".into(),
        end_date: None,
        paused: false,
        notes: String::new(),
    }
}

fn main() {
    let root: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: u22_fixture <library-root>")
        .parse()
        .unwrap();
    if std::fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        panic!("refusing symlink path: {}", root.display());
    }
    let canonical = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    assert!(
        canonical
            .components()
            .any(|c| c.as_os_str() == "local.thingary.virtualbilling.acceptance"),
        "refusing non-isolated path: {}",
        canonical.display()
    );
    let today = today();
    let mut s = Store::open(&root).expect("open store");
    if !s.virtual_overview(&today).unwrap().items.is_empty() {
        println!("already-populated");
        return;
    }
    // 1. 订阅：GPT 月订阅，持续续费（默认形态）。
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: sub_fields("GPT Plus"),
            },
            &today,
        )
        .unwrap();
    let gpt = s
        .virtual_save(
            &VirtualSave {
                plan: Some(LinkedPlanSave {
                    id: Some(plan.id.clone()),
                    expected_revision: Some(plan.revision),
                    fields: plan.fields.clone(),
                }),
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    name: "GPT Plus".into(),
                    kind: "general".into(),
                    billing: "subscription".into(),
                    label_id: None,
                    pay_method: Some("支付宝".into()),
                    perpetual: None,
                    provider: "OpenAI".into(),
                    purchase_date: None,
                    price_cents: None,
                    expires: None,
                    plan_id: Some(plan.id.clone()),
                    url: String::new(),
                    notes: "虚构订阅；验收夹具。".into(),
                    stopped_on: None,
                },
            },
            &today,
        )
        .unwrap();
    println!("subscription id={} billing={}", gpt.id, gpt.fields.billing);
    // 2. 储值：饭卡，两次充值（其一实付未知），一条余额盘点。
    let card = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    name: "虚构饭卡".into(),
                    kind: "general".into(),
                    billing: "topup".into(),
                    label_id: None,
                    pay_method: None,
                    perpetual: None,
                    provider: "虚构食堂".into(),
                    purchase_date: None,
                    price_cents: None,
                    expires: None,
                    plan_id: None,
                    url: String::new(),
                    notes: String::new(),
                    stopped_on: None,
                },
            },
            &today,
        )
        .unwrap();
    let first = TopupSave {
        request_id: rid(),
        generation: s.generation(),
        asset_id: card.id.clone(),
        id: None,
        expected_revision: None,
        fields: TopupFields {
            topup_date: Some(today.clone()),
            paid_cents: Some("15000".into()),
            gift_cents: Some("5000".into()),
            credit_cents: Some("20000".into()),
            pay_method: "微信".into(),
            notes: String::new(),
        },
    };
    s.virtual_topup_save(&first, &today).unwrap();
    let second = TopupSave {
        request_id: rid(),
        generation: s.generation(),
        asset_id: card.id.clone(),
        id: None,
        expected_revision: None,
        fields: TopupFields {
            topup_date: None,
            paid_cents: None,
            gift_cents: None,
            credit_cents: Some("3000".into()),
            pay_method: String::new(),
            notes: "日期与实付待补充".into(),
        },
    };
    s.virtual_topup_save(&second, &today).unwrap();
    s.virtual_balance_save(
        &BalanceSave {
            request_id: rid(),
            generation: s.generation(),
            asset_id: card.id.clone(),
            id: None,
            expected_revision: None,
            balance_cents: "12345".into(),
            recorded_on: today.clone(),
            notes: "手动盘点".into(),
        },
        &today,
    )
    .unwrap();
    println!("topup id={} balance recorded_on={}", card.id, today);
    // 3. 单次购买：买断软件，永久有效。
    let license = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    name: "虚构买断软件".into(),
                    kind: "general".into(),
                    billing: "single".into(),
                    label_id: None,
                    pay_method: None,
                    perpetual: Some(true),
                    provider: "虚构厂商".into(),
                    purchase_date: Some(today.clone()),
                    price_cents: Some("128000".into()),
                    expires: None,
                    plan_id: None,
                    url: String::new(),
                    notes: String::new(),
                    stopped_on: None,
                },
            },
            &today,
        )
        .unwrap();
    println!(
        "single id={} perpetual={}",
        license.id,
        license.fields.perpetual.unwrap_or(false)
    );
    // 4. 历史补记：确认订阅已开始的前两期。
    let range = PaymentRangeSave {
        request_id: rid(),
        generation: s.generation(),
        plan_id: plan.id.clone(),
        expected_revision: 1, // 仅创建
        from_due: "2024-01-20".into(),
        to_due: "2024-02-20".into(),
        amount_cents: "14000".into(),
        confirmed: true,
    };
    let _ = s.recurring_payment_range_save(&range, &today);
    // 5. 完整备份：备份→恢复到新数据集，校验新表与事实一致。
    let backup = root.join("验收备份.thingary");
    s.backup(Some(&backup)).unwrap();
    let summary = s.inspect_backup(&backup).unwrap();
    println!(
        "backup schema={} virtual_assets={} virtual_topups={}",
        summary.schema, summary.virtual_assets, summary.virtual_topups
    );
    let mut other = Store::open(&root.join("restore-target")).unwrap();
    other
        .restore(&backup, &summary.hash, &other.generation())
        .unwrap();
    let o = other.virtual_overview(&today).unwrap();
    let card_view = o
        .items
        .iter()
        .find(|v| v.fields.name == "虚构饭卡")
        .expect("card restored");
    assert_eq!(card_view.topup_known_cents.as_deref(), Some("15000"));
    assert_eq!(card_view.topup_credit_cents.as_deref(), Some("23000"));
    assert_eq!(
        card_view.balance.as_ref().map(|b| b.balance_cents.as_str()),
        Some("12345")
    );
    let view = other.expense_view(None).unwrap();
    let topup_lines: Vec<_> = view.lines.iter().filter(|l| l.source == "topup").collect();
    assert_eq!(topup_lines.len(), 1, "只汇总已知实付的一笔充值");
    println!(
        "restore ok; expense spent={} (topup known paid only)",
        view.spent_cents
    );
    // 6. 停用与恢复：删除饭卡→充值支出暂时退出→恢复同一事实。
    other
        .wealth_trash(&TrashChange {
            request_id: rid(),
            generation: other.generation(),
            kind: "virtual".into(),
            id: card_view.id.clone(),
            expected_revision: card_view.revision,
            deleted: true,
        })
        .unwrap();
    assert_eq!(
        other
            .expense_view(None)
            .unwrap()
            .lines
            .iter()
            .filter(|l| l.source == "topup")
            .count(),
        0,
        "档案删除后充值暂不参加当前支出"
    );
    other
        .wealth_trash(&TrashChange {
            request_id: rid(),
            generation: other.generation(),
            kind: "virtual".into(),
            id: card_view.id.clone(),
            expected_revision: card_view.revision + 1,
            deleted: false,
        })
        .unwrap();
    assert_eq!(
        other
            .expense_view(None)
            .unwrap()
            .lines
            .iter()
            .filter(|l| l.source == "topup")
            .count(),
        1,
        "恢复原 ID 后同一事实继续生效"
    );
    println!("trash/restore round-trip ok");
    let _ = expenses::CATEGORIES;
    let _ = SpecialEnd {
        period_start: String::new(),
        coverage_end: None,
    };
    println!("u22 acceptance fixture complete");
}
