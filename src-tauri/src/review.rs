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
}
impl Store {
    pub fn review_overview(&self, year: Option<i32>, today: &str) -> Result<Overview> {
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
        let result = Overview {
            generation: self.generation(),
            today: today.into(),
            year,
            physical,
            wealth: self.wealth_summary().into(),
            expenses: self.expense_view(year).into(),
            recurring: self.recurring_overview(today).into(),
            virtual_assets: self.virtual_overview(today).into(),
            recent: self
                // One unified projection: snapshot facts ride the same read as
                // every other event, so the frontend never merges them again.
                .timeline_with_snapshots(
                    &crate::timeline::Query {
                        filter: "all".into(),
                        asset_id: None,
                    },
                    today,
                )
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
