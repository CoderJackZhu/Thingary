//! Global read-only search over the current library (§6). One query runs in
//! one read transaction: results, totals and per-type counts all come from
//! the same snapshot, nothing is written, and no disk index exists.
use crate::{
    domain::{Error, Result},
    modules,
    source::Target,
    storage::Store,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Fixed result order (§6.2); also the filter vocabulary.
pub const KINDS: [&str; 9] = [
    "asset", "wish", "account", "snapshot", "expense", "plan", "payment", "virtual", "topup",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub keyword: String,
    /// "all" or one of KINDS.
    pub type_filter: String,
    pub offset: u32,
    pub limit: u32,
    pub generation: String,
    /// In-memory read version from the previous page; never a write guard.
    #[serde(default)]
    pub revision: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub date: Option<String>,
    pub status: String,
    /// Chinese label of the field that matched, with the keyword in context.
    pub matched_field: String,
    pub context: String,
    pub target: Target,
}

#[derive(Clone, Debug, Serialize)]
pub struct Results {
    pub generation: String,
    pub revision: String,
    pub keyword: String,
    pub type_filter: String,
    pub offset: u32,
    pub limit: u32,
    pub total: i64,
    /// Per-type counts over the complete result set, fixed KINDS order.
    pub type_counts: Vec<(String, i64)>,
    pub items: Vec<Item>,
}

/// One candidate row before ranking; fields hold (label, value) pairs in
/// primary-first order so the first hit decides rank and context.
struct Candidate {
    kind: &'static str,
    id: String,
    title: String,
    date: Option<String>,
    status: String,
    add_time: Option<String>,
    primary: Vec<(&'static str, String)>,
    secondary: Vec<(&'static str, String)>,
    target: Target,
    /// Set when the matched field is a name/date (primary) field: those
    /// results rank ahead of secondary-field hits (§6.3).
    context_set_primary: bool,
    matched_field: String,
    context: String,
}

fn lifecycle_label(state: &str) -> &'static str {
    match state {
        "retired" => "已退役",
        "sold" => "已售出",
        _ => "使用中",
    }
}

fn decision_label(decision: &str) -> &'static str {
    match decision {
        "purchased" => "已购入",
        "dropped" => "不再考虑",
        "legacy_achieved" => "历史待核实",
        _ => "考虑中",
    }
}

fn account_kind_label(kind: &str) -> &'static str {
    match kind {
        "cash" => "现金与存款",
        "investment" => "投资账户",
        "mixed" => "混合投资",
        "fund" => "基金",
        "bond" => "债券",
        "housing_fund" => "公积金",
        "other_asset" => "其他资产",
        "credit_card" => "信用卡",
        "loan" => "贷款",
        _ => "其他负债",
    }
}

fn plan_category_label(category: &str) -> &'static str {
    match category {
        "rent" => "房租",
        "subscription" => "订阅",
        "utilities" => "水电网",
        "insurance" => "保险",
        "membership" => "会员服务",
        _ => "其他",
    }
}

fn expense_category_label(category: &str) -> &'static str {
    match category {
        "travel" => "旅行",
        "education" => "教育培训",
        "health" => "医疗健康",
        "home" => "家居服务",
        "digital" => "数字服务",
        "gift" => "礼物人情",
        _ => "其他",
    }
}

fn virtual_kind_label(kind: &str) -> &'static str {
    match kind {
        "license" => "买断软件",
        "domain" => "域名",
        "subscription" => "订阅服务",
        _ => "虚拟资产",
    }
}

/// Only fixed columns/keys enter this SQL expression. Display text shares the
/// same mapping as the result context, so candidate filtering cannot omit it.
fn label_case(column: &str, keys: &[&str], label: fn(&str) -> &'static str) -> String {
    let branches: String = keys
        .iter()
        .map(|key| format!("WHEN '{key}' THEN '{}' ", label(key).replace('\'', "''")))
        .collect();
    format!(
        "CASE {column} {branches}ELSE '{}' END",
        label("other").replace('\'', "''")
    )
}

/// Literal substring match, ASCII case-insensitive; LIKE wildcards in the
/// keyword stay literal (§6.3).
fn like(keyword: &str) -> String {
    format!(
        "%{}%",
        keyword
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}

fn contains_ci(value: &str, keyword_lower: &str) -> bool {
    value.to_ascii_lowercase().contains(keyword_lower)
}

/// ~80 characters around the actual hit, never a random fragment.
fn context_around(value: &str, keyword_lower: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let Some(at) = lower.find(keyword_lower) else {
        return value.chars().take(80).collect();
    };
    let chars: Vec<char> = value.chars().collect();
    // ASCII folding preserves UTF-8 byte lengths and character boundaries.
    let hit = value[..at].chars().count();
    let kw_len = keyword_lower.chars().count();
    let start = hit.saturating_sub(40);
    let end = (hit + kw_len + 40).min(chars.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(chars[start..end].iter());
    if end < chars.len() {
        out.push('…');
    }
    out
}

/// Snapshot completeness without duplicating the wealth reader: due accounts
/// on that date versus entries with a known amount.
fn snapshot_complete(c: &Connection, id: &str, day: &str) -> Result<bool> {
    let missing: i64 = c.query_row(
        "SELECT (SELECT count(*) FROM fin_accounts a WHERE a.deleted_at IS NULL AND a.opened_on<=?2 AND (a.closed_on IS NULL OR ?2<a.closed_on) AND NOT EXISTS(SELECT 1 FROM fin_snapshot_entries e WHERE e.snapshot_id=?1 AND e.account_id=a.id AND e.amount_cents IS NOT NULL))",
        rusqlite::params![id, day],
        |r| r.get(0),
    )?;
    Ok(missing == 0)
}

fn candidates(c: &Connection, kind: &str, keyword: &str) -> Result<Vec<Candidate>> {
    let like = like(keyword);
    let kl = keyword.to_ascii_lowercase();
    let mut out = Vec::new();
    let push = |out: &mut Vec<Candidate>, mut cand: Candidate| {
        // First primary hit decides rank and context; otherwise first
        // secondary hit. No hit (LIKE nuance) drops the row.
        for (label, value) in cand.primary.iter().chain(cand.secondary.iter()) {
            if contains_ci(value, &kl) {
                cand.context = context_around(value, &kl);
                cand.matched_field = (*label).into();
                cand.context_set_primary = cand.primary.iter().any(|(_, v)| contains_ci(v, &kl));
                out.push(cand);
                return;
            }
        }
    };
    match kind {
        "asset" => {
            let mut stmt = c.prepare(
                "SELECT a.id,a.name,coalesce(a.purchase_date,''),coalesce(a.lifecycle_state,'active'),coalesce(p.created_at,''),coalesce(p.brand,''),coalesce(p.model,''),coalesce(p.serial_number,''),coalesce(p.notes,''),coalesce(c.name,''),coalesce((SELECT n.name FROM named_choices n WHERE n.id=(SELECT json_extract(payload,'$.label_id') FROM asset_preferences ap WHERE ap.asset_id=a.id)),'')
                 FROM assets a LEFT JOIN asset_profiles p ON p.asset_id=a.id LEFT JOIN categories c ON c.id=a.category_id
                 WHERE a.deleted_at IS NULL AND (lower(coalesce(a.name,'')||'|'||coalesce(p.brand,'')||'|'||coalesce(p.model,'')||'|'||coalesce(p.notes,'')||'|'||coalesce(c.name,'')||'|'||coalesce((SELECT n.name FROM named_choices n WHERE n.id=(SELECT json_extract(payload,'$.label_id') FROM asset_preferences ap WHERE ap.asset_id=a.id)),'')) LIKE lower(?1) ESCAPE '\\')",
            )?;
            let rows = stmt.query_map([&like], |r| {
                Ok(Candidate {
                    kind: "asset",
                    id: r.get(0)?,
                    title: r.get(1)?,
                    date: Some(r.get::<_, String>(2)?).filter(|v| !v.is_empty()),
                    status: lifecycle_label(&r.get::<_, String>(3)?).into(),
                    add_time: Some(r.get::<_, String>(4)?).filter(|v| !v.is_empty()),
                    primary: vec![("名称", r.get::<_, String>(1)?)],
                    secondary: vec![
                        ("品牌", r.get::<_, String>(5)?),
                        ("型号", r.get::<_, String>(6)?),
                        ("备注", r.get::<_, String>(8)?),
                        ("分类", r.get::<_, String>(9)?),
                        ("标签", r.get::<_, String>(10)?),
                    ],
                    target: Target::Asset { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let cand = row?;
                let id = cand.id.clone();
                let mut cand = cand;
                cand.target = Target::Asset { id };
                push(&mut out, cand);
            }
        }
        "wish" => {
            let mut stmt = c.prepare(
                "SELECT w.id,w.name,w.decision_state,substr(w.created_at,1,10),w.created_at,coalesce(c.name,''),w.notes,w.decision_note,w.external_link
                 FROM wishlist_items w LEFT JOIN categories c ON c.id=w.category_id
                 WHERE w.deleted_at IS NULL AND (lower(coalesce(w.name,'')||'|'||coalesce(c.name,'')||'|'||w.notes||'|'||w.decision_note||'|'||w.external_link) LIKE lower(?1) ESCAPE '\\')",
            )?;
            let rows = stmt.query_map([&like], |r| {
                Ok(Candidate {
                    kind: "wish",
                    id: r.get(0)?,
                    title: r.get(1)?,
                    date: None,
                    status: decision_label(&r.get::<_, String>(2)?).into(),
                    add_time: Some(r.get::<_, String>(4)?).filter(|v| !v.is_empty()),
                    primary: vec![("名称", r.get::<_, String>(1)?)],
                    secondary: vec![
                        ("分类", r.get::<_, String>(5)?),
                        ("考虑理由", r.get::<_, String>(6)?),
                        ("决定备注", r.get::<_, String>(7)?),
                        ("相关链接", r.get::<_, String>(8)?),
                    ],
                    target: Target::Wish { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                cand.date = Some(r_head(&cand.add_time));
                cand.target = Target::Wish { id };
                push(&mut out, cand);
            }
        }
        "account" => {
            let label = label_case(
                "kind",
                &[
                    "cash",
                    "investment",
                    "mixed",
                    "fund",
                    "bond",
                    "housing_fund",
                    "other_asset",
                    "credit_card",
                    "loan",
                ],
                account_kind_label,
            );
            let mut stmt = c.prepare(&format!(
                "SELECT id,name,institution,kind,notes,coalesce(closed_on,''),created_at,coalesce(opened_on,'')
                 FROM fin_accounts
                 WHERE deleted_at IS NULL AND (lower(name||'|'||institution||'|'||notes||'|'||({label})) LIKE lower(?1) ESCAPE '\\')"
            ))?;
            let rows = stmt.query_map([&like], |r| {
                let kind: String = r.get(3)?;
                let closed: String = r.get(5)?;
                Ok(Candidate {
                    kind: "account",
                    id: r.get(0)?,
                    title: r.get(1)?,
                    date: Some(r.get::<_, String>(7)?).filter(|v| !v.is_empty()),
                    status: if closed.is_empty() {
                        "在用"
                    } else {
                        "已停用"
                    }
                    .into(),
                    add_time: Some(r.get::<_, String>(6)?).filter(|v| !v.is_empty()),
                    primary: vec![("名称", r.get::<_, String>(1)?)],
                    secondary: vec![
                        ("类型", account_kind_label(&kind).into()),
                        ("平台", r.get::<_, String>(2)?),
                        ("备注", r.get::<_, String>(4)?),
                    ],
                    target: Target::Account { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                cand.target = Target::Account { id };
                push(&mut out, cand);
            }
        }
        "snapshot" => {
            let mut stmt = c.prepare(
                "SELECT id,date,notes,created_at FROM fin_snapshots WHERE deleted_at IS NULL AND (lower(date||'|'||notes) LIKE lower(?1) ESCAPE '\\')",
            )?;
            let rows = stmt.query_map([&like], |r| {
                Ok(Candidate {
                    kind: "snapshot",
                    id: r.get(0)?,
                    title: r.get::<_, String>(1)?,
                    date: Some(r.get::<_, String>(1)?),
                    status: String::new(),
                    add_time: Some(r.get::<_, String>(3)?).filter(|v| !v.is_empty()),
                    primary: vec![("日期", r.get::<_, String>(1)?)],
                    secondary: vec![("备注", r.get::<_, String>(2)?)],
                    target: Target::Snapshot { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let (id, day) = (cand.id.clone(), cand.title.clone());
                cand.status = if snapshot_complete(c, &id, &day)? {
                    "完整".into()
                } else {
                    "不完整".into()
                };
                cand.target = Target::Snapshot { id };
                push(&mut out, cand);
            }
        }
        "expense" => {
            // Linked expenses are the item's purchase projection, not a second
            // expense result (§6.2); only independent ones are results.
            let label = label_case(
                "category",
                &["travel", "education", "health", "home", "digital", "gift"],
                expense_category_label,
            );
            let mut stmt = c.prepare(&format!(
                "SELECT id,title,date,category,notes,created_at FROM expenses WHERE deleted_at IS NULL AND asset_id IS NULL AND (lower(title||'|'||notes||'|'||date||'|'||({label})) LIKE lower(?1) ESCAPE '\\')"
            ))?;
            let rows = stmt.query_map([&like], |r| {
                Ok(Candidate {
                    kind: "expense",
                    id: r.get(0)?,
                    title: r.get(1)?,
                    date: Some(r.get::<_, String>(2)?),
                    status: String::new(),
                    add_time: Some(r.get::<_, String>(5)?).filter(|v| !v.is_empty()),
                    primary: vec![("名称", r.get::<_, String>(1)?)],
                    secondary: vec![
                        (
                            "分类",
                            expense_category_label(&r.get::<_, String>(3)?).into(),
                        ),
                        ("备注", r.get::<_, String>(4)?),
                        ("日期", r.get::<_, String>(2)?),
                    ],
                    target: Target::Expense { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                cand.target = Target::Expense { id };
                push(&mut out, cand);
            }
        }
        "plan" => {
            let label = label_case(
                "category",
                &[
                    "rent",
                    "subscription",
                    "utilities",
                    "insurance",
                    "membership",
                ],
                plan_category_label,
            );
            let mut stmt = c.prepare(&format!(
                "SELECT id,name,category,notes,created_at,coalesce(first_due,''),paused FROM recurring_plans WHERE deleted_at IS NULL AND (lower(name||'|'||notes||'|'||({label})) LIKE lower(?1) ESCAPE '\\')"
            ))?;
            let rows = stmt.query_map([&like], |r| {
                let paused: i64 = r.get(6)?;
                Ok(Candidate {
                    kind: "plan",
                    id: r.get(0)?,
                    title: r.get(1)?,
                    date: Some(r.get::<_, String>(5)?).filter(|v| !v.is_empty()),
                    status: if paused != 0 {
                        "已暂停".into()
                    } else {
                        "进行中".into()
                    },
                    add_time: Some(r.get::<_, String>(4)?).filter(|v| !v.is_empty()),
                    primary: vec![("名称", r.get::<_, String>(1)?)],
                    secondary: vec![
                        ("类别", plan_category_label(&r.get::<_, String>(2)?).into()),
                        ("备注", r.get::<_, String>(3)?),
                    ],
                    target: Target::Plan { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                cand.target = Target::Plan { id };
                push(&mut out, cand);
            }
        }
        "payment" => {
            // Recorded facts only: paid or skipped periods; unconfirmed
            // candidates are never results (§6.2).
            let mut stmt = c.prepare(
                "SELECT p.id,p.plan_id,r.name,p.due_date,coalesce(p.paid_date,''),p.notes,coalesce(p.created_at,''),p.state
                 FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id
                 WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND p.state IN ('paid','skipped') AND (lower(r.name||'|'||p.due_date||'|'||coalesce(p.paid_date,'')||'|'||p.notes) LIKE lower(?1) ESCAPE '\\')",
            )?;
            let rows = stmt.query_map([&like], |r| {
                let state: String = r.get(7)?;
                let due: String = r.get(3)?;
                let paid: String = r.get(4)?;
                Ok(Candidate {
                    kind: "payment",
                    id: r.get(0)?,
                    title: format!("{} · {}", r.get::<_, String>(2)?, due),
                    date: Some(if paid.is_empty() {
                        due.clone()
                    } else {
                        paid.clone()
                    }),
                    status: if state == "paid" {
                        "已付".into()
                    } else {
                        "已跳过".into()
                    },
                    add_time: Some(r.get::<_, String>(6)?).filter(|v| !v.is_empty()),
                    primary: vec![("所属计划", r.get::<_, String>(2)?), ("应付日期", due)],
                    secondary: vec![
                        ("实付日期", paid.clone()),
                        ("付款备注", r.get::<_, String>(5)?),
                    ],
                    target: Target::Payment {
                        id: String::new(),
                        plan_id: String::new(),
                    },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                let plan_id = plan_id_of(c, &id)?;
                cand.target = Target::Payment { id, plan_id };
                push(&mut out, cand);
            }
        }
        "virtual" => {
            let label = label_case(
                "v.kind",
                &["license", "domain", "subscription"],
                virtual_kind_label,
            );
            let mut stmt = c.prepare(&format!(
                "SELECT v.id,v.name,v.kind,coalesce(v.notes,''),v.created_at,coalesce(v.purchase_date,''),coalesce(v.stopped_on,''),coalesce(n.name,'')
                 FROM virtual_assets v LEFT JOIN named_choices n ON n.id=v.label_id
                 WHERE v.deleted_at IS NULL AND (lower(v.name||'|'||coalesce(v.notes,'')||'|'||coalesce(n.name,'')||'|'||({label})) LIKE lower(?1) ESCAPE '\\')"
            ))?;
            let rows = stmt.query_map([&like], |r| {
                let stopped: String = r.get(6)?;
                Ok(Candidate {
                    kind: "virtual",
                    id: r.get(0)?,
                    title: r.get(1)?,
                    date: Some(r.get::<_, String>(5)?).filter(|v| !v.is_empty()),
                    status: if stopped.is_empty() {
                        "使用中".into()
                    } else {
                        "已停用".into()
                    },
                    add_time: Some(r.get::<_, String>(4)?).filter(|v| !v.is_empty()),
                    primary: vec![("名称", r.get::<_, String>(1)?)],
                    secondary: vec![
                        ("类型", virtual_kind_label(&r.get::<_, String>(2)?).into()),
                        ("标签", r.get::<_, String>(7)?),
                        ("备注", r.get::<_, String>(3)?),
                    ],
                    target: Target::Virtual { id: String::new() },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                cand.target = Target::Virtual { id };
                push(&mut out, cand);
            }
        }
        "topup" => {
            let mut stmt = c.prepare(
                "SELECT t.id,t.asset_id,v.name,coalesce(t.topup_date,''),t.notes,coalesce(t.created_at,'')
                 FROM virtual_topups t JOIN virtual_assets v ON v.id=t.asset_id
                 WHERE t.deleted_at IS NULL AND v.deleted_at IS NULL AND (lower(v.name||'|'||coalesce(t.topup_date,'')||'|'||t.notes) LIKE lower(?1) ESCAPE '\\')",
            )?;
            let rows = stmt.query_map([&like], |r| {
                Ok(Candidate {
                    kind: "topup",
                    id: r.get(0)?,
                    title: format!("{} · 充值", r.get::<_, String>(2)?),
                    date: Some(r.get::<_, String>(3)?).filter(|v| !v.is_empty()),
                    status: String::new(),
                    add_time: Some(r.get::<_, String>(5)?).filter(|v| !v.is_empty()),
                    primary: vec![("所属档案", r.get::<_, String>(2)?)],
                    secondary: vec![
                        ("充值日期", r.get::<_, String>(3)?),
                        ("备注", r.get::<_, String>(4)?),
                    ],
                    target: Target::Topup {
                        id: String::new(),
                        asset_id: String::new(),
                    },
                    context_set_primary: false,
                    matched_field: String::new(),
                    context: String::new(),
                })
            })?;
            for row in rows {
                let mut cand = row?;
                let id = cand.id.clone();
                let asset_id = topup_asset_of(c, &id)?;
                cand.target = Target::Topup { id, asset_id };
                push(&mut out, cand);
            }
        }
        _ => return Err(Error::new("QUERY", "不支持的搜索类型")),
    }
    Ok(out)
}

fn r_head(value: &Option<String>) -> String {
    value
        .as_deref()
        .map(|v| v.get(..10).unwrap_or(v).to_owned())
        .unwrap_or_default()
}

fn plan_id_of(c: &Connection, payment: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT plan_id FROM plan_payments WHERE id=?1",
        [payment],
        |r| r.get(0),
    )?)
}

fn topup_asset_of(c: &Connection, topup: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT asset_id FROM virtual_topups WHERE id=?1",
        [topup],
        |r| r.get(0),
    )?)
}

impl Store {
    pub fn search_all(&self, input: &Query) -> Result<Results> {
        self.check_generation(&input.generation)?;
        let keyword = input.keyword.trim();
        if keyword.is_empty() {
            return Err(Error::new("QUERY", "空关键词不查询"));
        }
        if keyword.chars().count() > 200 || keyword.contains('\0') {
            return Err(Error::new(
                "SEARCH",
                "关键词最多 200 个字符，且不能含空字符",
            ));
        }
        if input.limit == 0 || input.limit > 100 {
            return Err(Error::new("QUERY", "每页数量无效"));
        }
        let filter = input.type_filter.as_str();
        if filter != "all" && !KINDS.contains(&filter) {
            return Err(Error::new("QUERY", "不支持的搜索类型"));
        }
        let revision = self.conn()?.total_changes().to_string();
        let offset = if input
            .revision
            .as_ref()
            .is_some_and(|previous| previous != &revision)
        {
            0
        } else {
            input.offset
        };
        let modules = modules::read(&self.root);
        // The whole query shares one read snapshot (§6.3).
        let tx = self.conn()?.unchecked_transaction()?;
        let enabled: Vec<&'static str> = KINDS
            .iter()
            .filter(|k| match **k {
                "asset" => true,
                "wish" => modules.wishlist,
                "account" | "snapshot" => modules.wealth,
                "expense" => modules.expenses,
                "plan" | "payment" => modules.recurring,
                "virtual" | "topup" => modules.virtual_assets,
                _ => false,
            })
            .copied()
            .collect();
        let mut all: Vec<(Candidate, i8)> = Vec::new();
        let mut type_counts: Vec<(String, i64)> = Vec::new();
        for kind in KINDS {
            if !enabled.contains(&kind) {
                type_counts.push((kind.into(), 0));
                continue;
            }
            let found = candidates(&tx, kind, keyword)?;
            let count = found.len() as i64;
            type_counts.push((kind.into(), count));
            if filter == "all" || filter == kind {
                for cand in found {
                    let rank: i8 = if cand.context_set_primary { 0 } else { 1 };
                    all.push((cand, rank));
                }
            }
        }
        // Name/date matches first, then add-time desc, fixed type order, id.
        all.sort_by(|a, b| {
            a.1.cmp(&b.1)
                .then(b.0.add_time.cmp(&a.0.add_time))
                .then(
                    KINDS
                        .iter()
                        .position(|k| *k == a.0.kind)
                        .cmp(&KINDS.iter().position(|k| *k == b.0.kind)),
                )
                .then(a.0.id.cmp(&b.0.id))
        });
        let total = all.len() as i64;
        let items = all
            .into_iter()
            .skip(offset as usize)
            .take(input.limit as usize)
            .map(|(cand, _)| Item {
                id: format!("{}:{}", cand.kind, cand.id),
                kind: cand.kind.into(),
                title: cand.title,
                date: cand.date,
                status: cand.status,
                matched_field: cand.matched_field.clone(),
                context: cand.context.clone(),
                target: cand.target,
            })
            .collect();
        tx.commit()?;
        Ok(Results {
            generation: self.generation(),
            revision,
            keyword: keyword.into(),
            type_filter: input.type_filter.clone(),
            offset,
            limit: input.limit,
            total,
            type_counts,
            items,
        })
    }
}
