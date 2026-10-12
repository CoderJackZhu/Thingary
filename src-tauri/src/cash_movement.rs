//! Optional settled cash movements. Snapshots remain the sole balance facts.
use crate::{
    domain::{date, Error, Result},
    investment_review_component as core,
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Endpoint {
    Account { account_id: String },
    External { label: String },
}
impl Endpoint {
    pub fn account(&self) -> Option<&str> {
        match self {
            Self::Account { account_id } => Some(account_id),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub kind: String,
    pub key: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub date: String,
    pub amount_cents: String,
    pub from: Endpoint,
    pub to: Endpoint,
    pub purpose: String,
    pub source: Option<Source>,
    pub notes: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub id: Option<String>,
    pub fields: Fields,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trash {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub id: String,
    pub deleted: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub account_id: Option<String>,
    pub deleted: String,
    pub cursor: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceQuery {
    pub kind: String,
    pub text: String,
    pub cursor: Option<String>,
    pub movement_id: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Record {
    pub id: String,
    pub revision: i64,
    pub deleted: bool,
    pub fields: Fields,
    pub source_status: String,
}
#[derive(Clone, Debug)]
pub(crate) struct Stored {
    pub fact_revision: i64,
    pub record: Record,
    pub source_basis: Option<String>,
    pub live_source_basis: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Saved {
    pub id: String,
    pub revision: i64,
}
#[derive(Clone, Debug)]
struct SourceFact {
    reference: Source,
    label: String,
    date: String,
    amount: String,
    deleted: bool,
    category: String,
    from: Option<String>,
    to: Option<String>,
    destination: Option<String>,
    linked: bool,
}
impl SourceFact {
    fn basis(&self) -> Result<String> {
        Ok(digest(&serde_json::to_vec(&(
            &self.reference,
            &self.date,
            &self.amount,
            self.deleted,
            &self.category,
            &self.from,
            &self.to,
            &self.destination,
            self.linked,
        ))?))
    }
}
fn bad(message: &str) -> Error {
    Error::new("INVALID_INPUT", message)
}
pub(crate) fn enabled(s: &Store, generation: &str) -> Result<()> {
    s.check_generation(generation)?;
    let m = crate::modules::read(&s.root);
    if !m.planning || !m.wealth {
        return Err(Error::new("MODULE_DISABLED", "规划或账户模块已关闭"));
    }
    Ok(())
}
fn key(kind: &str, id: &str) -> String {
    digest(&serde_json::to_vec(&("movement-source-v1", kind, id)).expect("plain strings"))
}
fn source_facts(c: &Connection, kind: &str) -> Result<Vec<SourceFact>> {
    if !["income", "expense"].contains(&kind) {
        return Err(bad("来源类型无效"));
    }
    let sql = if kind == "income" {
        "SELECT id,notes,date,net_cents,deleted_at IS NOT NULL,category,source_account_id,receiving_account_id,destination,0 FROM plan_income ORDER BY date DESC,id"
    } else {
        "SELECT id,title,date,amount_cents,deleted_at IS NOT NULL,category,NULL,NULL,NULL,asset_id IS NOT NULL FROM expenses ORDER BY date DESC,id"
    };
    let mut q = c.prepare(sql)?;
    let facts = q
        .query_map([], |r| {
            Ok(SourceFact {
                reference: Source {
                    kind: kind.into(),
                    key: key(kind, &r.get::<_, String>(0)?),
                },
                label: r.get(1)?,
                date: r.get(2)?,
                amount: r.get::<_, i64>(3)?.to_string(),
                deleted: r.get(4)?,
                category: r.get(5)?,
                from: r.get(6)?,
                to: r.get(7)?,
                destination: r.get(8)?,
                linked: r.get(9)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(facts)
}
fn source_fact(c: &Connection, reference: &Source) -> Result<SourceFact> {
    source_facts(c, &reference.kind)?
        .into_iter()
        .find(|f| f.reference == *reference)
        .ok_or_else(|| Error::new("SOURCE_DELETED", "来源不存在或已清除"))
}
fn source_matches(f: &Fields, s: &SourceFact) -> bool {
    if s.deleted || s.linked || s.date != f.date || s.amount != f.amount_cents {
        return false;
    }
    if s.reference.kind == "expense" {
        return ["living_payment", "investment_cost"].contains(&f.purpose.as_str())
            && f.from.account().is_some()
            && f.to.account().is_none();
    }
    if crate::plan_income::investment_category(&s.category) {
        f.purpose == "income_distribution"
            && s.destination.as_deref() == Some("transferred")
            && s.from.as_deref() == f.from.account()
            && s.from.is_some()
            && s.to.as_deref() == f.to.account()
    } else {
        f.purpose == "external_funding"
            && f.from.account().is_none()
            && f.to.account().is_some()
            && s.from.is_none()
            && s.to.as_deref().is_none_or(|id| Some(id) == f.to.account())
    }
}
pub(crate) fn source_changed(c: &Connection, kind: &str, id: &str) -> Result<()> {
    let key = key(kind, id);
    c.execute("UPDATE cash_movements SET fact_revision=fact_revision+1 WHERE source_kind=?1 AND source_key=?2",params![kind,key])?;
    crate::planning_flow_review::invalidate_source(c, kind, &key)
}
pub(crate) fn all(c: &Connection) -> Result<Vec<Stored>> {
    let mut q=c.prepare("SELECT id,revision,deleted_at IS NOT NULL,payload,source_basis,fact_revision FROM cash_movements ORDER BY date DESC,id")?;
    let raw = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut catalog = std::collections::BTreeMap::new();
    let parsed = raw
        .into_iter()
        .map(|(id, revision, deleted, payload, basis, fact_revision)| {
            Ok((
                id,
                revision,
                deleted,
                serde_json::from_str::<Fields>(&payload)?,
                basis,
                fact_revision,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let kinds = parsed
        .iter()
        .filter_map(|(_, _, _, f, _, _)| f.source.as_ref().map(|s| s.kind.clone()))
        .collect::<std::collections::BTreeSet<_>>();
    for kind in kinds {
        for fact in source_facts(c, &kind)? {
            catalog.insert(
                (fact.reference.kind.clone(), fact.reference.key.clone()),
                fact,
            );
        }
    }
    parsed
        .into_iter()
        .map(|(id, revision, deleted, fields, basis, fact_revision)| {
            let live = fields
                .source
                .as_ref()
                .and_then(|s| catalog.get(&(s.kind.clone(), s.key.clone())));
            let live_source_basis = if fields.source.is_none() {
                None
            } else {
                Some(
                    live.map(SourceFact::basis)
                        .transpose()?
                        .unwrap_or_else(|| "missing".into()),
                )
            };
            let status = if fields.source.is_none() {
                "unlinked"
            } else {
                match live {
                    None => "deleted",
                    Some(s) if s.deleted => "deleted",
                    Some(s) if source_matches(&fields, s) && basis == live_source_basis => {
                        "matched"
                    }
                    Some(_) => "needs_review",
                }
            };
            Ok(Stored {
                fact_revision,
                source_basis: basis,
                live_source_basis,
                record: Record {
                    id,
                    revision,
                    deleted,
                    fields,
                    source_status: status.into(),
                },
            })
        })
        .collect()
}

fn get(c: &Connection, id: &str) -> Result<Stored> {
    all(c)?
        .into_iter()
        .find(|r| r.record.id == id)
        .ok_or_else(|| Error::new("NOT_FOUND", "找不到资金流动"))
}
fn validate_syntax(f: &Fields, today: &str) -> Result<i64> {
    date(&f.date)?;
    if f.date.as_str() > today {
        return Err(bad("流动结算日期不能晚于今天"));
    }
    let amount =
        core::parse_cents(&f.amount_cents).map_err(|_| bad("金额须为正整数分且不超上限"))?;
    if amount == 0 {
        return Err(bad("流动金额须大于零"));
    }
    if f.notes.chars().count() > 500 || f.notes.contains('\0') {
        return Err(bad("备注最多500字"));
    }
    for e in [&f.from, &f.to] {
        match e {
            Endpoint::Account { account_id } => {
                uuid::Uuid::parse_str(account_id).map_err(|_| bad("账户标识无效"))?;
            }
            Endpoint::External { label } => {
                if label.trim().is_empty() || label.chars().count() > 80 || label.contains('\0') {
                    return Err(bad("请填写范围外对象，最多80字"));
                }
            }
        }
    }
    let a = f.from.account();
    let b = f.to.account();
    if a.is_none() && b.is_none() || a.is_some() && a == b {
        return Err(bad("至少一端为账户，且两端不能相同"));
    }
    let valid = match f.purpose.as_str() {
        "own_transfer" => a.is_some() && b.is_some(),
        "external_funding" => a.is_some() != b.is_some(),
        "living_payment" | "investment_cost" => a.is_some() && b.is_none(),
        "income_distribution" => a.is_some(),
        _ => false,
    };
    if !valid {
        return Err(bad("用途与资金方向不一致"));
    }
    if f.source.as_ref().is_some_and(|s| {
        !["income", "expense"].contains(&s.kind.as_str())
            || s.key.len() != 64
            || !s.key.bytes().all(|b| b.is_ascii_hexdigit())
    }) {
        return Err(bad("来源标识无效"));
    }
    Ok(amount)
}
fn validate_accounts(
    c: &Connection,
    f: &Fields,
    old: Option<&Fields>,
    historical: bool,
) -> Result<()> {
    for (e, previous) in [(&f.from, old.map(|f| &f.from)), (&f.to, old.map(|f| &f.to))] {
        if let Some(id) = e.account() {
            let account:Option<(String,String,String,Option<String>,bool)>=c.query_row("SELECT side,kind,opened_on,closed_on,deleted_at IS NOT NULL FROM fin_accounts WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
            let Some((side, kind, opened, closed, deleted)) = account else {
                return Err(bad("流动引用账户不存在"));
            };
            let retained = previous.is_some_and(|p| p.account() == Some(id))
                && old.is_some_and(|o| o.date == f.date);
            if !historical
                && !retained
                && (side != "asset"
                    || !["cash", "investment", "mixed", "fund", "bond"].contains(&kind.as_str())
                    || deleted
                    || opened > f.date
                    || closed.is_some_and(|d| d <= f.date))
            {
                return Err(bad("请选择结算时有效的金融资产账户"));
            }
            if !historical
                && f.purpose == "income_distribution"
                && e == &f.from
                && !core::SUPPORTED_KINDS.contains(&kind.as_str())
            {
                return Err(bad("现金收益分配须有明确投资来源账户"));
            }
        }
    }
    Ok(())
}
fn source_unique(c: &Connection, reference: &Source, id: &str) -> Result<()> {
    let used:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM cash_movements WHERE source_kind=?1 AND source_key=?2 AND deleted_at IS NULL AND id<>?3)",params![reference.kind,reference.key,id],|r|r.get(0))?;
    if used {
        return Err(Error::new("SOURCE_CONFLICT", "来源已由另一条有效流动关联"));
    }
    Ok(())
}
pub(crate) fn facts(f: &Fields) -> Value {
    // Display labels and notes never decide interval arithmetic/confirmation.
    let endpoint = |e: &Endpoint| match e {
        Endpoint::Account { account_id } => json!(["account", account_id]),
        Endpoint::External { .. } => json!(["external"]),
    };
    json!([
        f.date,
        f.amount_cents,
        endpoint(&f.from),
        endpoint(&f.to),
        f.purpose,
        f.source
    ])
}
pub(crate) fn receipt(c: &Connection, request: &str, fingerprint: &str) -> Result<Option<String>> {
    uuid::Uuid::parse_str(request).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [request],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match prior {
        Some((f, _)) if f != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"))
        }
        Some((_, id)) => Ok(Some(id)),
        None => Ok(None),
    }
}
pub(crate) fn audit(
    c: &Connection,
    kind: &str,
    id: &str,
    request: &str,
    before: Value,
    after: Value,
) -> Result<()> {
    c.execute("INSERT INTO planning_flow_audit(entity_kind,entity_id,request_id,before_value,after_value,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![kind,id,request,before.to_string(),after.to_string(),chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}
/// Stateless cursor, bound to the full query, dataset and contents. Expiry is explicit.
fn page<T: Serialize + Clone>(
    items: Vec<T>,
    query: Value,
    cursor: Option<&str>,
    generation: &str,
) -> Result<(Vec<T>, Option<String>)> {
    let binding = digest(&serde_json::to_vec(&(generation, query, &items))?);
    let offset = if let Some(raw) = cursor {
        let v: Value = serde_json::from_str(raw).map_err(|_| bad("分页游标无效"))?;
        if v["binding"] != binding {
            return Err(Error::new("STALE_CURSOR", "列表已变化，请从第一页重新读取"));
        }
        let n = v["offset"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= items.len() as u64)
            .ok_or_else(|| bad("分页游标无效"))?;
        n as usize
    } else {
        0
    };
    let end = (offset + 50).min(items.len());
    let next = (end < items.len()).then(|| json!({"binding":binding,"offset":end}).to_string());
    Ok((items[offset..end].to_vec(), next))
}
impl Store {
    pub fn movement_accounts(&self, generation: &str) -> Result<Value> {
        enabled(self, generation)?;
        let tx = self.conn()?.unchecked_transaction()?;
        let mut q = tx.prepare(
            "SELECT id,name,kind,side,closed_on,deleted_at FROM fin_accounts ORDER BY position,id",
        )?;
        let accounts=q.query_map([],|r| {let kind:String=r.get(2)?;let side:String=r.get(3)?;Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"kind":kind,"selectable":side=="asset" && ["cash","investment","mixed","fund","bond"].contains(&kind.as_str()) && r.get::<_,Option<String>>(4)?.is_none() && r.get::<_,Option<String>>(5)?.is_none()}))})?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(json!({"generation":generation,"accounts":accounts}))
    }
    pub fn movement_list(&self, query: &Query, generation: &str) -> Result<Value> {
        enabled(self, generation)?;
        for d in [&query.from_date, &query.to_date].into_iter().flatten() {
            date(d)?;
        }
        if !["active", "deleted", "all"].contains(&query.deleted.as_str())
            || matches!((&query.from_date,&query.to_date),(Some(a),Some(b)) if a>b)
        {
            return Err(bad("筛选条件无效"));
        }
        let tx = self.conn()?.unchecked_transaction()?;
        let records = all(&tx)?
            .into_iter()
            .map(|r| r.record)
            .filter(|r| {
                let f = &r.fields;
                query.from_date.as_ref().is_none_or(|d| f.date >= *d)
                    && query.to_date.as_ref().is_none_or(|d| f.date <= *d)
                    && query
                        .account_id
                        .as_deref()
                        .is_none_or(|id| f.from.account() == Some(id) || f.to.account() == Some(id))
                    && (query.deleted == "all" || r.deleted == (query.deleted == "deleted"))
            })
            .collect();
        let (records, next_cursor) = page(
            records,
            json!([
                query.from_date,
                query.to_date,
                query.account_id,
                query.deleted
            ]),
            query.cursor.as_deref(),
            generation,
        )?;
        Ok(json!({"generation":generation,"records":records,"next_cursor":next_cursor}))
    }
    pub fn movement_sources(&self, query: &SourceQuery, generation: &str) -> Result<Value> {
        enabled(self, generation)?;
        if query.text.chars().count() > 200 {
            return Err(bad("搜索条件过长"));
        }
        if query.kind == "expense" && !crate::modules::read(&self.root).expenses {
            return Err(Error::new("MODULE_DISABLED", "重要支出模块已关闭"));
        }
        let tx = self.conn()?.unchecked_transaction()?;
        let mut options = vec![];
        for f in source_facts(&tx, &query.kind)? {
            if !format!("{} {} {}", f.label, f.date, f.amount)
                .to_lowercase()
                .contains(&query.text.to_lowercase())
            {
                continue;
            }
            let occupied = match source_unique(
                &tx,
                &f.reference,
                query.movement_id.as_deref().unwrap_or(""),
            ) {
                Ok(()) => false,
                Err(e) if e.code == "SOURCE_CONFLICT" => true,
                Err(e) => return Err(e),
            };
            let reason = if f.deleted {
                Some("来源已删除")
            } else if f.linked {
                Some("支出已由物品事实解释，暂不提供关联")
            } else if f.amount == "0" {
                Some("零额来源不能关联正额流动")
            } else if occupied {
                Some("已被其他流动关联")
            } else {
                None
            };
            options.push(json!({"ref":f.reference,"label":if f.label.trim().is_empty(){format!("{} {}",if query.kind=="income"{"收入"}else{"支出"},f.date)}else{f.label},"date":f.date,"amount_cents":f.amount,"available":reason.is_none(),"unavailable_reason":reason}));
        }
        let (options, next_cursor) = page(
            options,
            json!([query.kind, query.text, query.movement_id]),
            query.cursor.as_deref(),
            generation,
        )?;
        Ok(json!({"generation":generation,"options":options,"next_cursor":next_cursor}))
    }
    pub fn movement_save(&mut self, input: &Save, today: &str) -> Result<Saved> {
        enabled(self, &input.generation)?;
        let fingerprint = digest(&serde_json::to_vec(&("movement_save", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            let r = get(&tx, &id)?.record;
            return Ok(Saved {
                id: r.id,
                revision: r.revision,
            });
        }
        let old = input.id.as_deref().map(|id| get(&tx, id)).transpose()?;
        let deleted_unlink = old.as_ref().is_some_and(|r| {
            let mut original = r.record.fields.clone();
            original.source = None;
            r.record.deleted && r.record.fields.source.is_some() && original == input.fields
        });
        if old.as_ref().map(|r| r.record.revision) != input.expected_revision
            || old.as_ref().is_some_and(|r| r.record.deleted) && !deleted_unlink
        {
            return Err(Error::new("REVISION_CONFLICT", "流动已变化，请重新读取"));
        }
        let f = &input.fields;
        validate_syntax(f, today)?;
        validate_accounts(&tx, f, old.as_ref().map(|r| &r.record.fields), false)?;
        let id = input.id.clone().unwrap_or_else(uid);
        let revision = old.as_ref().map_or(1, |r| r.record.revision + 1);
        let unchanged = old
            .as_ref()
            .is_some_and(|r| facts(&r.record.fields) == facts(f));
        let source_basis = if unchanged {
            old.as_ref().and_then(|r| r.source_basis.clone())
        } else if let Some(reference) = &f.source {
            if reference.kind == "expense" && !crate::modules::read(&self.root).expenses {
                return Err(Error::new("MODULE_DISABLED", "重要支出模块已关闭"));
            }
            source_unique(&tx, reference, &id)?;
            let s = source_fact(&tx, reference)?;
            if !source_matches(f, &s) {
                return Err(Error::new(
                    "SOURCE_MISMATCH",
                    "来源日期、整笔金额或资金方向不一致",
                ));
            }
            Some(s.basis()?)
        } else {
            None
        };
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute("INSERT INTO cash_movements(id,revision,date,from_account_id,to_account_id,source_kind,source_key,source_basis,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,date=excluded.date,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,source_kind=excluded.source_kind,source_key=excluded.source_key,source_basis=excluded.source_basis,payload=excluded.payload,updated_at=excluded.updated_at",params![id,revision,f.date,f.from.account(),f.to.account(),f.source.as_ref().map(|s|&s.kind),f.source.as_ref().map(|s|&s.key),source_basis,serde_json::to_string(f)?,now])?;
        if !unchanged {
            if old.is_some() {
                tx.execute(
                    "UPDATE cash_movements SET fact_revision=fact_revision+1 WHERE id=?1",
                    [&id],
                )?;
            }
            crate::planning_flow_review::invalidate_movement(
                &tx,
                old.as_ref().map(|r| &r.record.fields),
                Some(f),
            )?;
        }
        audit(
            &tx,
            "movement",
            &id,
            &input.request_id,
            old.as_ref()
                .map_or(Value::Null, |r| serde_json::to_value(&r.record).unwrap()),
            json!({"fields":f,"revision":revision,"deleted":old.as_ref().is_some_and(|r|r.record.deleted)}),
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        self.hit("movement.before_commit")?;
        tx.commit()?;
        self.hit("movement.after_commit")?;
        Ok(Saved { id, revision })
    }
    pub fn movement_trash(&mut self, input: &Trash) -> Result<Saved> {
        enabled(self, &input.generation)?;
        let fingerprint = digest(&serde_json::to_vec(&("movement_trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            let r = get(&tx, &id)?.record;
            return Ok(Saved {
                id: r.id,
                revision: r.revision,
            });
        }
        let old = get(&tx, &input.id)?;
        let r = &old.record;
        if Some(r.revision) != input.expected_revision || r.deleted == input.deleted {
            return Err(Error::new("REVISION_CONFLICT", "流动已变化，请重新读取"));
        }
        if !input.deleted {
            if let Some(reference) = &r.fields.source {
                source_unique(&tx, reference, &r.id)?;
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE cash_movements SET revision=revision+1,fact_revision=fact_revision+1,deleted_at=?2,updated_at=?3 WHERE id=?1",
            params![
                r.id,
                if input.deleted {
                    Some(now.clone())
                } else {
                    None
                },
                now
            ],
        )?;
        crate::planning_flow_review::invalidate_movement(&tx, Some(&r.fields), None)?;
        audit(
            &tx,
            "movement",
            &r.id,
            &input.request_id,
            serde_json::to_value(r)?,
            json!({"fields":r.fields,"revision":r.revision+1,"deleted":input.deleted}),
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, r.id],
        )?;
        self.hit("movement.before_commit")?;
        tx.commit()?;
        self.hit("movement.after_commit")?;
        Ok(Saved {
            id: r.id.clone(),
            revision: r.revision + 1,
        })
    }
    pub fn followup_receipt(&self, request: &str, generation: &str) -> Result<Option<Saved>> {
        self.check_generation(generation)?;
        let Some(id) = self.wealth_request_result(request, generation)? else {
            return Ok(None);
        };
        let revision = if id == "profile" {
            self.plan_profile()?.saved.map(|s| s.revision)
        } else {
            self.conn()?.query_row("SELECT revision FROM cash_movements WHERE id=?1 UNION ALL SELECT revision FROM investment_flows WHERE id=?1",[&id],|r|r.get(0)).optional()?
        };
        Ok(revision.map(|revision| Saved { id, revision }))
    }
}
pub(crate) fn protect_purge(c: &Connection, kind: &str, id: &str) -> Result<()> {
    let used = if kind == "account" {
        c.query_row("SELECT EXISTS(SELECT 1 FROM cash_movements WHERE from_account_id=?1 OR to_account_id=?1)",[id],|r|r.get::<_,bool>(0))?
    } else if ["income", "expense"].contains(&kind) {
        c.query_row(
            "SELECT EXISTS(SELECT 1 FROM cash_movements WHERE source_kind=?1 AND source_key=?2)",
            params![kind, key(kind, id)],
            |r| r.get::<_, bool>(0),
        )?
    } else {
        false
    };
    if used {
        return Err(Error::new(
            "PLANNING_DEPENDENCY",
            "记录仍被资金流动引用，请先显式解除来源关联；账户引用包含已删除流动",
        ));
    }
    Ok(())
}
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    for r in all(c)? {
        let f = &r.record.fields;
        validate_syntax(f, "9999-12-31")?;
        validate_accounts(c, f, None, true)?;
        if uuid::Uuid::parse_str(&r.record.id).is_err()
            || r.record.revision < 1
            || r.fact_revision < 1
        {
            return Err(bad("资金流动身份无效"));
        }
        if let Some(source) = &f.source {
            source_fact(c, source)?;
            if !r.record.deleted {
                source_unique(c, source, &r.record.id)?;
            }
        }
        let indexed:bool=c.query_row("SELECT date=?2 AND from_account_id IS ?3 AND to_account_id IS ?4 AND source_kind IS ?5 AND source_key IS ?6 FROM cash_movements WHERE id=?1",params![r.record.id,f.date,f.from.account(),f.to.account(),f.source.as_ref().map(|s|&s.kind),f.source.as_ref().map(|s|&s.key)],|r|r.get(0))?;
        if !indexed
            || f.source.is_some() != r.source_basis.is_some()
            || r.source_basis
                .as_ref()
                .is_some_and(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(bad("资金流动索引与内容不一致"));
        }
    }
    let mut stamp_query =
        c.prepare("SELECT created_at,updated_at,deleted_at FROM cash_movements")?;
    let mut stamps = stamp_query.query([])?;
    while let Some(r) = stamps.next()? {
        for i in 0..3 {
            if let Some(v) = r.get::<_, Option<String>>(i)? {
                chrono::DateTime::parse_from_rfc3339(&v).map_err(|_| bad("流动时间无效"))?;
            }
        }
    }
    let mut q = c.prepare("SELECT before_value,after_value,created_at FROM planning_flow_audit")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        for i in [0, 1] {
            let _: Value = serde_json::from_str(&r.get::<_, String>(i)?)?;
        }
        chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(2)?)
            .map_err(|_| bad("审计时间无效"))?;
    }
    Ok(())
}
