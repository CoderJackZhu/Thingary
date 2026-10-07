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
    pub expenses: Read<crate::expenses::View>,
    pub recurring: Read<crate::recurring::Overview>,
    pub virtual_assets: Read<crate::virtual_assets::Overview>,
    pub recent: Read<Vec<crate::timeline::Event>>,
    pub planning: Option<PlanSources>,
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
        crate::domain::date(today)?;
        if year.is_some_and(|y| !(1..=9999).contains(&y)) {
            return Err(Error::new("QUERY", "年份无效"));
        }
        // All domain readers borrow this same connection. The transaction also
        // pins a SQLite snapshot against external connections, beyond worker serialization.
        let tx = self.conn()?.unchecked_transaction()?;
        let physical = self.overview("held", today).into();
        #[cfg(test)]
        self.hit("review.after_physical")?;
        let wealth: Read<crate::wealth::Summary> = if wealth_enabled {
            self.wealth_summary().into()
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
                review: if wealth_enabled {
                    self.plan_review_in_transaction().into()
                } else {
                    disabled()
                },
                incomes: self.plan_income_list().map(|list| list.rows).into(),
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
            planning,
            expenses: self.expense_view(year).into(),
            recurring: self.recurring_overview(today).into(),
            virtual_assets: self.virtual_overview(today).into(),
            recent: (if wealth_enabled {
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
            .into(),
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
        crate::domain::date(today)?;
        let tx = self.conn()?.unchecked_transaction()?;
        let (profile, incomes, review) = if planning_enabled {
            (
                self.plan_profile().into(),
                self.plan_income_list().map(|r| r.rows).into(),
                if wealth_enabled {
                    self.plan_review_in_transaction().into()
                } else {
                    disabled()
                },
            )
        } else {
            (disabled(), disabled(), disabled())
        };
        let (snapshot, accounts) = if planning_enabled && wealth_enabled {
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
