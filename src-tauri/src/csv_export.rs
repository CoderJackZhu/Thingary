//! Readable tables (AC30, R06): the asset table plus three finance tables
//! (check-ins, important expenses, recurring costs). Not backups: no photos,
//! maintenance, warranties or wishes. RFC 4180 with UTF-8 BOM and CRLF so spreadsheets
//! open Chinese text correctly; unknown values stay empty, never zero.
use crate::{
    domain::Result,
    storage::{atomic_write, Store},
};
use std::path::Path;

pub const HEADER: [&str; 14] = [
    "档案编号",
    "名称",
    "分类",
    "品牌",
    "型号",
    "购入价（元）",
    "币种",
    "购入日期",
    "渠道",
    "状态",
    "退役日期",
    "售出日期",
    "售价（元）",
    "备注",
];

/// Text a spreadsheet could run as a formula gets a leading apostrophe.
fn text(value: &str, guarded: bool) -> String {
    if guarded && value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{value}")
    } else {
        value.to_owned()
    }
}

fn yuan(cents: Option<i64>) -> String {
    cents.map_or_else(String::new, |c| {
        let sign = if c < 0 { "-" } else { "" };
        format!("{sign}{}.{:02}", c.abs() / 100, c.abs() % 100)
    })
}

fn field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) || value != value.trim() {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

impl Store {
    pub fn asset_csv(&self) -> Result<String> {
        self.asset_table(true)
    }
    pub(crate) fn asset_table(&self, guarded: bool) -> Result<String> {
        let mut stmt = self.conn()?.prepare(
            "SELECT a.id,a.name,c.name,p.brand,p.model,a.price_cents,a.purchase_date,ch.name,a.lifecycle_state,s.date,s.price_cents,p.notes,
                    CASE WHEN a.lifecycle_state='retired' THEN (SELECT e.date FROM lifecycle_events e WHERE e.asset_id=a.id ORDER BY e.sequence DESC LIMIT 1) END
             FROM assets a LEFT JOIN asset_profiles p ON p.asset_id=a.id LEFT JOIN categories c ON c.id=a.category_id
             LEFT JOIN channels ch ON ch.id=a.channel_id LEFT JOIN sales s ON s.asset_id=a.id AND s.revoked_at IS NULL
             WHERE a.deleted_at IS NULL ORDER BY p.created_at IS NULL,p.created_at,a.id",
        )?;
        let mut out = String::from("\u{feff}");
        out.push_str(&HEADER.map(field).join(","));
        out.push_str("\r\n");
        let rows = stmt.query_map([], |r| {
            let t = |i: usize| r.get::<_, Option<String>>(i).map(|v| v.unwrap_or_default());
            let state = match r.get::<_, String>(8)?.as_str() {
                "retired" => "已退役",
                "sold" => "已售出",
                _ => "使用中",
            };
            Ok([
                t(0)?,
                text(&t(1)?, guarded),
                text(&t(2)?, guarded),
                text(&t(3)?, guarded),
                text(&t(4)?, guarded),
                yuan(r.get(5)?),
                "CNY".into(),
                t(6)?,
                text(&t(7)?, guarded),
                state.into(),
                t(12)?,
                t(9)?,
                yuan(r.get(10)?),
                text(&t(11)?, guarded),
            ])
        })?;
        for row in rows {
            out.push_str(&row?.map(|v| field(&v)).join(","));
            out.push_str("\r\n");
        }
        Ok(out)
    }

    /// The native save panel already confirmed any replacement; the write is atomic.
    pub fn export_csv(&self, destination: &Path) -> Result<i64> {
        let csv = self.asset_csv()?;
        atomic_write(destination, csv.as_bytes())?;
        Ok(self.conn()?.query_row(
            "SELECT count(*) FROM assets WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?)
    }

    /// Check-ins as one row per account per check-in, oldest first.
    pub(crate) fn wealth_csv(&self) -> Result<(String, i64)> {
        self.wealth_table(true)
    }
    pub(crate) fn wealth_table(&self, guarded: bool) -> Result<(String, i64)> {
        let mut stmt = self.conn()?.prepare(
            "SELECT s.date,a.name,a.institution,e.side,e.kind,e.counted,e.state,e.amount_cents,s.notes
             FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id
             JOIN fin_accounts a ON a.id=e.account_id
             WHERE s.deleted_at IS NULL ORDER BY s.date,a.position,a.id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let kind: String = r.get(4)?;
                let state: String = r.get(6)?;
                Ok(vec![
                    r.get::<_, String>(0)?,
                    text(&r.get::<_, String>(1)?, guarded),
                    text(&r.get::<_, String>(2)?, guarded),
                    if r.get::<_, String>(3)? == "liability" {
                        "负债"
                    } else {
                        "资产"
                    }
                    .into(),
                    account_kind(&kind).into(),
                    if r.get::<_, bool>(5)? { "是" } else { "否" }.into(),
                    match state.as_str() {
                        "entered" => "录入",
                        "unchanged" => "确认未变",
                        _ => "未知",
                    }
                    .into(),
                    yuan(r.get(7)?),
                    text(&r.get::<_, String>(8)?, guarded),
                ])
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let header = [
            "盘点日期",
            "账户",
            "平台",
            "方向",
            "类型",
            "计入净资产",
            "状态",
            "金额（元）",
            "盘点备注",
        ];
        Ok((table(&header, &rows), rows.len() as i64))
    }

    /// Important expenses with their refund and the linked item's name.
    pub(crate) fn expenses_csv(&self) -> Result<(String, i64)> {
        self.expenses_table(true)
    }
    pub(crate) fn expenses_table(&self, guarded: bool) -> Result<(String, i64)> {
        let mut stmt = self.conn()?.prepare(
            "SELECT x.date,x.title,x.category,x.amount_cents,x.refund_cents,x.refund_date,a.name,x.notes
             FROM expenses x LEFT JOIN assets a ON a.id=x.asset_id
             WHERE x.deleted_at IS NULL ORDER BY x.date,x.id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let category: String = r.get(2)?;
                Ok(vec![
                    r.get::<_, String>(0)?,
                    text(&r.get::<_, String>(1)?, guarded),
                    expense_category(&category).into(),
                    yuan(r.get(3)?),
                    yuan(r.get(4)?),
                    r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    text(&r.get::<_, Option<String>>(6)?.unwrap_or_default(), guarded),
                    text(&r.get::<_, String>(7)?, guarded),
                ])
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let header = [
            "日期",
            "名称",
            "分类",
            "金额（元）",
            "退款（元）",
            "退款日期",
            "关联物品",
            "备注",
        ];
        Ok((table(&header, &rows), rows.len() as i64))
    }

    /// Plans with their confirmed or skipped periods; a plan without any
    /// payment still appears once, with empty payment columns.
    pub(crate) fn recurring_csv(&self) -> Result<(String, i64)> {
        self.recurring_table(true)
    }
    pub(crate) fn recurring_table(&self, guarded: bool) -> Result<(String, i64)> {
        let mut stmt = self.conn()?.prepare(
            "SELECT p.name,p.category,p.interval_months,p.amount_cents,p.first_due,p.end_date,p.paused,
                    y.due_date,y.state,y.paid_date,y.amount_cents,y.notes
             FROM recurring_plans p LEFT JOIN plan_payments y ON y.plan_id=p.id AND y.deleted_at IS NULL
             WHERE p.deleted_at IS NULL ORDER BY p.name,p.id,y.due_date",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let category: String = r.get(1)?;
                let months: i64 = r.get(2)?;
                let state: Option<String> = r.get(8)?;
                Ok(vec![
                    text(&r.get::<_, String>(0)?, guarded),
                    recurring_category(&category).into(),
                    match months {
                        1 => "每月".to_owned(),
                        3 => "每季".to_owned(),
                        6 => "每半年".to_owned(),
                        12 => "每年".to_owned(),
                        n => format!("每 {n} 个月"),
                    },
                    yuan(r.get(3)?),
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    if r.get::<_, bool>(6)? {
                        "已暂停"
                    } else {
                        "进行中"
                    }
                    .into(),
                    r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    match state.as_deref() {
                        Some("paid") => "已付",
                        Some("skipped") => "本期不付",
                        _ => "",
                    }
                    .into(),
                    r.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    yuan(r.get(10)?),
                    text(
                        &r.get::<_, Option<String>>(11)?.unwrap_or_default(),
                        guarded,
                    ),
                ])
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let header = [
            "计划",
            "分类",
            "周期",
            "每期金额（元）",
            "首期到期日",
            "结束日期",
            "计划状态",
            "到期日",
            "付款状态",
            "实付日期",
            "实付金额（元）",
            "备注",
        ];
        Ok((table(&header, &rows), rows.len() as i64))
    }

    /// `kind` is `wealth`, `expenses` or `recurring`; the native save panel
    /// already confirmed any replacement and the write is atomic.
    /// Monthly income rows, oldest first.
    pub(crate) fn income_csv(&self) -> Result<(String, i64)> {
        self.income_table(true)
    }
    pub(crate) fn income_table(&self, guarded: bool) -> Result<(String, i64)> {
        let mut stmt = self.conn()?.prepare(
            "SELECT date,net_cents,hpf_cents,notes,category,source_account_id,destination,receiving_account_id,classification_changed FROM plan_income WHERE deleted_at IS NULL ORDER BY date,id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(vec![
                    r.get::<_, String>(0)?,
                    yuan(r.get(1)?),
                    yuan(r.get::<_, Option<i64>>(2)?),
                    text(&r.get::<_, String>(3)?, guarded),
                    r.get::<_, String>(4)?,
                    text(&r.get::<_, Option<String>>(5)?.unwrap_or_default(), guarded),
                    r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    text(&r.get::<_, Option<String>>(7)?.unwrap_or_default(), guarded),
                    r.get::<_, bool>(8)?.to_string(),
                ])
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let header = [
            "到账日期",
            "税后到账（元）",
            "公积金缴存（元）",
            "备注",
            "收入分类",
            "来源账户ID",
            "去向",
            "接收账户ID",
            "旧口径估计停用",
        ];
        Ok((table(&header, &rows), rows.len() as i64))
    }

    /// Every readable table in one new folder: items, check-ins, important
    /// expenses, recurring costs and monthly income. The folder must not exist
    /// yet; nothing is overwritten, and a failure removes what was written.
    pub fn export_all_csv(&self, folder: &Path) -> Result<Vec<(&'static str, i64)>> {
        if folder.exists() {
            return Err(crate::domain::Error::new(
                "EXPORT_EXISTS",
                "已有同名文件夹，请换一个名字",
            ));
        }
        std::fs::create_dir(folder)?;
        let result = (|| -> Result<Vec<(&'static str, i64)>> {
            let mut done = Vec::new();
            let items = self.asset_csv()?;
            atomic_write(&folder.join("物品.csv"), items.as_bytes())?;
            done.push((
                "物品.csv",
                self.conn()?.query_row(
                    "SELECT count(*) FROM assets WHERE deleted_at IS NULL",
                    [],
                    |r| r.get(0),
                )?,
            ));
            for (name, csv) in [
                ("盘点记录.csv", self.wealth_csv()?),
                ("重要支出.csv", self.expenses_csv()?),
                ("周期费用.csv", self.recurring_csv()?),
                ("月度收入.csv", self.income_csv()?),
                ("投资区间核对.csv", self.investment_review_table(true)?),
                ("资金流动.csv", self.movement_table(true)?),
                ("规划假设.csv", self.assumption_table(true)?),
                ("规划核对审计.csv", self.planning_flow_audit_table(true)?),
            ] {
                atomic_write(&folder.join(name), csv.0.as_bytes())?;
                done.push((name, csv.1));
            }
            Ok(done)
        })();
        if result.is_err() {
            let _ = crate::storage::remove_dir_all_retry(folder);
        }
        result
    }

    /// Exact saved flow inputs, including deleted records and original endpoint
    /// keys. Analysis only; the full database backup remains the restore format.
    pub(crate) fn investment_review_table(&self, guarded: bool) -> Result<(String, i64)> {
        let records = crate::investment_review::records(self.conn()?)?;
        let mut rows = Vec::new();
        for record in records {
            let f = record.flow;
            let id = f["id"]
                .as_str()
                .ok_or_else(|| crate::domain::Error::new("FORMAT", "核对标识无效"))?;
            let source = crate::planning_flow_review::export_metadata(self.conn()?, id)?;
            let cell = |key: &str| {
                f[key].as_str().map(str::to_owned).unwrap_or_else(|| {
                    if f[key].is_null() {
                        String::new()
                    } else {
                        f[key].to_string()
                    }
                })
            };
            rows.push(vec![
                cell("id"),
                cell("revision"),
                cell("from_snapshot_id"),
                cell("to_snapshot_id"),
                cell("from_date"),
                cell("to_date"),
                cell("scope_account_ids"),
                cell("inflow_cents"),
                cell("outflow_cents"),
                cell("confirmed_complete"),
                cell("unsupported_movements"),
                text(&cell("notes"), guarded),
                record.deleted.to_string(),
                text(&cell("from_value_key"), guarded),
                text(&cell("to_value_key"), guarded),
                source["mode"].as_str().unwrap_or("manual").to_owned(),
                source["confirmation"]
                    .as_str()
                    .unwrap_or("unconfirmed")
                    .to_owned(),
                text(&source["draft"].to_string(), guarded),
                text(source["basis_key"].as_str().unwrap_or(""), guarded),
            ]);
        }
        Ok((
            table(
                &[
                    "编号",
                    "修订",
                    "期初盘点编号",
                    "期末盘点编号",
                    "期初日期",
                    "期末日期",
                    "账户范围编号",
                    "转入（分）",
                    "转出（分）",
                    "已确认完整",
                    "含未支持流动",
                    "备注",
                    "已删除",
                    "原期初内容键",
                    "原期末内容键",
                    "来源模式",
                    "当前确认状态",
                    "原权威来源草稿",
                    "流动依据内容键",
                ],
                &rows,
            ),
            rows.len() as i64,
        ))
    }

    pub(crate) fn movement_table(&self, guarded: bool) -> Result<(String, i64)> {
        let rows = crate::cash_movement::all(self.conn()?)?
            .into_iter()
            .map(|r| {
                let f = r.record.fields;
                vec![
                    r.record.id,
                    r.record.revision.to_string(),
                    r.record.deleted.to_string(),
                    f.date,
                    f.amount_cents,
                    text(&serde_json::to_string(&f.from).expect("endpoint"), guarded),
                    text(&serde_json::to_string(&f.to).expect("endpoint"), guarded),
                    f.purpose,
                    f.source.as_ref().map_or(String::new(), |s| s.kind.clone()),
                    f.source.map_or(String::new(), |s| s.key),
                    r.record.source_status,
                    text(&f.notes, guarded),
                ]
            })
            .collect::<Vec<_>>();
        Ok((
            table(
                &[
                    "编号",
                    "修订",
                    "已删除",
                    "结算日期",
                    "金额（分）",
                    "转出端",
                    "转入端",
                    "用途",
                    "来源类型",
                    "来源稳定键",
                    "来源状态",
                    "备注",
                ],
                &rows,
            ),
            rows.len() as i64,
        ))
    }
    pub(crate) fn assumption_table(&self, guarded: bool) -> Result<(String, i64)> {
        let value = crate::plan_assumptions::export_value(self.conn()?)?;
        let rows = if let Some(v) = value {
            vec![vec![
                v["revision"].to_string(),
                v["values"]["real_return_before_hundredths"].to_string(),
                v["values"]["real_return_after_hundredths"].to_string(),
                v["values"]["inflation_hundredths"].to_string(),
                v["values"]["volatility_hundredths"].to_string(),
                v["confirmation"]
                    .as_str()
                    .unwrap_or("unconfirmed")
                    .to_string(),
                text(&v["confirmed_values"].to_string(), guarded),
            ]]
        } else {
            vec![]
        };
        Ok((
            table(
                &[
                    "资料修订",
                    "退休前实际收益（万分比）",
                    "退休后实际收益（万分比）",
                    "通胀（万分比）",
                    "模拟波动（万分比）",
                    "确认状态",
                    "曾确认值",
                ],
                &rows,
            ),
            rows.len() as i64,
        ))
    }
    pub(crate) fn planning_flow_audit_table(&self, guarded: bool) -> Result<(String, i64)> {
        let mut q=self.conn()?.prepare("SELECT id,entity_kind,entity_id,request_id,before_value,after_value,created_at FROM planning_flow_audit ORDER BY id")?;
        let rows = q
            .query_map([], |r| {
                Ok(vec![
                    r.get::<_, i64>(0)?.to_string(),
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    text(&r.get::<_, String>(4)?, guarded),
                    text(&r.get::<_, String>(5)?, guarded),
                    r.get(6)?,
                ])
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((
            table(
                &[
                    "审计序号",
                    "类型",
                    "记录编号",
                    "请求编号",
                    "更正前",
                    "更正后",
                    "时间",
                ],
                &rows,
            ),
            rows.len() as i64,
        ))
    }

    pub fn export_finance_csv(&self, kind: &str, destination: &Path) -> Result<i64> {
        let (csv, rows) = match kind {
            "wealth" => self.wealth_csv()?,
            "expenses" => self.expenses_csv()?,
            "recurring" => self.recurring_csv()?,
            _ => return Err(crate::domain::Error::new("EXPORT_KIND", "不支持的导出类型")),
        };
        atomic_write(destination, csv.as_bytes())?;
        Ok(rows)
    }
}

fn table(header: &[&str], rows: &[Vec<String>]) -> String {
    let mut out = String::from("\u{feff}");
    out.push_str(
        &header
            .iter()
            .map(|h| field(h))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push_str("\r\n");
    for row in rows {
        out.push_str(&row.iter().map(|v| field(v)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

fn account_kind(kind: &str) -> &str {
    match kind {
        "cash" => "现金与存款",
        "investment" => "投资账户",
        "mixed" => "混合投资",
        "fund" => "基金",
        "bond" => "债券",
        "housing_fund" => "公积金",
        "other_asset" => "其他资产",
        "property" => "房产",
        "pension" => "个人养老金",
        "insurance" => "保险现金价值",
        "precious_metal" => "黄金与贵金属",
        "receivable" => "应收款",
        "vehicle" => "车辆",
        "credit_card" => "信用卡",
        "loan" => "贷款",
        "other_liability" => "其他负债",
        other => other,
    }
}

fn expense_category(category: &str) -> &str {
    match category {
        "travel" => "旅行",
        "education" => "教育培训",
        "health" => "医疗健康",
        "home" => "家居服务",
        "digital" => "数字服务",
        "gift" => "礼物人情",
        "other" => "其他",
        other => other,
    }
}

fn recurring_category(category: &str) -> &str {
    match category {
        "rent" => "房租",
        "subscription" => "订阅",
        "utilities" => "水电网",
        "insurance" => "保险",
        "membership" => "会员服务",
        "other" => "其他",
        other => other,
    }
}
