//! Virtual assets (ADR-001 §21): software licenses, domains and subscriptions.
//! Status and validity are derived on read (X-D14). A linked recurring plan is
//! the source of confirmed cost, service arrangement and paid coverage.
use crate::{
    domain::{cents, date, Error, Result},
    recurring::{enrich_plan, nth, plan, receipt, save_plan, Plan, PlanFields},
    storage::{digest, uid, Store},
};
use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const KINDS: [&str; 3] = ["license", "domain", "subscription"];
/// Manually entered expiry: warn a month ahead. A linked plan already tracks
/// its renewal, so it uses the recurring page's seven days (X-D11); a monthly
/// subscription would otherwise always read as expiring.
const EXPIRING_DAYS: i64 = 30;
const LINKED_EXPIRING_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fields {
    pub name: String,
    /// `license`, `domain` or `subscription`.
    pub kind: String,
    pub provider: String,
    pub purchase_date: Option<String>,
    /// One-time price; only without a linked plan.
    pub price_cents: Option<String>,
    /// Valid until; only without a linked plan. Empty on a license = perpetual.
    pub expires: Option<String>,
    pub plan_id: Option<String>,
    pub url: String,
    pub notes: String,
    pub stopped_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedPlanSave {
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: PlanFields,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Save {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<LinkedPlanSave>,
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
}

#[derive(Debug, Clone, Serialize)]
pub struct VirtualAsset {
    pub paid_until: Option<String>,
    pub plan: Option<Plan>,
    pub id: String,
    pub fields: Fields,
    pub revision: i64,
    /// Name of the linked plan while it is live.
    pub plan_name: Option<String>,
    /// Linked plan is in Recently Deleted: no validity or cost from it.
    pub plan_deleted: bool,
    pub valid_until: Option<String>,
    /// `stopped`, `perpetual`, `unknown`, `expired`, `expiring`, `active`,
    /// `ongoing` or `paused`.
    pub status: String,
    /// Confirmed spending; `None` when the price is unknown.
    pub spent_cents: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanChoice {
    pub id: String,
    pub name: String,
    pub interval_months: u32,
    /// The virtual asset already linked to this plan, if any.
    pub linked_to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub generation: String,
    pub today: String,
    pub items: Vec<VirtualAsset>,
    /// Not stopped.
    pub in_use: i64,
    pub expiring: i64,
    pub expired: i64,
    pub spent_cents: String,
    pub unknown_price: i64,
    pub plans: Vec<PlanChoice>,
}

fn text(v: &str, max: usize, code: &str, message: &str) -> Result<()> {
    if v.chars().count() > max || v.contains('\0') {
        return Err(Error::new(code, message));
    }
    Ok(())
}

fn validate(f: &Fields, today: &str) -> Result<Option<i64>> {
    let name = f.name.trim();
    if name.is_empty() {
        return Err(Error::new("VIRTUAL_NAME", "名称须为 1–80 字"));
    }
    text(name, 80, "VIRTUAL_NAME", "名称须为 1–80 字")?;
    text(&f.provider, 80, "VIRTUAL_PROVIDER", "提供方最多 80 字")?;
    text(&f.url, 2000, "VIRTUAL_URL", "链接最多 2000 字")?;
    text(
        &f.notes,
        10000,
        "VIRTUAL_NOTES",
        "备注最多 10000 字，且不能含空字符",
    )?;
    if !KINDS.contains(&f.kind.as_str()) {
        return Err(Error::new("VIRTUAL_KIND", "请选择类型"));
    }
    for d in [&f.purchase_date, &f.expires, &f.stopped_on]
        .into_iter()
        .flatten()
    {
        date(d)?;
    }
    if f.purchase_date.as_deref().is_some_and(|d| d > today) {
        return Err(Error::new("VIRTUAL_DATE", "购买日期不能晚于今天"));
    }
    if let Some(s) = f.stopped_on.as_deref() {
        if s > today {
            return Err(Error::new("VIRTUAL_STOP", "停用日期不能晚于今天"));
        }
        if f.purchase_date.as_deref().is_some_and(|p| s < p) {
            return Err(Error::new("VIRTUAL_STOP", "停用日期不能早于购买日期"));
        }
    }
    if f.plan_id.is_some() {
        if f.kind == "license" {
            return Err(Error::new("VIRTUAL_PLAN", "买断软件不关联周期计划"));
        }
        if f.price_cents.is_some() || f.expires.is_some() {
            return Err(Error::new(
                "VIRTUAL_PLAN",
                "关联计划后，价格和有效期由计划的付款推算，无需填写",
            ));
        }
    }
    cents(f.price_cents.as_deref()).map_err(|_| Error::new("VIRTUAL_PRICE", "价格须为金额或留空"))
}

const COLUMNS: &str = "v.id,v.name,v.kind,v.provider,v.purchase_date,v.price_cents,v.expires,v.plan_id,v.url,v.notes,v.stopped_on,v.revision,r.name,r.deleted_at IS NOT NULL,r.interval_months";

struct Row {
    item: VirtualAsset,
    interval: Option<u32>,
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        item: VirtualAsset {
            id: r.get(0)?,
            fields: Fields {
                name: r.get(1)?,
                kind: r.get(2)?,
                provider: r.get(3)?,
                purchase_date: r.get(4)?,
                price_cents: r.get::<_, Option<i64>>(5)?.map(|v| v.to_string()),
                expires: r.get(6)?,
                plan_id: r.get(7)?,
                url: r.get(8)?,
                notes: r.get(9)?,
                stopped_on: r.get(10)?,
            },
            revision: r.get(11)?,
            plan_name: r.get(12)?,
            plan_deleted: r.get::<_, Option<bool>>(13)?.unwrap_or(false),
            valid_until: None,
            paid_until: None,
            status: String::new(),
            spent_cents: None,
            plan: None,
        },
        interval: r.get(14)?,
    })
}

/// Fills the derived fields: validity, status and spending.
fn derive(c: &Connection, row: Row, today: NaiveDate) -> Result<VirtualAsset> {
    let mut v = row.item;
    let linked = v.fields.plan_id.clone().filter(|_| !v.plan_deleted);
    if v.plan_deleted {
        v.plan_name = None;
    }
    if let (Some(plan_id), Some(interval)) = (&linked, row.interval) {
        let (last, covered, sum): (Option<String>, Option<String>, Option<i64>) = c.query_row(
            "SELECT max(due_date),max(coverage_end),sum(amount_cents) FROM plan_payments WHERE plan_id=?1 AND state='paid' AND deleted_at IS NULL",
            [plan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        v.valid_until = if covered.is_some() {
            covered
        } else {
            last.map(|d| -> Result<String> {
                let end = nth(date(&d)?, interval, 1)
                    .and_then(|x| x.pred_opt())
                    .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
                Ok(end.format("%Y-%m-%d").to_string())
            })
            .transpose()?
        };
        v.paid_until = v.valid_until.clone();
        v.plan = plan(c, plan_id)?;
        if let Some(p) = &mut v.plan {
            let today = today.to_string();
            let overview_next = crate::recurring::schedule(
                &p.fields,
                date(&today)?.max(date(&p.active_from)?),
                nth(date(&today)?, 12, 1).unwrap_or(date(&today)?),
            )?;
            p.next_due = None;
            if !p.fields.paused {
                for due in overview_next {
                    let recorded: bool = c.query_row(
                        "SELECT EXISTS(SELECT 1 FROM plan_payments WHERE plan_id=?1 AND due_date=?2 AND deleted_at IS NULL)",
                        params![p.id, due.to_string()],
                        |r| r.get(0),
                    )?;
                    if !recorded {
                        p.next_due = Some(due.to_string());
                        break;
                    }
                }
            }
            enrich_plan(c, p, &today)?;
        }
        v.spent_cents = Some(sum.unwrap_or(0).to_string());
    } else if v.fields.plan_id.is_none() {
        v.valid_until = v.fields.expires.clone();
        v.spent_cents = v.fields.price_cents.clone();
    }
    if let Some(p) = &v.plan {
        if (p.fields.service_start.is_some() || v.fields.kind == "subscription")
            && p.fields.end_date.is_some()
        {
            v.valid_until = p.fields.end_date.clone();
        }
    }
    let window = if linked.is_some() {
        LINKED_EXPIRING_DAYS
    } else {
        EXPIRING_DAYS
    };
    let soon = (today + Duration::days(window))
        .format("%Y-%m-%d")
        .to_string();
    let now = today.format("%Y-%m-%d").to_string();
    v.status = match (&v.fields.stopped_on, &v.valid_until) {
        (Some(_), _) => "stopped",
        (None, None) if v.fields.kind == "license" && v.fields.plan_id.is_none() => "perpetual",
        (None, None) if v.fields.kind == "subscription" && v.fields.plan_id.is_none() => "ongoing",
        (None, _)
            if v.plan.as_ref().is_some_and(|p| {
                (p.fields.service_start.is_some() || v.fields.kind == "subscription")
                    && !p.fields.paused
                    && p.fields.end_date.is_none()
            }) =>
        {
            "ongoing"
        }
        (None, _)
            if v.plan.as_ref().is_some_and(|p| {
                (p.fields.service_start.is_some() || v.fields.kind == "subscription")
                    && p.fields.paused
                    && p.fields
                        .end_date
                        .as_deref()
                        .is_none_or(|e| e >= now.as_str())
            }) =>
        {
            "paused"
        }
        (None, None) => "unknown",
        (None, Some(u)) if *u < now => "expired",
        (None, Some(u)) if *u <= soon => "expiring",
        _ => "active",
    }
    .into();
    Ok(v)
}

fn read(c: &Connection, id: Option<&str>, today: NaiveDate) -> Result<Vec<VirtualAsset>> {
    let mut q = c.prepare(&format!("SELECT {COLUMNS} FROM virtual_assets v LEFT JOIN recurring_plans r ON r.id=v.plan_id WHERE v.deleted_at IS NULL AND (?1 IS NULL OR v.id=?1) ORDER BY v.name,v.id"))?;
    let rows = q
        .query_map([id], row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter().map(|r| derive(c, r, today)).collect()
}

impl Store {
    pub fn virtual_save(&mut self, input: &Save, today: &str) -> Result<VirtualAsset> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let now_day = date(today)?;
        let fingerprint = digest(&serde_json::to_vec(&("virtual_asset", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let one = |c: &Connection, id: &str| -> Result<VirtualAsset> {
            read(c, Some(id), now_day)?
                .pop()
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))
        };
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return one(&tx, &id);
        }
        let mut fields = input.fields.clone();
        let old = input.id.as_deref().map(|id| one(&tx, id)).transpose()?;
        if old.as_ref().map(|v| v.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "这项虚拟资产已变化，请重新读取",
            ));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        if let Some(p) = &input.plan {
            if fields.kind != "subscription"
                || p.fields.category != "subscription"
                || p.fields.service_start.is_none()
            {
                return Err(Error::new("VIRTUAL_PLAN", "订阅计划需要开始使用日期"));
            }
            if let Some(pid) = &p.id {
                if old.as_ref().and_then(|o| o.fields.plan_id.as_ref()) != Some(pid)
                    && fields.plan_id.as_ref() != Some(pid)
                {
                    return Err(Error::new("VIRTUAL_PLAN", "关联的计划已经变化"));
                }
                let taken: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM virtual_assets WHERE plan_id=?1 AND id!=?2 AND deleted_at IS NULL)",params![pid,id],|r|r.get(0))?;
                if taken {
                    return Err(Error::new("VIRTUAL_PLAN_TAKEN", "此计划已关联其他虚拟资产"));
                }
            }
            let pid = p.id.clone().unwrap_or_else(uid);
            save_plan(
                &tx,
                &pid,
                p.expected_revision,
                &p.fields,
                p.id.is_some(),
                today,
            )?;
            fields.plan_id = Some(pid);
            fields.price_cents = None;
            fields.expires = None;
        }
        let f = &fields;
        let price = validate(f, today)?;
        if let Some(plan_id) = &f.plan_id {
            let live: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM recurring_plans WHERE id=?1 AND deleted_at IS NULL)",
                [plan_id],
                |r| r.get(0),
            )?;
            // A link to a plan now in Recently Deleted may stay as it was.
            let kept = old
                .as_ref()
                .is_some_and(|o| o.fields.plan_id.as_ref() == Some(plan_id));
            if !live && !kept {
                return Err(Error::new("VIRTUAL_PLAN", "找不到这项周期计划"));
            }
            let taken: Option<String> = tx
                .query_row(
                    "SELECT name FROM virtual_assets WHERE plan_id=?1 AND id!=?2 AND deleted_at IS NULL",
                    params![plan_id, id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(name) = taken {
                return Err(Error::new(
                    "VIRTUAL_PLAN_TAKEN",
                    &format!("这项计划已关联「{name}」"),
                ));
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        let values = params![
            id,
            f.name.trim(),
            f.kind,
            f.provider.trim(),
            f.purchase_date,
            price,
            f.expires,
            f.plan_id,
            f.url.trim(),
            f.notes,
            f.stopped_on,
            now
        ];
        if old.is_some() {
            tx.execute("UPDATE virtual_assets SET name=?2,kind=?3,provider=?4,purchase_date=?5,price_cents=?6,expires=?7,plan_id=?8,url=?9,notes=?10,stopped_on=?11,revision=revision+1,updated_at=?12 WHERE id=?1", values)?;
        } else {
            tx.execute("INSERT INTO virtual_assets(id,name,kind,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?12)", values)?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = one(&tx, &id)?;
        self.hit("virtual.before_commit")?;
        tx.commit()?;
        self.hit("virtual.after_commit")?;
        Ok(result)
    }

    pub fn virtual_overview(&self, today: &str) -> Result<Overview> {
        let c = self.conn()?;
        let items = read(c, None, date(today)?)?;
        let count = |s: &str| items.iter().filter(|v| v.status == s).count() as i64;
        let mut spent: i64 = 0;
        for v in &items {
            if let Some(x) = &v.spent_cents {
                spent = spent
                    .checked_add(
                        x.parse()
                            .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?,
                    )
                    .ok_or_else(|| Error::new("VIRTUAL_OVERFLOW", "金额合计超出范围"))?;
            }
        }
        let mut q = c.prepare("SELECT r.id,r.name,r.interval_months,(SELECT v.name FROM virtual_assets v WHERE v.plan_id=r.id AND v.deleted_at IS NULL) FROM recurring_plans r WHERE r.deleted_at IS NULL ORDER BY r.name,r.id")?;
        let plans = q
            .query_map([], |r| {
                Ok(PlanChoice {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    interval_months: r.get(2)?,
                    linked_to: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Overview {
            generation: self.generation(),
            today: today.into(),
            in_use: items.iter().filter(|v| v.status != "stopped").count() as i64,
            expiring: count("expiring"),
            expired: count("expired"),
            unknown_price: items.iter().filter(|v| v.spent_cents.is_none()).count() as i64,
            spent_cents: spent.to_string(),
            items,
            plans,
        })
    }
}

/// Backup validation for schema 19 data beyond what SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法虚拟资产资料");
    let mut q = c.prepare(&format!(
        "SELECT {COLUMNS} FROM virtual_assets v LEFT JOIN recurring_plans r ON r.id=v.plan_id"
    ))?;
    let rows = q
        .query_map([], row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for r in rows {
        let v = r.item;
        if uuid::Uuid::parse_str(&v.id).is_err()
            || v.revision < 1
            || (v.fields.plan_id.is_some() && r.interval.is_none())
        {
            return Err(bad());
        }
        validate(&v.fields, "9999-12-31").map_err(|_| bad())?;
    }
    Ok(())
}
