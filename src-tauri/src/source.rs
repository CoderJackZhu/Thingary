//! Stable source identities, independent of display labels and event ordering.
use crate::{
    domain::{Error, Result},
    storage::Store,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    Asset {
        id: String,
    },
    Wish {
        id: String,
    },
    Snapshot {
        id: String,
    },
    Expense {
        id: String,
    },
    Payment {
        id: String,
        plan_id: String,
    },
    Virtual {
        id: String,
    },
    Plan {
        id: String,
    },
    /// A topup fact: the parent account and the fact travel together.
    Topup {
        id: String,
        asset_id: String,
    },
    /// A wealth account, opened by stable ID in its form (§6.2).
    Account {
        id: String,
    },
    Income {
        id: String,
    },
    Movement {
        id: String,
    },
}

impl Store {
    /// The worker supplies the same app-level capability snapshot as the active library.
    pub fn validate_source_with_modules(
        &self,
        target: &Target,
        generation: &str,
        modules: &crate::modules::RuntimeModules,
    ) -> Result<()> {
        self.check_generation(generation)?;
        let enabled = match target {
            Target::Income { .. } => modules.incomes,
            Target::Movement { .. } => modules.movements && modules.modules.wealth,
            Target::Account { .. } | Target::Snapshot { .. } => modules.modules.wealth,
            Target::Expense { .. } => modules.modules.expenses,
            Target::Payment { .. } | Target::Plan { .. } => modules.modules.recurring,
            Target::Virtual { .. } | Target::Topup { .. } => modules.modules.virtual_assets,
            Target::Wish { .. } => modules.modules.wishlist,
            Target::Asset { .. } => true,
        };
        if !enabled {
            return Err(Error::new(
                "MODULE_DISABLED",
                "来源所属功能已关闭，请在设置中开启后查看。",
            ));
        }
        self.validate_source(target, generation)
    }

    pub fn validate_source(&self, target: &Target, generation: &str) -> Result<()> {
        if generation != self.generation() {
            return Err(Error::new(
                "STALE_DATASET",
                "资料库已变化，请返回后重新读取。",
            ));
        }
        let (table, id) = match target {
            Target::Asset { id } => ("assets", id),
            Target::Wish { id } => ("wishlist_items", id),
            Target::Snapshot { id } => ("fin_snapshots", id),
            Target::Expense { id } => ("expenses", id),
            Target::Payment { id, .. } => ("plan_payments", id),
            Target::Virtual { id } => ("virtual_assets", id),
            Target::Plan { id } => ("recurring_plans", id),
            Target::Topup { id, .. } => ("virtual_topups", id),
            Target::Account { id } => ("fin_accounts", id),
            Target::Income { id } => ("plan_income", id),
            Target::Movement { id } => ("cash_movements", id),
        };
        uuid::Uuid::parse_str(id).map_err(|_| Error::new("ID", "来源标识无效"))?;
        let exists: bool = self.conn()?.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND deleted_at IS NULL)"),
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(Error::new(
                "NOT_FOUND",
                "这条来源记录已删除或失效，请返回后重新读取。",
            ));
        }
        if let Target::Payment { id, plan_id } = target {
            let valid: bool = self.conn()?.query_row("SELECT EXISTS(SELECT 1 FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.id=?1 AND p.plan_id=?2 AND r.deleted_at IS NULL AND p.state IN ('paid','skipped'))",rusqlite::params![id,plan_id],|r|r.get(0))?;
            if !valid {
                return Err(Error::new(
                    "NOT_FOUND",
                    "付款来源已变化，请返回后重新读取。",
                ));
            }
        }
        if let Target::Topup { id, asset_id } = target {
            let valid: bool = self.conn()?.query_row(
                "SELECT EXISTS(SELECT 1 FROM virtual_topups t JOIN virtual_assets v ON v.id=t.asset_id WHERE t.id=?1 AND t.asset_id=?2 AND t.deleted_at IS NULL AND v.deleted_at IS NULL)",
                rusqlite::params![id, asset_id],
                |r| r.get(0),
            )?;
            if !valid {
                return Err(Error::new(
                    "NOT_FOUND",
                    "充值来源已变化，请返回后重新读取。",
                ));
            }
        }
        if let Target::Expense { id } = target {
            let valid: bool = self.conn()?.query_row("SELECT EXISTS(SELECT 1 FROM expenses e WHERE e.id=?1 AND (e.asset_id IS NULL OR EXISTS(SELECT 1 FROM assets a WHERE a.id=e.asset_id AND a.deleted_at IS NULL)))",[id],|r|r.get(0))?;
            if !valid {
                return Err(Error::new(
                    "NOT_FOUND",
                    "关联物品已删除，请返回后重新读取。",
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod finance_tests {
    use super::*;

    #[test]
    fn finance_sources_use_identity_generation_and_actual_capabilities() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        let modules = crate::modules::RuntimeModules {
            modules: Default::default(),
            incomes: true,
            movements: true,
            finance_status: crate::modules::FinanceStatus::Ready,
            finance_revision: 1,
        };
        // Only the source resolver's identity columns are relevant to this fixture.
        let c = store.conn().unwrap();
        c.execute_batch("DROP TABLE cash_movements; CREATE TABLE cash_movements(id TEXT, deleted_at TEXT); DROP TABLE plan_income; CREATE TABLE plan_income(id TEXT, deleted_at TEXT);").unwrap();
        for (table, target) in [
            (
                "plan_income",
                Target::Income {
                    id: uuid::Uuid::new_v4().to_string(),
                },
            ),
            (
                "cash_movements",
                Target::Movement {
                    id: uuid::Uuid::new_v4().to_string(),
                },
            ),
        ] {
            let id = match &target {
                Target::Income { id } | Target::Movement { id } => id,
                _ => unreachable!(),
            };
            c.execute(&format!("INSERT INTO {table}(id) VALUES(?1)"), [id])
                .unwrap();
            store
                .validate_source_with_modules(&target, &store.generation(), &modules)
                .unwrap();
            assert_eq!(
                store
                    .validate_source_with_modules(&target, "old-generation", &modules)
                    .unwrap_err()
                    .code,
                "STALE_DATASET"
            );
            c.execute(
                &format!("UPDATE {table} SET deleted_at='2026-10-12' WHERE id=?1"),
                [id],
            )
            .unwrap();
            assert_eq!(
                store
                    .validate_source_with_modules(&target, &store.generation(), &modules)
                    .unwrap_err()
                    .code,
                "NOT_FOUND"
            );
            c.execute_batch(&format!("DROP TABLE {table}")).unwrap();
            let mut off = modules;
            off.incomes = false;
            off.movements = false;
            assert_eq!(
                store
                    .validate_source_with_modules(&target, &store.generation(), &off)
                    .unwrap_err()
                    .code,
                "MODULE_DISABLED"
            );
        }
    }
}
