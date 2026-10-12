//! Selection authority, content keys and invalidation around the existing review core.
use crate::{
    cash_movement as movement,
    domain::{Error, Result},
    investment_review as old, investment_review_component as core,
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pair {
    pub from_snapshot_id: String,
    pub to_snapshot_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum Selection {
    Manual {
        inflow_cents: Option<String>,
        outflow_cents: Option<String>,
    },
    Movements,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub selection: Selection,
    pub confirmed_complete: bool,
    pub unsupported_movements: bool,
    pub notes: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub pair: Pair,
    pub draft: Draft,
    pub basis_key: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    draft: Draft,
    basis_key: String,
    needs_review: bool,
}
fn mode(s: &Selection) -> &'static str {
    match s {
        Selection::Manual { .. } => "manual",
        Selection::Movements => "movements",
    }
}
fn draft_of(f: &core::Flow) -> Draft {
    Draft {
        selection: Selection::Manual {
            inflow_cents: f.inflow_cents.map(|n| n.to_string()),
            outflow_cents: f.outflow_cents.map(|n| n.to_string()),
        },
        confirmed_complete: f.confirmed_complete,
        unsupported_movements: f.unsupported_movements,
        notes: f.notes.clone(),
    }
}
fn meta(c: &Connection, id: &str) -> Result<Option<Metadata>> {
    let row: Option<(String, String, bool)> = c
        .query_row(
            "SELECT draft,basis_key,needs_review FROM investment_flow_sources WHERE flow_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    row.map(|(d, b, n)| {
        Ok(Metadata {
            draft: serde_json::from_str(&d)?,
            basis_key: b,
            needs_review: n,
        })
    })
    .transpose()
}
fn current(c: &Connection, pair: &Pair) -> Result<Option<core::Flow>> {
    let id:Option<String>=c.query_row("SELECT id FROM investment_flows WHERE from_snapshot_id=?1 AND to_snapshot_id=?2 AND deleted_at IS NULL ORDER BY id LIMIT 1",params![pair.from_snapshot_id,pair.to_snapshot_id],|r|r.get(0)).optional()?;
    id.as_deref()
        .map(|id| old::get(c, id).map(|r| r.map(|(f, _)| f)))
        .transpose()
        .map(Option::flatten)
}
fn amount(v: &Option<String>) -> Result<Option<i64>> {
    v.as_deref()
        .map(|v| {
            core::parse_cents(v)
                .map_err(|_| Error::new("INVALID_INPUT", "合计须为合法的非负整数分"))
        })
        .transpose()
}
fn totals_json(i: Option<i64>, o: Option<i64>) -> Value {
    json!({"inflow_cents":i.map(|n|n.to_string()),"outflow_cents":o.map(|n|n.to_string())})
}
fn reason(code: &str, message: &str) -> Value {
    json!({"path":"movements","code":code,"message":message})
}
fn relevant(f: &movement::Fields, from: &str, to: &str, scope: &BTreeSet<String>) -> bool {
    f.date.as_str() > from
        && f.date.as_str() <= to
        && [f.from.account(), f.to.account()]
            .into_iter()
            .flatten()
            .any(|id| scope.contains(id))
}
/// Count transfers against one explicit scope. Internal transfers cancel; costs remain net losses.
pub fn classify(fields: &movement::Fields, scope: &BTreeSet<String>) -> Result<(i64, i64)> {
    let n = core::parse_cents(&fields.amount_cents)
        .map_err(|_| Error::new("INVALID_INPUT", "流动金额无效"))?;
    if fields.purpose == "investment_cost" {
        return Ok((0, 0));
    }
    let inside = |e: &movement::Endpoint| e.account().is_some_and(|id| scope.contains(id));
    Ok(match (inside(&fields.from), inside(&fields.to)) {
        (false, true) => (n, 0),
        (true, false) => (0, n),
        _ => (0, 0),
    })
}
struct Computed {
    preview: Value,
    flow: core::Flow,
    draft: Draft,
    key: String,
}
fn compute(
    c: &Connection,
    pair: &Pair,
    draft: &Draft,
    generation: &str,
    saved_result: bool,
    historical_flow: Option<&core::Flow>,
    runtime: Option<&crate::modules::RuntimeModules>,
) -> Result<Computed> {
    let from = old::endpoint(c, &pair.from_snapshot_id)?;
    let to = old::endpoint(c, &pair.to_snapshot_id)?;
    let saved = match historical_flow {
        Some(f) => Some(f.clone()),
        None => current(c, pair)?,
    };
    let metadata = saved
        .as_ref()
        .map(|f| meta(c, &f.id))
        .transpose()?
        .flatten();
    let scope: BTreeSet<String> = from
        .members
        .iter()
        .chain(&to.members)
        .filter(|m| m.counted)
        .map(|m| m.account_id.clone())
        .collect();
    let movements_enabled = runtime.is_none_or(|m| m.movements && m.modules.wealth);
    let unavailable = !movements_enabled && matches!(draft.selection, Selection::Movements);
    let rows = if movements_enabled {
        movement::all_visible(c, runtime)?
    } else {
        vec![]
    };
    let relevant_rows = rows
        .iter()
        .filter(|r| relevant(&r.record.fields, &from.date, &to.date, &scope))
        .collect::<Vec<_>>();
    let active = relevant_rows
        .iter()
        .filter(|r| !r.record.deleted)
        .collect::<Vec<_>>();
    let mut ins = 0i64;
    let mut outs = 0i64;
    let mut reasons = vec![];
    for r in &active {
        let (i, o) = classify(&r.record.fields, &scope)?;
        ins = ins
            .checked_add(i)
            .filter(|n| *n <= core::MAX_CENTS)
            .ok_or_else(|| Error::new("INVALID_INPUT", "区间转入合计超出范围"))?;
        outs = outs
            .checked_add(o)
            .filter(|n| *n <= core::MAX_CENTS)
            .ok_or_else(|| Error::new("INVALID_INPUT", "区间转出合计超出范围"))?;
        match r.record.source_status.as_str() {
            "needs_review" => reasons.push(reason(
                "source_mismatch",
                "关联来源已更正，请核对或解除关联",
            )),
            "deleted" => reasons.push(reason("source_deleted", "关联来源已删除，请核对或解除关联")),
            _ => {}
        }
    }
    // An investment fee paid outside the scope is disclosed, never silently subtracted.
    if rows.iter().any(|r| {
        !r.record.deleted
            && r.record.fields.date > from.date
            && r.record.fields.date <= to.date
            && r.record.fields.purpose == "investment_cost"
            && !r
                .record
                .fields
                .from
                .account()
                .is_some_and(|id| scope.contains(id))
    }) {
        reasons.push(reason(
            "external_cost_excluded",
            "所选投资范围损益未包含范围外账户支付的投资费用",
        ));
    }
    let (inflow, outflow) = match &draft.selection {
        Selection::Manual {
            inflow_cents,
            outflow_cents,
        } => (amount(inflow_cents)?, amount(outflow_cents)?),
        Selection::Movements if unavailable => (None, None),
        Selection::Movements => (Some(ins), Some(outs)),
    };
    let facts = relevant_rows
        .iter()
        .map(|r| {
            Ok(json!([
                r.record.id,
                r.fact_revision,
                movement::facts(&r.record.fields),
                r.record.deleted,
                r.record.source_status,
                r.source_basis,
                r.live_source_basis
            ]))
        })
        .collect::<Result<Vec<Value>>>()?;
    let key = digest(&serde_json::to_vec(&(
        "review-basis-v1",
        core::endpoint_value_key(&from),
        core::endpoint_value_key(&to),
        &draft.selection,
        draft.confirmed_complete,
        draft.unsupported_movements,
        facts,
    ))?);
    let overlaps = old::overlaps(
        c,
        &from.date,
        &to.date,
        &old::scope_key(&from),
        saved.as_ref().map(|f| f.id.as_str()),
    )?;
    let candidate = core::Flow {
        id: saved.as_ref().map_or_else(uid, |f| f.id.clone()),
        revision: saved.as_ref().map_or(1, |f| f.revision),
        from_snapshot_id: from.snapshot_id.clone(),
        to_snapshot_id: to.snapshot_id.clone(),
        from_revision: from.revision,
        to_revision: to.revision,
        from_value_key: core::endpoint_value_key(&from),
        to_value_key: core::endpoint_value_key(&to),
        from_date: from.date.clone(),
        to_date: to.date.clone(),
        scope_account_ids: from
            .members
            .iter()
            .filter(|m| m.counted)
            .map(|m| m.account_id.clone())
            .collect(),
        inflow_cents: inflow,
        outflow_cents: outflow,
        confirmed_complete: draft.confirmed_complete,
        unsupported_movements: draft.unsupported_movements,
        notes: draft.notes.clone(),
    };
    // Endpoint value keys are independently checked by review_interval below.
    // While movements are disabled, the saved basis includes unavailable movement
    // facts and cannot be compared; persisted invalidation still remains binding.
    let stale = metadata
        .as_ref()
        .is_some_and(|m| m.needs_review || (movements_enabled && m.basis_key != key))
        || metadata.is_none() && saved.is_some() && !relevant_rows.is_empty();
    let source_bad = reasons
        .iter()
        .any(|r| r["code"] == "source_mismatch" || r["code"] == "source_deleted");
    let input = core::ReviewInput {
        contract_version: 1,
        from,
        to,
        flow: Some(if saved_result {
            saved.clone().unwrap_or_else(|| candidate.clone())
        } else {
            candidate.clone()
        }),
        overlapping_active_flow_ids: overlaps,
    };
    let mut result = old::result_json(core::review_interval(&input));
    if (saved_result && stale) || source_bad {
        if saved_result && stale {
            reasons.push(reason("stale_movements", "资金流动依据已变化，请重新核对"));
        }
        // Preserve the core's invalid / not-comparable precedence. Never expose a stale ready amount.
        if result["status"] != "invalid" && result["status"] != "not_comparable" {
            let change = if result["status"] == "ready" {
                result["value"]["change_cents"].clone()
            } else {
                result["change_cents"].clone()
            };
            let mut codes = result["reasons"].as_array().cloned().unwrap_or_default();
            for r in &reasons {
                if r["code"] != "external_cost_excluded" && !codes.contains(&r["code"]) {
                    codes.push(r["code"].clone());
                }
            }
            result = json!({"status":"needs_review","change_cents":change,"reasons":codes});
        }
    }
    if unavailable {
        result = json!({"status":"unavailable","reasons":["movements_disabled"]});
    }
    let previous = saved
        .as_ref()
        .map(|f| totals_json(f.inflow_cents, f.outflow_cents));
    let difference = totals_json(
        inflow
            .zip(saved.as_ref().and_then(|f| f.inflow_cents))
            .map(|(n, o)| n - o),
        outflow
            .zip(saved.as_ref().and_then(|f| f.outflow_cents))
            .map(|(n, o)| n - o),
    );
    let confirmation = if unavailable {
        "unavailable"
    } else if saved.as_ref().is_some_and(|f| f.confirmed_complete) {
        if stale || source_bad || (saved_result && result["status"] != "ready") {
            "needs_review"
        } else {
            "confirmed"
        }
    } else {
        "unconfirmed"
    };
    let input_json = json!({"contract_version":1,"from":old::endpoint_json(&input.from),"to":old::endpoint_json(&input.to),"flow":if saved.is_some(){input.flow.as_ref().map(old::flow_json)}else{None},"overlapping_active_flow_ids":input.overlapping_active_flow_ids});
    let preview = json!({"generation":generation,"pair":pair,"review_id":saved.as_ref().map(|f|&f.id),"revision":saved.as_ref().map(|f|f.revision),"input":input_json,"result":result,"saved_mode":saved.as_ref().map(|_|metadata.as_ref().map_or("manual",|m|mode(&m.draft.selection))),"selected":draft.selection,"previous_totals":previous,"selected_totals":totals_json(inflow,outflow),"difference":difference,"movement_count":if unavailable { Value::Null } else { json!(active.len()) },"confirmation":confirmation,"reasons":reasons,"basis_key":key});
    Ok(Computed {
        preview,
        flow: candidate,
        draft: draft.clone(),
        key,
    })
}
fn persist(c: &Connection, f: &core::Flow, draft: &Draft, key: &str) -> Result<()> {
    c.execute("INSERT INTO investment_flow_sources(flow_id,mode,draft,basis_key,needs_review) VALUES(?1,?2,?3,?4,0) ON CONFLICT(flow_id) DO UPDATE SET mode=excluded.mode,draft=excluded.draft,basis_key=excluded.basis_key,needs_review=0",params![f.id,mode(&draft.selection),serde_json::to_string(draft)?,key])?;
    Ok(())
}
pub(crate) fn invalidate_movement(
    c: &Connection,
    before: Option<&movement::Fields>,
    after: Option<&movement::Fields>,
) -> Result<()> {
    for r in old::records(c)? {
        let id = r.flow["id"]
            .as_str()
            .ok_or_else(|| Error::new("FORMAT", "核对标识无效"))?;
        let (flow, _) = old::get(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "核对不存在"))?;
        let scope = flow.scope_account_ids.iter().cloned().collect();
        if [before, after]
            .into_iter()
            .flatten()
            .any(|f| relevant(f, &flow.from_date, &flow.to_date, &scope))
        {
            if meta(c, id)?.is_none() {
                persist(c, &flow, &draft_of(&flow), "")?;
            }
            c.execute(
                "UPDATE investment_flow_sources SET needs_review=1 WHERE flow_id=?1",
                [id],
            )?;
        }
    }
    Ok(())
}
pub(crate) fn invalidate_source(c: &Connection, kind: &str, key: &str) -> Result<()> {
    for r in movement::all(c)? {
        if r.record
            .fields
            .source
            .as_ref()
            .is_some_and(|s| s.kind == kind && s.key == key)
        {
            invalidate_movement(c, Some(&r.record.fields), None)?;
        }
    }
    Ok(())
}
/// Existing v37 readers must also stop rendering confirmed profit after related changes.
pub(crate) fn saved_result(
    c: &Connection,
    input: &core::ReviewInput,
    result: Value,
    runtime: &crate::modules::RuntimeModules,
) -> Result<Value> {
    let Some(flow) = &input.flow else {
        return Ok(result);
    };
    let draft = meta(c, &flow.id)?.map_or_else(|| draft_of(flow), |m| m.draft);
    let checked = compute(
        c,
        &Pair {
            from_snapshot_id: input.from.snapshot_id.clone(),
            to_snapshot_id: input.to.snapshot_id.clone(),
        },
        &draft,
        "",
        true,
        Some(flow),
        Some(runtime),
    )?;
    Ok(checked.preview["result"].clone())
}
pub(crate) fn require_saved_mode(
    s: &Store,
    c: &Connection,
    id: &str,
    generation: &str,
) -> Result<()> {
    if meta(c, id)?.is_some_and(|m| matches!(m.draft.selection, Selection::Movements)) {
        movement::enabled(s, generation)?;
    }
    Ok(())
}
pub(crate) fn guard_legacy(
    c: &Connection,
    flow: &core::Flow,
    runtime: &crate::modules::RuntimeModules,
) -> Result<()> {
    if meta(c, &flow.id)?.is_some_and(|m| mode(&m.draft.selection) == "movements") {
        return Err(Error::new(
            "FOLLOWUP_REQUIRED",
            "明细来源核对请使用资金流动端口保存",
        ));
    }
    let scope = flow.scope_account_ids.iter().cloned().collect();
    if runtime.movements
        && flow.confirmed_complete
        && movement::all_visible(c, Some(runtime))?
            .iter()
            .any(|r| relevant(&r.record.fields, &flow.from_date, &flow.to_date, &scope))
    {
        return Err(Error::new(
            "FOLLOWUP_REQUIRED",
            "有相关流动时请先核对内容依据再确认",
        ));
    }
    Ok(())
}
pub(crate) fn legacy_saved(
    c: &Connection,
    flow: &core::Flow,
    runtime: &crate::modules::RuntimeModules,
) -> Result<()> {
    let draft = draft_of(flow);
    let pair = Pair {
        from_snapshot_id: flow.from_snapshot_id.clone(),
        to_snapshot_id: flow.to_snapshot_id.clone(),
    };
    let candidate = compute(c, &pair, &draft, "", false, None, Some(runtime))?;
    persist(c, flow, &draft, &candidate.key)
}
impl Store {
    pub fn followup_review_read(&self, pair: &Pair, generation: &str) -> Result<Value> {
        self.check_generation(generation)?;
        self.investment_review_enabled()?;
        let runtime = crate::modules::read_runtime(&self.root);
        let tx = self.conn()?.unchecked_transaction()?;
        let f = current(&tx, pair)?;
        let draft = if let Some(f) = f {
            meta(&tx, &f.id)?.map_or_else(|| draft_of(&f), |m| m.draft)
        } else {
            Draft {
                selection: Selection::Manual {
                    inflow_cents: None,
                    outflow_cents: None,
                },
                confirmed_complete: false,
                unsupported_movements: false,
                notes: String::new(),
            }
        };
        let mut preview =
            compute(&tx, pair, &draft, generation, true, None, Some(&runtime))?.preview;
        if preview["review_id"].is_null() {
            let from = old::endpoint(&tx, &pair.from_snapshot_id)?;
            let to = old::endpoint(&tx, &pair.to_snapshot_id)?;
            preview["result"] = old::result_json(core::review_interval(&core::ReviewInput {
                contract_version: 1,
                from,
                to,
                flow: None,
                overlapping_active_flow_ids: serde_json::from_value(
                    preview["input"]["overlapping_active_flow_ids"].clone(),
                )?,
            }));
        }
        Ok(json!({"draft":draft,"preview":preview}))
    }
    pub fn followup_review_preview(
        &self,
        pair: &Pair,
        draft: &Draft,
        generation: &str,
    ) -> Result<Value> {
        self.check_generation(generation)?;
        self.investment_review_enabled()?;
        let runtime = crate::modules::read_runtime(&self.root);
        let tx = self.conn()?.unchecked_transaction()?;
        Ok(compute(&tx, pair, draft, generation, false, None, Some(&runtime))?.preview)
    }
    pub fn followup_review_list(&self, generation: &str) -> Result<Value> {
        self.check_generation(generation)?;
        self.investment_review_enabled()?;
        let runtime = crate::modules::read_runtime(&self.root);
        let tx = self.conn()?.unchecked_transaction()?;
        let mut rows = vec![];
        for record in old::records(&tx)? {
            let id = record.flow["id"]
                .as_str()
                .ok_or_else(|| Error::new("FORMAT", "核对标识无效"))?;
            let (f, _) = old::get(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "核对不存在"))?;
            let m = meta(&tx, id)?;
            let pair = Pair {
                from_snapshot_id: f.from_snapshot_id.clone(),
                to_snapshot_id: f.to_snapshot_id.clone(),
            };
            let draft = m.as_ref().map_or_else(|| draft_of(&f), |m| m.draft.clone());
            let confirmation = match compute(
                &tx,
                &pair,
                &draft,
                generation,
                true,
                Some(&f),
                Some(&runtime),
            ) {
                Ok(v) => v.preview["confirmation"].clone(),
                Err(e)
                    if ["ENDPOINT_MISSING", "ENDPOINT_INCOMPLETE"].contains(&e.code.as_str()) =>
                {
                    json!(if f.confirmed_complete {
                        "needs_review"
                    } else {
                        "unconfirmed"
                    })
                }
                Err(e) => return Err(e),
            };
            rows.push(json!({"id":id,"revision":f.revision,"deleted":record.deleted,"pair":pair,"from_date":f.from_date,"to_date":f.to_date,"mode":mode(&draft.selection),"confirmation":confirmation}));
        }
        Ok(json!({"generation":generation,"records":rows}))
    }
    pub fn followup_review_save(&mut self, input: &Save) -> Result<movement::Saved> {
        self.check_generation(&input.generation)?;
        let runtime = crate::modules::read_runtime(&self.root);
        let fingerprint = digest(&serde_json::to_vec(&("followup_review_save", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = movement::receipt(&tx, &input.request_id, &fingerprint)? {
            let (f, _) =
                old::get(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "回执核对记录不存在"))?;
            return Ok(movement::Saved {
                id,
                revision: f.revision,
            });
        }
        self.investment_review_enabled()?;
        if matches!(input.draft.selection, Selection::Movements) {
            movement::enabled(self, &input.generation)?;
        }
        let previous = current(&tx, &input.pair)?;
        if previous.as_ref().map(|f| f.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "核对记录已变化，请重新读取",
            ));
        }
        let computed = compute(
            &tx,
            &input.pair,
            &input.draft,
            &input.generation,
            false,
            None,
            Some(&runtime),
        )?;
        if computed.key != input.basis_key {
            return Err(Error::new(
                "STALE_BASIS",
                "盘点、流动或关联依据已变化，请重新预览",
            ));
        }
        if computed.preview["result"]["status"] == "invalid" {
            return Err(Error::new("INVALID_INPUT", "核对字段无效"));
        }
        if computed.preview["result"]["status"] == "not_comparable" {
            return Err(Error::new("NOT_COMPARABLE", "两端投资范围不可比较"));
        }
        if input.draft.confirmed_complete && computed.preview["result"]["status"] != "ready" {
            return Err(Error::new(
                "INVALID_INPUT",
                "有未知合计、未支持流动或关联问题时不能确认完整",
            ));
        }
        let mut flow = computed.flow;
        flow.revision = previous.as_ref().map_or(1, |f| f.revision + 1);
        let scope = old::scope_key(&old::endpoint(&tx, &input.pair.from_snapshot_id)?);
        old::require_no_overlap(&tx, &flow, &scope)?;
        let before = previous
            .as_ref()
            .map(|f| Ok::<_, Error>(json!({"flow":f,"metadata":meta(&tx,&f.id)?})))
            .transpose()?
            .unwrap_or(Value::Null);
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute("INSERT INTO investment_flows(id,revision,from_snapshot_id,to_snapshot_id,from_date,to_date,scope_key,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,from_date=excluded.from_date,to_date=excluded.to_date,scope_key=excluded.scope_key,payload=excluded.payload,updated_at=excluded.updated_at",params![flow.id,flow.revision,flow.from_snapshot_id,flow.to_snapshot_id,flow.from_date,flow.to_date,scope,serde_json::to_string(&flow)?,now])?;
        persist(&tx, &flow, &computed.draft, &computed.key)?;
        movement::audit(
            &tx,
            "review",
            &flow.id,
            &input.request_id,
            before,
            json!({"flow":flow,"metadata":meta(&tx,&flow.id)?}),
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, flow.id],
        )?;
        self.hit("followup_review.before_commit")?;
        tx.commit()?;
        self.hit("followup_review.after_commit")?;
        Ok(movement::Saved {
            id: flow.id,
            revision: flow.revision,
        })
    }
    pub fn followup_review_trash(&mut self, input: &movement::Trash) -> Result<movement::Saved> {
        self.check_generation(&input.generation)?;
        let revision = input
            .expected_revision
            .ok_or_else(|| Error::new("INVALID_INPUT", "删除或恢复需记录修订"))?;
        self.investment_review_trash(&old::Trash {
            request_id: input.request_id.clone(),
            generation: input.generation.clone(),
            id: input.id.clone(),
            expected_revision: revision,
            deleted: input.deleted,
        })?;
        let (f, _) = old::get(self.conn()?, &input.id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "核对不存在"))?;
        Ok(movement::Saved {
            id: f.id,
            revision: f.revision,
        })
    }
}
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut q =
        c.prepare("SELECT flow_id,mode,draft,basis_key,needs_review FROM investment_flow_sources")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let d: Draft = serde_json::from_str(&r.get::<_, String>(2)?)?;
        let b: String = r.get(3)?;
        let needs: bool = r.get(4)?;
        let (f, _) =
            old::get(c, &id)?.ok_or_else(|| Error::new("DATA_CONSTRAINT", "核对来源引用不存在"))?;
        let (i, o) = match &d.selection {
            Selection::Manual {
                inflow_cents,
                outflow_cents,
            } => (amount(inflow_cents)?, amount(outflow_cents)?),
            Selection::Movements => (f.inflow_cents, f.outflow_cents),
        };
        if r.get::<_, String>(1)? != mode(&d.selection)
            || b.is_empty() && !needs
            || !b.is_empty() && (b.len() != 64 || !b.bytes().all(|b| b.is_ascii_hexdigit()))
            || i != f.inflow_cents
            || o != f.outflow_cents
            || d.confirmed_complete != f.confirmed_complete
            || d.unsupported_movements != f.unsupported_movements
            || d.notes != f.notes
        {
            return Err(Error::new("DATA_CONSTRAINT", "核对来源结构或内容不一致"));
        }
    }
    Ok(())
}

pub(crate) fn export_metadata(c: &Connection, id: &str) -> Result<Value> {
    let (f, _) = old::get(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "核对不存在"))?;
    let m = meta(c, id)?;
    let draft = m.as_ref().map_or_else(|| draft_of(&f), |m| m.draft.clone());
    let pair = Pair {
        from_snapshot_id: f.from_snapshot_id.clone(),
        to_snapshot_id: f.to_snapshot_id.clone(),
    };
    let confirmation = match compute(c, &pair, &draft, "", true, Some(&f), None) {
        Ok(v) => v.preview["confirmation"].clone(),
        Err(e) if ["ENDPOINT_MISSING", "ENDPOINT_INCOMPLETE"].contains(&e.code.as_str()) => {
            json!(if f.confirmed_complete {
                "needs_review"
            } else {
                "unconfirmed"
            })
        }
        Err(e) => return Err(e),
    };
    Ok(
        json!({"mode":mode(&draft.selection),"confirmation":confirmation,"draft":draft,"basis_key":m.map(|m|m.basis_key)}),
    )
}
