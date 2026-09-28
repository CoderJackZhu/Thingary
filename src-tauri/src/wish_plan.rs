//! Editable wishlist plans and integer-cent savings. All transitions are atomic.
use crate::{
    domain::{cents, date, Error, Result},
    photos::Selection,
    storage::{digest, uid, Store},
    wishlist::{Fields, WishlistItem},
};
use chrono::TimeZone;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub added_date: Option<String>,
    pub channel_id: Option<String>,
    pub mode: String,
    pub saved_cents: String,
    pub achievement_source: Option<String>,
    pub pinned: bool,
    pub reminder: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            added_date: None,
            channel_id: None,
            mode: "countdown".into(),
            saved_cents: "0".into(),
            achievement_source: None,
            pinned: false,
            reminder: false,
        }
    }
}
impl Preferences {
    pub fn validate(&self) -> Result<()> {
        if let Some(d) = &self.added_date {
            date(d)?;
        }
        cents(Some(&self.saved_cents))?;
        if !["countdown", "savings"].contains(&self.mode.as_str())
            || self
                .achievement_source
                .as_deref()
                .is_some_and(|s| !["manual", "savings", "conversion"].contains(&s))
        {
            return Err(Error::new("WISH_PLAN", "心愿计划无效"));
        }
        Ok(())
    }
}
pub fn read(c: &Connection, id: &str) -> Result<Preferences> {
    let raw: Option<String> = c
        .query_row(
            "SELECT payload FROM wishlist_preferences WHERE wishlist_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
        .map(Option::unwrap_or_default)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
    pub preferences: Preferences,
    pub photos: Selection,
    /// preserve, manual, or ongoing; clients cannot assert automatic provenance.
    pub status_intent: String,
    pub achieved_date: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Saving {
    pub request_id: String,
    pub generation: String,
    pub id: String,
    pub expected_revision: i64,
    pub mode: String,
    pub cents: String,
}
fn local_noon(day: &str) -> Result<String> {
    let dt = date(day)?
        .and_hms_opt(12, 0, 0)
        .ok_or_else(|| Error::new("DATE", "日期无效"))?;
    chrono::Local
        .from_local_datetime(&dt)
        .single()
        .map(|v| v.to_rfc3339())
        .ok_or_else(|| Error::new("DATE", "当地时间无效"))
}
fn transition(
    old: Option<&WishlistItem>,
    p: &mut Preferences,
    f: &Fields,
    intent: &str,
    chosen: Option<&str>,
    today: &str,
) -> Result<(String, Option<String>)> {
    date(today)?;
    if !["preserve", "manual", "ongoing"].contains(&intent) {
        return Err(Error::new("WISH_STATUS", "请选择有效的心愿状态"));
    }
    if let Some(item) = old {
        if item.converted_asset.is_some() {
            if intent == "ongoing"
                && item.preferences.achievement_source.as_deref() != Some("savings")
            {
                return Err(Error::new("WISH_STATUS", "已进入资产档案的心愿不能回退"));
            }
            if item.preferences.achievement_source.as_deref() == Some("savings") {
                let target = cents(f.estimated_price_cents.as_deref())?;
                let saved = cents(Some(&p.saved_cents))?.unwrap_or(0);
                if intent == "ongoing"
                    || (intent != "manual" && target.is_none_or(|value| saved < value))
                {
                    p.achievement_source = None;
                    return Ok(("ongoing".into(), None));
                }
            }
            p.achievement_source = if intent == "manual" {
                Some("manual".into())
            } else {
                item.preferences
                    .achievement_source
                    .clone()
                    .or(Some("conversion".into()))
            };
            return Ok(("achieved".into(), item.achieved_at.clone()));
        }
        if item.status == "abandoned" {
            return Err(Error::new("WISH_STATUS", "已放弃心愿不能直接修改"));
        }
    }
    p.achievement_source = old
        .and_then(|w| w.preferences.achievement_source.clone())
        .filter(|_| intent == "preserve");
    if intent == "manual" {
        p.achievement_source = Some("manual".into());
    }
    let target = cents(f.estimated_price_cents.as_deref())?;
    let saved = cents(Some(&p.saved_cents))?.unwrap_or(0);
    let reached = p.mode == "savings" && target.is_some_and(|t| saved >= t);
    if p.achievement_source.as_deref() != Some("manual") {
        p.achievement_source = if reached {
            Some("savings".into())
        } else {
            None
        };
    }
    if p.achievement_source.is_none() {
        return Ok(("ongoing".into(), None));
    }
    let at = if intent == "manual" {
        let d = chosen.unwrap_or(today);
        date(d)?;
        if d > today {
            return Err(Error::new("WISH_DATE", "实现日期不能晚于今天"));
        }
        local_noon(d)?
    } else {
        old.and_then(|w| w.achieved_at.clone())
            .map(Ok)
            .unwrap_or_else(|| local_noon(today))?
    };
    Ok(("achieved".into(), Some(at)))
}
fn receipt(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((f, result)) = prior {
        if f != fingerprint {
            return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
        }
        Ok(Some(result))
    } else {
        Ok(None)
    }
}
fn reference(c: &Connection, table: &str, id: Option<&str>) -> Result<()> {
    if let Some(id) = id {
        if !c.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"),
            [id],
            |r| r.get::<_, bool>(0),
        )? {
            return Err(Error::new("TAXONOMY_STALE", "分类或渠道已变化，请重新选择"));
        }
    }
    Ok(())
}
impl Store {
    pub fn save_wish_plan(&mut self, input: &Save, today: &str) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wish_plan", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return crate::wishlist::read(&tx, &id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"));
        }
        input.fields.validate()?;
        input.preferences.validate()?;
        if input
            .preferences
            .added_date
            .as_deref()
            .is_some_and(|d| d > today)
        {
            return Err(Error::new("WISH_DATE", "添加时间不能晚于今天"));
        }
        reference(&tx, "categories", input.fields.category_id.as_deref())?;
        reference(&tx, "channels", input.preferences.channel_id.as_deref())?;
        let old = input
            .id
            .as_ref()
            .map(|id| {
                crate::wishlist::read(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"))
            })
            .transpose()?;
        if old.as_ref().map(|w| w.revision) != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let mut p = input.preferences.clone();
        let (status, at) = transition(
            old.as_ref(),
            &mut p,
            &input.fields,
            &input.status_intent,
            input.achieved_date.as_deref(),
            today,
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        let f = &input.fields;
        if status == "ongoing" {
            if let Some(previous) = &old {
                crate::wishlist::unlink_auto_achieved_asset(&tx, previous)?;
            }
        }
        if old.is_some() {
            tx.execute("UPDATE wishlist_items SET name=?2,category_id=?3,estimated_price_cents=?4,priority=?5,target_date=?6,external_link=?7,notes=?8,status=?9,achieved_at=?10,revision=revision+1,updated_at=?11 WHERE id=?1",params![id,f.name.trim(),f.category_id,cents(f.estimated_price_cents.as_deref())?,f.priority,f.target_date,f.external_link.trim(),f.notes,status,at,now])?;
        } else {
            tx.execute("INSERT INTO wishlist_items(id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,achieved_at,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11)",params![id,f.name.trim(),f.category_id,cents(f.estimated_price_cents.as_deref())?,f.priority,f.target_date,f.external_link.trim(),f.notes,status,at,now])?;
        }
        self.commit_wishlist_cover(&tx, &id, &input.photos)?;
        tx.execute("INSERT INTO wishlist_preferences VALUES(?1,?2) ON CONFLICT(wishlist_id) DO UPDATE SET payload=excluded.payload",params![id,serde_json::to_string(&p)?])?;
        if status == "achieved" {
            if old.as_ref().is_none_or(|w| w.status != "achieved") {
                self.refuse_new_asset()?;
            }
            crate::wishlist::link_achieved_asset(&tx, &id)?;
        }
        tx.execute(
            "DELETE FROM reminders WHERE kind='wishlist' AND entity_id=?1",
            [&id],
        )?;
        if p.reminder && p.mode == "countdown" && status == "ongoing" {
            let d = f
                .target_date
                .as_ref()
                .ok_or_else(|| Error::new("REMINDER", "到期通知需要目标日期"))?;
            tx.execute(
                "INSERT INTO reminders VALUES(?1,'wishlist',?2,NULL,?3,'')",
                params![format!("wish-{id}"), id, d],
            )?;
        }
        let result = crate::wishlist::read(&tx, &id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"))?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        tx.execute(
            "INSERT INTO feature_audit VALUES(?1,'wishlist',?2,?3,?4)",
            params![input.request_id, id, serde_json::to_string(&result)?, now],
        )?;
        self.hit("wish_plan.before_commit")?;
        tx.commit()?;
        self.hit("wish_plan.after_commit")?;
        Ok(result)
    }
    pub fn save_wish_savings(&mut self, input: &Saving, today: &str) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fp = digest(&serde_json::to_vec(&("wish_savings", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fp)? {
            return crate::wishlist::read(&tx, &id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"));
        }
        let old = crate::wishlist::read(&tx, &input.id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"))?;
        if old.revision != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        if old.preferences.mode != "savings" {
            return Err(Error::new("WISH_MODE", "此心愿未启用攒钱模式"));
        }
        let mut p = old.preferences.clone();
        let amount = cents(Some(&input.cents))?.unwrap_or(0);
        let prior = cents(Some(&p.saved_cents))?.unwrap_or(0);
        let target = cents(old.fields.estimated_price_cents.as_deref())?;
        if input.mode == "add"
            && (old.status == "achieved" || target.is_some_and(|limit| prior >= limit))
        {
            return Err(Error::new(
                "SAVING_COMPLETE",
                "这条心愿已攒够；如需更正，请修改累计金额",
            ));
        }
        p.saved_cents = match input.mode.as_str() {
            "add" => prior
                .checked_add(amount)
                .ok_or_else(|| Error::new("AMOUNT", "累计金额过大"))?
                .min(target.unwrap_or(i64::MAX))
                .to_string(),
            "total" => amount.min(target.unwrap_or(i64::MAX)).to_string(),
            _ => return Err(Error::new("SAVING_MODE", "请选择新增金额或更正累计")),
        };
        p.validate()?;
        let (status, at) = transition(Some(&old), &mut p, &old.fields, "preserve", None, today)?;
        let now = chrono::Utc::now().to_rfc3339();
        if status == "ongoing" {
            crate::wishlist::unlink_auto_achieved_asset(&tx, &old)?;
        }
        tx.execute("UPDATE wishlist_items SET status=?2,achieved_at=?3,revision=revision+1,updated_at=?4 WHERE id=?1",params![input.id,status,at,now])?;
        tx.execute("INSERT INTO wishlist_preferences VALUES(?1,?2) ON CONFLICT(wishlist_id) DO UPDATE SET payload=excluded.payload",params![input.id,serde_json::to_string(&p)?])?;
        if status == "achieved" {
            if old.status != "achieved" {
                self.refuse_new_asset()?;
            }
            crate::wishlist::link_achieved_asset(&tx, &input.id)?;
        }
        let result = crate::wishlist::read(&tx, &input.id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"))?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fp, input.id],
        )?;
        tx.execute(
            "INSERT INTO feature_audit VALUES(?1,'savings',?2,?3,?4)",
            params![
                input.request_id,
                input.id,
                serde_json::to_string(&result)?,
                now
            ],
        )?;
        self.hit("wish_plan.before_commit")?;
        tx.commit()?;
        self.hit("wish_plan.after_commit")?;
        Ok(result)
    }
}
impl Store {
    pub fn saved_wish_feature(
        &self,
        request: &str,
        generation: &str,
    ) -> Result<Option<WishlistItem>> {
        self.check_generation(generation)?;
        let id:Option<String>=self.conn()?.query_row("SELECT r.result FROM feature_requests r JOIN feature_audit a ON a.request_id=r.id WHERE r.id=?1 AND a.kind IN ('wishlist','savings')",[request],|r|r.get(0)).optional()?;
        id.map(|id| crate::wishlist::read(self.conn()?, &id))
            .transpose()
            .map(Option::flatten)
    }
}
