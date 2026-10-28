use super::ExportSheet;
use crate::{
    domain::{Error, Result},
    plan_basic::{CostScope, Start},
    plan_profile::Retire,
    storage::Store,
};
use rusqlite::{Connection, Row};
use std::collections::HashMap;

type Rows = Vec<Vec<String>>;

fn header(labels: &[&str]) -> Rows {
    vec![labels.iter().map(|s| (*s).to_owned()).collect()]
}

fn decimal(value: i128) -> String {
    let magnitude = value.unsigned_abs();
    format!(
        "{}{}.{:02}",
        if value < 0 { "-" } else { "" },
        magnitude / 100,
        magnitude % 100
    )
}

fn money(value: &str) -> Result<String> {
    value
        .parse::<i64>()
        .map(|n| decimal(i128::from(n)))
        .map_err(|_| Error::new("FORMAT", "规划金额格式不兼容或损坏"))
}

fn optional_money(value: Option<&str>) -> Result<String> {
    value.map(money).transpose().map(Option::unwrap_or_default)
}

fn sql_money(value: Option<i64>) -> String {
    value.map(|n| decimal(i128::from(n))).unwrap_or_default()
}

fn yes(value: bool) -> String {
    if value { "是" } else { "否" }.into()
}

fn text(row: &Row<'_>, column: usize) -> rusqlite::Result<String> {
    Ok(row.get::<_, Option<String>>(column)?.unwrap_or_default())
}

fn period(months: i64, days: Option<i64>) -> String {
    match days {
        Some(n) => format!("每 {n} 天"),
        None => match months {
            1 => "每月".into(),
            3 => "每季".into(),
            6 => "每半年".into(),
            12 => "每年".into(),
            n => format!("每 {n} 个月"),
        },
    }
}

fn category(value: &str) -> &'static str {
    match value {
        "rent" => "房租",
        "subscription" => "订阅",
        "utilities" => "水电燃气",
        "insurance" => "保险",
        "membership" => "会员",
        _ => "其他",
    }
}

fn query(
    c: &Connection,
    labels: &[&str],
    sql: &str,
    map: impl FnMut(&Row<'_>) -> rusqlite::Result<Vec<String>>,
) -> Result<Rows> {
    let mut out = header(labels);
    let mut statement = c.prepare(sql)?;
    out.extend(
        statement
            .query_map([], map)?
            .collect::<std::result::Result<Vec<_>, _>>()?,
    );
    Ok(out)
}

fn subscriptions(c: &Connection) -> Result<Vec<ExportSheet>> {
    let plans = query(
        c,
        &[
            "计划",
            "分类",
            "周期",
            "每期金额（元）",
            "首期到期日",
            "结束日期",
            "暂停状态",
            "后续续费",
            "开始使用日期",
            "服务覆盖锚点",
            "试用天数",
            "待记录期起点",
            "关联虚拟资产",
            "备注",
            "计划编号",
        ],
        "SELECT p.name,p.category,p.interval_months,p.interval_days,p.amount_cents,
                p.first_due,p.end_date,p.paused,p.auto_renew,p.service_start,
                p.coverage_start,p.trial_days,p.active_from,
                (SELECT v.name FROM virtual_assets v
                 WHERE v.plan_id=p.id AND v.deleted_at IS NULL ORDER BY v.id LIMIT 1),
                p.notes,p.id
         FROM recurring_plans p WHERE p.deleted_at IS NULL ORDER BY p.name,p.id",
        |r| {
            Ok(vec![
                r.get(0)?,
                category(&r.get::<_, String>(1)?).into(),
                period(r.get(2)?, r.get(3)?),
                sql_money(r.get(4)?),
                text(r, 5)?,
                text(r, 6)?,
                if r.get::<_, bool>(7)? {
                    "已暂停"
                } else {
                    "未暂停"
                }
                .into(),
                yes(r.get(8)?),
                text(r, 9)?,
                text(r, 10)?,
                r.get::<_, Option<i64>>(11)?
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                text(r, 12)?,
                text(r, 13)?,
                text(r, 14)?,
                r.get(15)?,
            ])
        },
    )?;
    let payments = query(
        c,
        &[
            "计划",
            "到期日",
            "付款状态",
            "实付日期",
            "实付金额（元）",
            "服务覆盖开始",
            "服务覆盖结束",
            "备注",
            "付款编号",
            "计划编号",
        ],
        "SELECT p.name,y.due_date,y.state,y.paid_date,y.amount_cents,
                y.coverage_start,y.coverage_end,y.notes,y.id,p.id
         FROM plan_payments y JOIN recurring_plans p ON p.id=y.plan_id
         WHERE y.deleted_at IS NULL AND p.deleted_at IS NULL
         ORDER BY p.name,p.id,y.due_date,y.id",
        |r| {
            Ok(vec![
                r.get(0)?,
                r.get(1)?,
                match r.get::<_, String>(2)?.as_str() {
                    "paid" => "已付",
                    "skipped" => "本期不付",
                    _ => "待核对",
                }
                .into(),
                text(r, 3)?,
                sql_money(r.get(4)?),
                text(r, 5)?,
                text(r, 6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
            ])
        },
    )?;
    // These are saved changes, not an expansion of estimated future periods.
    let rules = query(
        c,
        &[
            "计划",
            "记录类型",
            "生效或重新开通日期",
            "周期",
            "每期金额（元）",
            "首期到期日",
            "开始使用日期",
            "服务覆盖锚点",
            "试用天数",
            "上段最后使用日",
            "指定服务期开始",
            "指定服务期结束",
            "计划编号",
        ],
        "SELECT p.name,x.kind,x.effective,x.months,x.days,x.amount,x.first_due,
                x.service_start,x.anchor,x.trial,x.previous_end,x.period_start,
                x.coverage_end,p.id
         FROM (
           SELECT plan_id,'rule' kind,effective_date effective,interval_months months,
                  interval_days days,NULL amount,first_due,service_start,anchor,
                  trial_days trial,NULL previous_end,NULL period_start,NULL coverage_end
           FROM plan_rules
           UNION ALL
           SELECT plan_id,'price',effective_date,NULL,NULL,amount_cents,NULL,NULL,
                  NULL,NULL,NULL,NULL,NULL FROM plan_rates
           UNION ALL
           SELECT plan_id,'resume',resumed_on,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
                  previous_end,NULL,NULL FROM plan_resumptions
           UNION ALL
           SELECT plan_id,'coverage',period_start,NULL,NULL,NULL,NULL,NULL,NULL,
                  NULL,NULL,period_start,coverage_end FROM plan_period_ends
         ) x JOIN recurring_plans p ON p.id=x.plan_id
         WHERE p.deleted_at IS NULL ORDER BY p.name,p.id,x.effective,x.kind",
        |r| {
            let kind: String = r.get(1)?;
            let months: Option<i64> = r.get(3)?;
            let days: Option<i64> = r.get(4)?;
            Ok(vec![
                r.get(0)?,
                match kind.as_str() {
                    "rule" => "计费规则",
                    "price" => "价格",
                    "resume" => "重新订阅",
                    _ => "指定服务期结束",
                }
                .into(),
                r.get(2)?,
                months.map(|m| period(m, days)).unwrap_or_default(),
                sql_money(r.get(5)?),
                text(r, 6)?,
                text(r, 7)?,
                text(r, 8)?,
                r.get::<_, Option<i64>>(9)?
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                text(r, 10)?,
                text(r, 11)?,
                text(r, 12)?,
                r.get(13)?,
            ])
        },
    )?;
    Ok(vec![
        ("周期费用", plans),
        ("订阅付款", payments),
        ("订阅规则", rules),
    ])
}

fn condition(rows: &mut Rows, group: &str, item: &str, value: impl Into<String>, unit: &str) {
    rows.push(vec![group.into(), item.into(), value.into(), unit.into()]);
}

fn conditions(saved: &crate::plan_profile::Saved) -> Result<Rows> {
    let mut rows = header(&["类别", "设置项", "保存值", "单位或说明"]);
    let r = &saved.profile.retire;
    condition(
        &mut rows,
        "基本",
        "保存时间",
        super::time(&saved.updated_at),
        "",
    );
    condition(
        &mut rows,
        "基本",
        "首次设置已完成",
        yes(r.setup_completed),
        "",
    );
    condition(
        &mut rows,
        "基本",
        "目标模式",
        match r.mode.as_str() {
            "fire" => "钱够用后退休",
            "traditional" => "按计划退休",
            _ => "待核对",
        },
        "",
    );
    condition(
        &mut rows,
        "预算",
        "完整生活预算",
        optional_money(r.spend_cents.as_deref())?,
        "元/月",
    );
    condition(&mut rows, "预算", "房租", money(&r.rent_cents)?, "元/月");
    condition(
        &mut rows,
        "预算",
        "应急金",
        r.emergency_months.to_string(),
        "个月生活费用",
    );
    for (label, value) in [
        ("积累期间实际年收益率", r.real_return_before_hundredths),
        ("动用资金期间实际年收益率", r.real_return_after_hundredths),
        ("通胀率", saved.profile.assumptions.inflation_hundredths),
        ("模拟年波动率", r.volatility_hundredths),
    ] {
        condition(&mut rows, "假设", label, decimal(i128::from(value)), "%");
    }
    let f = &r.simplified;
    if let Some(reference) = &f.time.reference {
        condition(&mut rows, "本人", "年龄参考月份", &reference.month, "");
        condition(&mut rows, "本人", "参考年龄", age(reference.age_months), "");
    }
    condition(
        &mut rows,
        "时间",
        "希望退休月份",
        f.time.target_month.clone().unwrap_or_default(),
        "",
    );
    condition(
        &mut rows,
        "时间",
        "规划终点月份",
        f.time.horizon_month.clone().unwrap_or_default(),
        "",
    );
    condition(
        &mut rows,
        "家庭",
        "规划人数",
        match f.household.mode.as_str() {
            "single" => "单人",
            "couple" => "本人及伴侣",
            _ => "待核对",
        },
        "",
    );
    if let Some(partner) = &f.household.partner {
        condition(&mut rows, "伴侣", "出生年月", &partner.birth_month, "");
        condition(
            &mut rows,
            "伴侣",
            "停工安排",
            partner
                .stop_age_months
                .map(age)
                .unwrap_or_else(|| "与本人同时".into()),
            "",
        );
        condition(
            &mut rows,
            "伴侣",
            "每月存款",
            optional_money(partner.monthly_cents.as_deref())?,
            "元/月",
        );
    }
    condition(
        &mut rows,
        "未来收入",
        "收入处理",
        match f.income_mode.as_str() {
            "unconfirmed" => "尚未确认",
            "excluded" => "暂不计入",
            "manual" => "手动填写",
            _ => "待核对",
        },
        "",
    );
    if let Some(basic) = &r.basic {
        match &basic.start {
            Start::Live => condition(
                &mut rows,
                "资金起点",
                "来源",
                "账户盘点",
                "不生成或重算盘点",
            ),
            Start::Simulation {
                available_cents,
                date,
                notes,
                ..
            } => {
                condition(&mut rows, "资金起点", "来源", "已保存的手动起点", "");
                condition(
                    &mut rows,
                    "资金起点",
                    "可用资金",
                    optional_money(available_cents.as_deref())?,
                    "元",
                );
                condition(
                    &mut rows,
                    "资金起点",
                    "起点日期",
                    date.clone().unwrap_or_default(),
                    "",
                );
                condition(&mut rows, "资金起点", "备注", notes, "");
            }
        }
        condition(
            &mut rows,
            "投入",
            "每月净投入",
            optional_money(basic.contribution.monthly_cents.as_deref())?,
            "元/月；负数表示净取出",
        );
    }
    if let Some(core) = &r.core {
        condition(
            &mut rows,
            "基本",
            "金额基准日期",
            &core.monetary_basis_date,
            "",
        );
    }
    for issue in &saved.reference_issues {
        condition(&mut rows, "核对", "关联资料提示", issue, "");
    }
    Ok(rows)
}

fn age(months: u32) -> String {
    format!("{} 岁 {} 个月", months / 12, months % 12)
}

fn cost_name(r: &Retire, source: &str) -> String {
    if source == "rent" {
        return "房租".into();
    }
    for item in &r.spend_items {
        if source == format!("spend:{}", item.id) {
            return item.label.clone();
        }
    }
    for event in &r.life_events {
        if source == format!("event:{}:loan", event.id) {
            return format!("{}：贷款月供", event.label);
        }
        if source == format!("event:{}:holding", event.id) {
            return format!("{}：持续持有费用", event.label);
        }
    }
    "费用来源已失效，需核对".into()
}

fn scope_rows(rows: &mut Rows, r: &Retire, scopes: &[CostScope], accumulation: bool) -> Result<()> {
    for s in scopes {
        rows.push(vec![
            cost_name(r, &s.source_id),
            if accumulation {
                "积累期间费用处理"
            } else {
                "动用资金期间费用处理"
            }
            .into(),
            optional_money(s.reference_cents.as_deref())?,
            "".into(),
            "".into(),
            "".into(),
            "".into(),
            "".into(),
            match s.treatment.as_str() {
                "included" if accumulation => "已含在每月净投入中",
                "included" => "已含在完整生活预算中",
                "extra" => "额外计入",
                "excluded" => "不计入",
                _ => "待核对",
            }
            .into(),
            s.source_id.clone(),
        ]);
    }
    Ok(())
}

fn budget(r: &Retire) -> Result<Rows> {
    let mut rows = header(&[
        "费用名称",
        "记录类型",
        "每月金额或已含参考额（元）",
        "开始月份",
        "结束月份",
        "单独通胀率（%）",
        "必需费用",
        "时间待重设",
        "计入方式",
        "费用编号",
    ]);
    for s in &r.spend_items {
        rows.push(vec![
            s.label.clone(),
            "生活费用".into(),
            money(&s.monthly_cents)?,
            s.start_month.clone().unwrap_or_default(),
            s.end_month.clone().unwrap_or_default(),
            s.inflation_hundredths
                .map(|n| decimal(i128::from(n)))
                .unwrap_or_default(),
            yes(s.essential),
            yes(s.time_unconfirmed),
            "".into(),
            s.id.clone(),
        ]);
    }
    if let Some(basic) = &r.basic {
        scope_rows(&mut rows, r, &basic.contribution_costs, true)?;
        scope_rows(&mut rows, r, &basic.retirement_costs, false)?;
    }
    Ok(rows)
}

fn future_income(r: &Retire) -> Result<Rows> {
    let mut rows = header(&[
        "收入名称",
        "类型",
        "计入规划",
        "每月金额（元）",
        "开始月份",
        "结束月份",
        "金额基准",
        "基准月份",
        "增长假设",
        "资料来源",
        "来源核对日期",
        "备注",
        "收入编号",
    ]);
    for income in &r.simplified.future_incomes {
        rows.push(vec![
            income.name.clone(),
            if income.role == "pension" {
                "退休金"
            } else {
                "其他收入"
            }
            .into(),
            yes(income.included),
            optional_money(income.monthly_cents.as_deref())?,
            income.start_month.clone().unwrap_or_default(),
            income.end_month.clone().unwrap_or_default(),
            match income.basis.as_str() {
                "reference_month" => "指定月份购买力",
                "start_month" => "开始领取月份",
                _ => "待核对",
            }
            .into(),
            income.basis_month.clone().unwrap_or_default(),
            match income.growth.as_str() {
                "fixed_nominal" => "名义金额固定",
                "constant_purchasing_power" => "保持购买力",
                _ => "待核对",
            }
            .into(),
            income.source.clone().unwrap_or_default(),
            income.source_checked_on.clone().unwrap_or_default(),
            income.notes.clone(),
            income.id.clone(),
        ]);
    }
    Ok(rows)
}

fn events(r: &Retire) -> Result<Rows> {
    let mut rows = header(&[
        "计划名称",
        "类型",
        "计入规划",
        "计划月份",
        "预计总价（元）",
        "首付（元）",
        "杂费（元）",
        "贷款年利率（%）",
        "贷款年数",
        "每月持有费用（元）",
        "省下的月房租（元）",
        "循环年数",
        "结束月份",
        "时间待重设",
        "旧物回收金额（元）",
        "计划编号",
    ]);
    for e in &r.life_events {
        rows.push(vec![
            e.label.clone(),
            match e.kind.as_str() {
                "house" => "买房",
                "car" => "买车",
                _ => "其他",
            }
            .into(),
            yes(e.included),
            e.date.clone(),
            money(&e.price_cents)?,
            money(&e.down_cents)?,
            money(&e.extra_cents)?,
            decimal(i128::from(e.loan_rate_hundredths)),
            e.loan_years.to_string(),
            money(&e.holding_cents)?,
            money(&e.rent_saved_cents)?,
            e.cycle_years.map(|n| n.to_string()).unwrap_or_default(),
            e.until_month.clone().unwrap_or_default(),
            yes(e.time_unconfirmed),
            money(&e.resale_cents)?,
            e.id.clone(),
        ]);
    }
    Ok(rows)
}

struct References {
    accounts: HashMap<String, String>,
    snapshots: HashMap<String, (String, i64, bool)>,
    sources: HashMap<(String, String), String>,
}

impl References {
    fn read(c: &Connection) -> Result<Self> {
        let mut accounts = HashMap::new();
        let mut q = c.prepare("SELECT id,name FROM fin_accounts WHERE deleted_at IS NULL")?;
        for row in q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (id, name) = row?;
            accounts.insert(id, name);
        }
        let mut snapshots = HashMap::new();
        let mut q =
            c.prepare("SELECT id,date,revision,deleted_at IS NOT NULL FROM fin_snapshots")?;
        for row in q.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
        })? {
            let (id, snapshot) = row?;
            snapshots.insert(id, snapshot);
        }
        let mut sources = HashMap::new();
        let mut q = c.prepare(
            "SELECT 'asset',id,name FROM assets WHERE deleted_at IS NULL
             UNION ALL SELECT 'expense',e.id,e.title FROM expenses e
             WHERE e.deleted_at IS NULL AND (e.asset_id IS NULL OR EXISTS(
               SELECT 1 FROM assets a WHERE a.id=e.asset_id AND a.deleted_at IS NULL))
             UNION ALL SELECT 'wish',id,name FROM wishlist_items WHERE deleted_at IS NULL",
        )?;
        for row in q.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))? {
            let (key, name) = row?;
            sources.insert(key, name);
        }
        Ok(Self {
            accounts,
            snapshots,
            sources,
        })
    }

    fn account(&self, id: Option<&str>) -> String {
        id.map(|id| {
            self.accounts
                .get(id)
                .cloned()
                .unwrap_or_else(|| "关联账户已删除或不存在".into())
        })
        .unwrap_or_default()
    }

    fn snapshot(&self, id: Option<&str>, revision: Option<i64>) -> String {
        match id {
            None => "".into(),
            Some(id) => match self.snapshots.get(id) {
                Some((_, _, true)) | None => "关联盘点已删除或不存在".into(),
                Some((date, current, false)) if Some(*current) == revision => {
                    format!("{date}（已记录计入）")
                }
                Some((date, _, false)) => format!("{date}（盘点已更正，待核对）"),
            },
        }
    }

    fn source(&self, kind: Option<&str>, id: Option<&str>) -> String {
        match (kind, id) {
            (Some(kind), Some(id)) => {
                let label = match kind {
                    "asset" => "物品",
                    "expense" => "独立支出",
                    "wish" => "心愿",
                    _ => "来源",
                };
                match self.sources.get(&(kind.into(), id.into())) {
                    Some(name) => format!("{label}：{name}"),
                    None => format!("{label}已删除或不存在"),
                }
            }
            _ => "".into(),
        }
    }
}

fn event_name(r: &Retire, id: &str) -> String {
    r.life_events
        .iter()
        .find(|e| e.id == id)
        .map(|e| e.label.clone())
        .unwrap_or_else(|| "关联计划已移除".into())
}

fn occurrences(r: &Retire, refs: &References) -> Result<(Rows, Rows)> {
    let mut occurred = header(&[
        "计划名称",
        "状态",
        "实际发生或取消日期",
        "付款资料已补全",
        "贷款账户",
        "贷款余额截至日",
        "已保存贷款本金（元）",
        "剩余贷款月数",
        "发生编号",
        "计划编号",
    ]);
    let mut payments = header(&[
        "计划名称",
        "发生状态",
        "实际付款日期",
        "付款金额（元）",
        "付款账户",
        "关联业务来源",
        "已计入的盘点",
        "付款编号",
        "发生编号",
        "计划编号",
    ]);
    if let Some(core) = &r.core {
        for o in &core.occurrences {
            let name = event_name(r, &o.event_id);
            let status = match o.status.as_str() {
                "occurred" => "已发生",
                "cancelled" => "已取消",
                _ => "待核对",
            };
            occurred.push(vec![
                name.clone(),
                status.into(),
                o.actual_date.clone(),
                yes(o.payments_complete),
                refs.account(o.loan.as_ref().map(|l| l.account_id.as_str())),
                o.loan.as_ref().map(|l| l.as_of.clone()).unwrap_or_default(),
                optional_money(o.loan.as_ref().map(|l| l.principal_cents.as_str()))?,
                o.loan
                    .as_ref()
                    .map(|l| l.remaining_months.to_string())
                    .unwrap_or_default(),
                o.id.clone(),
                o.event_id.clone(),
            ]);
            for p in &o.payments {
                payments.push(vec![
                    name.clone(),
                    status.into(),
                    p.date.clone(),
                    optional_money(p.amount_cents.as_deref())?,
                    refs.account(p.account_id.as_deref()),
                    refs.source(p.source_kind.as_deref(), p.source_id.as_deref()),
                    refs.snapshot(p.absorbed_snapshot_id.as_deref(), p.absorbed_revision),
                    p.id.clone(),
                    o.id.clone(),
                    o.event_id.clone(),
                ]);
            }
        }
    }
    Ok((occurred, payments))
}

fn funds(r: &Retire, refs: &References) -> Result<(Rows, Rows)> {
    let mut funds = header(&[
        "账户",
        "安排类型",
        "资金可用范围",
        "计入份额（%）",
        "释放月份",
        "释放净额（元）",
        "金额为估计",
        "不含未来缴存",
        "安排编号",
        "账户编号",
    ]);
    let mut debts = header(&[
        "负债账户",
        "记录日期",
        "余额截至日",
        "保存余额（元）",
        "还款开始月份",
        "还款结束月份",
        "每月还款（元）",
        "积累期间处理",
        "动用资金期间处理",
        "账户编号",
    ]);
    if let Some(core) = &r.core {
        for f in &core.fund_rules {
            funds.push(vec![
                refs.account(Some(&f.account_id)),
                "账户资金范围".into(),
                match f.availability.as_str() {
                    "available" => "可用",
                    "restricted" => "受限，按释放安排使用",
                    "excluded" => "不计入",
                    _ => "待核对",
                }
                .into(),
                decimal(i128::from(f.share_hundredths)),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                f.account_id.clone(),
            ]);
        }
        for release in &core.releases {
            funds.push(vec![
                refs.account(Some(&release.account_id)),
                "资金释放".into(),
                "".into(),
                "".into(),
                release.month.clone(),
                optional_money(release.net_cents.as_deref())?,
                yes(release.estimated),
                yes(release.excludes_future_deposits),
                release.id.clone(),
                release.account_id.clone(),
            ]);
        }
        for d in &core.debt_repayments {
            let treatment = |value: Option<&str>, accumulation: bool| -> String {
                match value {
                    None => "",
                    Some("scheduled") => "按还款安排额外计入",
                    Some("included") if accumulation => "已含在每月净投入中",
                    Some("included") => "已含在完整生活预算中",
                    Some("excluded") => "不计入",
                    _ => "待核对",
                }
                .into()
            };
            debts.push(vec![
                refs.account(Some(&d.account_id)),
                d.recorded_on.clone(),
                d.as_of.clone(),
                money(&d.balance_cents)?,
                d.start_month.clone(),
                d.last_month.clone().unwrap_or_default(),
                optional_money(d.monthly_cents.as_deref())?,
                treatment(d.before.as_deref(), true),
                treatment(d.after.as_deref(), false),
                d.account_id.clone(),
            ]);
        }
    }
    Ok((funds, debts))
}

pub(super) fn sheets(store: &Store) -> Result<Vec<ExportSheet>> {
    let c = store.conn()?;
    let mut sheets = subscriptions(c)?;
    // read() only parses saved inputs and checks references; it never computes a projection.
    if let Some(saved) = crate::plan_profile::read(c)? {
        let r = &saved.profile.retire;
        let refs = References::read(c)?;
        let (occurred, payments) = occurrences(r, &refs)?;
        let (funds, debts) = funds(r, &refs)?;
        sheets.extend([
            ("规划条件", conditions(&saved)?),
            ("规划预算", budget(r)?),
            ("未来收入", future_income(r)?),
            ("大额计划", events(r)?),
            ("计划发生", occurred),
            ("计划付款", payments),
            ("规划资金", funds),
            ("既有债务还款", debts),
        ]);
    } else {
        let r = crate::plan_basic::empty_profile().retire;
        let refs = References {
            accounts: HashMap::new(),
            snapshots: HashMap::new(),
            sources: HashMap::new(),
        };
        let (occurred, payments) = occurrences(&r, &refs)?;
        let (funds, debts) = funds(&r, &refs)?;
        sheets.extend([
            (
                "规划条件",
                header(&["类别", "设置项", "保存值", "单位或说明"]),
            ),
            ("规划预算", budget(&r)?),
            ("未来收入", future_income(&r)?),
            ("大额计划", events(&r)?),
            ("计划发生", occurred),
            ("计划付款", payments),
            ("规划资金", funds),
            ("既有债务还款", debts),
        ]);
    }
    Ok(sheets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan_core::{Core, Occurrence, Payment};

    #[test]
    fn exact_amounts_keep_zero_unknown_and_signed_values_distinct() {
        assert_eq!(optional_money(None).unwrap(), "");
        assert_eq!(optional_money(Some("0")).unwrap(), "0.00");
        assert_eq!(money("-125").unwrap(), "-1.25");
        assert_eq!(money("99999999999").unwrap(), "999999999.99");
        assert!(money("not money").is_err());
        assert_eq!(period(1, Some(14)), "每 14 天");
        assert_eq!(period(3, None), "每季");
    }

    #[test]
    fn unknown_payments_and_stale_snapshot_links_are_readable() {
        let mut p = crate::plan_basic::empty_profile();
        p.retire.core = Some(Core {
            contract_version: 1,
            monetary_basis_date: "2026-10-01".into(),
            fund_rules: vec![],
            releases: vec![],
            debt_repayments: vec![],
            occurrences: vec![Occurrence {
                id: "occurrence".into(),
                event_id: "event".into(),
                status: "occurred".into(),
                actual_date: "2026-10-01".into(),
                payments_complete: false,
                payments: vec![
                    Payment {
                        id: "unknown".into(),
                        date: "2026-10-01".into(),
                        amount_cents: None,
                        account_id: None,
                        absorbed_snapshot_id: None,
                        absorbed_revision: None,
                        source_kind: None,
                        source_id: None,
                    },
                    Payment {
                        id: "zero".into(),
                        date: "2026-10-02".into(),
                        amount_cents: Some("0".into()),
                        account_id: Some("cash".into()),
                        absorbed_snapshot_id: Some("snapshot".into()),
                        absorbed_revision: Some(1),
                        source_kind: Some("asset".into()),
                        source_id: Some("asset".into()),
                    },
                ],
                loan: None,
            }],
        });
        let refs = References {
            accounts: HashMap::from([("cash".into(), "虚构现金".into())]),
            snapshots: HashMap::from([("snapshot".into(), ("2026-10-03".into(), 2, false))]),
            sources: HashMap::from([(("asset".into(), "asset".into()), "虚构物品".into())]),
        };
        let (occurred, payments) = occurrences(&p.retire, &refs).unwrap();
        assert_eq!(occurred[1][0], "关联计划已移除");
        assert_eq!(occurred[1][6], "");
        assert_eq!(payments[1][3], "");
        assert_eq!(payments[2][3], "0.00");
        assert_eq!(payments[2][4], "虚构现金");
        assert_eq!(payments[2][5], "物品：虚构物品");
        assert!(payments[2][6].contains("盘点已更正，待核对"));
    }

    #[test]
    fn empty_library_has_headers_without_invented_planning_values() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(&temp.path().join("fictional-export")).unwrap();
        let before = store.conn().unwrap().total_changes();
        let tables = sheets(&store).unwrap();
        assert_eq!(tables.len(), 11);
        assert!(tables.iter().all(|(_, rows)| rows.len() == 1));
        assert_eq!(store.conn().unwrap().total_changes(), before);
    }

    #[test]
    fn subscription_export_reads_saved_rules_and_filters_deleted_children() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(&temp.path().join("fictional-export")).unwrap();
        let c = store.conn().unwrap();
        c.execute_batch(
            "INSERT INTO recurring_plans
             (id,name,category,amount_cents,interval_months,first_due,end_date,paused,
              active_from,notes,revision,created_at,updated_at,service_start,
              coverage_start,interval_days,trial_days,auto_renew)
             VALUES ('plan','虚构按天订阅','subscription',12345,1,'2026-10-08',NULL,0,
                     '2026-10-01','已保存的备注',1,'2026-10-01','2026-10-01',
                     '2026-10-01','2026-10-08',14,7,0);
             INSERT INTO plan_payments
             (id,plan_id,due_date,state,paid_date,amount_cents,notes,revision,created_at,
              updated_at,coverage_start,coverage_end)
             VALUES ('paid','plan','2026-10-08','paid','2026-10-07',12345,'真实付款',1,
                     '2026-10-07','2026-10-07','2026-10-08','2026-10-21'),
                    ('skipped','plan','2026-10-22','skipped',NULL,NULL,'本期跳过',1,
                     '2026-10-22','2026-10-22',NULL,NULL),
                    ('deleted','plan','2026-11-05','skipped',NULL,NULL,'删除的付款',1,
                     '2026-10-22','2026-10-22',NULL,NULL);
             UPDATE plan_payments SET deleted_at='2026-10-23' WHERE id='deleted';
             INSERT INTO plan_rules
             (plan_id,effective_date,anchor,interval_months,interval_days,first_due,service_start,trial_days)
             VALUES ('plan','2026-10-01','2026-10-08',1,14,'2026-10-08','2026-10-01',7);
             INSERT INTO plan_rates VALUES ('plan','2026-10-01',12345),('plan','2026-12-01',15000);
             INSERT INTO plan_period_ends VALUES ('plan','2026-10-08','2026-10-25');
             INSERT INTO plan_resumptions VALUES ('plan','2027-01-01','2026-11-30');",
        ).unwrap();
        let changes = c.total_changes();
        let tables = sheets(&store).unwrap();
        let rows = |name| &tables.iter().find(|(n, _)| *n == name).unwrap().1;
        assert_eq!(rows("周期费用")[1][2], "每 14 天");
        assert_eq!(rows("周期费用")[1][3], "123.45");
        assert_eq!(rows("周期费用")[1][7], "否");
        assert_eq!(rows("周期费用")[1][10], "7");
        assert_eq!(rows("订阅付款").len(), 3);
        assert_eq!(rows("订阅付款")[1][2], "已付");
        assert_eq!(rows("订阅付款")[1][6], "2026-10-21");
        assert_eq!(rows("订阅付款")[2][2], "本期不付");
        assert_eq!(rows("订阅付款")[2][4], "");
        assert_eq!(rows("订阅规则").len(), 6);
        assert!(rows("订阅规则")
            .iter()
            .any(|r| r[1] == "价格" && r[4] == "150.00"));
        assert!(rows("订阅规则")
            .iter()
            .any(|r| r[1] == "重新订阅" && r[9] == "2026-11-30"));
        for (_, rows) in &tables {
            assert!(rows.iter().all(|r| r.len() == rows[0].len()));
        }
        assert_eq!(c.total_changes(), changes);
        c.execute(
            "UPDATE recurring_plans SET deleted_at='2026-10-28' WHERE id='plan'",
            [],
        )
        .unwrap();
        for (_, rows) in subscriptions(c).unwrap() {
            assert_eq!(rows.len(), 1);
        }
    }

    #[test]
    fn saved_planning_exports_person_partner_budgets_and_arrangements_without_forecasts() {
        use crate::{
            plan_basic::{Basic, Contribution},
            plan_core::{DebtRepayment, FundRelease, FundRule, Loan},
            plan_profile::{LifeEvent, SpendItem},
            plan_simplified::{FutureIncome, Household, Partner, Reference},
        };
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(&temp.path().join("fictional-export")).unwrap();
        let mut p = crate::plan_basic::empty_profile();
        let r = &mut p.retire;
        r.spend_cents = Some("200000".into());
        r.basic = Some(Basic {
            contract_version: 1,
            start: Start::Simulation {
                id: "saved".into(),
                available_cents: None,
                date: Some("2026-10-01".into()),
                notes: "虚构手动起点".into(),
            },
            contribution: Contribution {
                id: "contribution".into(),
                monthly_cents: Some("-10000".into()),
            },
            contribution_costs: vec![CostScope {
                source_id: "event:car:loan".into(),
                treatment: "included".into(),
                reference_cents: Some("0".into()),
            }],
            retirement_costs: vec![],
        });
        r.spend_items.push(SpendItem {
            id: "expense".into(),
            label: "虚构生活费".into(),
            monthly_cents: "10000".into(),
            start_month: None,
            end_month: Some("2030-12".into()),
            inflation_hundredths: Some(250),
            essential: false,
            time_unconfirmed: true,
        });
        r.simplified.time.reference = Some(Reference {
            month: "2026-10".into(),
            age_months: 365,
        });
        r.simplified.time.target_month = Some("2030-01".into());
        r.simplified.time.horizon_month = Some("2080-01".into());
        r.simplified.household = Household {
            mode: "couple".into(),
            partner: Some(Partner {
                birth_month: "1995-01".into(),
                stop_age_months: None,
                monthly_cents: None,
            }),
        };
        r.simplified.future_incomes.push(FutureIncome {
            id: "income".into(),
            name: "虚构未来收入".into(),
            role: "other".into(),
            included: false,
            monthly_cents: Some("0".into()),
            start_month: None,
            end_month: None,
            basis: "reference_month".into(),
            basis_month: Some("2026-10".into()),
            growth: "constant_purchasing_power".into(),
            source: Some("虚构来源".into()),
            source_checked_on: Some("2026-10-01".into()),
            notes: "没有进行预测".into(),
        });
        r.life_events.push(LifeEvent {
            id: "car".into(),
            label: "虚构换车计划".into(),
            kind: "car".into(),
            date: "2030-01".into(),
            included: false,
            price_cents: "10000000".into(),
            down_cents: "0".into(),
            extra_cents: "50000".into(),
            loan_rate_hundredths: 300,
            loan_years: 5,
            holding_cents: "10000".into(),
            rent_saved_cents: "0".into(),
            cycle_years: Some(8),
            until_month: Some("2060-01".into()),
            time_unconfirmed: false,
            resale_cents: "500000".into(),
        });
        let mut cancelled_event = r.life_events[0].clone();
        cancelled_event.id = "cancelled-event".into();
        cancelled_event.label = "虚构已取消计划".into();
        r.life_events.push(cancelled_event);
        r.core = Some(Core {
            contract_version: 1,
            monetary_basis_date: "2026-10-01".into(),
            fund_rules: vec![FundRule {
                account_id: "cash".into(),
                availability: "restricted".into(),
                share_hundredths: 5025,
            }],
            releases: vec![FundRelease {
                id: "release".into(),
                account_id: "cash".into(),
                month: "2040-01".into(),
                net_cents: Some("0".into()),
                estimated: true,
                excludes_future_deposits: true,
            }],
            occurrences: vec![
                Occurrence {
                    id: "occurred".into(),
                    event_id: "car".into(),
                    status: "occurred".into(),
                    actual_date: "2026-10-01".into(),
                    payments_complete: false,
                    payments: vec![
                        Payment {
                            id: "actual".into(),
                            date: "2026-10-01".into(),
                            amount_cents: Some("500".into()),
                            account_id: Some("cash".into()),
                            absorbed_snapshot_id: Some("snapshot".into()),
                            absorbed_revision: Some(1),
                            source_kind: Some("expense".into()),
                            source_id: Some("expense".into()),
                        },
                        Payment {
                            id: "zero".into(),
                            date: "2026-10-01".into(),
                            amount_cents: Some("0".into()),
                            account_id: None,
                            absorbed_snapshot_id: None,
                            absorbed_revision: None,
                            source_kind: None,
                            source_id: None,
                        },
                        Payment {
                            id: "unknown".into(),
                            date: "2026-10-02".into(),
                            amount_cents: None,
                            account_id: None,
                            absorbed_snapshot_id: None,
                            absorbed_revision: None,
                            source_kind: None,
                            source_id: None,
                        },
                    ],
                    loan: Some(Loan {
                        account_id: "debt".into(),
                        as_of: "2026-10-01".into(),
                        principal_cents: "100000".into(),
                        remaining_months: 60,
                    }),
                },
                Occurrence {
                    id: "cancelled".into(),
                    event_id: "cancelled-event".into(),
                    status: "cancelled".into(),
                    actual_date: "2026-10-01".into(),
                    payments_complete: false,
                    payments: vec![],
                    loan: None,
                },
            ],
            debt_repayments: vec![DebtRepayment {
                account_id: "debt".into(),
                recorded_on: "2026-10-01".into(),
                as_of: "2026-10-01".into(),
                balance_cents: "100000".into(),
                start_month: "2026-11".into(),
                last_month: None,
                monthly_cents: None,
                before: None,
                after: Some("excluded".into()),
            }],
        });
        let c = store.conn().unwrap();
        c.execute_batch(
            "INSERT INTO fin_accounts
             (id,name,institution,side,kind,counted,opened_on,notes,position,revision,created_at,updated_at)
             VALUES ('cash','虚构可用账户','虚构机构','asset','cash',1,'2020-01-01','',0,1,'2026-10-01','2026-10-01'),
                    ('debt','虚构贷款账户','虚构机构','liability','loan',1,'2020-01-01','',1,1,'2026-10-01','2026-10-01');
             INSERT INTO fin_snapshots (id,date,notes,revision,created_at,updated_at)
             VALUES ('snapshot','2026-10-01','虚构盘点',1,'2026-10-01','2026-10-01');
             INSERT INTO fin_snapshot_entries
             (snapshot_id,account_id,state,amount_cents,side,kind,counted)
             VALUES ('snapshot','cash','entered',100000,'asset','cash',1);
             INSERT INTO expenses
             (id,title,date,amount_cents,category,notes,revision,created_at,updated_at)
             VALUES ('expense','虚构计划付款','2026-10-01',500,'other','',1,'2026-10-01','2026-10-01');",
        ).unwrap();
        c.execute(
            "INSERT INTO plan_profile VALUES (1,?1,1,'2026-10-01')",
            [serde_json::to_string(&p).unwrap()],
        )
        .unwrap();
        let changes = c.total_changes();
        let tables = sheets(&store).unwrap();
        let rows = |name| &tables.iter().find(|(n, _)| *n == name).unwrap().1;
        assert!(rows("规划条件")
            .iter()
            .any(|r| r[1] == "每月净投入" && r[2] == "-100.00"));
        assert!(rows("规划条件")
            .iter()
            .any(|r| r[1] == "停工安排" && r[2] == "与本人同时"));
        assert!(rows("规划条件")
            .iter()
            .any(|r| r[1] == "可用资金" && r[2].is_empty()));
        assert_eq!(rows("规划预算")[1][5], "2.50");
        assert_eq!(rows("规划预算")[2][0], "虚构换车计划：贷款月供");
        assert_eq!(rows("规划预算")[2][2], "0.00");
        assert_eq!(rows("未来收入")[1][3], "0.00");
        assert_eq!(rows("大额计划")[1][4], "100000.00");
        assert_eq!(rows("计划发生")[1][4], "虚构贷款账户");
        assert_eq!(rows("计划发生")[1][6], "1000.00");
        assert_eq!(rows("计划发生")[2][1], "已取消");
        assert_eq!(rows("计划付款")[1][3], "5.00");
        assert_eq!(rows("计划付款")[1][4], "虚构可用账户");
        assert_eq!(rows("计划付款")[1][5], "独立支出：虚构计划付款");
        assert_eq!(rows("计划付款")[1][6], "2026-10-01（已记录计入）");
        assert_eq!(rows("计划付款")[2][3], "0.00");
        assert_eq!(rows("计划付款")[3][3], "");
        assert_eq!(rows("规划资金")[1][0], "虚构可用账户");
        assert_eq!(rows("规划资金")[1][3], "50.25");
        assert_eq!(rows("规划资金")[2][5], "0.00");
        assert_eq!(rows("既有债务还款")[1][6], "");
        assert_eq!(rows("既有债务还款")[1][8], "不计入");
        assert_eq!(rows("既有债务还款")[1][0], "虚构贷款账户");
        for (_, rows) in &tables {
            assert!(rows.iter().all(|r| r.len() == rows[0].len()));
        }
        assert_eq!(c.total_changes(), changes);
        c.execute(
            "UPDATE expenses SET deleted_at='2026-10-28' WHERE id='expense'",
            [],
        )
        .unwrap();
        c.execute(
            "UPDATE fin_snapshots SET deleted_at='2026-10-28' WHERE id='snapshot'",
            [],
        )
        .unwrap();
        let changed = sheets(&store).unwrap();
        let payments = &changed.iter().find(|(n, _)| *n == "计划付款").unwrap().1;
        assert_eq!(payments[1][5], "独立支出已删除或不存在");
        assert_eq!(payments[1][6], "关联盘点已删除或不存在");
        assert!(!changed
            .iter()
            .flat_map(|(_, rows)| rows.iter())
            .flatten()
            .any(|cell| cell.contains("虚构计划付款")));
    }
}
