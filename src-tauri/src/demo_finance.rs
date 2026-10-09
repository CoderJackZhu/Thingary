//! Shared fictional financial fixtures; source data also drives the browser preview.
use crate::{domain::Result, storage::Store, wealth};
use chrono::{Days, Months, NaiveDate};
use serde::Deserialize;

#[derive(Deserialize)]
struct Account {
    key: String,
    name: String,
    institution: String,
    side: String,
    kind: String,
    counted: bool,
}
#[derive(Deserialize)]
struct Snapshot {
    months_ago: u32,
    amounts_yuan: Vec<Option<i64>>,
}
#[derive(Deserialize)]
struct Expense {
    key: String,
    title: String,
    days_ago: u64,
    amount_cents: String,
    category: String,
    refund_cents: Option<String>,
    refund_days_ago: Option<u64>,
    asset_key: Option<String>,
    deleted: bool,
}
#[derive(Deserialize)]
struct Plan {
    key: String,
    name: String,
    category: String,
    amount_cents: String,
    interval_months: u32,
    months_ago: u32,
    day_offset: i64,
    paused: bool,
    paid_periods: Vec<u32>,
}
#[derive(Deserialize)]
struct Virtual {
    key: String,
    name: String,
    kind: String,
    provider: String,
    purchase_days_ago: Option<u64>,
    price_cents: Option<String>,
    expires_in_days: Option<u64>,
    plan_key: Option<String>,
    stopped_days_ago: Option<u64>,
}
#[derive(Deserialize)]
struct Fixtures {
    accounts: Vec<Account>,
    snapshots: Vec<Snapshot>,
    expenses: Vec<Expense>,
    plans: Vec<Plan>,
    virtuals: Vec<Virtual>,
}
fn day(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}
fn rid(key: &str) -> String {
    super::demo::request(key, "unified-v1")
}
fn before(today: NaiveDate, days: u64) -> String {
    day(today
        .checked_sub_days(Days::new(days))
        .expect("bounded sample date"))
}

pub(crate) fn import(s: &mut Store, today: &str) -> Result<()> {
    let complete = s.root.join("unified-demo-v1.complete");
    if complete.exists() {
        return Ok(());
    }
    // Persist the anchor before the first write so an interrupted import retries identical inputs.
    let anchor = s.root.join("unified-demo-v1.date");
    let date = if anchor.exists() {
        std::fs::read_to_string(&anchor)?
    } else {
        crate::storage::atomic_write(&anchor, today.as_bytes())?;
        today.to_owned()
    };
    let now = crate::domain::date(&date)?;
    let data: Fixtures = serde_json::from_str(include_str!("../../src/demo-finance.json"))?;
    let generation = s.generation();
    let opened = day(now
        .checked_sub_months(Months::new(6))
        .expect("bounded sample date"));
    let mut ids = Vec::new();
    for a in data.accounts {
        let record = s.wealth_account_save(
            &wealth::AccountSave {
                request_id: rid(&a.key),
                generation: generation.clone(),
                id: None,
                expected_revision: None,
                fields: wealth::AccountFields {
                    name: a.name,
                    institution: a.institution,
                    side: a.side,
                    kind: a.kind,
                    counted: a.counted,
                    opened_on: opened.clone(),
                    closed_on: None,
                    notes: "虚构样例；房贷单独展示，不计入金融净资产。".into(),
                },
            },
            &date,
        )?;
        ids.push(record.id);
    }
    for snapshot in data.snapshots {
        s.wealth_snapshot_save(
            &wealth::SnapshotSave {
                request_id: rid(&format!("snapshot-{}", snapshot.months_ago)),
                generation: generation.clone(),
                id: None,
                expected_revision: None,
                date: day(now
                    .checked_sub_months(Months::new(snapshot.months_ago))
                    .expect("bounded sample date")),
                notes: "虚构盘点；缺失记录不当作零，不参与完整净资产比较。".into(),
                entries: ids
                    .iter()
                    .zip(snapshot.amounts_yuan)
                    .map(|(id, amount)| wealth::EntryInput {
                        account_id: id.clone(),
                        state: if amount.is_some() {
                            "entered"
                        } else {
                            "missing"
                        }
                        .into(),
                        amount_cents: amount.map(|v| (v * 100).to_string()),
                    })
                    .collect(),
            },
            &date,
        )?;
    }
    import_expenses(s, data.expenses, now, &date)?;
    import_plans(s, data.plans, now, &date)?;
    crate::storage::atomic_write(&complete, b"1")?;
    Ok(())
}

fn import_expenses(s: &mut Store, data: Vec<Expense>, now: NaiveDate, today: &str) -> Result<()> {
    for e in data {
        // Deleted sample rows need not be replayed: their receipt remains authoritative.
        let exists: bool = s.conn()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM feature_requests WHERE id=?1)",
            [rid(&format!("expense-{}", e.key))],
            |r| r.get(0),
        )?;
        if exists && !e.deleted {
            continue;
        }
        if e.deleted {
            let removed: bool = s.conn()?.query_row(
                "SELECT EXISTS(SELECT 1 FROM feature_requests WHERE id=?1)",
                [rid("expense-trash-delete")],
                |r| r.get(0),
            )?;
            if removed {
                continue;
            }
        }
        let asset_id = e
            .asset_key
            .as_ref()
            .map(|key| {
                s.saved_request(&super::demo::request(key, "create"), &s.generation())
                    .map(|r| r.filter(|r| !r.deleted).map(|r| r.asset.id))
            })
            .transpose()?
            .flatten();
        // Upgrading an edited legacy sample must not turn a removed asset's
        // descriptive purchase link into a new standalone charge.
        if e.asset_key.is_some() && asset_id.is_none() {
            continue;
        }
        let record = s.expense_save(
            &crate::expenses::Save {
                request_id: rid(&format!("expense-{}", e.key)),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: crate::expenses::Fields {
                    title: e.title,
                    date: before(now, e.days_ago),
                    amount_cents: e.amount_cents,
                    category: e.category,
                    notes: "虚构样例；关联物品仅作说明，不重复累计。".into(),
                    refund_cents: e.refund_cents,
                    refund_date: e.refund_days_ago.map(|d| before(now, d)),
                    asset_id,
                },
            },
            today,
        )?;
        if e.deleted {
            s.wealth_trash(&wealth::TrashChange {
                request_id: rid("expense-trash-delete"),
                generation: s.generation(),
                kind: "expense".into(),
                id: record.id,
                expected_revision: 1,
                deleted: true,
            })?;
        }
    }
    Ok(())
}
fn import_plans(s: &mut Store, data: Vec<Plan>, now: NaiveDate, today: &str) -> Result<()> {
    for p in data {
        let first = now
            .checked_add_signed(chrono::Duration::days(p.day_offset))
            .expect("bounded sample date")
            .checked_sub_months(Months::new(p.months_ago))
            .expect("bounded sample date");
        let plan = s.recurring_plan_save(
            &crate::recurring::PlanSave {
                request_id: rid(&format!("plan-{}", p.key)),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: crate::recurring::PlanFields {
                    auto_renew: true,
                    interval_days: None,
                    trial_days: None,
                    service_start: None,
                    coverage_start: None,
                    name: p.name,
                    category: p.category,
                    amount_cents: p.amount_cents.clone(),
                    interval_months: p.interval_months,
                    first_due: day(first),
                    end_date: None,
                    paused: p.paused,
                    notes: "虚构样例；到期并不代表已付款。".into(),
                },
            },
            today,
        )?;
        for period in p.paid_periods {
            let due = day(first
                .checked_add_months(Months::new(period * p.interval_months))
                .expect("bounded sample date"));
            s.recurring_payment_save(
                &crate::recurring::PaymentSave {
                    request_id: rid(&format!("payment-{}-{period}", p.key)),
                    generation: s.generation(),
                    id: None,
                    expected_revision: None,
                    plan_id: plan.id.clone(),
                    due_date: due.clone(),
                    state: "paid".into(),
                    paid_date: Some(due),
                    amount_cents: Some(p.amount_cents.clone()),
                    notes: "虚构已付款；重要支出与时间轴共用此记录。".into(),
                },
                today,
            )?;
        }
    }
    Ok(())
}

/// Virtual assets (C2) carry their own marker so sample libraries made before
/// C2 gain them on upgrade. Dates count from the first attempt's day.
pub(crate) fn import_virtual(s: &mut Store, today: &str) -> Result<()> {
    let complete = s.root.join("unified-demo-virtual-v1.complete");
    if complete.exists() {
        return Ok(());
    }
    let anchor = s.root.join("unified-demo-virtual-v1.date");
    let date = if anchor.exists() {
        std::fs::read_to_string(&anchor)?
    } else {
        crate::storage::atomic_write(&anchor, today.as_bytes())?;
        today.to_owned()
    };
    let now = crate::domain::date(&date)?;
    let data: Fixtures = serde_json::from_str(include_str!("../../src/demo-finance.json"))?;
    let plans = s.recurring_overview(&date)?.plans;
    for v in data.virtuals {
        // Link only while the sample plan is still there under its name.
        let plan_id = v.plan_key.and_then(|k| {
            let name = &data.plans.iter().find(|p| p.key == k)?.name;
            Some(plans.iter().find(|p| &p.fields.name == name)?.id.clone())
        });
        let request_id = rid(&format!("virtual-{}", v.key));
        if s.conn()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM feature_requests WHERE id=?1)",
            [&request_id],
            |r| r.get::<_, bool>(0),
        )? {
            continue;
        }
        s.virtual_save(
            &crate::virtual_assets::Save {
                plan: None,
                request_id,
                generation: s.generation(),
                id: None,
                expected_revision: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                fields: crate::virtual_assets::Fields {
                    name: v.name,
                    billing: if plan_id.is_some() {
                        "subscription".into()
                    } else {
                        "single".into()
                    },
                    label_id: None,
                    pay_method: None,
                    perpetual: None,
                    kind: v.kind,
                    provider: v.provider,
                    purchase_date: v.purchase_days_ago.map(|d| before(now, d)),
                    price_cents: plan_id.is_none().then_some(v.price_cents).flatten(),
                    expires: v.expires_in_days.map(|d| {
                        day(now
                            .checked_add_days(Days::new(d))
                            .expect("bounded sample date"))
                    }),
                    plan_id,
                    url: String::new(),
                    notes: "虚构样例；有效期与费用按规则推算。".into(),
                    stopped_on: v.stopped_days_ago.map(|d| before(now, d)),
                },
            },
            &date,
        )?;
    }
    crate::storage::atomic_write(&complete, b"1")?;
    Ok(())
}

/// Planning samples (monthly income, pension profile, saving phases, a car plan)
/// carry their own marker so older sample libraries gain them on upgrade.
pub(crate) fn import_plan(s: &mut Store, today: &str) -> Result<()> {
    let complete = s.root.join("unified-demo-plan-v1.complete");
    if complete.exists() {
        return Ok(());
    }
    let anchor = s.root.join("unified-demo-plan-v1.date");
    let date = if anchor.exists() {
        std::fs::read_to_string(&anchor)?
    } else {
        crate::storage::atomic_write(&anchor, today.as_bytes())?;
        today.to_owned()
    };
    let now = crate::domain::date(&date)?;
    let generation = s.generation();
    for m in 0..6u32 {
        s.plan_income_save(
            &crate::plan_income::Save {
                request_id: rid(&format!("plan-income-{m}")),
                generation: generation.clone(),
                id: None,
                expected_revision: None,
                fields: crate::plan_income::Fields {
                    date: day(now
                        .checked_sub_months(Months::new(m))
                        .expect("bounded sample date")),
                    net_cents: "2000000".into(),
                    hpf_cents: Some("180000".into()),
                    notes: if m == 3 { "含虚构年终奖" } else { "" }.into(),
                },
            },
            &date,
        )?;
    }
    let profile: crate::plan_profile::Profile = serde_json::from_value(serde_json::json!({
        "birth_month": "1990-06", "worker": "male", "region": "beijing",
        "paid_months": 48, "account_balance_cents": "5000000", "base_cents": "2000000",
        "past_index_hundredths": null, "flex_months": 0,
        "personal_pension_annual_cents": "1200000", "marginal_tax_hundredths": 1000,
        "assumptions": { "inflation_hundredths": 200, "wage_growth_hundredths": 200, "pp_return_hundredths": 200 },
        "retire": {
            "spend_cents": "500000", "real_return_before_hundredths": 300, "real_return_after_hundredths": 200,
            "spend_items": [
                { "id": "demo-health", "label": "医疗", "monthly_cents": "100000", "start_age": 65, "end_age": null, "inflation_hundredths": 400, "essential": true },
                { "id": "demo-travel", "label": "旅行", "monthly_cents": "150000", "start_age": null, "end_age": 75, "inflation_hundredths": null, "essential": false }
            ],
            "income_items": [
                { "id": "demo-annuity", "label": "企业年金", "monthly_cents": "120000", "start_age": 60, "end_age": null, "indexed": false }
            ],
            "life_events": [
                { "id": "demo-car", "label": "换车", "kind": "car", "date": day(now.checked_add_months(Months::new(18)).expect("bounded sample date"))[..7], "included": true,
                  "price_cents": "20000000", "down_cents": "6000000", "extra_cents": "1000000",
                  "loan_rate_hundredths": 350, "loan_years": 3, "holding_cents": "100000",
                  "rent_saved_cents": "0", "cycle_years": 8, "until_age": 70, "resale_cents": "3000000" }
            ]
        }
    }))?;
    let base = &profile.retire;
    let section = serde_json::from_value(serde_json::json!({
        "section":"setup","fields":{
            "basic": {"birth_month":profile.birth_month,"spend_cents":"750000","target_age":60,"horizon_age":90,"mode":"traditional",
                "real_return_before_hundredths":300,"real_return_after_hundredths":200,"volatility_hundredths":500,"emergency_months":6,"inflation_hundredths":200,"monetary_basis_date":date,
                "basic":{"contract_version":1,"start":{"kind":"live"},"contribution":{"id":"demo-contribution","monthly_cents":"800000"},"retirement_income":{"mode":"excluded","selected":[]},
                    "pension_contributions":{"start_month":null,"stop_month":null,"base_cents":null},"contribution_costs":[],"retirement_costs":[]}},
            "pension": {"birth_month":profile.birth_month,"worker":profile.worker,"region":profile.region,"paid_months":profile.paid_months,"account_balance_cents":profile.account_balance_cents,"base_cents":profile.base_cents,"past_index_hundredths":profile.past_index_hundredths,"flex_months":profile.flex_months,"personal_pension_annual_cents":profile.personal_pension_annual_cents,"marginal_tax_hundredths":profile.marginal_tax_hundredths,"wage_growth_hundredths":200,"pp_return_hundredths":200,"overrides":profile.overrides},
            "budget": null,"funds":null
        }
    }))?;
    let saved = s.plan_profile_update(
        &crate::plan_basic::Update {
            request_id: rid("plan-profile"),
            generation: generation.clone(),
            expected_revision: None,
            section,
        },
        &date,
    )?;
    s.plan_profile_update(
        &crate::plan_basic::Update {
            request_id: rid("plan-events"),
            generation,
            expected_revision: Some(saved.revision),
            section: crate::plan_basic::Section::Events(crate::plan_basic::EventsFields {
                life_events: base.life_events.clone(),
                occurrences: vec![],
                legacy_costs: None,
            }),
        },
        &date,
    )?;
    crate::storage::atomic_write(&complete, b"1")?;
    Ok(())
}
