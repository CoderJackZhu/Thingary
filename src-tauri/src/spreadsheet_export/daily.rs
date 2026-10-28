//! Readable daily business records. All queries are unpaged and read-only;
//! Recently Deleted records (including children of deleted parents) stay out.
use super::ExportSheet;
use crate::{
    domain::{Error, Result},
    storage::Store,
};
use rusqlite::{Connection, OptionalExtension, Row};
use std::collections::BTreeMap;

pub(super) fn sheets(store: &Store) -> Result<Vec<ExportSheet>> {
    let c = store.conn()?;
    Ok(vec![
        ("物品", assets(store)?),
        ("心愿清单", wishes(c)?),
        ("心愿决策", wish_decisions(c)?),
        ("维护记录", maintenance(c)?),
        ("保障记录", warranties(c)?),
        ("物品状态历史", lifecycle(c)?),
        ("虚拟资产", virtual_assets(c)?),
        ("储值充值", topups(c)?),
        ("储值余额记录", balances(c)?),
        ("业务提醒", reminders(c)?),
        ("自定义选项", choices(c)?),
    ])
}

fn header(labels: &[&str]) -> Vec<Vec<String>> {
    vec![labels.iter().map(|s| (*s).to_owned()).collect()]
}

fn append<F>(rows: &mut Vec<Vec<String>>, c: &Connection, sql: &str, read: F) -> Result<()>
where
    F: FnMut(&Row<'_>) -> rusqlite::Result<Vec<String>>,
{
    let mut stmt = c.prepare(sql)?;
    for row in stmt.query_map([], read)? {
        rows.push(row?);
    }
    Ok(())
}

fn text(row: &Row<'_>, column: usize) -> rusqlite::Result<String> {
    Ok(row.get::<_, Option<String>>(column)?.unwrap_or_default())
}

fn money(row: &Row<'_>, column: usize) -> rusqlite::Result<String> {
    Ok(row
        .get::<_, Option<i64>>(column)?
        .map(|v| crate::currency::decimal(v, 2))
        .unwrap_or_default())
}

fn saved_money(value: &str) -> Result<String> {
    let value = value
        .parse::<i64>()
        .map_err(|_| Error::new("FORMAT", "已保存的金额格式不正确，无法导出"))?;
    Ok(crate::currency::decimal(value, 2))
}

fn yes(value: bool) -> String {
    if value { "是" } else { "否" }.into()
}

fn origin(
    row: &Row<'_>,
    currency: usize,
    original: usize,
    rate: usize,
    current: usize,
) -> rusqlite::Result<[String; 3]> {
    let (Some(code), Some(minor), Some(micro), Some(cents)) = (
        row.get::<_, Option<String>>(currency)?,
        row.get::<_, Option<i64>>(original)?,
        row.get::<_, Option<i64>>(rate)?,
        row.get::<_, Option<i64>>(current)?,
    ) else {
        return Ok(Default::default());
    };
    let saved = crate::catalog::PriceOrigin {
        currency: code.clone(),
        original_minor: minor.to_string(),
        fx_rate_micro: micro.to_string(),
    };
    if !saved.explains(Some(&cents.to_string())) {
        return Ok(Default::default());
    }
    Ok([
        code.clone(),
        crate::currency::decimal(minor, crate::currency::decimals(&code)),
        crate::currency::decimal(micro, 6),
    ])
}

fn assets(store: &Store) -> Result<Vec<Vec<String>>> {
    // Reuse the importable columns verbatim, including their order and literal
    // text handling. Added fields are only for reading.
    let csv = store.asset_table(false)?;
    let mut rows: Vec<Vec<String>> =
        crate::csv_import::records(csv.trim_start_matches('\u{feff}'))?
            .into_iter()
            .map(|(_, row)| row)
            .collect();
    let mut additions = BTreeMap::new();
    let c = store.conn()?;
    let mut stmt = c.prepare(
        "SELECT a.id,p.serial_number,ap.payload,n.name,
                (SELECT count(*) FROM asset_photos ph WHERE ph.asset_id=a.id)
         FROM assets a LEFT JOIN asset_profiles p ON p.asset_id=a.id
         LEFT JOIN asset_preferences ap ON ap.asset_id=a.id
         LEFT JOIN named_choices n ON n.id=json_extract(ap.payload,'$.label_id')
         WHERE a.deleted_at IS NULL",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            text(r, 1)?,
            r.get::<_, Option<String>>(2)?,
            text(r, 3)?,
            r.get::<_, i64>(4)?,
        ))
    })? {
        let (id, serial, raw, label, photos) = row?;
        let p: crate::preferences::AssetPreferences = raw
            .map(|raw| serde_json::from_str(&raw))
            .transpose()?
            .unwrap_or_default();
        let (goal_kind, goal_cost, goal_date) = match &p.goal {
            crate::preferences::Goal::None => ("未设置", String::new(), String::new()),
            crate::preferences::Goal::Cost { cents } => {
                ("单位成本", saved_money(cents)?, String::new())
            }
            crate::preferences::Goal::Date { date } => ("使用至日期", String::new(), date.clone()),
        };
        let exclusions = [
            (p.exclude.total, "总投入"),
            (p.exclude.daily, "每日成本"),
            (p.exclude.statistics, "统计"),
            (p.exclude.timeline, "时间线"),
        ]
        .into_iter()
        .filter_map(|(excluded, name)| excluded.then_some(name))
        .collect::<Vec<_>>()
        .join("、");
        additions.insert(
            id,
            vec![
                serial,
                label,
                match p.cost_mode.as_str() {
                    "per_use" => "按次",
                    _ => "按日",
                }
                .into(),
                p.use_count.to_string(),
                goal_kind.into(),
                goal_cost,
                goal_date,
                yes(p.pinned),
                exclusions,
                photos.to_string(),
            ],
        );
    }
    rows[0].extend(
        [
            "序列号",
            "标签（只读）",
            "成本方式（只读）",
            "使用次数（只读）",
            "目标类型（只读）",
            "目标单位成本（元，只读）",
            "目标日期（只读）",
            "置顶（只读）",
            "不计入（只读）",
            "照片数量（只读）",
        ]
        .map(str::to_owned),
    );
    for row in rows.iter_mut().skip(1) {
        let extra = additions
            .remove(&row[0])
            .ok_or_else(|| Error::new("REFERENCE", "物品资料已变化，请重新导出"))?;
        row.extend(extra);
    }
    Ok(rows)
}

fn wishes(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "名称",
        "决策状态",
        "预计价格（元）",
        "原币币种",
        "原币金额",
        "记录汇率",
        "分类",
        "优先级",
        "加入日期",
        "计划日期",
        "确认购入日期",
        "不再考虑日期",
        "考虑理由与顾虑",
        "决定备注",
        "链接",
        "渠道",
        "已购入物品",
        "考虑替换的物品",
        "旧攒钱记录（元）",
        "旧实现日期（待核实）",
        "旧自动生成物品（待核实）",
        "置顶",
        "照片数量",
        "心愿编号",
    ]);
    let mut stmt = c.prepare(
        "SELECT w.id,w.name,w.decision_state,w.estimated_price_cents,o.currency,
                o.original_minor,o.fx_rate_micro,cat.name,w.priority,w.target_date,
                w.achieved_at,w.abandoned_at,w.notes,w.decision_note,w.external_link,
                wp.payload,w.created_at,
                CASE WHEN a.deleted_at IS NULL THEN a.name ELSE '关联物品在最近删除中' END,
                CASE WHEN replacement.id IS NOT NULL THEN
                    CASE WHEN replacement.deleted_at IS NULL THEN replacement.name ELSE '关联物品在最近删除中' END
                    WHEN w.replacement_asset_name!='' THEN w.replacement_asset_name || '（已删除）' END,
                w.legacy_generated_at,
                CASE WHEN legacy.deleted_at IS NULL THEN legacy.name ELSE '关联物品在最近删除中' END,
                (SELECT count(*) FROM wishlist_attachments ph WHERE ph.wishlist_id=w.id)
         FROM wishlist_items w LEFT JOIN categories cat ON cat.id=w.category_id
         LEFT JOIN amount_origin o ON o.kind='wish' AND o.record_id=w.id
         LEFT JOIN wishlist_preferences wp ON wp.wishlist_id=w.id
         LEFT JOIN assets a ON a.id=w.converted_asset_id
         LEFT JOIN assets replacement ON replacement.id=w.replacement_asset_id
         LEFT JOIN assets legacy ON legacy.id=w.legacy_generated_asset_id
         WHERE w.deleted_at IS NULL ORDER BY w.created_at,w.id",
    )?;
    let mut wish_rows = stmt.query([])?;
    while let Some(r) = wish_rows.next()? {
        let raw: Option<String> = r.get(15)?;
        let p: crate::wish_plan::Preferences = raw
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or_default();
        let channel = match &p.channel_id {
            Some(id) => c
                .query_row("SELECT name FROM channels WHERE id=?1", [id], |r| r.get(0))
                .optional()?
                .unwrap_or_else(|| "关联渠道已删除".into()),
            None => String::new(),
        };
        let state = text(r, 2)?;
        let [code, amount, rate] = origin(r, 4, 5, 6, 3)?;
        let added = p.added_date.unwrap_or(super::date(&text(r, 16)?));
        let legacy_saving = if p.mode.as_deref() == Some("savings") || p.saved_cents != "0" {
            saved_money(&p.saved_cents)?
        } else {
            String::new()
        };
        rows.push(vec![
            text(r, 1)?,
            decision_label(&state).into(),
            money(r, 3)?,
            code,
            amount,
            rate,
            text(r, 7)?,
            match text(r, 8)?.as_str() {
                "high" => "高",
                "medium" => "中",
                "low" => "低",
                _ => "",
            }
            .into(),
            added,
            text(r, 9)?,
            if state == "purchased" {
                super::date(&text(r, 10)?)
            } else {
                String::new()
            },
            super::date(&text(r, 11)?),
            text(r, 12)?,
            text(r, 13)?,
            text(r, 14)?,
            channel,
            text(r, 17)?,
            text(r, 18)?,
            // These amounts are retained legacy notes, never savings balances.
            legacy_saving,
            super::date(&text(r, 19)?),
            text(r, 20)?,
            yes(p.pinned),
            r.get::<_, i64>(21)?.to_string(),
            text(r, 0)?,
        ]);
    }
    Ok(rows)
}

fn decision_label(state: &str) -> &'static str {
    match state {
        "considering" => "考虑中",
        "purchased" => "已确认购入",
        "dropped" => "不再考虑",
        "legacy_achieved" => "旧实现记录待核实",
        _ => "待核实",
    }
}

fn wish_decisions(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "心愿名称",
        "记录时间",
        "动作",
        "决定备注",
        "关联物品",
        "心愿编号",
    ]);
    let mut stmt = c.prepare(
        "SELECT w.name,d.created_at,d.action,d.snapshot,w.id
         FROM wishlist_audit d JOIN wishlist_items w ON w.id=d.wishlist_id
         WHERE w.deleted_at IS NULL AND d.action!='add'
         ORDER BY d.created_at,d.sequence",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            text(r, 0)?,
            text(r, 1)?,
            text(r, 2)?,
            text(r, 3)?,
            text(r, 4)?,
        ))
    })? {
        let (name, time, action, raw, id) = row?;
        // Only the readable decision is extracted from the saved snapshot;
        // request receipts, file metadata and the raw snapshot stay private.
        let snapshot: serde_json::Value = serde_json::from_str(&raw)?;
        let note = snapshot["decision_note"].as_str().unwrap_or("").to_owned();
        let item = snapshot["converted_asset"]["name"]
            .as_str()
            .unwrap_or("")
            .to_owned();
        let action = match action.as_str() {
            "abandon" | "drop" => "不再考虑",
            "reconsider" => "重新考虑",
            "convert" if snapshot["decision_state"].as_str() != Some("purchased") => {
                "旧实现记录（待核实）"
            }
            "convert" => "记录购入",
            "link" => "确认关联已购入物品",
            "verify_purchased" => "核实为已购入",
            "verify_considering" => "核实为考虑中",
            "verify_dropped" => "核实为不再考虑",
            _ => "决定记录",
        };
        rows.push(vec![
            name,
            super::time(&time),
            action.into(),
            note,
            item,
            id,
        ]);
    }
    Ok(rows)
}

fn maintenance(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "物品名称",
        "日期",
        "类型",
        "标题",
        "费用（元）",
        "提供方",
        "说明",
        "照片数量",
        "维护编号",
        "物品编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT a.name,m.date,m.kind,m.title,m.cost_cents,m.provider,m.description,
                (SELECT count(*) FROM maintenance_photos p WHERE p.maintenance_id=m.id),m.id,a.id
         FROM maintenances m JOIN assets a ON a.id=m.asset_id
         WHERE m.deleted_at IS NULL AND a.deleted_at IS NULL
         ORDER BY m.date IS NULL,m.date,a.name,m.id",
        |r| {
            Ok(vec![
                text(r, 0)?,
                text(r, 1)?,
                match text(r, 2)?.as_str() {
                    "repair" => "维修",
                    "service" => "保养",
                    "cleaning" => "清洁",
                    "replacement" => "更换",
                    "upgrade" => "升级",
                    "accessory" => "配件",
                    _ => "其他",
                }
                .into(),
                text(r, 3)?,
                money(r, 4)?,
                text(r, 5)?,
                text(r, 6)?,
                r.get::<_, i64>(7)?.to_string(),
                text(r, 8)?,
                text(r, 9)?,
            ])
        },
    )?;
    Ok(rows)
}

fn warranty_label(kind: &str) -> &'static str {
    match kind {
        "manufacturer" => "原厂保修",
        "extended" => "延长保障",
        "applecare" => "AppleCare",
        "store" => "店铺保障",
        _ => "其他保障",
    }
}

fn warranties(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "物品名称",
        "保障类型",
        "提供方",
        "开始日期",
        "结束日期",
        "备注",
        "照片数量",
        "保障编号",
        "物品编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT a.name,w.kind,w.provider,w.start_date,w.end_date,w.notes,
                (SELECT count(*) FROM warranty_photos p WHERE p.warranty_id=w.id),w.id,a.id
         FROM warranties w JOIN assets a ON a.id=w.asset_id
         WHERE w.deleted_at IS NULL AND a.deleted_at IS NULL
         ORDER BY a.name,w.start_date IS NULL,w.start_date,w.id",
        |r| {
            Ok(vec![
                text(r, 0)?,
                warranty_label(&text(r, 1)?).into(),
                text(r, 2)?,
                text(r, 3)?,
                text(r, 4)?,
                text(r, 5)?,
                r.get::<_, i64>(6)?.to_string(),
                text(r, 7)?,
                text(r, 8)?,
            ])
        },
    )?;
    Ok(rows)
}

fn lifecycle(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "物品名称",
        "业务日期",
        "动作",
        "售价（元）",
        "售出平台",
        "买方",
        "说明",
        "撤销时间",
        "物品编号",
        "记录编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT a.name,e.date,CASE e.kind WHEN 'retire' THEN '退役' ELSE '重新启用' END,
                NULL,'','',e.notes,'',a.id,e.id,e.created_at,e.sequence
         FROM lifecycle_events e JOIN assets a ON a.id=e.asset_id WHERE a.deleted_at IS NULL
         UNION ALL
         SELECT a.name,s.date,CASE WHEN s.revoked_at IS NULL THEN '售出' ELSE '售出（已撤销）' END,
                s.price_cents,s.platform,s.buyer,s.notes,s.revoked_at,a.id,s.id,s.created_at,9223372036854775807
         FROM sales s JOIN assets a ON a.id=s.asset_id WHERE a.deleted_at IS NULL
         ORDER BY 2,1,9,12,11,10",
        |r| {
            Ok(vec![
                text(r, 0)?,
                text(r, 1)?,
                text(r, 2)?,
                money(r, 3)?,
                text(r, 4)?,
                text(r, 5)?,
                text(r, 6)?,
                super::time(&text(r, 7)?),
                text(r, 8)?,
                text(r, 9)?,
            ])
        },
    )?;
    Ok(rows)
}

fn virtual_assets(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "名称",
        "计费方式",
        "标签",
        "提供方",
        "购买日期",
        "单次价格（元）",
        "手动记录的权益到期日",
        "明确永久有效",
        "结束使用日期",
        "关联周期费用",
        "付款方式说明",
        "链接",
        "备注",
        "档案类型",
        "虚拟资产编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT v.name,v.billing,n.name,v.provider,v.purchase_date,v.price_cents,
                v.expires,v.perpetual,v.stopped_on,
                CASE WHEN p.deleted_at IS NULL THEN p.name ELSE '关联计划在最近删除中' END,
                v.pay_method,v.url,v.notes,v.kind,v.id
         FROM virtual_assets v LEFT JOIN named_choices n ON n.id=v.label_id
         LEFT JOIN recurring_plans p ON p.id=v.plan_id
         WHERE v.deleted_at IS NULL ORDER BY v.name,v.id",
        |r| {
            Ok(vec![
                text(r, 0)?,
                match text(r, 1)?.as_str() {
                    "subscription" => "周期订阅",
                    "topup" => "储值",
                    _ => "单次购买",
                }
                .into(),
                text(r, 2)?,
                text(r, 3)?,
                text(r, 4)?,
                money(r, 5)?,
                text(r, 6)?,
                yes(r.get(7)?),
                text(r, 8)?,
                text(r, 9)?,
                text(r, 10)?,
                text(r, 11)?,
                text(r, 12)?,
                match text(r, 13)?.as_str() {
                    "license" => "软件授权",
                    "domain" => "域名",
                    "subscription" => "订阅",
                    _ => "一般虚拟资产",
                }
                .into(),
                text(r, 14)?,
            ])
        },
    )?;
    Ok(rows)
}

fn topups(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "储值名称",
        "充值日期",
        "实付（元）",
        "赠送（元）",
        "记录的到账额度（元）",
        "付款方式说明",
        "备注",
        "充值编号",
        "虚拟资产编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT v.name,t.topup_date,t.paid_cents,t.gift_cents,t.credit_cents,
                t.pay_method,t.notes,t.id,v.id
         FROM virtual_topups t JOIN virtual_assets v ON v.id=t.asset_id
         WHERE t.deleted_at IS NULL AND v.deleted_at IS NULL
         ORDER BY t.topup_date IS NULL,t.topup_date,v.name,t.id",
        |r| {
            Ok(vec![
                text(r, 0)?,
                text(r, 1)?,
                money(r, 2)?,
                money(r, 3)?,
                money(r, 4)?,
                text(r, 5)?,
                text(r, 6)?,
                text(r, 7)?,
                text(r, 8)?,
            ])
        },
    )?;
    Ok(rows)
}

fn balances(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "储值名称",
        "记录日期",
        "手动记录余额（元）",
        "备注",
        "余额记录编号",
        "虚拟资产编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT v.name,b.recorded_on,b.balance_cents,b.notes,b.id,v.id
         FROM virtual_balances b JOIN virtual_assets v ON v.id=b.asset_id
         WHERE b.deleted_at IS NULL AND v.deleted_at IS NULL
         ORDER BY b.recorded_on,v.name,b.id",
        |r| {
            Ok(vec![
                text(r, 0)?,
                text(r, 1)?,
                money(r, 2)?,
                text(r, 3)?,
                text(r, 4)?,
                text(r, 5)?,
            ])
        },
    )?;
    Ok(rows)
}

fn reminders(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&[
        "对象名称",
        "提醒类型",
        "关联保障",
        "保存的提醒日期",
        "逐期重复",
        "提前天数",
        "备注",
        "对象编号",
    ]);
    append(
        &mut rows,
        c,
        "SELECT CASE r.kind WHEN 'warranty' THEN a.name WHEN 'wishlist' THEN w.name ELSE v.name END,
                r.kind,g.kind,g.provider,r.date,r.repeat_every_period,r.lead_days,r.notes,r.entity_id
         FROM reminders r
         LEFT JOIN assets a ON r.kind='warranty' AND a.id=r.entity_id
         LEFT JOIN warranties g ON r.kind='warranty' AND g.id=r.source_id AND g.asset_id=a.id
         LEFT JOIN wishlist_items w ON r.kind='wishlist' AND w.id=r.entity_id
         LEFT JOIN virtual_assets v ON r.kind='renewal' AND v.id=r.entity_id
         LEFT JOIN recurring_plans p ON p.id=v.plan_id
         WHERE (r.kind='warranty' AND a.id IS NOT NULL AND a.deleted_at IS NULL AND g.id IS NOT NULL AND g.deleted_at IS NULL)
            OR (r.kind='wishlist' AND w.id IS NOT NULL AND w.deleted_at IS NULL)
            OR (r.kind='renewal' AND v.id IS NOT NULL AND v.deleted_at IS NULL
                AND (v.plan_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL)))
         ORDER BY r.date,r.kind,r.entity_id,r.id",
        |r| {
            let kind = text(r, 1)?;
            let repeated = r.get::<_, bool>(5)?;
            let warranty = if kind == "warranty" {
                let provider = text(r, 3)?;
                let label = warranty_label(&text(r, 2)?);
                if provider.is_empty() {
                    label.into()
                } else {
                    format!("{label} · {provider}")
                }
            } else {
                String::new()
            };
            Ok(vec![
                text(r, 0)?,
                match kind.as_str() {
                    "warranty" => "保障提醒",
                    "wishlist" => "心愿提醒",
                    _ => "续费提醒",
                }
                .into(),
                warranty,
                text(r, 4)?,
                yes(repeated),
                if repeated {
                    r.get::<_, i64>(6)?.to_string()
                } else {
                    String::new()
                },
                text(r, 7)?,
                text(r, 8)?,
            ])
        },
    )?;
    Ok(rows)
}

fn choices(c: &Connection) -> Result<Vec<Vec<String>>> {
    let mut rows = header(&["选项类型", "名称", "适用范围", "是否启用"]);
    append(
        &mut rows,
        c,
        "SELECT '分类',t.name,'物品与心愿',
                NOT EXISTS(SELECT 1 FROM disabled_choices d WHERE d.kind='category' AND d.id=t.id),0,t.position,t.id
         FROM categories t
         UNION ALL
         SELECT '渠道',t.name,'物品与心愿',
                NOT EXISTS(SELECT 1 FROM disabled_choices d WHERE d.kind='channel' AND d.id=t.id),1,t.position,t.id
         FROM channels t
         UNION ALL
         SELECT CASE n.kind WHEN 'label' THEN '标签' ELSE '售出平台' END,n.name,
                CASE WHEN n.kind='sale_channel' THEN '物品售出'
                     WHEN coalesce(s.scope,'physical')='physical' THEN '物品'
                     WHEN s.scope='virtual' THEN '虚拟资产' ELSE '物品与虚拟资产' END,
                n.enabled,2,n.position,n.id
         FROM named_choices n LEFT JOIN label_scopes s ON s.label_id=n.id
         UNION ALL
         SELECT '账户分组',g.name,'财富账户',1,3,g.position,g.id FROM fin_account_groups g
         ORDER BY 5,6,7",
        |r| Ok(vec![text(r, 0)?, text(r, 1)?, text(r, 2)?, yes(r.get(3)?)]),
    )?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        (dir, store)
    }

    fn sheet<'a>(sheets: &'a [ExportSheet], name: &str) -> &'a Vec<Vec<String>> {
        &sheets.iter().find(|(n, _)| *n == name).unwrap().1
    }

    fn cell<'a>(rows: &'a [Vec<String>], row: usize, label: &str) -> &'a str {
        let column = rows[0].iter().position(|s| s == label).unwrap();
        &rows[row][column]
    }

    fn seed_asset(c: &Connection, id: &str, deleted: bool) {
        c.execute(
            "INSERT INTO assets(id,name,price_cents,purchase_date,revision,deleted_at,lifecycle_state)
             VALUES(?1,'虚构相机',0,'2026-01-01',1,?2,'active')",
            rusqlite::params![id, deleted.then_some("2026-10-01")],
        )
        .unwrap();
    }

    fn seed_virtual(c: &Connection, id: &str, deleted: bool) {
        c.execute(
            "INSERT INTO virtual_assets(id,name,kind,provider,purchase_date,price_cents,expires,plan_id,
             url,notes,stopped_on,revision,created_at,updated_at,deleted_at,billing,pay_method)
             VALUES(?1,'虚构交通卡','general','虚构服务商',NULL,NULL,NULL,NULL,'','',NULL,1,
                    '2026-01-01','2026-01-01',?2,'topup','')",
            rusqlite::params![id, deleted.then_some("2026-10-01")],
        )
        .unwrap();
    }

    #[test]
    fn empty_exports_have_headers_and_preserve_the_importable_asset_prefix() {
        let (_dir, store) = fixture();
        let result = sheets(&store).unwrap();
        assert_eq!(result.len(), 11);
        assert!(result.iter().all(|(_, rows)| !rows.is_empty()));
        assert!(result
            .iter()
            .all(|(_, rows)| rows.len() == 1 || rows[0][0] == "选项类型"));
        let assets = sheet(&result, "物品");
        assert_eq!(
            &assets[0][..crate::csv_export::HEADER.len()],
            crate::csv_export::HEADER.as_slice()
        );
    }

    #[test]
    fn origin_precision_and_explanation_match_all_supported_currencies() {
        let c = Connection::open_in_memory().unwrap();
        for (code, _, decimals) in crate::currency::CURRENCIES {
            if code == "CNY" {
                continue;
            }
            let minor = if decimals == 0 { 123 } else { 12345 };
            let expected = crate::currency::decimal(minor, decimals);
            let cents = if decimals == 0 { 12300 } else { 12345 };
            let result = c
                .query_row(
                    "SELECT ?1,?2,1000000,?3",
                    rusqlite::params![code, minor, cents],
                    |r| origin(r, 0, 1, 2, 3),
                )
                .unwrap();
            assert_eq!(result, [code.into(), expected, "1.000000".into()]);
        }
        let stale = c
            .query_row("SELECT 'USD',12345,1000000,100", [], |r| {
                origin(r, 0, 1, 2, 3)
            })
            .unwrap();
        assert_eq!(stale, [String::new(), String::new(), String::new()]);
        let unknown = c
            .query_row("SELECT 'USD',0,1000000,NULL", [], |r| origin(r, 0, 1, 2, 3))
            .unwrap();
        assert_eq!(unknown, [String::new(), String::new(), String::new()]);
    }

    #[test]
    fn parent_deletion_excludes_daily_children_and_reminders() {
        let (_dir, store) = fixture();
        let c = store.conn().unwrap();
        for (id, deleted) in [("live", false), ("trash", true)] {
            seed_asset(c, id, deleted);
            seed_virtual(c, id, deleted);
            c.execute(
                "INSERT INTO maintenances(id,asset_id,date,kind,title,description,cost_cents,provider,
                 created_at,updated_at) VALUES(?1,?1,NULL,'accessory','虚构配件','',NULL,'','2026-01-01','2026-01-01')",
                [id],
            )
            .unwrap();
            c.execute(
                "INSERT INTO warranties(id,asset_id,kind,provider,start_date,end_date,notes,created_at,updated_at)
                 VALUES(?1,?1,'manufacturer','虚构保障方',NULL,'2026-12-31','','2026-01-01','2026-01-01')",
                [id],
            )
            .unwrap();
            c.execute(
                "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes)
                 VALUES(?1,'warranty',?1,?1,'2026-12-01','保存的安排')",
                [id],
            )
            .unwrap();
            c.execute(
                "INSERT INTO virtual_topups(id,asset_id,paid_cents,gift_cents,credit_cents,pay_method,
                 notes,revision,created_at,updated_at)
                 VALUES(?1,?1,0,NULL,NULL,'','',1,'2026-01-01','2026-01-01')",
                [id],
            )
            .unwrap();
            c.execute(
                "INSERT INTO virtual_balances(id,asset_id,balance_cents,recorded_on,notes,revision,
                 created_at,updated_at) VALUES(?1,?1,0,'2026-10-01','',1,'2026-01-01','2026-01-01')",
                [id],
            )
            .unwrap();
        }
        let result = sheets(&store).unwrap();
        for name in [
            "物品",
            "维护记录",
            "保障记录",
            "业务提醒",
            "虚拟资产",
            "储值充值",
            "储值余额记录",
        ] {
            assert_eq!(sheet(&result, name).len(), 2, "{name}");
        }
        assert_eq!(cell(sheet(&result, "维护记录"), 1, "费用（元）"), "");
        assert_eq!(cell(sheet(&result, "储值充值"), 1, "实付（元）"), "0.00");
        assert_eq!(cell(sheet(&result, "储值充值"), 1, "赠送（元）"), "");
        assert_eq!(
            cell(sheet(&result, "储值余额记录"), 1, "手动记录余额（元）"),
            "0.00"
        );
        let changes = c.total_changes();
        sheets(&store).unwrap();
        assert_eq!(c.total_changes(), changes);
    }

    #[test]
    fn readable_values_keep_manual_balances_separate_and_exclude_deleted_children() {
        let (_dir, store) = fixture();
        let c = store.conn().unwrap();
        seed_asset(c, "asset", false);
        seed_virtual(c, "card", false);
        for id in ["kept", "removed"] {
            c.execute(
                "INSERT INTO maintenances(id,asset_id,date,kind,title,description,cost_cents,provider,
                 created_at,updated_at,deleted_at)
                 VALUES(?1,'asset','2026-02-01','accessory','虚构电池','可替换电池',1250,
                        '虚构配件店','2026-02-01','2026-02-01',?2)",
                rusqlite::params![id, (id == "removed").then_some("2026-10-01")],
            )
            .unwrap();
            c.execute(
                "INSERT INTO warranties(id,asset_id,kind,provider,start_date,end_date,notes,created_at,
                 updated_at,deleted_at)
                 VALUES(?1,'asset','extended','虚构保障方','2026-01-01','2027-01-01','意外保障',
                        '2026-01-01','2026-01-01',?2)",
                rusqlite::params![id, (id == "removed").then_some("2026-10-01")],
            )
            .unwrap();
            c.execute(
                "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes)
                 VALUES(?1,'warranty','asset',?1,'2026-12-25','记得续保')",
                [id],
            )
            .unwrap();
            c.execute(
                "INSERT INTO virtual_topups(id,asset_id,topup_date,paid_cents,gift_cents,credit_cents,
                 pay_method,notes,revision,created_at,updated_at,deleted_at)
                 VALUES(?1,'card','2026-02-03',5000,1000,6000,'虚构付款备注','充值活动',
                        1,'2026-02-03','2026-02-03',?2)",
                rusqlite::params![id, (id == "removed").then_some("2026-10-01")],
            )
            .unwrap();
            c.execute(
                "INSERT INTO virtual_balances(id,asset_id,balance_cents,recorded_on,notes,revision,
                 created_at,updated_at,deleted_at)
                 VALUES(?1,'card',1200,'2026-03-01','人工盘点余额',1,'2026-03-01','2026-03-01',?2)",
                rusqlite::params![id, (id == "removed").then_some("2026-10-01")],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,
             paused,active_from,notes,revision,created_at,updated_at,service_start,coverage_start,auto_renew)
             VALUES('plan','虚构周期计划','subscription',500,1,'2026-01-01',0,'2026-01-01','',
                    1,'2026-01-01','2026-01-01','2026-01-01','2026-01-01',1)",
            [],
        )
        .unwrap();
        seed_virtual(c, "subscription", false);
        c.execute(
            "UPDATE virtual_assets SET name='虚构订阅',billing='subscription',plan_id='plan'
             WHERE id='subscription'",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO reminders(id,kind,entity_id,date,notes,repeat_every_period,lead_days)
             VALUES('renewal','renewal','subscription','2026-10-30','用户保存的安排',1,7)",
            [],
        )
        .unwrap();
        let changes = c.total_changes();
        let result = sheets(&store).unwrap();
        assert_eq!(c.total_changes(), changes);
        for name in ["维护记录", "保障记录", "储值充值", "储值余额记录"] {
            assert_eq!(sheet(&result, name).len(), 2, "{name}");
        }
        let maintenance = sheet(&result, "维护记录");
        assert_eq!(cell(maintenance, 1, "物品名称"), "虚构相机");
        assert_eq!(cell(maintenance, 1, "类型"), "配件");
        assert_eq!(cell(maintenance, 1, "日期"), "2026-02-01");
        assert_eq!(cell(maintenance, 1, "费用（元）"), "12.50");
        assert_eq!(cell(maintenance, 1, "说明"), "可替换电池");
        let warranty = sheet(&result, "保障记录");
        assert_eq!(cell(warranty, 1, "保障类型"), "延长保障");
        assert_eq!(cell(warranty, 1, "提供方"), "虚构保障方");
        assert_eq!(cell(warranty, 1, "开始日期"), "2026-01-01");
        assert_eq!(cell(warranty, 1, "结束日期"), "2027-01-01");
        let virtuals = sheet(&result, "虚拟资产");
        assert_eq!(cell(virtuals, 1, "名称"), "虚构交通卡");
        assert_eq!(cell(virtuals, 1, "计费方式"), "储值");
        assert_eq!(cell(virtuals, 1, "单次价格（元）"), "");
        assert_eq!(cell(virtuals, 1, "明确永久有效"), "否");
        let topup = sheet(&result, "储值充值");
        assert_eq!(cell(topup, 1, "实付（元）"), "50.00");
        assert_eq!(cell(topup, 1, "赠送（元）"), "10.00");
        assert_eq!(cell(topup, 1, "记录的到账额度（元）"), "60.00");
        assert_eq!(cell(topup, 1, "付款方式说明"), "虚构付款备注");
        assert_eq!(
            cell(sheet(&result, "储值余额记录"), 1, "手动记录余额（元）"),
            "12.00"
        );
        let reminders = sheet(&result, "业务提醒");
        assert_eq!(reminders.len(), 3);
        assert_eq!(cell(reminders, 1, "对象名称"), "虚构订阅");
        assert_eq!(cell(reminders, 1, "提醒类型"), "续费提醒");
        assert_eq!(cell(reminders, 1, "逐期重复"), "是");
        assert_eq!(cell(reminders, 1, "提前天数"), "7");
        assert_eq!(cell(reminders, 2, "关联保障"), "延长保障 · 虚构保障方");
        assert_eq!(cell(reminders, 2, "保存的提醒日期"), "2026-12-25");
        assert_eq!(cell(reminders, 2, "逐期重复"), "否");
        assert_eq!(cell(reminders, 2, "提前天数"), "");
    }

    #[test]
    fn item_preferences_and_lifecycle_history_are_readable() {
        let (_dir, store) = fixture();
        let c = store.conn().unwrap();
        seed_asset(c, "asset", false);
        c.execute(
            "INSERT INTO asset_profiles(asset_id,brand,model,serial_number,notes)
             VALUES('asset','虚构品牌','虚构型号','FICTIONAL-001','虚构备注')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO named_choices(id,kind,name,name_key,position)
             VALUES('label','label','摄影','摄影',0)",
            [],
        )
        .unwrap();
        let preferences = crate::preferences::AssetPreferences {
            label_id: Some("label".into()),
            cost_mode: "per_use".into(),
            use_count: 5,
            goal: crate::preferences::Goal::Cost {
                cents: "123".into(),
            },
            pinned: true,
            exclude: crate::preferences::Exclusions {
                statistics: true,
                ..Default::default()
            },
        };
        c.execute(
            "INSERT INTO asset_preferences VALUES('asset',?1)",
            [serde_json::to_string(&preferences).unwrap()],
        )
        .unwrap();
        for (id, sequence, kind) in [("z-first", 1, "retire"), ("a-second", 2, "activate")] {
            c.execute(
                "INSERT INTO lifecycle_events(id,asset_id,sequence,kind,date,notes,created_at,updated_at)
                 VALUES(?1,'asset',?2,?3,'2026-02-01','状态说明','2026-02-01','2026-02-01')",
                rusqlite::params![id, sequence, kind],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO sales(id,asset_id,previous_state,date,price_cents,platform,buyer,notes,
             created_at,updated_at,revoked_at)
             VALUES('sale','asset','active','2026-03-01',2300,'虚构平台','虚构买方','误记',
                    '2026-03-01','2026-03-01','2026-03-02')",
            [],
        )
        .unwrap();
        let result = sheets(&store).unwrap();
        let items = sheet(&result, "物品");
        assert!(items[0].len() <= 32);
        assert_eq!(
            &items[0][..crate::csv_export::HEADER.len()],
            crate::csv_export::HEADER.as_slice()
        );
        assert_eq!(cell(items, 1, "名称"), "虚构相机");
        assert_eq!(cell(items, 1, "序列号"), "FICTIONAL-001");
        assert_eq!(cell(items, 1, "标签（只读）"), "摄影");
        assert_eq!(cell(items, 1, "成本方式（只读）"), "按次");
        assert_eq!(cell(items, 1, "使用次数（只读）"), "5");
        assert_eq!(cell(items, 1, "目标单位成本（元，只读）"), "1.23");
        assert_eq!(cell(items, 1, "置顶（只读）"), "是");
        assert_eq!(cell(items, 1, "不计入（只读）"), "统计");
        let history = sheet(&result, "物品状态历史");
        assert_eq!(history.len(), 4);
        assert_eq!(cell(history, 1, "动作"), "退役");
        assert_eq!(cell(history, 2, "动作"), "重新启用");
        assert_eq!(cell(history, 3, "动作"), "售出（已撤销）");
        assert_eq!(cell(history, 3, "售价（元）"), "23.00");
        assert_eq!(cell(history, 3, "撤销时间"), "2026-03-02");
    }

    #[test]
    fn wishes_are_unpaged_keep_pending_verification_and_preserve_literal_notes() {
        let (_dir, store) = fixture();
        let c = store.conn().unwrap();
        for index in 0..125 {
            c.execute(
                "INSERT INTO wishlist_items(id,name,estimated_price_cents,priority,target_date,
                 external_link,notes,status,decision_state,decision_note,revision,created_at,updated_at)
                 VALUES(?1,'虚构同名心愿',0,'high',NULL,'','=SUM(A1:A2)\n第二行','ongoing',
                        'considering','',1,'2026-01-01','2026-01-01')",
                [format!("wish-{index:03}")],
            )
            .unwrap();
        }
        c.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',
             achieved_at='2026-02-01',legacy_generated_at='2026-02-01' WHERE id='wish-000'",
            [],
        )
        .unwrap();
        c.execute(
            "UPDATE wishlist_items SET deleted_at='2026-10-01' WHERE id='wish-124'",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO amount_origin(kind,record_id,currency,original_minor,fx_rate_micro)
             VALUES('wish','wish-001','KRW',0,1000000)",
            [],
        )
        .unwrap();
        let rows = wishes(c).unwrap();
        assert_eq!(rows.len(), 125);
        assert_eq!(cell(&rows, 1, "决策状态"), "旧实现记录待核实");
        assert_eq!(cell(&rows, 1, "确认购入日期"), "");
        assert_eq!(cell(&rows, 1, "旧实现日期（待核实）"), "2026-02-01");
        assert_eq!(cell(&rows, 2, "原币币种"), "KRW");
        assert_eq!(cell(&rows, 2, "原币金额"), "0");
        assert_eq!(cell(&rows, 2, "预计价格（元）"), "0.00");
        assert_eq!(cell(&rows, 2, "考虑理由与顾虑"), "=SUM(A1:A2)\n第二行");
    }

    #[test]
    fn wish_decisions_and_reminders_preserve_names_and_filter_deleted_wishes() {
        let (_dir, store) = fixture();
        let c = store.conn().unwrap();
        for (id, deleted) in [("kept", false), ("removed", true)] {
            c.execute(
                "INSERT INTO wishlist_items(id,name,estimated_price_cents,external_link,notes,status,
                 decision_state,decision_note,revision,created_at,updated_at,deleted_at)
                 VALUES(?1,'虚构镜头',20000,'https://example.invalid/lens','考虑拍摄需求','ongoing',
                        'considering','先比较重量',1,'2026-01-01','2026-01-01',?2)",
                rusqlite::params![id, deleted.then_some("2026-10-01")],
            )
            .unwrap();
            c.execute(
                "INSERT INTO wishlist_preferences VALUES(?1,?2)",
                rusqlite::params![
                    id,
                    serde_json::to_string(&crate::wish_plan::Preferences {
                        added_date: Some("2026-01-02".into()),
                        mode: Some("savings".into()),
                        saved_cents: "0".into(),
                        ..Default::default()
                    })
                    .unwrap()
                ],
            )
            .unwrap();
            c.execute(
                "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at)
                 VALUES(?1,?1,'reconsider',?2,'2026-02-02T12:00:00Z')",
                rusqlite::params![
                    id,
                    serde_json::json!({
                        "decision_note": "预算已明确，重新考虑",
                        "converted_asset": {"name": "虚构旧镜头"}
                    })
                    .to_string()
                ],
            )
            .unwrap();
            c.execute(
                "INSERT INTO reminders(id,kind,entity_id,date,notes)
                 VALUES(?1,'wishlist',?1,'2026-12-01','之后再决定')",
                [id],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at)
             VALUES('old-conversion','kept','convert',?1,'2026-01-03T12:00:00Z')",
            [serde_json::json!({
                "status": "achieved",
                "converted_asset": {"name": "虚构自动生成档案"},
                "preferences": {"achievement_source": "savings"}
            })
            .to_string()],
        )
        .unwrap();
        let result = sheets(&store).unwrap();
        let wishes = sheet(&result, "心愿清单");
        assert_eq!(wishes.len(), 2);
        assert_eq!(cell(wishes, 1, "名称"), "虚构镜头");
        assert_eq!(cell(wishes, 1, "决策状态"), "考虑中");
        assert_eq!(cell(wishes, 1, "预计价格（元）"), "200.00");
        assert_eq!(cell(wishes, 1, "加入日期"), "2026-01-02");
        assert_eq!(cell(wishes, 1, "旧攒钱记录（元）"), "0.00");
        let decisions = sheet(&result, "心愿决策");
        assert_eq!(decisions.len(), 3);
        assert_eq!(cell(decisions, 1, "心愿名称"), "虚构镜头");
        assert_eq!(cell(decisions, 1, "动作"), "旧实现记录（待核实）");
        assert_eq!(cell(decisions, 2, "动作"), "重新考虑");
        assert_eq!(cell(decisions, 2, "决定备注"), "预算已明确，重新考虑");
        assert_eq!(cell(decisions, 2, "关联物品"), "虚构旧镜头");
        let reminders = sheet(&result, "业务提醒");
        assert_eq!(reminders.len(), 2);
        assert_eq!(cell(reminders, 1, "对象名称"), "虚构镜头");
        assert_eq!(cell(reminders, 1, "提醒类型"), "心愿提醒");
        assert_eq!(cell(reminders, 1, "备注"), "之后再决定");
    }
}
