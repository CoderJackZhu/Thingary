use super::{money, row, yes, ExportSheet};
use crate::{cash_movement::Endpoint, domain::Result, storage::Store};

pub(super) fn sheets(store: &Store) -> Result<Vec<ExportSheet>> {
    let c = store.conn()?;
    let accounts = super::account_names(c)?;
    let name = |id: &str| {
        accounts
            .get(id)
            .cloned()
            .unwrap_or_else(|| "关联账户已清除".into())
    };
    let endpoint = |e: &Endpoint| match e {
        Endpoint::Account { account_id } => name(account_id),
        Endpoint::External { label } => label.clone(),
    };
    let mut movements = vec![row(&[
        "结算日期",
        "转出方",
        "转入方",
        "金额（元）",
        "用途",
        "来源",
        "来源状态",
        "备注",
        "记录编号",
    ])];
    for stored in crate::cash_movement::all(c)? {
        let r = stored.record;
        if r.deleted {
            continue;
        }
        let f = r.fields;
        movements.push(vec![
            f.date,
            endpoint(&f.from),
            endpoint(&f.to),
            money(f.amount_cents.parse().ok()),
            label(&f.purpose).into(),
            f.source
                .as_ref()
                .map(|s| label(&s.kind).to_owned())
                .unwrap_or_else(|| "手动记录".into()),
            label(&r.source_status).into(),
            f.notes,
            r.id,
        ]);
    }
    let mut expenses = vec![row(&[
        "日期",
        "名称",
        "来源",
        "金额（元）",
        "计入方式",
        "备注",
        "来源编号",
    ])];
    let mut lines = crate::expenses::lines_for_modules(c, &crate::modules::Modules::default())?;
    lines.sort_by(|a, b| (&a.date, &a.source, &a.id).cmp(&(&b.date, &b.source, &b.id)));
    for l in lines {
        let treatment = match l.source.as_str() {
            "linked" => "关联参考，不重复计入",
            "refund" => "退款",
            "sale" => "售出回收",
            _ => "支出",
        };
        expenses.push(vec![
            l.date.unwrap_or_default(),
            l.title,
            label(&l.source).into(),
            money(l.amount_cents.as_deref().and_then(|v| v.parse().ok())),
            treatment.into(),
            l.notes.unwrap_or_default(),
            l.id,
        ]);
    }
    let mut snapshots = vec![row(&[
        "盘点日期",
        "备注",
        "完整性",
        "账户数",
        "已填写",
        "沿用上次",
        "未填写",
        "盘点编号",
    ])];
    let live = crate::wealth::accounts(c)?;
    let mut q =
        c.prepare("SELECT id FROM fin_snapshots WHERE deleted_at IS NULL ORDER BY date,id")?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for id in ids {
        let s = crate::wealth::snapshot(c, &id, &live)?
            .ok_or_else(|| crate::domain::Error::new("NOT_FOUND", "盘点不存在"))?;
        let entered = s.entries.iter().filter(|e| e.state == "entered").count();
        let unchanged = s.entries.iter().filter(|e| e.state == "unchanged").count();
        let count = s.entries.len()
            + s.missing
                .iter()
                .filter(|id| !s.entries.iter().any(|e| &e.account_id == *id))
                .count();
        snapshots.push(vec![
            s.date,
            s.notes,
            if !s.missing.is_empty() {
                "有未填写余额"
            } else if count == 0 {
                "没有账户明细"
            } else {
                "完整"
            }
            .into(),
            count.to_string(),
            entered.to_string(),
            unchanged.to_string(),
            s.missing.len().to_string(),
            id,
        ]);
    }

    let mut goals = vec![row(&[
        "名称",
        "目标金额（元）",
        "目标日期",
        "关联账户",
        "备注",
        "创建日期",
        "目标编号",
    ])];
    let mut links = vec![row(&[
        "目标名称",
        "账户名称",
        "账户状态",
        "目标编号",
        "账户编号",
    ])];
    for g in crate::savings_goals::list(c, false)? {
        let names = g.account_ids.iter().map(|id| name(id)).collect::<Vec<_>>();
        for id in &g.account_ids {
            let deleted: bool = c.query_row(
                "SELECT deleted_at IS NOT NULL FROM fin_accounts WHERE id=?1",
                [id],
                |r| r.get(0),
            )?;
            links.push(vec![
                g.fields.name.clone(),
                name(id),
                if deleted {
                    "账户已删除（关系中仍保留）"
                } else {
                    "账户仍保留"
                }
                .into(),
                g.id.clone(),
                id.clone(),
            ]);
        }
        goals.push(vec![
            g.fields.name,
            money(g.fields.target_cents.parse().ok()),
            g.fields.target_date.unwrap_or_default(),
            names.join("、"),
            g.fields.notes,
            g.created_on,
            g.id,
        ]);
    }
    let mut reviews = vec![row(&[
        "期初日期",
        "期末日期",
        "账户范围",
        "转入（元）",
        "转出（元）",
        "已确认完整",
        "含未支持流动",
        "来源方式",
        "当前核对状态",
        "备注",
        "记录编号",
    ])];
    for r in crate::investment_review::records(c)? {
        if r.deleted {
            continue;
        }
        let f = r.flow;
        let id = f["id"].as_str().unwrap_or_default();
        let source = crate::planning_flow_review::export_metadata(c, id)?;
        let scope = f["scope_account_ids"]
            .as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(|v| v.as_str())
                    .map(name)
                    .collect::<Vec<_>>()
                    .join("、")
            })
            .unwrap_or_default();
        reviews.push(vec![
            string(&f["from_date"]),
            string(&f["to_date"]),
            scope,
            value_money(&f["inflow_cents"]),
            value_money(&f["outflow_cents"]),
            yes(f["confirmed_complete"].as_bool().unwrap_or(false)),
            yes(f["unsupported_movements"].as_bool().unwrap_or(false)),
            label(source["mode"].as_str().unwrap_or("manual")).into(),
            label(source["confirmation"].as_str().unwrap_or("unconfirmed")).into(),
            string(&f["notes"]),
            id.into(),
        ]);
    }
    let mut assumptions = vec![row(&["假设", "保存值（%）", "核对状态", "曾确认值（%）"])];
    if let Some(v) = crate::plan_assumptions::export_value(c)? {
        for (key, title) in [
            ("real_return_before_hundredths", "退休前实际收益"),
            ("real_return_after_hundredths", "退休后实际收益"),
            ("inflation_hundredths", "通胀"),
            ("volatility_hundredths", "模拟波动"),
        ] {
            assumptions.push(vec![
                title.into(),
                value_money(&v["values"][key]),
                label(v["confirmation"].as_str().unwrap_or("unconfirmed")).into(),
                value_money(&v["confirmed_values"][key]),
            ]);
        }
    }
    let mut audits = vec![row(&[
        "时间",
        "业务类型",
        "更正前摘要",
        "更正后摘要",
        "记录编号",
    ])];
    let mut q = c.prepare(
        "SELECT a.created_at,a.entity_kind,a.before_value,a.after_value,a.entity_id
         FROM planning_flow_audit a
         WHERE (a.entity_kind='movement' AND EXISTS(
           SELECT 1 FROM cash_movements m WHERE m.id=a.entity_id AND m.deleted_at IS NULL))
         OR (a.entity_kind='review' AND EXISTS(
           SELECT 1 FROM investment_flows f WHERE f.id=a.entity_id AND f.deleted_at IS NULL))
         ORDER BY a.id",
    )?;
    for r in q.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    })? {
        let (date, kind, before, after, id) = r?;
        audits.push(vec![
            super::time(&date),
            label(&kind).into(),
            audit_summary(&before, &endpoint)?,
            audit_summary(&after, &endpoint)?,
            id,
        ]);
    }
    Ok(vec![
        ("盘点概况", snapshots),
        ("支出明细", expenses),
        ("资金流动", movements),
        ("存钱目标", goals),
        ("目标关联账户", links),
        ("投资区间核对", reviews),
        ("规划假设", assumptions),
        ("规划核对审计", audits),
    ])
}

fn string(v: &serde_json::Value) -> String {
    v.as_str().map(str::to_owned).unwrap_or_default()
}
fn value_money(v: &serde_json::Value) -> String {
    money(
        v.as_i64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok())),
    )
}
fn audit_summary(raw: &str, endpoint: &impl Fn(&Endpoint) -> String) -> Result<String> {
    let root: serde_json::Value = serde_json::from_str(raw)?;
    if root.is_null() {
        return Ok("无记录".into());
    }
    let v = root
        .get("fields")
        .or_else(|| root.get("flow"))
        .unwrap_or(&root);
    let mut out = Vec::new();
    for (key, title) in [
        ("date", "日期"),
        ("from_date", "期初"),
        ("to_date", "期末"),
        ("notes", "备注"),
    ] {
        if let Some(value) = v[key].as_str().filter(|s| !s.is_empty()) {
            out.push(format!("{title}：{value}"));
        }
    }
    for (key, title) in [
        ("amount_cents", "金额"),
        ("inflow_cents", "转入"),
        ("outflow_cents", "转出"),
    ] {
        if !v[key].is_null() {
            out.push(format!("{title}：{} 元", value_money(&v[key])));
        }
    }
    for (key, title) in [("from", "转出方"), ("to", "转入方")] {
        if !v[key].is_null() {
            if let Ok(e) = serde_json::from_value::<Endpoint>(v[key].clone()) {
                out.push(format!("{title}：{}", endpoint(&e)));
            }
        }
    }
    if let Some(purpose) = v["purpose"].as_str() {
        out.push(format!("用途：{}", label(purpose)));
    }
    if let Some(ids) = v["scope_account_ids"].as_array() {
        let names = ids
            .iter()
            .filter_map(|v| v.as_str())
            .map(|id| {
                endpoint(&Endpoint::Account {
                    account_id: id.into(),
                })
            })
            .collect::<Vec<_>>();
        out.push(format!("账户范围：{}", names.join("、")));
    }
    for (key, title) in [
        ("deleted", "已删除"),
        ("confirmed_complete", "已确认完整"),
        ("unsupported_movements", "含未支持流动"),
    ] {
        if let Some(b) = root
            .get(key)
            .or_else(|| v.get(key))
            .and_then(|v| v.as_bool())
        {
            out.push(format!("{title}：{}", yes(b)));
        }
    }
    if let Some(selection) = root.pointer("/metadata/draft/selection") {
        if let Some(mode) = selection["mode"].as_str().or_else(|| selection.as_str()) {
            out.push(format!("来源方式：{}", label(mode)));
        }
    }
    if let Some(needs_review) = root
        .pointer("/metadata/needs_review")
        .and_then(|v| v.as_bool())
    {
        out.push(format!("待重新核对：{}", yes(needs_review)));
    }
    Ok(if out.is_empty() {
        "核对设置已记录；详细恢复信息保留在备份中".into()
    } else {
        out.join("\n")
    })
}

fn label(value: &str) -> &str {
    match value {
        "own_transfer" => "自己账户间转账",
        "external_funding" => "外部资金往来",
        "living_payment" => "生活付款",
        "investment_cost" => "投资费用",
        "income_distribution" => "投资收入分配",
        "income" => "月度收入",
        "expense" => "独立支出",
        "purchase" => "物品购入",
        "maintenance" => "物品维护",
        "linked" => "已关联物品的支出",
        "payment" => "订阅付款",
        "virtual" => "虚拟资产购入",
        "topup" => "储值充值实付",
        "refund" => "退款",
        "sale" => "售出回收",
        "manual" => "手动填写",
        "movements" => "资金流动明细",
        "confirmed" | "valid" | "ready" | "matched" => "已核对",
        "unconfirmed" | "not_recorded" => "未核对",
        "needs_review" | "changed" | "stale" => "待重新核对",
        "missing" | "deleted" => "来源已删除或缺失",
        "none" | "unlinked" => "无关联来源",
        "disabled" => "来源模块已隐藏",
        "movement" => "资金流动",
        "record" => "记录更正",
        "flow_edit" => "投资区间核对更正",
        "investment_flow" | "review" | "flow" => "投资区间核对",
        "" => "",
        _ => "待核对",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use serde_json::json;

    fn table(store: &Store, name: &str) -> Vec<Vec<String>> {
        sheets(store)
            .unwrap()
            .into_iter()
            .find(|(n, _)| *n == name)
            .unwrap()
            .1
    }

    #[test]
    fn audit_summaries_read_nested_and_legacy_business_values() {
        let endpoint = |e: &Endpoint| match e {
            Endpoint::Account { account_id } => format!("虚构账户{account_id}"),
            Endpoint::External { label } => label.clone(),
        };
        let fields = json!({
            "date":"2026-10-15", "amount_cents":"12345",
            "from":{"type":"account","account_id":"a"},
            "to":{"type":"external","label":"虚构商家"},
            "purpose":"living_payment", "notes":"分两次核实"
        });
        // Use actual endpoint serialization to avoid coupling to its tag spelling.
        let mut fields = fields;
        fields["from"] = serde_json::to_value(Endpoint::Account {
            account_id: "a".into(),
        })
        .unwrap();
        fields["to"] = serde_json::to_value(Endpoint::External {
            label: "虚构商家".into(),
        })
        .unwrap();
        let movement = audit_summary(
            &json!({"fields":fields,"revision":2,"deleted":false}).to_string(),
            &endpoint,
        )
        .unwrap();
        for value in [
            "日期：2026-10-15",
            "金额：123.45 元",
            "转出方：虚构账户a",
            "转入方：虚构商家",
            "用途：生活付款",
            "已删除：否",
            "分两次核实",
        ] {
            assert!(movement.contains(value), "{movement}");
        }
        let flow = json!({
            "from_date":"2026-09-30","to_date":"2026-10-31",
            "inflow_cents":0,"outflow_cents":4567,
            "scope_account_ids":["a"],"confirmed_complete":true,
            "unsupported_movements":false, "notes":"原始核对"
        });
        for value in [
            flow.clone(),
            json!({"flow":flow,"metadata":{"draft":{"selection":{"mode":"movements"}},"needs_review":true}}),
        ] {
            let summary = audit_summary(&value.to_string(), &endpoint).unwrap();
            for text in [
                "期初：2026-09-30",
                "期末：2026-10-31",
                "转入：0.00 元",
                "转出：45.67 元",
                "账户范围：虚构账户a",
                "已确认完整：是",
            ] {
                assert!(summary.contains(text), "{summary}");
            }
            assert!(!summary.contains("basis_key"));
        }
    }

    #[test]
    fn snapshot_missing_rows_use_domain_completeness() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::open(&temp.path().join("library")).unwrap();
        crate::modules::initialize_runtime(&store.root);
        crate::demo::prepare(&mut store, "2026-10-28").unwrap();
        let c = store.conn().unwrap();
        let (snapshot, account): (String, String) = c
            .query_row(
                "SELECT s.id,e.account_id FROM fin_snapshots s
             JOIN fin_snapshot_entries e ON e.snapshot_id=s.id
             JOIN fin_accounts a ON a.id=e.account_id
             WHERE s.deleted_at IS NULL AND a.deleted_at IS NULL AND a.opened_on<=s.date
             AND (a.closed_on IS NULL OR s.date<a.closed_on) LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        c.execute(
            "DELETE FROM fin_snapshot_entries WHERE snapshot_id=?1 AND account_id=?2",
            params![snapshot, account],
        )
        .unwrap();
        let live = crate::wealth::accounts(c).unwrap();
        let expected = crate::wealth::snapshot(c, &snapshot, &live)
            .unwrap()
            .unwrap();
        assert!(expected.missing.contains(&account));
        let rows = table(&store, "盘点概况");
        let r = rows.iter().find(|r| r[7] == snapshot).unwrap();
        assert_eq!(r[2], "有未填写余额");
        assert_eq!(r[6], expected.missing.len().to_string());
    }

    #[test]
    fn deleted_review_endpoints_do_not_abort_workbook_and_deleted_audits_are_excluded() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::open(&temp.path().join("library")).unwrap();
        crate::modules::initialize_runtime(&store.root);
        crate::demo::prepare(&mut store, "2026-10-28").unwrap();
        let c = store.conn().unwrap();
        let mut q = c
            .prepare(
                "SELECT id,date FROM fin_snapshots WHERE deleted_at IS NULL ORDER BY date LIMIT 2",
            )
            .unwrap();
        let snapshots = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(snapshots.len(), 2);
        let flow = json!({
            "id":"fictional-review", "revision":1,
            "from_snapshot_id":snapshots[0].0, "from_revision":1, "from_value_key":"old",
            "to_snapshot_id":snapshots[1].0, "to_revision":1, "to_value_key":"old",
            "from_date":snapshots[0].1, "to_date":snapshots[1].1,
            "scope_account_ids":[], "inflow_cents":0,"outflow_cents":0,
            "confirmed_complete":true, "unsupported_movements":false, "notes":"虚构历史核对"
        });
        c.execute(
            "INSERT INTO investment_flows(id,revision,from_snapshot_id,to_snapshot_id,
            from_date,to_date,scope_key,payload,created_at,updated_at)
            VALUES('fictional-review',1,?1,?2,?3,?4,'[]',?5,'now','now')",
            params![
                snapshots[0].0,
                snapshots[1].0,
                snapshots[0].1,
                snapshots[1].1,
                flow.to_string()
            ],
        )
        .unwrap();
        c.execute(
            "UPDATE fin_snapshots SET deleted_at='now' WHERE id=?1",
            [&snapshots[0].0],
        )
        .unwrap();
        c.execute("INSERT INTO planning_flow_audit(entity_kind,entity_id,request_id,before_value,after_value,created_at)
            VALUES('review','fictional-review','private-request','null',?1,'now')", [flow.to_string()]).unwrap();
        let rows = table(&store, "投资区间核对");
        let r = rows.iter().find(|r| r[10] == "fictional-review").unwrap();
        assert_eq!(r[8], "待重新核对");
        let path = temp.path().join("虚构失效核对.xlsx");
        let changes = c.total_changes();
        store.export_workbook(&path).unwrap();
        assert_eq!(c.total_changes(), changes);
        assert!(table(&store, "规划核对审计")
            .iter()
            .any(|r| r[4] == "fictional-review"));
        c.execute(
            "UPDATE investment_flows SET deleted_at='now' WHERE id='fictional-review'",
            [],
        )
        .unwrap();
        assert!(!table(&store, "规划核对审计")
            .iter()
            .any(|r| r[4] == "fictional-review"));

        let account: String = c
            .query_row("SELECT id FROM fin_accounts LIMIT 1", [], |r| r.get(0))
            .unwrap();
        let fields = json!({
            "date":"2026-10-01","amount_cents":"100",
            "from":serde_json::to_value(Endpoint::Account {account_id:account.clone()}).unwrap(),
            "to":serde_json::to_value(Endpoint::External {label:"虚构外部".into()}).unwrap(),
            "purpose":"living_payment","source":null,"notes":"虚构付款"
        });
        c.execute("INSERT INTO cash_movements(id,revision,date,from_account_id,payload,created_at,updated_at)
            VALUES('fictional-movement',1,'2026-10-01',?1,?2,'now','now')", params![account,fields.to_string()]).unwrap();
        c.execute("INSERT INTO planning_flow_audit(entity_kind,entity_id,request_id,before_value,after_value,created_at)
            VALUES('movement','fictional-movement','private-request','null',?1,'now')",
            [json!({"fields":fields,"deleted":false}).to_string()]).unwrap();
        c.execute(
            "UPDATE fin_accounts SET deleted_at='now' WHERE id=?1",
            [&account],
        )
        .unwrap();
        let movements = table(&store, "资金流动");
        let r = movements
            .iter()
            .find(|r| r[8] == "fictional-movement")
            .unwrap();
        assert!(r[1].ends_with("（账户已删除）"), "{r:?}");
        assert!(table(&store, "规划核对审计")
            .iter()
            .any(|r| r[4] == "fictional-movement"));
        c.execute(
            "UPDATE cash_movements SET deleted_at='now' WHERE id='fictional-movement'",
            [],
        )
        .unwrap();
        assert!(!table(&store, "规划核对审计")
            .iter()
            .any(|r| r[4] == "fictional-movement"));
    }
}
