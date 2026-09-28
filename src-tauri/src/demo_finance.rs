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
struct Fixtures {
    accounts: Vec<Account>,
    snapshots: Vec<Snapshot>,
    expenses: Vec<Expense>,
    plans: Vec<Plan>,
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
