//! Financial facts independent of goals, sampled in one SQLite read snapshot.
use crate::{
    domain::{Error, Result},
    expenses::Period,
    modules::RuntimeModules,
    storage::Store,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Read<T> {
    Ready { value: T },
    Disabled { reason: String },
    Error { code: String, message: String },
}
impl<T> From<Result<T>> for Read<T> {
    fn from(result: Result<T>) -> Self {
        match result {
            Ok(value) => Self::Ready { value },
            Err(Error { code, message }) => Self::Error { code, message },
        }
    }
}
fn disabled<T>() -> Read<T> {
    Read::Disabled {
        reason: "模块已关闭，本次未读取".into(),
    }
}

#[derive(Debug, Serialize)]
pub struct FinanceSources {
    pub generation: String,
    pub write_version: u64,
    pub today: String,
    pub period: Period,
    pub modules: RuntimeModules,
    pub wealth: Read<crate::wealth::Summary>,
    pub accounts: Read<Vec<crate::wealth::Account>>,
    pub incomes: Read<Vec<crate::plan_income::Income>>,
    pub expenses: Read<crate::expenses::View>,
    pub asset_review: Read<crate::plan_savings::AssetReview>,
    pub history: Read<crate::plan_savings::Review>,
}

impl Store {
    /// The Worker supplies actual capabilities; callers cannot elevate them via IPC.
    pub fn finance_sources(
        &self,
        period: &Period,
        modules: &RuntimeModules,
        today: &str,
    ) -> Result<FinanceSources> {
        crate::domain::date(today)?;
        let range = period.date_range()?;
        let conn = self.conn()?;
        let tx = conn.unchecked_transaction()?;
        // Pin even when wealth is disabled. Schema access ensures the first
        // financial reader also sees the same snapshot as all later readers.
        conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| {
            r.get::<_, i64>(0)
        })?;
        let wealth = if modules.modules.wealth {
            self.wealth_summary().into()
        } else {
            disabled()
        };
        #[cfg(any(test, feature = "fault-injection"))]
        self.hit("finance_sources.after_wealth")?;
        let accounts = if modules.modules.wealth {
            self.wealth_accounts().into()
        } else {
            disabled()
        };
        let incomes = if modules.incomes {
            self.plan_income_list()
                .map(|list| {
                    list.rows
                        .into_iter()
                        .filter(|row| range.as_ref().is_none_or(|r| r.contains(&row.fields.date)))
                        .collect()
                })
                .into()
        } else {
            disabled()
        };
        let asset_review = if modules.modules.wealth {
            self.asset_review_in_transaction().into()
        } else {
            disabled()
        };
        let history = if modules.modules.wealth && modules.incomes {
            self.plan_review_in_transaction().into()
        } else {
            disabled()
        };
        let result = FinanceSources {
            generation: self.generation(),
            write_version: conn.total_changes(),
            today: today.into(),
            period: period.clone(),
            modules: *modules,
            wealth,
            accounts,
            incomes,
            // Items are always facts; expenses only gates standalone expenses.
            expenses: self.expense_period_view(period, &modules.modules).into(),
            asset_review,
            history,
        };
        tx.commit()?;
        Ok(result)
    }
}
