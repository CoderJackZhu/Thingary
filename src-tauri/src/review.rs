//! One read transaction, one worker job, and the existing domain calculations.
use crate::{
    domain::{Error, Result},
    storage::Store,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "status", content = "value", rename_all = "snake_case")]
pub enum Read<T> {
    Ready(T),
    Error(Error),
}
impl<T> From<Result<T>> for Read<T> {
    fn from(value: Result<T>) -> Self {
        match value {
            Ok(v) => Self::Ready(v),
            Err(e) => Self::Error(e),
        }
    }
}
#[derive(Debug, Serialize)]
pub struct Overview {
    pub generation: String,
    pub today: String,
    pub year: Option<i32>,
    pub physical: Read<crate::insights::Overview>,
    pub wealth: Read<crate::wealth::Summary>,
    pub account_availability: Read<AccountAvailability>,
    pub expenses: Read<crate::expenses::View>,
    pub recurring: Read<crate::recurring::Overview>,
    pub virtual_assets: Read<crate::virtual_assets::Overview>,
    pub recent: Read<Vec<crate::timeline::Event>>,
    pub planning: Option<PlanSources>,
}

/// Live accounts and the subset eligible for a check-in on the overview's day.
/// This is independent of whether any balance snapshot has been recorded.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AccountAvailability {
    pub total: usize,
    pub due_today: usize,
}

/// All sources share the overview's SQLite snapshot and worker/library identity.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSources {
    pub review: Read<crate::plan_savings::Review>,
    pub incomes: Read<Vec<crate::plan_income::Income>>,
    pub profile: Read<crate::plan_profile::State>,
    pub snapshot: Read<Option<crate::wealth::Snapshot>>,
    pub snapshot_id: Option<String>,
    pub snapshot_date: Option<String>,
    pub generation: String,
    pub write_version: u64,
    pub modules: PlanningModules,
}
impl Store {
    pub fn review_overview(&self, year: Option<i32>, today: &str) -> Result<Overview> {
        self.review_overview_with_planning(year, today, false)
    }

    pub fn review_overview_with_planning(
        &self,
        year: Option<i32>,
        today: &str,
        planning: bool,
    ) -> Result<Overview> {
        self.review_overview_with_modules(year, today, planning, true)
    }
    pub fn review_overview_with_modules(
        &self,
        year: Option<i32>,
        today: &str,
        planning: bool,
        wealth_enabled: bool,
    ) -> Result<Overview> {
        self.review_overview_with_runtime_modules(
            year,
            today,
            &legacy_modules(planning, wealth_enabled),
        )
    }

    /// Capabilities are sampled by the caller before opening this read transaction.
    pub fn review_overview_with_runtime_modules(
        &self,
        year: Option<i32>,
        today: &str,
        modules: &crate::modules::RuntimeModules,
    ) -> Result<Overview> {
        let planning = modules.modules.planning;
        let wealth_enabled = modules.modules.wealth;
        crate::domain::date(today)?;
        if year.is_some_and(|y| !(1..=9999).contains(&y)) {
            return Err(Error::new("QUERY", "年份无效"));
        }
        // All domain readers borrow this same connection. The transaction also
        // pins a SQLite snapshot against external connections, beyond worker serialization.
        let tx = self.conn()?.unchecked_transaction()?;
        let physical = if modules.modules.physical {
            self.overview("held", today).into()
        } else {
            disabled()
        };
        #[cfg(test)]
        self.hit("review.after_physical")?;
        let wealth: Read<crate::wealth::Summary> = if wealth_enabled {
            self.wealth_summary().into()
        } else {
            disabled()
        };
        let account_availability = if wealth_enabled {
            crate::wealth::accounts(self.conn()?)
                .map(|accounts| AccountAvailability {
                    total: accounts.len(),
                    due_today: accounts
                        .iter()
                        .filter(|account| crate::wealth::due(account, today))
                        .count(),
                })
                .into()
        } else {
            disabled()
        };
        #[cfg(test)]
        self.hit("review.after_wealth")?;
        let planning = planning.then(|| {
            let (snapshot_id, snapshot_date, snapshot) = match &wealth {
                Read::Ready(summary) => match summary.points.iter().rev().find(|p| p.complete) {
                    Some(point) => (
                        Some(point.snapshot_id.clone()),
                        Some(point.date.clone()),
                        self.wealth_snapshot(&point.snapshot_id).into(),
                    ),
                    None => (None, None, Read::Ready(None)),
                },
                Read::Error(e) => (None, None, Read::Error(Error::new(&e.code, &e.message))),
            };
            PlanSources {
                review: if wealth_enabled && modules.incomes {
                    self.plan_review_in_transaction().into()
                } else {
                    disabled()
                },
                incomes: if modules.incomes {
                    self.plan_income_list().map(|list| list.rows).into()
                } else {
                    disabled()
                },
                profile: self.plan_profile().into(),
                snapshot,
                snapshot_id,
                snapshot_date,
                generation: self.generation(),
                write_version: self.conn().map(|c| c.total_changes()).unwrap_or(0),
                modules: PlanningModules {
                    planning,
                    wealth: wealth_enabled,
                },
            }
        });
        let result = Overview {
            generation: self.generation(),
            today: today.into(),
            year,
            physical,
            wealth,
            account_availability,
            planning,
            expenses: self
                .expense_period_view(
                    &year.map_or(crate::expenses::Period::All, |year| {
                        crate::expenses::Period::Year { year }
                    }),
                    &modules.modules,
                )
                .into(),
            recurring: if modules.modules.recurring {
                self.recurring_overview(today).into()
            } else {
                disabled()
            },
            virtual_assets: if modules.modules.virtual_assets {
                self.virtual_overview(today).into()
            } else {
                disabled()
            },
            recent: if !modules.modules.timeline {
                disabled()
            } else {
                (if wealth_enabled {
                    self.timeline_with_snapshots(
                        &crate::timeline::Query {
                            filter: "all".into(),
                            asset_id: None,
                        },
                        today,
                    )
                } else {
                    self.timeline(
                        &crate::timeline::Query {
                            filter: "all".into(),
                            asset_id: None,
                        },
                        today,
                    )
                })
                .map(|p| {
                    p.dated
                        .into_iter()
                        .filter(|e| {
                            year.is_none_or(|y| {
                                e.date
                                    .as_ref()
                                    .is_some_and(|d| d.starts_with(&format!("{y:04}-")))
                            })
                        })
                        .take(8)
                        .collect()
                })
                .into()
            },
        };
        tx.commit()?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::to_value;
    const TODAY: &str = "2026-09-28";
    fn value<T>(r: Read<T>) -> T {
        match r {
            Read::Ready(v) => v,
            Read::Error(e) => panic!("{e}"),
        }
    }
    #[test]
    fn empty_and_invalid_inputs() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        let result = store.review_overview(Some(2026), TODAY).unwrap();
        assert_eq!(value(result.physical).held_known_cents, "0");
        assert!(value(result.wealth).points.is_empty());
        assert_eq!(value(result.expenses).net_cents, "0");
        assert!(store.review_overview(Some(0), TODAY).is_err());
        assert!(store.review_overview(None, "bad").is_err());
        assert!(store.conn().unwrap().is_autocommit());
    }
    #[test]
    fn unified_demo_matches_every_domain_and_year_without_writing() {
        let root = tempfile::tempdir().unwrap();
        // The sample is a sibling of the library; keep both inside this test's tempdir.
        let store = crate::demo::open(&root.path().join("library"), TODAY).unwrap();
        let changes = store.conn().unwrap().total_changes();
        for year in [None, Some(2025), Some(2026), Some(2000)] {
            let result = store.review_overview(year, TODAY).unwrap();
            assert_eq!(
                to_value(value(result.physical)).unwrap(),
                to_value(store.overview("held", TODAY).unwrap()).unwrap()
            );
            assert_eq!(
                to_value(value(result.wealth)).unwrap(),
                to_value(store.wealth_summary().unwrap()).unwrap()
            );
            assert_eq!(
                to_value(value(result.expenses)).unwrap(),
                to_value(store.expense_view(year).unwrap()).unwrap()
            );
            assert_eq!(
                to_value(value(result.recurring)).unwrap(),
                to_value(store.recurring_overview(TODAY).unwrap()).unwrap()
            );
            assert_eq!(
                to_value(value(result.virtual_assets)).unwrap(),
                to_value(store.virtual_overview(TODAY).unwrap()).unwrap()
            );
            assert!(value(result.recent).iter().all(|e| year.is_none_or(|y| e
                .date
                .as_ref()
                .unwrap()
                .starts_with(&y.to_string()))));
        }
        assert_eq!(store.conn().unwrap().total_changes(), changes);
    }
    #[test]
    fn domain_failure_is_not_zero_and_transaction_is_released() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        store
            .conn()
            .unwrap()
            .execute_batch("DROP TABLE fin_snapshots")
            .unwrap();
        let result = store.review_overview(None, TODAY).unwrap();
        assert!(matches!(result.wealth, Read::Error(_)));
        assert_eq!(value(result.physical).held_count, 0);
        assert_eq!(value(result.recurring).monthly_cents, "0");
        assert!(store.conn().unwrap().is_autocommit());
    }
    #[test]
    fn planning_is_optional_atomic_and_does_not_write() {
        let root = tempfile::tempdir().unwrap();
        let mut store = crate::demo::open(&root.path().join("library"), TODAY).unwrap();
        let changes = store.conn().unwrap().total_changes();
        let latest = store
            .wealth_summary()
            .unwrap()
            .points
            .into_iter()
            .rev()
            .find(|p| p.complete)
            .unwrap();
        let expected_snapshot =
            to_value(store.wealth_snapshot(&latest.snapshot_id).unwrap().unwrap()).unwrap();
        let expected_review = to_value(store.plan_review().unwrap()).unwrap();
        let expected_incomes = to_value(store.plan_income_list().unwrap().rows).unwrap();
        let expected_profile = to_value(store.plan_profile().unwrap()).unwrap();
        let path = store.dataset().join("data.sqlite");
        store.set_hook(move |point| {
            if point == "review.after_wealth" {
                let conn = rusqlite::Connection::open(&path)?;
                conn.execute_batch("UPDATE plan_income SET net_cents=1; DELETE FROM plan_profile; UPDATE fin_snapshot_entries SET amount_cents=1 WHERE amount_cents IS NOT NULL;")?;
            }
            Ok(())
        });
        let result = store
            .review_overview_with_planning(None, TODAY, true)
            .unwrap();
        let wealth = value(result.wealth);
        let sources = result.planning.unwrap();
        let latest = wealth.points.iter().rev().find(|p| p.complete).unwrap();
        assert_eq!(
            sources.snapshot_id.as_deref(),
            Some(latest.snapshot_id.as_str())
        );
        let snapshot = value(sources.snapshot).unwrap();
        assert_eq!(snapshot.id, latest.snapshot_id);
        assert_eq!(to_value(snapshot).unwrap(), expected_snapshot);
        assert_eq!(to_value(value(sources.review)).unwrap(), expected_review);
        assert_eq!(to_value(value(sources.incomes)).unwrap(), expected_incomes);
        assert_eq!(to_value(value(sources.profile)).unwrap(), expected_profile);
        assert_ne!(
            to_value(store.plan_income_list().unwrap().rows).unwrap(),
            expected_incomes
        );
        assert_eq!(store.conn().unwrap().total_changes(), changes);
        store.set_hook(|_| Ok(()));
        // Disabled means no planning reads, even when their tables cannot be read.
        store
            .conn()
            .unwrap()
            .execute_batch("DROP TABLE plan_profile; DROP TABLE plan_income")
            .unwrap();
        assert!(store
            .review_overview(None, TODAY)
            .unwrap()
            .planning
            .is_none());
        let partial = store
            .review_overview_with_planning(None, TODAY, true)
            .unwrap();
        let sources = partial.planning.unwrap();
        assert!(matches!(sources.profile, Read::Error(_)));
        assert!(matches!(sources.incomes, Read::Error(_)));
        assert!(matches!(sources.snapshot, Read::Ready(Some(_))));
        assert!(store.conn().unwrap().is_autocommit());
    }

    #[test]
    fn external_write_cannot_split_physical_and_expense_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path()).unwrap();
        // A single fictional purchase, updated between two domain reads by an
        // independent connection, deliberately stronger than queued app writes.
        store
            .save(
                &crate::domain::Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构电脑".into(),
                    price_cents: Some("1200000".into()),
                    purchase_date: Some(TODAY.into()),
                },
                TODAY,
            )
            .unwrap();
        let path = store.dataset().join("data.sqlite");
        store.set_hook(move |point| {
            if point == "review.after_physical" {
                let conn = rusqlite::Connection::open(&path)?;
                conn.execute("UPDATE assets SET price_cents=1150000", [])?;
            }
            Ok(())
        });
        let result = store.review_overview(Some(2026), TODAY).unwrap();
        assert_eq!(value(result.physical).held_known_cents, "1200000");
        assert_eq!(value(result.expenses).spent_cents, "1200000");
        store.set_hook(|_| Ok(()));
        let next = store.review_overview(Some(2026), TODAY).unwrap();
        assert_eq!(next.generation, result.generation);
        assert_eq!(value(next.expenses).spent_cents, "1150000");
    }
}

#[derive(Debug, Serialize)]
pub struct PlanningModules {
    pub planning: bool,
    pub wealth: bool,
}
#[derive(Debug, Serialize)]
pub struct PlanningSources {
    pub generation: String,
    pub write_version: u64,
    pub today: String,
    pub modules: PlanningModules,
    pub profile: Read<crate::plan_profile::State>,
    pub snapshot: Read<Option<crate::wealth::Snapshot>>,
    pub accounts: Read<Vec<crate::wealth::Account>>,
    pub review: Read<crate::plan_savings::Review>,
    pub incomes: Read<Vec<crate::plan_income::Income>>,
}
fn disabled<T>() -> Read<T> {
    Read::Error(Error::new("MODULE_DISABLED", "模块已关闭，本次未读取"))
}
impl Store {
    pub fn planning_sources(
        &self,
        planning_enabled: bool,
        wealth_enabled: bool,
        today: &str,
    ) -> Result<PlanningSources> {
        self.planning_sources_with_runtime_modules(
            &legacy_modules(planning_enabled, wealth_enabled),
            today,
        )
    }

    /// Uses the supplied capability snapshot and a single SQLite read transaction.
    pub fn planning_sources_with_runtime_modules(
        &self,
        modules: &crate::modules::RuntimeModules,
        today: &str,
    ) -> Result<PlanningSources> {
        crate::domain::date(today)?;
        let planning_enabled = modules.modules.planning;
        let wealth_enabled = modules.modules.wealth;
        let tx = self.conn()?.unchecked_transaction()?;
        let profile = if planning_enabled {
            self.plan_profile().into()
        } else {
            disabled()
        };
        let incomes = if modules.incomes {
            self.plan_income_list().map(|r| r.rows).into()
        } else {
            disabled()
        };
        let review = if modules.incomes && wealth_enabled {
            self.plan_review_in_transaction().into()
        } else {
            disabled()
        };
        let (snapshot, accounts) = if wealth_enabled {
            let snapshot = self
                .wealth_summary()
                .and_then(|s| match s.points.iter().rev().find(|p| p.complete) {
                    Some(p) => self.wealth_snapshot(&p.snapshot_id),
                    None => Ok(None),
                })
                .into();
            (snapshot, self.wealth_accounts().into())
        } else {
            (disabled(), disabled())
        };
        let result = PlanningSources {
            generation: self.generation(),
            write_version: self.conn()?.total_changes(),
            today: today.into(),
            modules: PlanningModules {
                planning: planning_enabled,
                wealth: wealth_enabled,
            },
            profile,
            snapshot,
            accounts,
            review,
            incomes,
        };
        tx.commit()?;
        Ok(result)
    }
}

/// Compatibility for direct legacy Store consumers; production Worker passes the
/// actual runtime snapshot and never reconstructs income capability from goals.
fn legacy_modules(planning: bool, wealth: bool) -> crate::modules::RuntimeModules {
    crate::modules::RuntimeModules {
        modules: crate::modules::Modules {
            planning,
            wealth,
            ..Default::default()
        },
        incomes: planning,
        movements: planning && wealth,
        finance_status: crate::modules::FinanceStatus::Ready,
        finance_revision: 0,
    }
}

#[cfg(test)]
mod account_availability_tests {
    use super::*;
    use crate::wealth::{AccountFields, AccountSave};

    const TODAY: &str = "2026-09-28";

    fn ready<T>(read: Read<T>) -> T {
        match read {
            Read::Ready(value) => value,
            Read::Error(error) => panic!("{error}"),
        }
    }

    fn account(store: &mut Store, opened: &str, closed: Option<&str>, counted: bool) -> String {
        store
            .wealth_account_save(
                &AccountSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    id: None,
                    expected_revision: None,
                    fields: AccountFields {
                        name: "虚构账户".into(),
                        institution: String::new(),
                        side: "asset".into(),
                        kind: "cash".into(),
                        counted,
                        opened_on: opened.into(),
                        closed_on: closed.map(str::to_string),
                        notes: String::new(),
                        purchase_cents: None,
                        purchased_on: None,
                        group_id: None,
                        currency: "CNY".into(),
                        holding_mode: false,
                        holding_unit: None,
                    },
                },
                // A later valid save date also exercises a clock moving back.
                "2026-12-31",
            )
            .unwrap()
            .id
    }

    #[test]
    fn availability_counts_live_accounts_without_snapshots_using_check_in_dates() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path()).unwrap();
        assert_eq!(
            ready(
                store
                    .review_overview(None, TODAY)
                    .unwrap()
                    .account_availability
            ),
            AccountAvailability {
                total: 0,
                due_today: 0
            }
        );
        account(&mut store, TODAY, None, true);
        account(&mut store, "2026-01-01", Some("2026-09-29"), false);
        account(&mut store, "2026-01-01", Some(TODAY), true);
        account(&mut store, "2026-09-29", None, true);
        let deleted = account(&mut store, "2026-01-01", None, true);
        store
            .conn()
            .unwrap()
            .execute(
                "UPDATE fin_accounts SET deleted_at='2026-09-28T12:00:00Z' WHERE id=?1",
                [&deleted],
            )
            .unwrap();
        let changes = store.conn().unwrap().total_changes();
        let result = store.review_overview(Some(2000), TODAY).unwrap();
        assert_eq!(result.generation, store.generation());
        assert_eq!(result.today, TODAY);
        assert!(ready(result.wealth).points.is_empty());
        assert_eq!(
            ready(result.account_availability),
            AccountAvailability {
                total: 4,
                due_today: 2
            }
        );
        assert_eq!(store.conn().unwrap().total_changes(), changes);
        assert!(store.conn().unwrap().is_autocommit());

        let before_opening = store.review_overview(None, "2025-12-31").unwrap();
        assert_eq!(
            ready(before_opening.account_availability),
            AccountAvailability {
                total: 4,
                due_today: 0
            }
        );
        let after_closure = store.review_overview(None, "2026-09-30").unwrap();
        assert_eq!(
            ready(after_closure.account_availability),
            AccountAvailability {
                total: 4,
                due_today: 2
            }
        );
    }

    #[test]
    fn availability_failure_stays_unknown_and_disabled_wealth_does_not_read_accounts() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        store
            .conn()
            .unwrap()
            .execute_batch("DROP TABLE fin_accounts")
            .unwrap();
        let failed = store.review_overview(None, TODAY).unwrap();
        assert!(matches!(failed.account_availability, Read::Error(_)));
        assert!(matches!(failed.physical, Read::Ready(_)));
        assert!(matches!(failed.recurring, Read::Ready(_)));
        let disabled = store
            .review_overview_with_modules(None, TODAY, false, false)
            .unwrap();
        assert!(
            matches!(disabled.account_availability, Read::Error(Error { code, .. }) if code == "MODULE_DISABLED")
        );
        assert!(store.conn().unwrap().is_autocommit());
    }

    #[test]
    fn availability_shares_the_overview_snapshot_and_does_not_write() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path()).unwrap();
        account(&mut store, "2026-01-01", None, true);
        let changes = store.conn().unwrap().total_changes();
        let path = store.dataset().join("data.sqlite");
        store.set_hook(move |point| {
            if point == "review.after_physical" {
                let external = rusqlite::Connection::open(&path)?;
                external.execute_batch("UPDATE fin_accounts SET closed_on='2026-09-28'")?;
            }
            Ok(())
        });
        let result = store.review_overview(None, TODAY).unwrap();
        assert_eq!(
            ready(result.account_availability),
            AccountAvailability {
                total: 1,
                due_today: 1
            }
        );
        assert_eq!(store.conn().unwrap().total_changes(), changes);
        store.set_hook(|_| Ok(()));
        let next = store.review_overview(None, TODAY).unwrap();
        assert_eq!(next.generation, result.generation);
        assert_eq!(
            ready(next.account_availability),
            AccountAvailability {
                total: 1,
                due_today: 0
            }
        );
    }
}

#[cfg(test)]
mod asset_review_tests {
    use super::*;
    const TODAY: &str = "2026-09-28";

    fn ready<T>(value: Read<T>) -> T {
        match value {
            Read::Ready(v) => v,
            Read::Error(e) => panic!("{e}"),
        }
    }
    fn is_disabled<T>(value: &Read<T>) -> bool {
        matches!(value, Read::Error(e) if e.code == "MODULE_DISABLED")
    }

    #[test]
    fn asset_review_ignores_broken_income_profile_and_marks_without_writes() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::demo::open(&root.path().join("library"), TODAY).unwrap();
        let read = || {
            let tx = store.conn().unwrap().unchecked_transaction().unwrap();
            let result = store.asset_review_in_transaction().unwrap();
            tx.commit().unwrap();
            serde_json::to_value(result).unwrap()
        };
        let expected = read();
        assert!(!expected["intervals"].as_array().unwrap().is_empty());
        store
            .conn()
            .unwrap()
            .execute_batch(
                "DROP TABLE plan_income; DROP TABLE plan_profile; DROP TABLE plan_baseline_marks",
            )
            .unwrap();
        let changes = store.conn().unwrap().total_changes();
        assert_eq!(read(), expected);
        assert_eq!(store.conn().unwrap().total_changes(), changes);
        assert!(store.conn().unwrap().is_autocommit());
    }

    #[test]
    fn runtime_income_off_never_queries_bad_table_or_leaks_overview_income() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::demo::open(&root.path().join("library"), TODAY).unwrap();
        store
            .conn()
            .unwrap()
            .execute_batch("DROP TABLE plan_income; DROP TABLE plan_baseline_marks")
            .unwrap();
        let mut modules = legacy_modules(true, true);
        modules.incomes = false;
        let changes = store.conn().unwrap().total_changes();
        let sources = store
            .planning_sources_with_runtime_modules(&modules, TODAY)
            .unwrap();
        assert!(is_disabled(&sources.incomes));
        assert!(is_disabled(&sources.review));
        ready(sources.profile);
        assert!(ready(sources.snapshot).is_some());
        assert!(!ready(sources.accounts).is_empty());
        let overview = store
            .review_overview_with_runtime_modules(None, TODAY, &modules)
            .unwrap();
        let planning = overview.planning.unwrap();
        assert!(is_disabled(&planning.incomes));
        assert!(is_disabled(&planning.review));
        assert_eq!(store.conn().unwrap().total_changes(), changes);
    }

    #[test]
    fn runtime_overview_skips_disabled_broken_auxiliary_tables() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        store
            .conn()
            .unwrap()
            .execute_batch(
                "DROP TABLE expenses; DROP TABLE recurring_plans; DROP TABLE virtual_assets",
            )
            .unwrap();
        let mut modules = legacy_modules(false, true);
        modules.modules.expenses = false;
        modules.modules.recurring = false;
        modules.modules.virtual_assets = false;
        modules.modules.timeline = false;
        let changes = store.conn().unwrap().total_changes();
        let overview = store
            .review_overview_with_runtime_modules(Some(2026), TODAY, &modules)
            .unwrap();
        assert!(is_disabled(&overview.recurring));
        assert!(is_disabled(&overview.virtual_assets));
        assert!(is_disabled(&overview.recent));
        assert!(ready(overview.expenses).lines.is_empty());
        ready(overview.wealth);
        assert_eq!(store.conn().unwrap().total_changes(), changes);
    }

    #[test]
    fn runtime_overview_skips_disabled_physical_projection_with_unavailable_assets() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        store
            .conn()
            .unwrap()
            .execute_batch("DROP TABLE assets")
            .unwrap();
        let mut modules = legacy_modules(false, true);
        modules.modules.physical = false;
        modules.modules.timeline = false;
        let changes = store.conn().unwrap().total_changes();
        let overview = store
            .review_overview_with_runtime_modules(None, TODAY, &modules)
            .unwrap();
        assert!(is_disabled(&overview.physical));
        ready(overview.wealth);
        assert_eq!(store.conn().unwrap().total_changes(), changes);
    }

    #[test]
    fn overview_expenses_use_sampled_modules_instead_of_rereading_preferences() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::demo::open(&root.path().join("library"), TODAY).unwrap();
        let mut modules = legacy_modules(false, true);
        modules.modules.expenses = false;
        modules.modules.recurring = false;
        modules.modules.virtual_assets = false;
        let expected = store
            .expense_period_view(&crate::expenses::Period::All, &modules.modules)
            .unwrap();
        let overview = store
            .review_overview_with_runtime_modules(None, TODAY, &modules)
            .unwrap();
        assert_eq!(
            serde_json::to_value(ready(overview.expenses)).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }

    #[test]
    fn planning_off_keeps_income_history_and_wealth_readable_without_profile() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::demo::open(&root.path().join("library"), TODAY).unwrap();
        let expected = serde_json::to_value(store.plan_review().unwrap()).unwrap();
        store
            .conn()
            .unwrap()
            .execute_batch("DROP TABLE plan_profile")
            .unwrap();
        let mut modules = legacy_modules(false, true);
        modules.incomes = true;
        let sources = store
            .planning_sources_with_runtime_modules(&modules, TODAY)
            .unwrap();
        assert!(is_disabled(&sources.profile));
        assert!(!ready(sources.incomes).is_empty());
        assert_eq!(
            serde_json::to_value(ready(sources.review)).unwrap(),
            expected
        );
        assert!(ready(sources.snapshot).is_some());
        assert!(!ready(sources.accounts).is_empty());
        assert!(store
            .review_overview_with_runtime_modules(None, TODAY, &modules)
            .unwrap()
            .planning
            .is_none());
        modules.modules.wealth = false;
        let sources = store
            .planning_sources_with_runtime_modules(&modules, TODAY)
            .unwrap();
        assert!(is_disabled(&sources.review));
        assert!(is_disabled(&sources.snapshot));
        assert!(is_disabled(&sources.accounts));
        assert!(!ready(sources.incomes).is_empty());
    }
}
