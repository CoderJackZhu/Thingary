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
}
impl Store {
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
            let valid: bool = self.conn()?.query_row("SELECT EXISTS(SELECT 1 FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.id=?1 AND p.plan_id=?2 AND r.deleted_at IS NULL AND p.state='paid')",rusqlite::params![id,plan_id],|r|r.get(0))?;
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
