//! U02 preferences and initial history share the asset-save transaction.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Exclusions {
    pub total: bool,
    pub daily: bool,
    pub statistics: bool,
    pub timeline: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
#[derive(Default)]
pub enum Goal {
    #[default]
    None,
    Cost {
        cents: String,
    },
    Date {
        date: String,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AssetPreferences {
    pub label_id: Option<String>,
    pub cost_mode: String,
    pub use_count: u32,
    pub goal: Goal,
    pub pinned: bool,
    pub exclude: Exclusions,
}
impl Default for AssetPreferences {
    fn default() -> Self {
        Self {
            label_id: None,
            cost_mode: "daily".into(),
            use_count: 0,
            goal: Goal::None,
            pinned: false,
            exclude: Exclusions::default(),
        }
    }
}
impl AssetPreferences {
    pub fn validate(&self) -> Result<()> {
        if !["daily", "per_use"].contains(&self.cost_mode.as_str())
            || self.use_count > 1_000_000_000
        {
            return Err(Error::new(
                "COST_MODE",
                "请选择按日或按次，次数不能超过十亿",
            ));
        }
        match &self.goal {
            Goal::None => {}
            Goal::Cost { cents: amount } => {
                if cents(Some(amount))?.unwrap_or(0) <= 0 {
                    return Err(Error::new("GOAL", "目标单位成本须大于零"));
                }
            }
            Goal::Date { date: value } => {
                date(value)?;
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reminder {
    pub date: String,
    pub notes: String,
}
impl Reminder {
    pub fn validate(&self) -> Result<()> {
        date(&self.date)?;
        if self.notes.chars().count() > 1000 || self.notes.contains('\0') {
            return Err(Error::new("REMINDER", "提醒备注最多 1000 字"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewWarranty {
    pub start_date: Option<String>,
    pub end_date: String,
    pub reminder: Option<Reminder>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AssetOptions {
    pub preferences: AssetPreferences,
    pub warranty: Option<NewWarranty>,
    pub retired_date: Option<String>,
    pub sale: Option<crate::sales::Fields>,
}
pub fn read(c: &Connection, id: &str) -> Result<AssetPreferences> {
    let raw: Option<String> = c
        .query_row(
            "SELECT payload FROM asset_preferences WHERE asset_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|v| serde_json::from_str(&v).map_err(Into::into))
        .transpose()
        .map(Option::unwrap_or_default)
}
pub fn per_use_cost(record: &crate::catalog::AssetRecord) -> Option<String> {
    let count = record.preferences.use_count as i128;
    if count == 0 {
        return None;
    }
    let value = if record.sale.is_some() {
        record.costs.net_cost_cents.as_ref()
    } else {
        record.costs.total_investment_cents.as_ref()
    }?
    .parse::<i128>()
    .ok()?;
    Some((((value.abs() + count / 2) / count) * value.signum()).to_string())
}
impl Store {
    pub(crate) fn write_asset_options(
        &self,
        tx: &Transaction<'_>,
        id: &str,
        input: &crate::domain::Save,
        options: &AssetOptions,
        today: &str,
    ) -> Result<()> {
        let p = &options.preferences;
        p.validate()?;
        if let Some(label) = &p.label_id {
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM named_choices WHERE id=?1 AND kind='label')",
                [label],
                |r| r.get(0),
            )?;
            if !exists {
                return Err(Error::new("LABEL", "状态标签已不可用，请重新选择"));
            }
        }
        tx.execute("INSERT INTO asset_preferences(asset_id,payload) VALUES(?1,?2) ON CONFLICT(asset_id) DO UPDATE SET payload=excluded.payload",params![id,serde_json::to_string(p)?])?;
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute("INSERT INTO feature_audit(request_id,kind,entity_id,snapshot,created_at) VALUES(?1,'asset',?2,?3,?4)",params![input.request_id,id,serde_json::to_string(p)?,now])?;
        if input.asset_id.is_some()
            && (options.warranty.is_some()
                || options.retired_date.is_some()
                || options.sale.is_some())
        {
            return Err(Error::new(
                "HISTORY",
                "已有档案请通过对应保障、退役或售出记录更正历史",
            ));
        }
        if let Some(retired) = &options.retired_date {
            date(retired)?;
            if retired.as_str() > today || input.purchase_date.as_ref().is_some_and(|p| retired < p)
            {
                return Err(Error::new(
                    "DATE_CONFLICT",
                    "退役日期须在购入日期和今天之间",
                ));
            }
            tx.execute("INSERT INTO lifecycle_events(id,asset_id,sequence,kind,date,notes,created_at,updated_at) VALUES(?1,?2,1,'retire',?3,'',?4,?4)",params![uid(),id,retired,now])?;
            tx.execute(
                "UPDATE assets SET lifecycle_state='retired' WHERE id=?1",
                [id],
            )?;
        }
        if let Some(fields) = &options.sale {
            fields.validate()?;
            if fields.date.as_str() > today
                || input
                    .purchase_date
                    .as_ref()
                    .is_some_and(|p| &fields.date < p)
                || options
                    .retired_date
                    .as_ref()
                    .is_some_and(|p| &fields.date < p)
            {
                return Err(Error::new(
                    "DATE_CONFLICT",
                    "售出日期须在购入、退役日期之后，且不晚于今天",
                ));
            }
            let sale = crate::sales::Sale {
                id: uid(),
                previous_state: if options.retired_date.is_some() {
                    crate::lifecycle::State::Retired
                } else {
                    crate::lifecycle::State::Active
                },
                fields: fields.clone(),
            };
            tx.execute("INSERT INTO sales(id,asset_id,previous_state,date,price_cents,platform,buyer,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",params![sale.id,id,if options.retired_date.is_some(){"retired"}else{"active"},fields.date,cents(Some(&fields.price_cents))?,fields.platform,fields.buyer,fields.notes,now])?;
            tx.execute("INSERT INTO sale_audit(request_id,sale_id,action,snapshot,created_at) VALUES(?1,?2,'sell',?3,?4)",params![input.request_id,sale.id,serde_json::to_string(&sale)?,now])?;
            tx.execute("UPDATE assets SET lifecycle_state='sold' WHERE id=?1", [id])?;
        }
        if let Some(w) = &options.warranty {
            date(&w.end_date)?;
            if let Some(start) = &w.start_date {
                date(start)?;
                if start > &w.end_date {
                    return Err(Error::new("WARRANTY_DATE", "保障结束日期不能早于开始日期"));
                }
            }
            let wid = uid();
            tx.execute("INSERT INTO warranties(id,asset_id,kind,provider,start_date,end_date,notes,created_at,updated_at) VALUES(?1,?2,'manufacturer','',?3,?4,'',?5,?5)",params![wid,id,w.start_date,w.end_date,now])?;
            let warranty = crate::warranty::read(tx, id, today)?
                .into_iter()
                .find(|x| x.id == wid)
                .ok_or_else(|| Error::new("WARRANTY", "保障未能写入"))?;
            tx.execute("INSERT INTO warranty_audit(request_id,warranty_id,action,snapshot,created_at) VALUES(?1,?2,'add',?3,?4)",params![input.request_id,wid,serde_json::to_string(&warranty)?,now])?;
            if let Some(r) = &w.reminder {
                r.validate()?;
                if r.date > w.end_date {
                    return Err(Error::new("REMINDER", "保障提醒日期不能晚于结束日期"));
                }
                tx.execute("INSERT INTO reminders(id,kind,entity_id,source_id,date,notes) VALUES(?1,'warranty',?2,?3,?4,?5)",params![uid(),id,wid,r.date,r.notes])?;
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut s = c.prepare("SELECT asset_id,payload FROM asset_preferences")?;
    for row in s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (_, raw) = row?;
        let p: AssetPreferences = serde_json::from_str(&raw)?;
        p.validate()?;
        if let Some(id) = p.label_id {
            if !c.query_row(
                "SELECT EXISTS(SELECT 1 FROM named_choices WHERE id=?1 AND kind='label')",
                [id],
                |r| r.get::<_, bool>(0),
            )? {
                return Err(Error::new("REFERENCE", "状态标签引用不存在"));
            }
        }
    }
    let mut s = c.prepare("SELECT date,notes FROM reminders")?;
    for r in s.query_map([], |r| {
        Ok(Reminder {
            date: r.get(0)?,
            notes: r.get(1)?,
        })
    })? {
        r?.validate()?;
    }

    let mut q=c.prepare("SELECT w.id,w.status,w.converted_asset_id,p.payload,w.estimated_price_cents FROM wishlist_items w LEFT JOIN wishlist_preferences p ON p.wishlist_id=w.id")?;
    for row in q.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<i64>>(4)?,
        ))
    })? {
        let (id, status, converted, raw, price) = row?;
        let p: crate::wish_plan::Preferences = raw
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or_default();
        p.validate()?;
        if let Some(channel) = &p.channel_id {
            if !c.query_row(
                "SELECT EXISTS(SELECT 1 FROM channels WHERE id=?1)",
                [channel],
                |r| r.get::<_, bool>(0),
            )? {
                return Err(Error::new("REFERENCE", "心愿渠道引用不存在"));
            }
        }
        if converted.is_none() && status == "achieved" {
            if ![Some("manual"), Some("savings")].contains(&p.achievement_source.as_deref()) {
                return Err(Error::new("WISH_STATUS", "已实现心愿缺少来源"));
            }
            let trace:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM feature_audit WHERE entity_id=?1 AND kind IN ('wishlist','savings'))",[&id],|r|r.get(0))?;
            if !trace {
                return Err(Error::new("WISH_STATUS", "心愿实现记录不可追溯"));
            }
            if p.achievement_source.as_deref() == Some("savings")
                && (p.mode != "savings"
                    || !price.is_some_and(|goal| {
                        cents(Some(&p.saved_cents))
                            .ok()
                            .flatten()
                            .is_some_and(|v| v >= goal)
                    }))
            {
                return Err(Error::new("WISH_STATUS", "攒钱实现状态与金额不一致"));
            }
        }
    }
    let invalid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM reminders r WHERE (r.kind='warranty' AND NOT EXISTS(SELECT 1 FROM warranties w WHERE w.id=r.source_id AND w.asset_id=r.entity_id)) OR (r.kind='wishlist' AND NOT EXISTS(SELECT 1 FROM wishlist_items w WHERE w.id=r.entity_id)))",[],|r|r.get(0))?;
    if invalid {
        return Err(Error::new("REFERENCE", "提醒引用不存在"));
    }
    Ok(())
}
