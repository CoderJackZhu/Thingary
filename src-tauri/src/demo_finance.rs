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
    purchase_cents: Option<String>,
    purchased_on: Option<String>,
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
    // V1 requests are permanent: finish the original five-account payload first.
    import_data(s, today, legacy_data()?)?;
    import_fixed_assets(s, today)
}

/// Keep the original v1 request payloads stable when the shared demo expands.
fn legacy_data() -> Result<Fixtures> {
    let mut data: Fixtures = serde_json::from_str(include_str!("../../src/demo-finance.json"))?;
    let keys = ["cash", "broker", "fund", "card", "loan"];
    let indices: Vec<_> = data
        .accounts
        .iter()
        .enumerate()
        .filter_map(|(i, a)| keys.contains(&a.key.as_str()).then_some(i))
        .collect();
    for snapshot in &mut data.snapshots {
        snapshot.amounts_yuan = indices.iter().map(|i| snapshot.amounts_yuan[*i]).collect();
    }
    data.accounts.retain(|a| keys.contains(&a.key.as_str()));
    Ok(data)
}

/// Historical migration fixtures use the original five-account sample only.
#[cfg(test)]
pub(crate) fn import_legacy_fixture(s: &mut Store, today: &str) -> Result<()> {
    import_data(s, today, legacy_data()?)
}

/// Fixed assets use independent receipts and a marker. Existing check-in rows
/// are copied from the Store, so an edited sample is never reset to JSON values.
fn import_fixed_assets(s: &mut Store, today: &str) -> Result<()> {
    let complete = s.root.join("unified-demo-fixed-assets-v1.complete");
    if complete.exists() {
        return Ok(());
    }
    let date = std::fs::read_to_string(s.root.join("unified-demo-v1.date"))?;
    let now = crate::domain::date(&date)?;
    let data: Fixtures = serde_json::from_str(include_str!("../../src/demo-finance.json"))?;
    let generation = s.generation();
    let opened = day(now
        .checked_sub_months(Months::new(6))
        .expect("bounded sample date"));
    let mut added = Vec::new();
    for (index, a) in data
        .accounts
        .into_iter()
        .enumerate()
        .filter(|(_, a)| matches!(a.kind.as_str(), "property" | "vehicle"))
    {
        let record = s.wealth_account_save(
            &wealth::AccountSave {
                request_id: rid(&format!("fixed-assets-v1-account-{}", a.key)),
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
                    purchase_cents: a.purchase_cents,
                    purchased_on: a.purchased_on,
                    group_id: None,
                    notes: "虚构样例；房贷单独展示，不计入金融净资产。".into(),
                    currency: crate::currency::cny(),
                    holding_mode: false,
                    holding_unit: None,
                },
            },
            today,
        )?;
        added.push((index, record.id));
    }
    for fixture in data.snapshots {
        let request_id = rid(&format!("fixed-assets-v1-snapshot-{}", fixture.months_ago));
        if s.wealth_request_result(&request_id, &generation)?.is_some() {
            continue;
        }
        let Some(id) = s.wealth_request_result(
            &rid(&format!("snapshot-{}", fixture.months_ago)),
            &generation,
        )?
        else {
            continue;
        };
        let Some(old) = s.wealth_snapshot(&id)? else {
            continue;
        };
        let mut entries: Vec<_> = old
            .entries
            .into_iter()
            .map(|e| wealth::EntryInput {
                account_id: e.account_id,
                amount_cents: if e.state == "unchanged" {
                    None
                } else {
                    e.amount_cents
                },
                state: e.state,
                original_minor: e.original_minor,
                fx_rate_micro: e.fx_rate_micro,
                quantity_e8: e.quantity_e8,
                unit_price_e6: e.unit_price_e6,
            })
            .collect();
        for (index, account_id) in &added {
            if entries.iter().any(|e| &e.account_id == account_id) {
                continue;
            }
            let amount = fixture.amounts_yuan[*index];
            entries.push(wealth::EntryInput {
                account_id: account_id.clone(),
                state: if amount.is_some() {
                    "entered"
                } else {
                    "missing"
                }
                .into(),
                amount_cents: amount.map(|v| (v * 100).to_string()),
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            });
        }
        // Accounts added while the sample was edited can be due but absent
        // from old rows. Preserve that unknown amount rather than filling zero.
        for account_id in old.missing {
            if !entries.iter().any(|e| e.account_id == account_id) {
                entries.push(wealth::EntryInput {
                    account_id,
                    state: "missing".into(),
                    amount_cents: None,
                    original_minor: None,
                    fx_rate_micro: None,
                    quantity_e8: None,
                    unit_price_e6: None,
                });
            }
        }
        s.wealth_snapshot_save(
            &wealth::SnapshotSave {
                request_id,
                generation: generation.clone(),
                id: Some(id),
                expected_revision: Some(old.revision),
                date: old.date,
                notes: old.notes,
                entries,
            },
            today,
        )?;
    }
    crate::storage::atomic_write(&complete, b"1")?;
    Ok(())
}

fn import_data(s: &mut Store, today: &str, data: Fixtures) -> Result<()> {
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
                    purchase_cents: a.purchase_cents,
                    purchased_on: a.purchased_on,
                    group_id: None,
                    notes: "虚构样例；房贷单独展示，不计入金融净资产。".into(),
                    currency: crate::currency::cny(),
                    holding_mode: false,
                    holding_unit: None,
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
                        original_minor: None,
                        fx_rate_micro: None,
                        quantity_e8: None,
                        unit_price_e6: None,
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
                    category: "unclassified".into(),
                    source_account_id: None,
                    destination: None,
                    receiving_account_id: None,
                },
            },
            &date,
        )?;
    }
    let mut profile = crate::plan_basic::empty_profile();
    profile.retire.life_events = serde_json::from_value(serde_json::json!([
      {"id":"demo-car","label":"换车","kind":"car","date":day(now.checked_add_months(Months::new(18)).expect("bounded sample date"))[..7],"included":true,"price_cents":"20000000","down_cents":"6000000","extra_cents":"1000000","loan_rate_hundredths":350,"loan_years":3,"holding_cents":"100000","rent_saved_cents":"0","cycle_years":8,"until_month":null,"time_unconfirmed":false,"resale_cents":"3000000"}
    ]))?;
    let sources = s.planning_sources(true, true, &date)?;
    let snapshot = match sources.snapshot {
        crate::review::Read::Ready(Some(snapshot)) => snapshot,
        _ => {
            return Err(crate::domain::Error::new(
                "DEMO_INVALID",
                "样例资金盘点缺失",
            ))
        }
    };
    let fund_rules: Vec<_> = snapshot.entries.iter().filter(|e| e.counted && e.side == "asset").map(|e| {
        serde_json::json!({"account_id":e.account_id,"availability":if e.kind == "cash" {"available"} else {"restricted"},"share_hundredths":10000})
    }).collect();
    let base = &profile.retire;
    let section = serde_json::from_value(serde_json::json!({
      "section":"setup","fields":{
       "basic":{"spend_cents":"750000","mode":"traditional","real_return_before_hundredths":300,"real_return_after_hundredths":200,"volatility_hundredths":500,"emergency_months":6,"inflation_hundredths":200,"monetary_basis_date":date,
        "basic":{"contract_version":1,"start":{"kind":"live"},"contribution":{"id":"demo-contribution","monthly_cents":"800000"},"contribution_costs":[],"retirement_costs":[]}},
       "simplified":{"contract_version":1,"time":{"reference":null,"target_month":day(now.checked_add_months(Months::new(240)).expect("bounded sample date"))[..7],"horizon_month":day(now.checked_add_months(Months::new(600)).expect("bounded sample date"))[..7]},"income_mode":"excluded","future_incomes":[]},
       "budget":null,"funds":{"monetary_basis_date":date,"fund_rules":fund_rules,"releases":[]}
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
            }),
        },
        &date,
    )?;
    crate::storage::atomic_write(&complete, b"1")?;
    Ok(())
}

#[cfg(test)]
mod nonblocking_tests {
    use super::*;
    use serde_json::{json, Value};

    fn event_update(
        store: &Store,
        saved: &crate::plan_profile::Saved,
        occurrences: Value,
    ) -> crate::plan_basic::Update {
        serde_json::from_value(json!({
            "request_id": uuid::Uuid::new_v4().to_string(), "generation": store.generation(),
            "expected_revision": saved.revision, "section": "events",
            "fields": {"life_events": saved.profile.retire.life_events, "occurrences": occurrences}
        }))
        .unwrap()
    }
    fn blank_row() -> Value {
        json!({"id":"10000000-0000-4000-8000-000000000001", "event_id":"demo-car", "status":"occurred", "actual_date":"2026-10-10",
            "payments_complete":false, "payments":[{"id":"10000000-0000-4000-8000-000000000002", "date":"2026-10-10", "amount_cents":null,
            "account_id":null, "absorbed_snapshot_id":null, "absorbed_revision":null, "source_kind":null, "source_id":null}], "loan":null})
    }
    #[test]
    fn blank_occurrence_retracts_with_data_preservation_and_idempotent_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        import(&mut store, "2026-10-10").unwrap();
        import_plan(&mut store, "2026-10-10").unwrap();
        let before = store.plan_profile().unwrap().saved.unwrap();
        let recorded = store
            .plan_profile_update(
                &event_update(&store, &before, json!([blank_row()])),
                "2026-10-10",
            )
            .unwrap();
        let update = event_update(&store, &recorded, json!([]));
        let retracted = store.plan_profile_update(&update, "2026-10-10").unwrap();
        assert_eq!(
            serde_json::to_value(&retracted.profile).unwrap(),
            serde_json::to_value(&before.profile).unwrap()
        );
        let replay = store.plan_profile_update(&update, "2026-10-10").unwrap();
        assert_eq!(
            serde_json::to_value(&replay).unwrap(),
            serde_json::to_value(&retracted).unwrap()
        );
        assert!(replay.profile.retire.core.unwrap().occurrences.is_empty());
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(
            store.plan_profile().unwrap().saved.unwrap().revision,
            retracted.revision
        );
    }
    #[test]
    fn factual_occurrence_cannot_be_removed_even_when_new_draft_clears_facts() {
        for fact in ["amount", "account", "absorption", "loan"] {
            let dir = tempfile::tempdir().unwrap();
            let mut store = Store::open(dir.path()).unwrap();
            import(&mut store, "2026-10-10").unwrap();
            import_plan(&mut store, "2026-10-10").unwrap();
            let sources =
                serde_json::to_value(store.planning_sources(true, true, "2026-10-10").unwrap())
                    .unwrap();
            let entries = sources["snapshot"]["value"]["entries"].as_array().unwrap();
            let cash = entries.iter().find(|e| e["kind"] == "cash").unwrap()["account_id"].clone();
            let debt = entries
                .iter()
                .find(|e| e["side"] == "liability" && e["counted"] == true)
                .unwrap()["account_id"]
                .clone();
            let mut row = blank_row();
            match fact {
                "amount" => row["payments"][0]["amount_cents"] = json!("0"),
                "account" => row["payments"][0]["account_id"] = cash.clone(),
                "absorption" => {
                    row["payments"][0]["account_id"] = cash;
                    row["payments"][0]["absorbed_snapshot_id"] =
                        sources["snapshot"]["value"]["id"].clone();
                    row["payments"][0]["absorbed_revision"] =
                        sources["snapshot"]["value"]["revision"].clone();
                }
                "loan" => {
                    row["loan"] = json!({"account_id":debt,"as_of":"2026-10-10","principal_cents":"500000","remaining_months":10})
                }
                _ => unreachable!(),
            }
            let before = store.plan_profile().unwrap().saved.unwrap();
            let saved = store
                .plan_profile_update(&event_update(&store, &before, json!([row])), "2026-10-10")
                .unwrap();
            let error = store
                .plan_profile_update(&event_update(&store, &saved, json!([])), "2026-10-10")
                .unwrap_err();
            assert_eq!(error.code, "PLANNING_OCCURRENCE", "{fact}");
            assert_eq!(
                serde_json::to_value(store.plan_profile().unwrap().saved.unwrap()).unwrap(),
                serde_json::to_value(saved).unwrap()
            );
        }
    }

    /// Generate the checked-in TS regression input with the same domain imports as the app.
    /// Identity/timestamps are canonicalized only in the export, never in the temporary Store.
    #[test]
    fn nonblocking_fixture_matches_real_demo_import() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path()).unwrap();
        let date = "2026-10-10";
        import(&mut store, date).unwrap();
        import_plan(&mut store, date).unwrap();
        let mut value =
            serde_json::to_value(store.planning_sources(true, true, date).unwrap()).unwrap();
        let mut ids = std::collections::BTreeMap::new();
        let accounts = value["accounts"]["value"].as_array().unwrap();
        let mut sorted = accounts.iter().collect::<Vec<_>>();
        sorted.sort_by_key(|a| a["fields"]["name"].as_str().unwrap());
        for (i, a) in sorted.iter().enumerate() {
            ids.insert(
                a["id"].as_str().unwrap().to_owned(),
                format!("00000000-0000-4000-8000-{:012}", i + 1),
            );
        }
        ids.insert(
            value["generation"].as_str().unwrap().to_owned(),
            "fictional-nonblocking".into(),
        );
        ids.insert(
            value["snapshot"]["value"]["id"]
                .as_str()
                .unwrap()
                .to_owned(),
            "00000000-0000-4000-8000-000000000100".into(),
        );
        for (i, a) in value["incomes"]["value"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            ids.insert(
                a["id"].as_str().unwrap().to_owned(),
                format!("00000000-0000-4000-8000-{:012}", i + 200),
            );
        }
        fn canonical(v: &mut Value, ids: &std::collections::BTreeMap<String, String>) {
            match v {
                Value::String(s) => {
                    if let Some(id) = ids.get(s) {
                        *s = id.clone();
                    }
                }
                Value::Array(a) => {
                    for v in a {
                        canonical(v, ids);
                    }
                }
                Value::Object(o) => {
                    for v in o.values_mut() {
                        canonical(v, ids);
                    }
                }
                _ => {}
            }
        }
        // Historical review is unrelated to the capability calculation and contains other snapshot IDs.
        value["review"] = json!({"status":"error","value":{"code":"UNAVAILABLE","message":"历史复盘不作为未来投入"}});
        canonical(&mut value, &ids);
        value["write_version"] = json!(1);
        value["profile"]["value"]["saved"]["updated_at"] = json!("2026-10-10T00:00:00Z");
        assert_eq!(
            value["profile"]["value"]["saved"]["profile"]["retire"]["life_events"][0]["date"],
            "2028-04"
        );
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/planning-basic/nonblocking-demo.json");
        if std::env::var("THINGARY_EXPORT_NONBLOCKING_FIXTURE").as_deref() == Ok("1") {
            std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap() + "\n").unwrap();
        }
        let expected: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            value, expected,
            "fixture must come from real demo_finance::import_plan"
        );
    }
}

#[cfg(test)]
mod fixed_asset_import_tests {
    use super::*;
    use crate::domain::Error;

    const TODAY: &str = "2026-10-10";
    fn fail_after_snapshot_commit(point: &str) -> Result<()> {
        if point == "wealth_snapshot.after_commit" {
            Err(Error::new("INJECTED", "虚构提交后中断"))
        } else {
            Ok(())
        }
    }

    #[test]
    fn interrupted_five_account_v1_resumes_before_fixed_asset_extension() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        s.set_hook(fail_after_snapshot_commit);
        assert_eq!(
            import_legacy_fixture(&mut s, TODAY).unwrap_err().code,
            "INJECTED"
        );
        assert!(dir.path().join("unified-demo-v1.date").exists());
        assert!(!dir.path().join("unified-demo-v1.complete").exists());
        assert_eq!(s.wealth_accounts().unwrap().len(), 5);
        let request_id = rid("snapshot-5");
        let first_id = s
            .wealth_request_result(&request_id, &s.generation())
            .unwrap()
            .unwrap();
        let first = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(first.entries.len(), 5);
        assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
        drop(s);

        let mut s = Store::open(dir.path()).unwrap();
        import(&mut s, "2026-10-11").unwrap();
        assert_eq!(
            s.wealth_request_result(&request_id, &s.generation())
                .unwrap()
                .as_deref(),
            Some(first_id.as_str())
        );
        assert_eq!(s.wealth_accounts().unwrap().len(), 7);
        assert_eq!(s.wealth_summary().unwrap().points.len(), 6);
        let upgraded = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(upgraded.date, first.date);
        assert_eq!(upgraded.notes, first.notes);
        assert_eq!(upgraded.entries.len(), 7);
        for old in first.entries {
            let new = upgraded
                .entries
                .iter()
                .find(|e| e.account_id == old.account_id)
                .unwrap();
            assert_eq!(
                serde_json::to_value(new).unwrap(),
                serde_json::to_value(old).unwrap()
            );
        }
        assert!(dir.path().join("unified-demo-v1.complete").exists());
        assert!(dir
            .path()
            .join("unified-demo-fixed-assets-v1.complete")
            .exists());
    }

    #[test]
    fn fixed_asset_extension_preserves_unchanged_after_an_earlier_correction() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        crate::demo::prepare_legacy_fixture(&mut s, TODAY).unwrap();
        let first_id = s
            .wealth_request_result(&rid("snapshot-5"), &s.generation())
            .unwrap()
            .unwrap();
        let second_id = s
            .wealth_request_result(&rid("snapshot-4"), &s.generation())
            .unwrap()
            .unwrap();
        let second = s.wealth_snapshot(&second_id).unwrap().unwrap();
        let account_id = second.entries[0].account_id.clone();
        let mut entries: Vec<_> = second
            .entries
            .into_iter()
            .map(|e| wealth::EntryInput {
                account_id: e.account_id,
                state: e.state,
                amount_cents: e.amount_cents,
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            })
            .collect();
        entries[0].state = "unchanged".into();
        entries[0].amount_cents = None;
        s.wealth_snapshot_save(
            &wealth::SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: Some(second_id.clone()),
                expected_revision: Some(second.revision),
                date: second.date,
                notes: "虚构已确认未变".into(),
                entries,
            },
            TODAY,
        )
        .unwrap();
        let preserved = s.wealth_snapshot(&second_id).unwrap().unwrap().entries[0]
            .amount_cents
            .clone();
        let first = s.wealth_snapshot(&first_id).unwrap().unwrap();
        let mut entries: Vec<_> = first
            .entries
            .into_iter()
            .map(|e| wealth::EntryInput {
                account_id: e.account_id,
                state: e.state,
                amount_cents: e.amount_cents,
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            })
            .collect();
        entries[0].amount_cents = Some("8100000".into());
        assert_ne!(entries[0].amount_cents, preserved);
        s.wealth_snapshot_save(
            &wealth::SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: Some(first_id),
                expected_revision: Some(first.revision),
                date: first.date,
                notes: "虚构更正前期估值".into(),
                entries,
            },
            TODAY,
        )
        .unwrap();
        crate::demo::prepare(&mut s, TODAY).unwrap();
        let second = s.wealth_snapshot(&second_id).unwrap().unwrap();
        let old = second
            .entries
            .iter()
            .find(|e| e.account_id == account_id)
            .unwrap();
        assert_eq!(old.state, "unchanged");
        assert_eq!(old.amount_cents, preserved);
        assert_eq!(second.entries.len(), 7);
    }

    #[test]
    fn fixed_asset_extension_keeps_a_new_accounts_missing_historical_amounts_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        crate::demo::prepare_legacy_fixture(&mut s, TODAY).unwrap();
        let extra = s
            .wealth_account_save(
                &wealth::AccountSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    id: None,
                    expected_revision: None,
                    fields: wealth::AccountFields {
                        name: "虚构后来添加的现金账户".into(),
                        institution: String::new(),
                        side: "asset".into(),
                        kind: "cash".into(),
                        counted: true,
                        opened_on: "2020-01-01".into(),
                        closed_on: None,
                        notes: "虚构历史金额仍未知".into(),
                        purchase_cents: None,
                        purchased_on: None,
                        group_id: None,
                        currency: crate::currency::cny(),
                        holding_mode: false,
                        holding_unit: None,
                    },
                },
                TODAY,
            )
            .unwrap();
        let first_id = s
            .wealth_request_result(&rid("snapshot-5"), &s.generation())
            .unwrap()
            .unwrap();
        let first = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(first.entries.len(), 5);
        assert!(first.missing.contains(&extra.id));
        crate::demo::prepare(&mut s, TODAY).unwrap();
        let upgraded = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(upgraded.entries.len(), 8);
        let unknown = upgraded
            .entries
            .iter()
            .find(|e| e.account_id == extra.id)
            .unwrap();
        assert_eq!(unknown.state, "missing");
        assert_eq!(unknown.amount_cents, None);
        assert!(upgraded.missing.contains(&extra.id));
        for old in first.entries {
            let kept = upgraded
                .entries
                .iter()
                .find(|e| e.account_id == old.account_id)
                .unwrap();
            assert_eq!(
                serde_json::to_value(kept).unwrap(),
                serde_json::to_value(old).unwrap()
            );
        }
        assert!(dir
            .path()
            .join("unified-demo-fixed-assets-v1.complete")
            .exists());
    }

    #[test]
    fn fixed_asset_extension_replays_its_own_receipt_and_preserves_sample_edits() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        crate::demo::prepare_legacy_fixture(&mut s, TODAY).unwrap();
        let first_id = s
            .wealth_request_result(&rid("snapshot-5"), &s.generation())
            .unwrap()
            .unwrap();
        let first = s.wealth_snapshot(&first_id).unwrap().unwrap();
        let mut entries: Vec<_> = first
            .entries
            .into_iter()
            .map(|e| wealth::EntryInput {
                account_id: e.account_id,
                state: e.state,
                amount_cents: e.amount_cents,
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            })
            .collect();
        let edited_id = entries[0].account_id.clone();
        entries[0].amount_cents = Some("999999".into());
        s.wealth_snapshot_save(
            &wealth::SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: Some(first_id.clone()),
                expected_revision: Some(first.revision),
                date: first.date,
                notes: "虚构手动更正，不得覆盖".into(),
                entries,
            },
            TODAY,
        )
        .unwrap();
        s.set_hook(fail_after_snapshot_commit);
        assert_eq!(
            crate::demo::prepare(&mut s, TODAY).unwrap_err().code,
            "INJECTED"
        );
        let committed = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(committed.entries.len(), 7);
        assert!(!dir
            .path()
            .join("unified-demo-fixed-assets-v1.complete")
            .exists());
        drop(s);

        let mut s = Store::open(dir.path()).unwrap();
        crate::demo::prepare(&mut s, "2026-10-11").unwrap();
        let replay = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(replay).unwrap(),
            serde_json::to_value(committed).unwrap()
        );
        let first = s.wealth_snapshot(&first_id).unwrap().unwrap();
        assert_eq!(first.notes, "虚构手动更正，不得覆盖");
        assert_eq!(
            first
                .entries
                .iter()
                .find(|e| e.account_id == edited_id)
                .unwrap()
                .amount_cents
                .as_deref(),
            Some("999999")
        );
        assert_eq!(s.wealth_accounts().unwrap().len(), 7);
        assert!(dir
            .path()
            .join("unified-demo-fixed-assets-v1.complete")
            .exists());
    }
    #[test]
    fn fixed_asset_extension_preserves_user_added_foreign_sample_fact() {
        use serde_json::json;
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        crate::demo::prepare_legacy_fixture(&mut s, TODAY).unwrap();
        let account:wealth::AccountSave=serde_json::from_value(json!({"request_id":uuid::Uuid::new_v4().to_string(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"name":"虚构样例外币","institution":"","side":"asset","kind":"cash","counted":true,"currency":"USD","opened_on":"2020-01-01","closed_on":null,"notes":""}})).unwrap();
        let account = s.wealth_account_save(&account, TODAY).unwrap();
        let id = s
            .wealth_request_result(&rid("snapshot-5"), &s.generation())
            .unwrap()
            .unwrap();
        let old = s.wealth_snapshot(&id).unwrap().unwrap();
        let mut value = serde_json::to_value(&old).unwrap();
        value["request_id"] = json!(uuid::Uuid::new_v4().to_string());
        value["generation"] = json!(s.generation());
        value["expected_revision"] = json!(old.revision);
        value["entries"].as_array_mut().unwrap().push(json!({"account_id":account.id,"state":"entered","amount_cents":"879433","original_minor":"123456","fx_rate_micro":"7123456"}));
        let input: wealth::SnapshotSave = serde_json::from_value(value).unwrap();
        s.wealth_snapshot_save(&input, TODAY).unwrap();
        crate::demo::prepare(&mut s, TODAY).unwrap();
        let upgraded = s.wealth_snapshot(&id).unwrap().unwrap();
        let foreign = upgraded
            .entries
            .iter()
            .find(|e| e.account_id == account.id)
            .unwrap();
        assert_eq!(foreign.amount_cents.as_deref(), Some("879433"));
        assert_eq!(foreign.original_minor.as_deref(), Some("123456"));
        assert_eq!(foreign.fx_rate_micro.as_deref(), Some("7123456"));
        assert_eq!(upgraded.entries.len(), 8);
    }
    #[test]
    fn fixed_asset_extension_preserves_holding_fact_after_input_mode_is_disabled() {
        use serde_json::json;
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        crate::demo::prepare_legacy_fixture(&mut s, TODAY).unwrap();
        let account:wealth::AccountSave=serde_json::from_value(json!({"request_id":uuid::Uuid::new_v4().to_string(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"name":"虚构样例持仓","institution":"","side":"asset","kind":"fund","holding_mode":true,"holding_unit":"克","counted":true,"currency":"USD","opened_on":"2020-01-01","closed_on":null,"notes":""}})).unwrap();
        let account = s.wealth_account_save(&account, TODAY).unwrap();
        let id = s
            .wealth_request_result(&rid("snapshot-5"), &s.generation())
            .unwrap()
            .unwrap();
        let old = s.wealth_snapshot(&id).unwrap().unwrap();
        let mut value = serde_json::to_value(&old).unwrap();
        value["request_id"] = json!(uuid::Uuid::new_v4().to_string());
        value["generation"] = json!(s.generation());
        value["expected_revision"] = json!(old.revision);
        value["entries"].as_array_mut().unwrap().push(json!({"account_id":account.id,"state":"entered","amount_cents":"879433","original_minor":"123456","fx_rate_micro":"7123456","quantity_e8":"123456000000","unit_price_e6":"1000000"}));
        let input: wealth::SnapshotSave = serde_json::from_value(value).unwrap();
        s.wealth_snapshot_save(&input, TODAY).unwrap();
        let mut fields = account.fields.clone();
        fields.holding_mode = false;
        fields.holding_unit = None;
        s.wealth_account_save(
            &wealth::AccountSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: Some(account.id.clone()),
                expected_revision: Some(account.revision),
                fields,
            },
            TODAY,
        )
        .unwrap();
        crate::demo::prepare(&mut s, TODAY).unwrap();
        let upgraded = s.wealth_snapshot(&id).unwrap().unwrap();
        let foreign = upgraded
            .entries
            .iter()
            .find(|e| e.account_id == account.id)
            .unwrap();
        assert_eq!(foreign.amount_cents.as_deref(), Some("879433"));
        assert_eq!(foreign.original_minor.as_deref(), Some("123456"));
        assert_eq!(foreign.fx_rate_micro.as_deref(), Some("7123456"));
        assert_eq!(foreign.quantity_e8.as_deref(), Some("123456000000"));
        assert_eq!(foreign.unit_price_e6.as_deref(), Some("1000000"));
        assert_eq!(upgraded.entries.len(), 8);
    }
}
