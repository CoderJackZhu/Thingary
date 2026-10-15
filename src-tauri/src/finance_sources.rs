//! Financial facts independent of goals, sampled in one SQLite read snapshot.
use crate::{
    domain::{Error, Result},
    expenses::Period,
    modules::RuntimeModules,
    storage::Store,
};
use serde::Serialize;
use std::collections::BTreeSet;

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
    /// All visible record years, independent of the selected period.
    pub record_years: Read<Vec<i32>>,
    pub asset_review: Read<crate::plan_savings::AssetReview>,
    pub history: Read<crate::plan_savings::Review>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annual: Option<Annual>,
}

#[derive(Debug, Serialize)]
pub struct Annual {
    pub year: i32,
    pub years: Read<Vec<i32>>,
    pub comparison: Read<Option<crate::wealth::Compare>>,
    pub scope_changed: bool,
    pub savings: Read<crate::savings_goals::Read>,
    pub planning: Read<Vec<crate::goal_progress::Entry>>,
}

impl Store {
    /// The Worker supplies actual capabilities; callers cannot elevate them via IPC.
    pub fn finance_sources(
        &self,
        period: &Period,
        modules: &RuntimeModules,
        today: &str,
    ) -> Result<FinanceSources> {
        self.finance_sources_with_view(period, modules, today, false)
    }

    pub fn finance_sources_with_view(
        &self,
        period: &Period,
        modules: &RuntimeModules,
        today: &str,
        annual_view: bool,
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
        let all_incomes: Read<Vec<crate::plan_income::Income>> = if modules.incomes {
            self.plan_income_list().map(|list| list.rows).into()
        } else {
            disabled()
        };
        // Items are always facts; expenses only gates standalone expenses.
        let expenses = self.expense_period_view(period, &modules.modules).into();
        let record_years = (|| -> Result<Vec<i32>> {
            let mut years = BTreeSet::new();
            match &all_incomes {
                Read::Ready { value } => {
                    for row in value {
                        years.insert(record_year(&row.fields.date)?);
                    }
                }
                Read::Error { code, message } => return Err(Error::new(code, message)),
                Read::Disabled { .. } => {}
            }
            match &expenses {
                Read::Ready {
                    value: crate::expenses::View { years: value, .. },
                } => {
                    years.extend(value);
                }
                Read::Error { code, message } => return Err(Error::new(code, message)),
                Read::Disabled { .. } => {}
            }
            if modules.movements && modules.modules.wealth {
                for stored in crate::cash_movement::all_visible(conn, Some(modules))? {
                    let record = stored.record;
                    if !record.deleted {
                        years.insert(record_year(&record.fields.date)?);
                    }
                }
            }
            Ok(years.into_iter().collect())
        })()
        .into();
        let incomes = match all_incomes {
            Read::Ready { value } => Read::Ready {
                value: value
                    .into_iter()
                    .filter(|row| range.as_ref().is_none_or(|r| r.contains(&row.fields.date)))
                    .collect(),
            },
            other => other,
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
        let annual = if annual_view {
            let year = match period {
                Period::Year { year } => *year,
                _ => return Err(Error::new("PERIOD", "年度回顾须选择自然年")),
            };
            let start = format!("{year:04}-01-01");
            let end = format!("{year:04}-12-31");
            let mut scope_changed = false;
            let comparison = match &wealth {
                Read::Ready { value: w } => (|| -> Result<Option<crate::wealth::Compare>> {
                    let last = w
                        .points
                        .iter()
                        .rev()
                        .find(|p| p.complete && p.date >= start && p.date <= end);
                    let first = w
                        .points
                        .iter()
                        .rev()
                        .find(|p| p.complete && p.date < start)
                        .or_else(|| {
                            w.points
                                .iter()
                                .find(|p| p.complete && p.date >= start && p.date <= end)
                        });
                    match (first, last) {
                        (Some(b), Some(e)) if b.date < e.date => {
                            scope_changed = w.points.iter().any(|p| {
                                p.complete && p.date > b.date && p.date <= e.date && p.scope_changed
                            });
                            Ok(Some(self.wealth_compare(&b.snapshot_id, &e.snapshot_id)?))
                        }
                        _ => Ok(None),
                    }
                })()
                .into(),
                Read::Error { code, message } => Read::Error {
                    code: code.clone(),
                    message: message.clone(),
                },
                Read::Disabled { .. } => disabled(),
            };
            let savings = if modules.modules.wealth {
                self.savings_goals_in_transaction(Some(year), today, modules)
                    .into()
            } else {
                disabled()
            };
            let planning = if modules.modules.wealth && modules.modules.planning {
                self.goal_progress_year(year).into()
            } else {
                disabled()
            };
            let years=(||->Result<Vec<i32>> {
                let mut years=BTreeSet::from([record_year(today)?]);
                match &record_years {Read::Ready{value}=>years.extend(value),Read::Error{code,message}=>return Err(Error::new(code,message)),Read::Disabled{..}=>{}}
                match &wealth {Read::Ready{value}=>{for p in &value.points {years.insert(record_year(&p.date)?);}},Read::Error{code,message}=>return Err(Error::new(code,message)),Read::Disabled{..}=>{}}
                match &savings {Read::Ready{value}=>years.extend(&value.years),Read::Error{code,message}=>return Err(Error::new(code,message)),Read::Disabled{..}=>{}}
                if modules.modules.wealth && modules.modules.planning {
                    let mut q=conn.prepare("SELECT DISTINCT substr(s.date,1,4) FROM goal_progress p JOIN fin_snapshots s ON s.id=p.snapshot_id WHERE s.deleted_at IS NULL AND p.snapshot_revision=s.revision")?;
                    for y in q.query_map([],|r|r.get::<_,String>(0))? {years.insert(y?.parse().map_err(|_|Error::new("FORMAT","规划年份无效"))?);}
                }
                Ok(years.into_iter().collect())
            })().into();
            Some(Annual {
                year,
                years,
                comparison,
                scope_changed,
                savings,
                planning,
            })
        } else {
            None
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
            expenses,
            record_years,
            asset_review,
            history,
            annual,
        };
        tx.commit()?;
        Ok(result)
    }
}

fn record_year(day: &str) -> Result<i32> {
    crate::domain::date(day)?;
    day[..4]
        .parse()
        .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))
}
