//! Store adapter for one complete investment-account scope. Saved inputs are
//! immutable audit references until an explicit edit; current facts are reread
//! on every review. No income rows or portfolio rates are manufactured.
use crate::{
    domain::{Error, Result},
    investment_review_component as core,
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub inflow_cents: Option<String>,
    pub outflow_cents: Option<String>,
    pub confirmed_complete: bool,
    pub unsupported_movements: bool,
    pub notes: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub from_snapshot_id: String,
    pub to_snapshot_id: String,
    pub from_value_key: String,
    pub to_value_key: String,
    pub fields: Fields,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trash {
    pub request_id: String,
    pub generation: String,
    pub id: String,
    pub expected_revision: i64,
    pub deleted: bool,
}
#[derive(Debug, Serialize)]
pub struct Record {
    pub flow: Value,
    pub deleted: bool,
}
#[derive(Debug, Serialize)]
pub struct List {
    pub generation: String,
    pub records: Vec<Record>,
}
#[derive(Debug, Serialize)]
pub struct View {
    pub generation: String,
    pub input: Value,
    pub result: Value,
    pub from_value_key: String,
    pub to_value_key: String,
    pub records: Vec<Record>,
}
fn bad(message: &str) -> Error {
    Error::new("INVESTMENT_INVALID", message)
}
fn money(value: &Option<String>) -> Result<Option<i64>> {
    value
        .as_deref()
        .map(|v| core::parse_cents(v).map_err(|_| bad("金额必须为合法的非负整数分")))
        .transpose()
}
fn flow_json(flow: &core::Flow) -> Value {
    let mut value = serde_json::to_value(flow).expect("plain flow is serializable");
    value["inflow_cents"] = json!(flow.inflow_cents.map(|v| v.to_string()));
    value["outflow_cents"] = json!(flow.outflow_cents.map(|v| v.to_string()));
    value
}
fn endpoint_json(e: &core::Endpoint) -> Value {
    json!({"snapshot_id":e.snapshot_id,"date":e.date,"revision":e.revision,"members":e.members.iter().map(|m| json!({"account_id":m.account_id,"kind":m.kind,"counted":m.counted,"amount_cents":m.amount_cents.map(|v|v.to_string())})).collect::<Vec<_>>()})
}
fn result_json(r: core::ReviewResult) -> Value {
    match r {
        core::ReviewResult::Ready { value: v } => {
            json!({"status":"ready","value":{"opening_cents":v.opening_cents.to_string(),"closing_cents":v.closing_cents.to_string(),"change_cents":v.change_cents.to_string(),"inflow_cents":v.inflow_cents.to_string(),"outflow_cents":v.outflow_cents.to_string(),"profit_cents":v.profit_cents.to_string()}})
        }
        core::ReviewResult::Blocked {
            status,
            reasons,
            change_cents,
        } => {
            json!({"status":match status {core::BlockedStatus::NotRecorded=>"not_recorded",core::BlockedStatus::NeedsReview=>"needs_review",core::BlockedStatus::NotComparable=>"not_comparable"},"reasons":reasons,"change_cents":change_cents.map(|v|v.to_string())})
        }
        core::ReviewResult::Invalid { issues } => {
            json!({"status":"invalid","issues":issues.iter().map(|i|json!({"path":i.path,"code":i.code,"message":i.message})).collect::<Vec<_>>()})
        }
    }
}
fn endpoint(c: &Connection, id: &str) -> Result<core::Endpoint> {
    let accounts = crate::wealth::accounts(c)?;
    let snap = crate::wealth::snapshot(c, id, &accounts)?.ok_or_else(|| {
        Error::new(
            "ENDPOINT_MISSING",
            "起止盘点已删除或不存在，原核对记录仍保留",
        )
    })?;
    if !snap.missing.is_empty() {
        return Err(Error::new(
            "ENDPOINT_INCOMPLETE",
            "此盘点尚有未知余额，先补齐完整盘点",
        ));
    }
    let members = snap
        .entries
        .iter()
        .filter(|e| {
            e.counted && e.side == "asset" && core::SUPPORTED_KINDS.contains(&e.kind.as_str())
        })
        .map(|e| {
            Ok(core::ScopeMember {
                account_id: e.account_id.clone(),
                kind: e.kind.clone(),
                counted: e.counted,
                amount_cents: money(&e.amount_cents)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(core::Endpoint {
        snapshot_id: snap.id,
        revision: snap.revision,
        date: snap.date,
        members,
    })
}
fn scope_key(e: &core::Endpoint) -> String {
    let mut ids = e
        .members
        .iter()
        .map(|m| m.account_id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    serde_json::to_string(&ids).expect("string list serializable")
}
fn get(c: &Connection, id: &str) -> Result<Option<(core::Flow, bool)>> {
    let raw: Option<(String, bool)> = c
        .query_row(
            "SELECT payload,deleted_at IS NOT NULL FROM investment_flows WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    raw.map(|(payload, deleted)| Ok((serde_json::from_str(&payload)?, deleted)))
        .transpose()
}
pub(crate) fn records(c: &Connection) -> Result<Vec<Record>> {
    let mut q=c.prepare("SELECT payload,deleted_at IS NOT NULL FROM investment_flows ORDER BY to_date DESC,from_date DESC,id")?;
    let rows = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))?
        .map(|r| {
            let (p, deleted) = r?;
            let flow: core::Flow = serde_json::from_str(&p)?;
            Ok(Record {
                flow: flow_json(&flow),
                deleted,
            })
        })
        .collect();
    rows
}
fn overlaps(
    c: &Connection,
    from: &str,
    to: &str,
    scope: &str,
    except: Option<&str>,
) -> Result<Vec<String>> {
    let mut q=c.prepare("SELECT id FROM investment_flows WHERE deleted_at IS NULL AND scope_key=?1 AND from_date<?3 AND to_date>?2 AND (?4 IS NULL OR id<>?4) ORDER BY id")?;
    let result = q
        .query_map(params![scope, from, to, except], |r| r.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}
fn receipt(c: &Connection, request: &str, fingerprint: &str) -> Result<Option<String>> {
    uuid::Uuid::parse_str(request).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
    let found: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [request],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match found {
        Some((f, _)) if f != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"))
        }
        Some((_, id)) => Ok(Some(id)),
        None => Ok(None),
    }
}
fn require_no_overlap(c: &Connection, flow: &core::Flow, scope: &str) -> Result<()> {
    let pair:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM investment_flows WHERE deleted_at IS NULL AND from_snapshot_id=?1 AND to_snapshot_id=?2 AND id<>?3)",params![flow.from_snapshot_id,flow.to_snapshot_id,flow.id],|r|r.get(0))?;
    if pair {
        return Err(Error::new(
            "OVERLAPPING_FLOW",
            "这两次盘点已有活动核对，请编辑旧汇总或明确删除后新增",
        ));
    }
    if !overlaps(c, &flow.from_date, &flow.to_date, scope, Some(&flow.id))?.is_empty() {
        return Err(Error::new(
            "OVERLAPPING_FLOW",
            "同一投资范围已有重叠核对；请先明确删除旧汇总，不能自动拆分或覆盖",
        ));
    }
    Ok(())
}
impl Store {
    fn investment_review_enabled(&self) -> Result<()> {
        if !crate::modules::read(&self.root).wealth {
            return Err(Error::new(
                "MODULE_DISABLED",
                "账户与盘点模块已关闭，本次未读取或写入",
            ));
        }
        Ok(())
    }
    pub fn investment_review_list(&self, generation: &str) -> Result<List> {
        self.check_generation(generation)?;
        self.investment_review_enabled()?;
        Ok(List {
            generation: self.generation(),
            records: records(self.conn()?)?,
        })
    }
    pub fn investment_review_read(
        &self,
        generation: &str,
        from_id: &str,
        to_id: &str,
    ) -> Result<View> {
        self.check_generation(generation)?;
        self.investment_review_enabled()?;
        let c = self.conn()?;
        let from = endpoint(c, from_id)?;
        let to = endpoint(c, to_id)?;
        let id:Option<String>=c.query_row("SELECT id FROM investment_flows WHERE from_snapshot_id=?1 AND to_snapshot_id=?2 AND deleted_at IS NULL ORDER BY id LIMIT 1",params![from_id,to_id],|r|r.get(0)).optional()?;
        let flow = id
            .as_deref()
            .map(|id| get(c, id))
            .transpose()?
            .flatten()
            .map(|(f, _)| f);
        let overlapping_active_flow_ids =
            overlaps(c, &from.date, &to.date, &scope_key(&from), id.as_deref())?;
        let input = core::ReviewInput {
            contract_version: 1,
            from,
            to,
            flow,
            overlapping_active_flow_ids,
        };
        Ok(View {
            generation: self.generation(),
            from_value_key: core::endpoint_value_key(&input.from),
            to_value_key: core::endpoint_value_key(&input.to),
            input: json!({"contract_version":1,"from":endpoint_json(&input.from),"to":endpoint_json(&input.to),"flow":input.flow.as_ref().map(flow_json),"overlapping_active_flow_ids":input.overlapping_active_flow_ids}),
            result: result_json(core::review_interval(&input)),
            records: records(c)?,
        })
    }
    pub fn investment_review_save(&mut self, input: &Save) -> Result<Value> {
        self.check_generation(&input.generation)?;
        self.investment_review_enabled()?;
        let fingerprint = digest(&serde_json::to_vec(&("investment_review_save", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return get(&tx, &id)?
                .map(|(f, _)| flow_json(&f))
                .ok_or_else(|| bad("回执记录不存在"));
        }
        let old = input
            .id
            .as_deref()
            .map(|id| get(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到核对记录")))
            .transpose()?;
        if old.as_ref().map(|(f, _)| f.revision) != input.expected_revision
            || old.as_ref().is_some_and(|(_, d)| *d)
        {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "核对记录已变化，请重新读取",
            ));
        }
        if old.as_ref().is_some_and(|(f, _)| {
            f.from_snapshot_id != input.from_snapshot_id || f.to_snapshot_id != input.to_snapshot_id
        }) {
            return Err(bad("已有核对的起止盘点不能更换，请删除旧汇总后新增"));
        }
        let from = endpoint(&tx, &input.from_snapshot_id)?;
        let to = endpoint(&tx, &input.to_snapshot_id)?;
        let from_key = core::endpoint_value_key(&from);
        let to_key = core::endpoint_value_key(&to);
        if input.from_value_key != from_key || input.to_value_key != to_key {
            return Err(Error::new(
                "STALE_ENDPOINTS",
                "盘点金额、日期或范围已变化，请重新读取并核对",
            ));
        }
        let scope = scope_key(&from);
        let flow = core::Flow {
            id: input.id.clone().unwrap_or_else(uid),
            revision: old.as_ref().map_or(1, |(f, _)| f.revision + 1),
            from_snapshot_id: from.snapshot_id.clone(),
            from_revision: from.revision,
            from_value_key: from_key,
            to_snapshot_id: to.snapshot_id.clone(),
            to_revision: to.revision,
            to_value_key: to_key,
            from_date: from.date.clone(),
            to_date: to.date.clone(),
            scope_account_ids: serde_json::from_str(&scope)?,
            inflow_cents: money(&input.fields.inflow_cents)?,
            outflow_cents: money(&input.fields.outflow_cents)?,
            confirmed_complete: input.fields.confirmed_complete,
            unsupported_movements: input.fields.unsupported_movements,
            notes: input.fields.notes.clone(),
        };
        if flow.confirmed_complete && flow.unsupported_movements {
            return Err(bad("有未支持资金流动时不能确认完整"));
        }
        let check = core::review_interval(&core::ReviewInput {
            contract_version: 1,
            from,
            to,
            flow: Some(flow.clone()),
            overlapping_active_flow_ids: vec![],
        });
        match check {
            core::ReviewResult::Invalid { issues } => {
                return Err(bad(&issues
                    .iter()
                    .map(|i| i.message.as_str())
                    .collect::<Vec<_>>()
                    .join("；")))
            }
            core::ReviewResult::Blocked {
                status: core::BlockedStatus::NotComparable,
                ..
            } => {
                return Err(Error::new(
                    "NOT_COMPARABLE",
                    "两端投资范围不可比较，请核对盘点",
                ))
            }
            _ => {}
        }
        require_no_overlap(&tx, &flow, &scope)?;
        let now = chrono::Utc::now().to_rfc3339();
        let payload = serde_json::to_string(&flow)?;
        tx.execute("INSERT INTO investment_flows(id,revision,from_snapshot_id,to_snapshot_id,from_date,to_date,scope_key,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,from_date=excluded.from_date,to_date=excluded.to_date,scope_key=excluded.scope_key,payload=excluded.payload,updated_at=excluded.updated_at",params![flow.id,flow.revision,flow.from_snapshot_id,flow.to_snapshot_id,flow.from_date,flow.to_date,scope,payload,now])?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, flow.id],
        )?;
        self.hit("investment_review.before_commit")?;
        tx.commit()?;
        self.hit("investment_review.after_commit")?;
        Ok(flow_json(&flow))
    }
    pub fn investment_review_trash(&mut self, input: &Trash) -> Result<()> {
        self.check_generation(&input.generation)?;
        self.investment_review_enabled()?;
        let fingerprint = digest(&serde_json::to_vec(&("investment_review_trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if receipt(&tx, &input.request_id, &fingerprint)?.is_some() {
            return Ok(());
        }
        let (mut flow, deleted) =
            get(&tx, &input.id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到核对记录"))?;
        if flow.revision != input.expected_revision || deleted == input.deleted {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "核对记录已变化，请重新读取",
            ));
        }
        if !input.deleted {
            let mut ids = flow.scope_account_ids.clone();
            ids.sort();
            require_no_overlap(&tx, &flow, &serde_json::to_string(&ids)?)?;
        }
        flow.revision += 1;
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute("UPDATE investment_flows SET revision=?2,payload=?3,updated_at=?4,deleted_at=?5 WHERE id=?1",params![input.id,flow.revision,serde_json::to_string(&flow)?,now,if input.deleted{Some(now.clone())}else{None}])?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.id],
        )?;
        self.hit("investment_review.before_commit")?;
        tx.commit()?;
        self.hit("investment_review.after_commit")?;
        Ok(())
    }
}

// A saved key is the original factual endpoint, so validate the original payload
// even when current endpoints have changed or been deleted. Do not force-reset it.
fn saved_endpoint(key: &str, revision: i64) -> Result<core::Endpoint> {
    let v: Value = serde_json::from_str(key)?;
    let a = v
        .as_array()
        .filter(|a| a.len() == 3)
        .ok_or_else(|| bad("端点键结构无效"))?;
    let string = |v: &Value| {
        v.as_str()
            .map(str::to_owned)
            .ok_or_else(|| bad("端点键字段无效"))
    };
    let members = a[2]
        .as_array()
        .ok_or_else(|| bad("端点成员无效"))?
        .iter()
        .map(|v| {
            let r = v
                .as_array()
                .filter(|r| r.len() == 4)
                .ok_or_else(|| bad("端点成员无效"))?;
            let amount = if r[3].is_null() {
                None
            } else {
                Some(string(&r[3])?)
            };
            Ok(core::ScopeMember {
                account_id: string(&r[0])?,
                kind: string(&r[1])?,
                counted: r[2].as_bool().ok_or_else(|| bad("计入标记无效"))?,
                amount_cents: money(&amount)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(core::Endpoint {
        snapshot_id: string(&a[0])?,
        date: string(&a[1])?,
        revision,
        members,
    })
}
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut q=c.prepare("SELECT id,revision,from_snapshot_id,to_snapshot_id,from_date,to_date,scope_key,payload,created_at,updated_at,deleted_at FROM investment_flows")?;
    let mut rows = q.query([])?;
    while let Some(row) = rows.next()? {
        let flow: core::Flow = serde_json::from_str(&row.get::<_, String>(7)?)?;
        let from = saved_endpoint(&flow.from_value_key, flow.from_revision)?;
        let to = saved_endpoint(&flow.to_value_key, flow.to_revision)?;
        if uuid::Uuid::parse_str(&flow.id).is_err()
            || flow.id != row.get::<_, String>(0)?
            || flow.revision != row.get::<_, i64>(1)?
            || flow.revision < 1
            || flow.from_revision < 1
            || flow.to_revision < 1
            || flow.from_snapshot_id != row.get::<_, String>(2)?
            || flow.to_snapshot_id != row.get::<_, String>(3)?
            || flow.from_date != row.get::<_, String>(4)?
            || flow.to_date != row.get::<_, String>(5)?
            || scope_key(&from) != row.get::<_, String>(6)?
        {
            return Err(bad("核对记录索引与内容不一致"));
        }
        if flow.from_value_key != core::endpoint_value_key(&from)
            || flow.to_value_key != core::endpoint_value_key(&to)
            || flow.confirmed_complete && flow.unsupported_movements
        {
            return Err(bad("核对记录内容键或完整性无效"));
        }
        let check = core::review_interval(&core::ReviewInput {
            contract_version: 1,
            from,
            to,
            flow: Some(flow.clone()),
            overlapping_active_flow_ids: vec![],
        });
        match check {
            core::ReviewResult::Invalid { .. }
            | core::ReviewResult::Blocked {
                status: core::BlockedStatus::NotComparable,
                ..
            } => return Err(bad("核对记录载荷无效")),
            core::ReviewResult::Blocked { reasons, .. }
                if reasons.contains(&core::REASON_STALE_ENDPOINTS) =>
            {
                return Err(bad("原始核对端点无效"))
            }
            _ => {}
        }
        for n in [8, 9, 10] {
            if let Some(value) = row.get::<_, Option<String>>(n)? {
                chrono::DateTime::parse_from_rfc3339(&value)
                    .map_err(|_| bad("核对记录时间无效"))?;
            }
        }
        if row.get::<_, Option<String>>(10)?.is_none() {
            require_no_overlap(c, &flow, &row.get::<_, String>(6)?)?;
        }
    }
    Ok(())
}
