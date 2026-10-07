//! Linked subscriptions (EXPENSE_OVERVIEW_SUBSCRIPTION_LINKS_DESIGN). A live
//! virtual asset and its linked recurring plan form one unit: shared billing
//! edits keep both revisions in one transaction, and deletes register a group
//! whose restore set covers exactly the recorded members. Derivation and
//! payment facts stay in `recurring.rs` / `virtual_assets.rs`.
use crate::{
    domain::{date, Error, Result},
    recurring::{plan, receipt, save_plan, PlanFields},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// 已付覆盖期：与虚拟资产推导同源（最后覆盖末日，或末期付款日顺延一期）。
fn paid_until_of(c: &Connection, plan_id: &str) -> Result<Option<String>> {
    let (last, covered): (Option<String>, Option<String>) = c.query_row(
        "SELECT max(due_date),max(coverage_end) FROM plan_payments WHERE plan_id=?1 AND state='paid' AND deleted_at IS NULL",
        [plan_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if let Some(covered) = covered {
        return Ok(Some(covered));
    }
    let Some(last) = last else { return Ok(None) };
    let (months, days): (i64, Option<u32>) = c.query_row(
        "SELECT interval_months,interval_days FROM recurring_plans WHERE id=?1",
        [plan_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let end = match days {
        Some(n) => date(&last)?.checked_add_days(chrono::Days::new(u64::from(n))),
        None => crate::recurring::shift_months(date(&last)?, months),
    }
    .and_then(|d| d.pred_opt());
    Ok(end.map(|d| d.to_string()))
}

/// Identity of the virtual side of a link, as shown and re-checked by the
/// shared detail and the recurring page's reminder editor.
#[derive(Debug, Clone, Serialize)]
pub struct AssetRef {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub deleted: bool,
    pub billing: String,
    pub stopped_on: Option<String>,
    pub provider: String,
    pub label_name: Option<String>,
}

/// Identity of the plan side of a link.
#[derive(Debug, Clone, Serialize)]
pub struct PlanRef {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub deleted: bool,
    pub category: String,
    pub end_date: Option<String>,
    pub auto_renew: bool,
    pub paused: bool,
    pub service_start: Option<String>,
}

/// `linked` both live; `asset_trashed`/`plan_trashed` one side in Recently
/// Deleted; `both_trashed` a historically split pair with no open group;
/// `group_deleted` an open trash group covers the pair; `plan_occupied` the
/// trashed asset's plan now belongs to another live asset; `unlinked` no
/// stable link remains.
#[derive(Debug, Clone, Serialize)]
pub struct LinkView {
    pub generation: String,
    pub relation: String,
    pub asset: Option<AssetRef>,
    pub plan: Option<PlanRef>,
    pub paid_count: i64,
    pub skipped_count: i64,
    pub paid_cents: Option<String>,
    /// 已付覆盖期（两页共用同一推导，设计 §4/§5.1）。
    pub paid_until: Option<String>,
    /// 旧停用档案且计划仍进行：需要明确结束或撤回（设计 §6/§8）。
    pub needs_review: bool,
    /// The live asset currently using the plan, when occupied.
    pub occupied_by: Option<OccupiedRef>,
    /// Historical deleted assets that reference the plan by ID (§8).
    pub candidates: Vec<CandidateRef>,
    /// Open trash group covering this pair, when one exists.
    pub group: Option<GroupRef>,
    /// The pair's shared 备款提醒 setting, when the archive has one (§4).
    pub reminder: Option<crate::virtual_assets::ReminderState>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OccupiedRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CandidateRef {
    pub id: String,
    pub name: String,
    pub deleted_at: String,
    /// Current (post-delete) revision, for an explicit restore of this one.
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupRef {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkPreview {
    pub generation: String,
    /// Backend-checked digest of the full impact; submit compares it again.
    pub preview: String,
    pub asset_id: String,
    pub plan_id: String,
    pub asset_name: String,
    pub plan_name: String,
    pub asset_revision: i64,
    pub plan_revision: i64,
    pub paid_count: i64,
    pub skipped_count: i64,
    pub paid_cents: String,
    /// Protection reasons visible now; submit re-verifies them regardless.
    pub blockers: Vec<String>,
    /// The partner that is already in Recently Deleted (§8 historical group).
    pub partner_deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkRestorePreview {
    pub generation: String,
    pub preview: String,
    pub group_id: String,
    pub asset_name: String,
    pub plan_name: String,
    /// Payments hidden only because their plan is hidden come back with it.
    pub payments_hidden: i64,
    /// Payments deleted individually before the group stay deleted (§7.2).
    pub payments_stay_deleted: i64,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkSave {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub asset_expected_revision: i64,
    pub plan_id: String,
    pub plan_expected_revision: i64,
    pub fields: PlanFields,
    /// Explicit 统一名称 choice; both names become this value (design §4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unify_name_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing: Option<BillingExtras>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingExtras {
    pub renewal_price_cents: Option<String>,
    pub renewal_from: Option<String>,
    pub special_end: Option<crate::virtual_assets::SpecialEnd>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkCreateSave {
    pub request_id: String,
    pub generation: String,
    pub plan_id: String,
    pub plan_expected_revision: i64,
    /// Service-side fields of the new archive; `billing` must be `subscription`.
    pub fields: crate::virtual_assets::Fields,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkTrashSave {
    pub request_id: String,
    pub generation: String,
    /// The live side that initiates: `virtual` or `plan`.
    pub side: String,
    pub id: String,
    /// The already-deleted partner to fold into the same group (§8). Required
    /// when this side no longer has a live link; the user names the exact
    /// candidate, never "the most recent one".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partner_id: Option<String>,
    pub asset_expected_revision: i64,
    pub plan_expected_revision: i64,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkRestoreSave {
    pub request_id: String,
    pub generation: String,
    pub group_id: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileSave {
    pub request_id: String,
    pub generation: String,
    /// `confirm_ended` | `withdraw_stop` | `register_group` | `restore_pair`.
    pub action: String,
    pub asset_id: String,
    pub plan_id: String,
    pub asset_expected_revision: i64,
    pub plan_expected_revision: i64,
    /// Explicit last-used day for `confirm_ended`; the old stopped day is only
    /// a suggestion and never written without confirmation (design §6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<String>,
    /// Backend-checked digest for the group-forming actions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkRepairPreview {
    #[serde(flatten)]
    pub pair: LinkPreview,
    pub asset_deleted: bool,
    pub plan_deleted: bool,
    pub payments_stay_deleted: i64,
}

fn resolve_repair_targets(
    c: &Connection,
    side: &str,
    id: &str,
    partner: Option<&str>,
) -> Result<(String, String)> {
    let (asset_id, plan_id) = match side {
        "virtual" => (
            id.to_owned(),
            asset_plan_id(c, id)?
                .ok_or_else(|| Error::new("NOT_LINKED", "没有可核对的付款计划"))?,
        ),
        "plan" => {
            let aid = if let Some(aid) = partner {
                aid.to_owned()
            } else if let Some((aid, _, _)) = live_asset_of_plan(c, id)? {
                aid
            } else {
                let mut q =
                    c.prepare("SELECT id FROM virtual_assets WHERE plan_id=?1 ORDER BY id")?;
                let ids = q
                    .query_map([id], |r| r.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                if ids.len() != 1 {
                    return Err(Error::new(
                        "LINK_CANDIDATE",
                        "请按 ID 明确选择这次要处理的历史档案",
                    ));
                }
                ids[0].clone()
            };
            (aid, id.to_owned())
        }
        _ => return Err(Error::new("LINK_KIND", "不支持的关联对象类型")),
    };
    if asset_plan_id(c, &asset_id)?.as_deref() != Some(plan_id.as_str()) {
        return Err(Error::new(
            "LINK_CHANGED",
            "档案并未按 ID 关联这项计划，请重新读取",
        ));
    }
    Ok((asset_id, plan_id))
}

fn repair_preview(
    c: &Connection,
    generation: &str,
    asset_id: &str,
    plan_id: &str,
    action: &str,
) -> Result<LinkRepairPreview> {
    if !["register_group", "restore_pair"].contains(&action) {
        return Err(Error::new("LINK_ACTION", "不支持的历史关系操作"));
    }
    let asset =
        asset_ref(c, asset_id)?.ok_or_else(|| Error::new("NOT_FOUND", "原服务档案已不存在"))?;
    let plan = plan_ref(c, plan_id)?
        .ok_or_else(|| Error::new("NOT_FOUND", "原付款计划已永久清除，不能恢复关联"))?;
    if asset_plan_id(c, asset_id)?.as_deref() != Some(plan_id) {
        return Err(Error::new("LINK_CHANGED", "关联关系已变化，请重新读取"));
    }
    if !asset.deleted && !plan.deleted {
        return Err(Error::new("LINK_STATE", "双方都有效，无需修复删除关系"));
    }
    if open_group_for(c, asset_id)?.is_some() || open_group_for(c, plan_id)?.is_some() {
        return Err(Error::new(
            "LINK_GROUP_EXISTS",
            "已有删除组，请在最近删除中整组恢复",
        ));
    }
    let mut blockers = protect_blockers(c, asset_id, plan_id)?;
    if let Some((id, name, _)) = live_asset_of_plan(c, plan_id)? {
        if id != asset_id {
            blockers.push(format!("计划已改由「{name}」使用，不能抢占关联"));
        }
    }
    let (paid, skipped, sum) = payment_summary(c, plan_id)?;
    let deleted: i64 = c.query_row(
        "SELECT count(*) FROM plan_payments WHERE plan_id=?1 AND deleted_at IS NOT NULL",
        [plan_id],
        |r| r.get(0),
    )?;
    Ok(LinkRepairPreview {
        pair: LinkPreview {
            generation: generation.into(),
            preview: impact_digest(c, generation, action, asset_id, plan_id)?,
            asset_id: asset_id.into(),
            plan_id: plan_id.into(),
            asset_name: asset.name,
            plan_name: plan.name,
            asset_revision: asset.revision,
            plan_revision: plan.revision,
            paid_count: paid,
            skipped_count: skipped,
            paid_cents: sum.unwrap_or(0).to_string(),
            blockers,
            partner_deleted: asset.deleted || plan.deleted,
        },
        asset_deleted: asset.deleted,
        plan_deleted: plan.deleted,
        payments_stay_deleted: deleted,
    })
}

impl Store {
    pub fn link_repair_preview(
        &self,
        side: &str,
        id: &str,
        partner: Option<&str>,
        action: &str,
    ) -> Result<LinkRepairPreview> {
        let tx = self.conn()?.unchecked_transaction()?;
        let (asset, plan) = resolve_repair_targets(&tx, side, id, partner)?;
        let result = repair_preview(&tx, &self.generation(), &asset, &plan, action)?;
        tx.commit()?;
        Ok(result)
    }
}

fn asset_ref(c: &Connection, id: &str) -> Result<Option<AssetRef>> {
    Ok(c.query_row(
        "SELECT id,name,revision,billing,stopped_on,deleted_at IS NOT NULL,provider,(SELECT name FROM named_choices WHERE id=label_id) FROM virtual_assets WHERE id=?1",
        [id],
        |r| {
            Ok(AssetRef {
                id: r.get(0)?,
                name: r.get(1)?,
                revision: r.get(2)?,
                billing: r.get(3)?,
                stopped_on: r.get(4)?,
                deleted: r.get(5)?,
                provider: r.get(6)?,
                label_name: r.get(7)?,
            })
        },
    )
    .optional()?)
}

fn plan_ref(c: &Connection, id: &str) -> Result<Option<PlanRef>> {
    Ok(c.query_row(
        "SELECT id,name,revision,category,end_date,auto_renew,paused,service_start,deleted_at IS NOT NULL FROM recurring_plans WHERE id=?1",
        [id],
        |r| {
            Ok(PlanRef {
                id: r.get(0)?,
                name: r.get(1)?,
                revision: r.get(2)?,
                category: r.get(3)?,
                end_date: r.get(4)?,
                auto_renew: r.get(5)?,
                paused: r.get(6)?,
                service_start: r.get(7)?,
                deleted: r.get(8)?,
            })
        },
    )
    .optional()?)
}

fn payment_summary(c: &Connection, plan_id: &str) -> Result<(i64, i64, Option<i64>)> {
    c.query_row(
        "SELECT coalesce(sum(state='paid'),0),coalesce(sum(state='skipped'),0),sum(CASE WHEN state='paid' THEN amount_cents END) FROM plan_payments WHERE plan_id=?1 AND deleted_at IS NULL",
        [plan_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .map_err(Into::into)
}

/// The one open trash group covering `member_id`, if any. Every parent stays
/// in at most one open group; that uniqueness is enforced at write time.
pub(crate) fn open_group_for(c: &Connection, member_id: &str) -> Result<Option<(String, String)>> {
    Ok(c.query_row(
        "SELECT g.id,g.status FROM link_trash_groups g JOIN link_trash_members m ON m.group_id=g.id WHERE m.member_id=?1 AND g.status='deleted'",
        [member_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?)
}

/// The live virtual asset currently linked to `plan_id`, if any.
pub(crate) fn live_asset_of_plan(
    c: &Connection,
    plan_id: &str,
) -> Result<Option<(String, String, i64)>> {
    Ok(c.query_row(
        "SELECT id,name,revision FROM virtual_assets WHERE plan_id=?1 AND deleted_at IS NULL",
        [plan_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()?)
}

/// The live plan a live asset links to, if any.
fn live_plan_of(c: &Connection, asset_id: &str) -> Result<Option<String>> {
    Ok(c.query_row(
        "SELECT r.id FROM virtual_assets v JOIN recurring_plans r ON r.id=v.plan_id WHERE v.id=?1 AND v.deleted_at IS NULL AND r.deleted_at IS NULL",
        [asset_id],
        |r| r.get(0),
    )
    .optional()?)
}

fn asset_plan_id(c: &Connection, asset_id: &str) -> Result<Option<String>> {
    Ok(c.query_row(
        "SELECT plan_id FROM virtual_assets WHERE id=?1",
        [asset_id],
        |r| r.get(0),
    )
    .optional()?
    .flatten())
}

/// Deterministic impact digest (design §7.1): generation, action, both sides
/// with revisions and delete marks, every payment of the plan with its
/// revision and delete mark, and the planning reference payload. Submit
/// recomputes the same digest inside the write transaction; anything the
/// preview saw that has since moved — a new payment, a correction, a relation
/// change or a planning dependency — changes it and voids the confirmation.
fn impact_digest(
    c: &Connection,
    generation: &str,
    action: &str,
    asset_id: &str,
    plan_id: &str,
) -> Result<String> {
    let asset: Option<(i64, Option<String>)> = c
        .query_row(
            "SELECT revision,deleted_at FROM virtual_assets WHERE id=?1",
            [asset_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let plan: Option<(i64, Option<String>)> = c
        .query_row(
            "SELECT revision,deleted_at FROM recurring_plans WHERE id=?1",
            [plan_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let mut payments = String::new();
    let mut q = c.prepare(
        "SELECT id,revision,state,deleted_at IS NOT NULL FROM plan_payments WHERE plan_id=?1 ORDER BY id",
    )?;
    let rows = q
        .query_map([plan_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    for (id, revision, state, deleted) in rows {
        payments.push_str(&format!("{id}:{revision}:{state}:{deleted};"));
    }
    // Any planning-profile edit conservatively voids the preview; the real
    // dependency check runs again via protect_reference at submit time.
    let profile: Option<String> = c
        .query_row("SELECT payload FROM plan_profile WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()?
        .flatten();
    let relation = asset_plan_id(c, asset_id)?;
    let mut q = c.prepare(
        "SELECT id,revision,deleted_at FROM virtual_assets WHERE plan_id=?1 ORDER BY id",
    )?;
    let owners = q
        .query_map([plan_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(digest(&serde_json::to_vec(&(
        "link-impact",
        relation,
        owners,
        generation,
        action,
        asset_id,
        asset,
        plan_id,
        plan,
        payments,
        profile.as_deref().map(|p| digest(p.as_bytes())),
    ))?))
}

fn protect_blockers(c: &Connection, asset_id: &str, plan_id: &str) -> Result<Vec<String>> {
    let mut blockers = Vec::new();
    for (kind, id, label) in [
        ("virtual", asset_id, "服务档案"),
        ("plan", plan_id, "付款计划"),
    ] {
        if let Err(e) = crate::plan_core::protect_reference(c, kind, id) {
            blockers.push(format!("{label}：{}", e.message));
        }
    }
    Ok(blockers)
}

fn reminder_of(
    c: &Connection,
    asset_id: &str,
) -> Result<Option<crate::virtual_assets::ReminderState>> {
    Ok(c.query_row(
        "SELECT date,notes,repeat_every_period,lead_days FROM reminders WHERE kind='renewal' AND entity_id=?1",
        [asset_id],
        |r| {
            Ok(Some(crate::virtual_assets::ReminderState {
                date: r.get(0)?,
                notes: r.get(1)?,
                repeat_every_period: r.get(2)?,
                lead_days: r.get(3)?,
            }))
        },
    )
    .optional()?
    .flatten())
}

/// Both member ids of one trash group, as `(asset_id, plan_id)`.
pub(crate) fn group_members_of(c: &Connection, group_id: &str) -> Result<(String, String)> {
    group_members(c, group_id)
}

fn group_members(c: &Connection, group_id: &str) -> Result<(String, String)> {
    let mut asset = None;
    let mut plan = None;
    let mut q =
        c.prepare("SELECT member_kind,member_id FROM link_trash_members WHERE group_id=?1")?;
    let rows = q
        .query_map([group_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (kind, id) in rows {
        match kind.as_str() {
            "virtual" => asset = Some(id),
            "plan" => plan = Some(id),
            _ => {}
        }
    }
    match (asset, plan) {
        (Some(a), Some(p)) => Ok((a, p)),
        _ => Err(Error::new(
            "LINK_GROUP_STALE",
            "删除组成员不完整，请重新读取最近删除",
        )),
    }
}

fn restore_digest(
    c: &Connection,
    generation: &str,
    group_id: &str,
    group_revision: i64,
) -> Result<String> {
    let (asset_id, plan_id) = group_members(c, group_id)?;
    let mut members = String::new();
    let mut q = c.prepare(
        "SELECT member_kind,member_id,revision_after FROM link_trash_members WHERE group_id=?1 ORDER BY member_kind",
    )?;
    let rows = q
        .query_map([group_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (kind, id, rev) in rows {
        members.push_str(&format!("{kind}:{id}:{rev};"));
    }
    Ok(digest(&serde_json::to_vec(&(
        "link-restore",
        generation,
        group_id,
        group_revision,
        members,
        asset_id,
        plan_id,
    ))?))
}

/// Resolve the two rows a group delete hides, including the historically
/// deleted partner case (design §7.2/§8). Booleans mark who is already deleted.
fn resolve_trash_targets(
    c: &Connection,
    side: &str,
    id: &str,
    partner_id: Option<&str>,
) -> Result<(String, String, bool, bool)> {
    match side {
        "virtual" => {
            let asset =
                asset_ref(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))?;
            if asset.deleted {
                return Err(Error::new(
                    "LINK_STATE",
                    "这项虚拟资产已在最近删除中，请从最近删除发起",
                ));
            }
            match live_plan_of(c, id)? {
                Some(pid) => Ok((asset.id, pid, false, false)),
                None => {
                    let pid = asset_plan_id(c, id)?.ok_or_else(|| {
                        Error::new("NOT_LINKED", "这项虚拟资产没有关联的付款计划")
                    })?;
                    if partner_id != Some(pid.as_str()) {
                        return Err(Error::new(
                            "LINK_STATE",
                            "关联的付款计划已在最近删除；请明确选择将它归入同一删除组",
                        ));
                    }
                    Ok((asset.id, pid, false, true))
                }
            }
        }
        "plan" => {
            let plan = plan_ref(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
            if plan.deleted {
                return Err(Error::new(
                    "LINK_STATE",
                    "这项计划已在最近删除中，请从最近删除发起",
                ));
            }
            match live_asset_of_plan(c, id)? {
                Some((aid, _, _)) => Ok((aid, plan.id, false, false)),
                None => {
                    let partner = partner_id.ok_or_else(|| {
                        Error::new(
                            "LINK_STATE",
                            "关联的服务档案已在最近删除；请明确选择要归入同一组的档案",
                        )
                    })?;
                    let partner_asset = asset_ref(c, partner)?
                        .ok_or_else(|| Error::new("NOT_FOUND", "找不到要归组的服务档案"))?;
                    if !partner_asset.deleted
                        || asset_plan_id(c, partner)?.as_deref() != Some(plan.id.as_str())
                    {
                        return Err(Error::new(
                            "LINK_STATE",
                            "要归组的档案必须按 ID 关联这项计划并已在最近删除中",
                        ));
                    }
                    Ok((partner.to_string(), plan.id, true, false))
                }
            }
        }
        _ => Err(Error::new("LINK_KIND", "不支持的关联对象类型")),
    }
}

/// Group restore shared by the restore command and `restore_pair`.
/// Caller owns the group-status and member revision checks.
pub(crate) fn restore_group_in_tx(c: &Connection, group_id: &str) -> Result<()> {
    let (asset_id, plan_id) = group_members(c, group_id)?;
    c.execute(
        "UPDATE virtual_assets SET deleted_at=NULL,revision=revision+1 WHERE id=?1",
        [&asset_id],
    )?;
    c.execute(
        "UPDATE recurring_plans SET deleted_at=NULL,revision=revision+1 WHERE id=?1",
        [&plan_id],
    )?;
    c.execute(
        "UPDATE link_trash_groups SET status='restored',revision=revision+1,updated_at=?2 WHERE id=?1",
        params![group_id, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// Member rows of a group delete: marks who hides now and who was already gone.
struct MemberWrite {
    kind: &'static str,
    id: String,
    already_deleted: bool,
}

impl Store {
    /// One read-only snapshot of the pair around either side (design §9).
    pub fn link_view(&self, kind: &str, id: &str) -> Result<LinkView> {
        let snapshot = self.conn()?.unchecked_transaction()?;
        let c = &snapshot;
        let generation = self.generation();
        if kind == "virtual" {
            let asset =
                asset_ref(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))?;
            let stored_plan_id = asset_plan_id(c, id)?;
            let plan = match stored_plan_id.as_deref() {
                Some(pid) => plan_ref(c, pid)?,
                None => None,
            };
            let live_plan_id = live_plan_of(c, id)?;
            let occupied_by = plan
                .as_ref()
                .filter(|p| !p.deleted && live_plan_id.is_none())
                .and_then(|p| live_asset_of_plan(c, &p.id).ok().flatten())
                .filter(|(aid, _, _)| aid != id)
                .map(|(id, name, _)| OccupiedRef { id, name });
            let (paid, skipped, sum) = match &live_plan_id {
                Some(pid) => payment_summary(c, pid)?,
                None => (0, 0, None),
            };
            let group = if asset.deleted {
                open_group_for(c, &asset.id)?
            } else {
                None
            }
            .map(|(id, status)| GroupRef { id, status });
            let needs_review = asset.stopped_on.is_some()
                && !asset.deleted
                && live_plan_id.is_some()
                && plan.as_ref().is_some_and(|p| p.end_date.is_none());
            let relation = if asset.deleted {
                if group.is_some() {
                    "group_deleted"
                } else if occupied_by.is_some() {
                    "plan_occupied"
                } else if plan.as_ref().is_some_and(|p| p.deleted) {
                    "both_trashed"
                } else if plan.is_some() {
                    "asset_trashed"
                } else {
                    "unlinked"
                }
            } else if live_plan_id.is_some() {
                "linked"
            } else if plan.as_ref().is_some_and(|p| p.deleted) {
                "plan_trashed"
            } else {
                "unlinked"
            };
            let reminder = reminder_of(c, &asset.id)?;
            Ok(LinkView {
                generation,
                relation: relation.into(),
                asset: Some(asset),
                plan,
                paid_count: paid,
                skipped_count: skipped,
                paid_cents: sum.map(|v| v.to_string()),
                paid_until: match &live_plan_id {
                    Some(pid) => paid_until_of(c, pid)?,
                    None => None,
                },
                needs_review,
                occupied_by,
                candidates: Vec::new(),
                group,
                reminder,
            })
        } else if kind == "plan" {
            let plan = plan_ref(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
            let (paid, skipped, sum) = payment_summary(c, &plan.id)?;
            let live = live_asset_of_plan(c, &plan.id)?;
            let mut candidates: Vec<CandidateRef> = Vec::new();
            if live.is_none() {
                let mut q = c.prepare(
                    "SELECT id,name,deleted_at,revision FROM virtual_assets WHERE plan_id=?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id",
                )?;
                candidates = q
                    .query_map([&plan.id], |r| {
                        Ok(CandidateRef {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            deleted_at: r.get(2)?,
                            revision: r.get(3)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
            }
            let group = match &live {
                Some((aid, _, _)) => open_group_for(c, aid)?,
                None => open_group_for(c, &plan.id)?,
            }
            .map(|(id, status)| GroupRef { id, status });
            let needs_review = live
                .as_ref()
                .and_then(|(aid, _, _)| asset_ref(c, aid).ok().flatten())
                .is_some_and(|a| a.stopped_on.is_some() && plan.end_date.is_none());
            let relation = if live.is_some() {
                if plan.deleted {
                    "plan_trashed"
                } else {
                    "linked"
                }
            } else if group.is_some() {
                "group_deleted"
            } else if candidates.is_empty() {
                "unlinked"
            } else {
                if plan.deleted {
                    "both_trashed"
                } else {
                    "asset_trashed"
                }
            };
            let asset = match &live {
                Some((aid, _, _)) => asset_ref(c, aid)?,
                None => None,
            };
            let reminder = match &asset {
                Some(a) => reminder_of(c, &a.id)?,
                None => None,
            };
            let paid_until = paid_until_of(c, &plan.id)?;
            Ok(LinkView {
                generation,
                relation: relation.into(),
                asset,
                plan: Some(plan),
                paid_count: paid,
                skipped_count: skipped,
                paid_cents: sum.map(|v| v.to_string()),
                paid_until,
                needs_review,
                occupied_by: None,
                candidates,
                group,
                reminder,
            })
        } else {
            Err(Error::new("LINK_KIND", "不支持的关联对象类型"))
        }
    }

    /// Read-only delete impact for one linked pair (design §7.1). Works for a
    /// live pair and for the historical case where the partner is already in
    /// Recently Deleted.
    pub fn link_delete_preview(
        &self,
        side: &str,
        id: &str,
        partner_id: Option<&str>,
    ) -> Result<LinkPreview> {
        let c = self.conn()?;
        let generation = self.generation();
        let (asset_id, plan_id, asset_deleted, plan_deleted) =
            resolve_trash_targets(c, side, id, partner_id)?;
        let asset = asset_ref(c, &asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))?;
        let plan =
            plan_ref(c, &plan_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        let (paid, skipped, sum) = payment_summary(c, &plan_id)?;
        Ok(LinkPreview {
            preview: impact_digest(c, &generation, "delete", &asset_id, &plan_id)?,
            generation,
            asset_id: asset.id.clone(),
            plan_id: plan.id.clone(),
            asset_name: asset.name.clone(),
            plan_name: plan.name.clone(),
            asset_revision: asset.revision,
            plan_revision: plan.revision,
            paid_count: paid,
            skipped_count: skipped,
            paid_cents: sum.unwrap_or(0).to_string(),
            blockers: protect_blockers(c, &asset_id, &plan_id)?,
            partner_deleted: asset_deleted || plan_deleted,
        })
    }

    /// Read-only restore impact of one open group (design §7.2).
    pub fn link_restore_preview(&self, group_id: &str) -> Result<LinkRestorePreview> {
        let c = self.conn()?;
        let generation = self.generation();
        let (status, revision): (String, i64) = c
            .query_row(
                "SELECT status,revision FROM link_trash_groups WHERE id=?1",
                [group_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条删除组"))?;
        if status != "deleted" {
            return Err(Error::new(
                "LINK_GROUP_STALE",
                "这组记录已恢复或已清除，请重新读取最近删除",
            ));
        }
        let (asset_id, plan_id) = group_members(c, group_id)?;
        let asset = asset_ref(c, &asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这组的服务档案"))?;
        let plan = plan_ref(c, &plan_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这组的付款计划"))?;
        let (hidden, stay_deleted): (i64, i64) = c.query_row(
            "SELECT coalesce(sum(deleted_at IS NULL),0),coalesce(sum(deleted_at IS NOT NULL),0) FROM plan_payments WHERE plan_id=?1",
            [&plan.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut blockers = protect_blockers(c, &asset.id, &plan.id)?;
        if let Some((_, name, _)) = live_asset_of_plan(c, &plan.id)? {
            blockers.push(format!("这项计划已改由「{name}」使用"));
        }
        Ok(LinkRestorePreview {
            generation: generation.clone(),
            preview: restore_digest(c, &generation, group_id, revision)?,
            group_id: group_id.to_string(),
            asset_name: asset.name,
            plan_name: plan.name,
            payments_hidden: hidden,
            payments_stay_deleted: stay_deleted,
            blockers,
        })
    }

    /// Whole-group soft delete of one linked pair (design §7.2). Both live
    /// sides hide in one transaction; a historically deleted partner may be
    /// folded in explicitly so the pair shares one future restore.
    pub fn link_trash(&mut self, input: &LinkTrashSave) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("link_trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(result);
        }
        let (asset_id, plan_id, asset_already, plan_already) =
            resolve_trash_targets(&tx, &input.side, &input.id, input.partner_id.as_deref())?;
        // Both revisions must match what the preview showed.
        {
            let asset = asset_ref(&tx, &asset_id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))?;
            let plan = plan_ref(&tx, &plan_id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
            if asset.revision != input.asset_expected_revision {
                return Err(Error::new(
                    "REVISION_CONFLICT",
                    "虚拟资产已变化，请重新读取",
                ));
            }
            if plan.revision != input.plan_expected_revision {
                return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
            }
            if !asset_already
                && (open_group_for(&tx, &asset.id)?.is_some()
                    || open_group_for(&tx, &plan.id)?.is_some())
            {
                return Err(Error::new(
                    "LINK_GROUP_EXISTS",
                    "这组订阅已有删除组，请重新读取最近删除",
                ));
            }
        }
        let actual = impact_digest(&tx, &input.generation, "delete", &asset_id, &plan_id)?;
        if actual != input.preview {
            return Err(Error::new(
                "PREVIEW_STALE",
                "删除影响已变化，请重新读取预览后再确认",
            ));
        }
        crate::plan_core::protect_reference(&tx, "virtual", &asset_id)?;
        crate::plan_core::protect_reference(&tx, "plan", &plan_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let group_id = uid();
        tx.execute(
            "INSERT INTO link_trash_groups(id,status,source_request_id,created_at,updated_at,revision) VALUES(?1,'deleted',?2,?3,?3,1)",
            params![group_id, input.request_id, now],
        )?;
        let members = [
            MemberWrite {
                kind: "virtual",
                id: asset_id,
                already_deleted: asset_already,
            },
            MemberWrite {
                kind: "plan",
                id: plan_id,
                already_deleted: plan_already,
            },
        ];
        for m in members {
            let table = match m.kind {
                "virtual" => "virtual_assets",
                _ => "recurring_plans",
            };
            let rev: i64 = tx.query_row(
                &format!("SELECT revision FROM {table} WHERE id=?1"),
                [&m.id],
                |r| r.get(0),
            )?;
            if !m.already_deleted {
                tx.execute(
                    &format!("UPDATE {table} SET deleted_at=?2,revision=revision+1 WHERE id=?1"),
                    params![m.id, now],
                )?;
            }
            tx.execute(
                "INSERT INTO link_trash_members(group_id,member_kind,member_id,revision_before,revision_after,restore_member) VALUES(?1,?2,?3,?4,?5,1)",
                params![group_id, m.kind, m.id, rev, if m.already_deleted { rev } else { rev + 1 }],
            )?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, group_id],
        )?;
        self.hit("link_trash.before_commit")?;
        tx.commit()?;
        self.hit("link_trash.after_commit")?;
        Ok(group_id)
    }

    /// Whole-group restore: one transaction revives exactly the recorded
    /// restore set; payments deleted before the group stay deleted (§7.2).
    pub fn link_restore(&mut self, input: &LinkRestoreSave) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("link_restore", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(result);
        }
        let (status, revision): (String, i64) = tx
            .query_row(
                "SELECT status,revision FROM link_trash_groups WHERE id=?1",
                [&input.group_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条删除组"))?;
        if status != "deleted" {
            return Err(Error::new(
                "LINK_GROUP_STALE",
                "这组记录已恢复或已清除，请重新读取最近删除",
            ));
        }
        // Every member must still sit at its recorded post-delete revision;
        // a purged member fails the whole restore, never one side first.
        let members: Vec<(String, String, i64)> = {
            let mut q = tx.prepare(
                "SELECT member_kind,member_id,revision_after FROM link_trash_members WHERE group_id=?1 ORDER BY member_kind",
            )?;
            let rows = q
                .query_map([&input.group_id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        for (kind, id, after) in &members {
            let row: Option<(bool, i64)> = match kind.as_str() {
                "virtual" => tx
                    .query_row(
                        "SELECT deleted_at IS NOT NULL,revision FROM virtual_assets WHERE id=?1",
                        [id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?,
                _ => tx
                    .query_row(
                        "SELECT deleted_at IS NOT NULL,revision FROM recurring_plans WHERE id=?1",
                        [id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?,
            };
            match row {
                None => {
                    return Err(Error::new(
                        "LINK_GROUP_STALE",
                        "组内对象已被永久删除，不能恢复",
                    ))
                }
                Some((deleted, rev)) => {
                    if !deleted {
                        return Err(Error::new("LINK_GROUP_STALE", "组内对象已不在最近删除中"));
                    }
                    if rev != *after {
                        return Err(Error::new(
                            "REVISION_CONFLICT",
                            "组内对象已变化，请重新读取最近删除",
                        ));
                    }
                }
            }
        }
        let actual = restore_digest(&tx, &input.generation, &input.group_id, revision)?;
        if actual != input.preview {
            return Err(Error::new(
                "PREVIEW_STALE",
                "这组记录的状态已变化，请重新读取预览后再确认",
            ));
        }
        let (asset_id, plan_id) = group_members(&tx, &input.group_id)?;
        crate::plan_core::protect_reference(&tx, "virtual", &asset_id)?;
        crate::plan_core::protect_reference(&tx, "plan", &plan_id)?;
        if let Some((_, name, _)) = live_asset_of_plan(&tx, &plan_id)? {
            return Err(Error::new(
                "VIRTUAL_PLAN_TAKEN",
                &format!("这项计划已改由「{name}」使用，不能恢复；请先解除那边的关联"),
            ));
        }
        restore_group_in_tx(&tx, &input.group_id)?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.group_id],
        )?;
        self.hit("link_restore.before_commit")?;
        tx.commit()?;
        self.hit("link_restore.after_commit")?;
        Ok(input.group_id.clone())
    }

    /// Shared billing save of one linked pair: both expected revisions in one
    /// transaction, one receipt; the other page's stale form fails (§5.2/§9).
    pub fn link_save(&mut self, input: &LinkSave, today: &str) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("link_save", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(result);
        }
        let asset = asset_ref(&tx, &input.asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))?;
        if asset.deleted {
            return Err(Error::new("NOT_FOUND", "这项虚拟资产已在最近删除中"));
        }
        if asset.revision != input.asset_expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "虚拟资产已变化，请重新读取",
            ));
        }
        let old_plan =
            plan(&tx, &input.plan_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        if old_plan.revision != input.plan_expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
        }
        // The relation must be exactly this pair, still unoccupied (§4).
        match live_asset_of_plan(&tx, &input.plan_id)? {
            Some((aid, _, _)) if aid == input.asset_id => {}
            Some((_, name, _)) => {
                return Err(Error::new(
                    "VIRTUAL_PLAN_TAKEN",
                    &format!("这项计划已改由「{name}」使用"),
                ))
            }
            None => return Err(Error::new("LINK_CHANGED", "关联关系已变化，请重新读取")),
        }
        if live_plan_of(&tx, &input.asset_id)?.as_deref() != Some(input.plan_id.as_str()) {
            return Err(Error::new("LINK_CHANGED", "关联关系已变化，请重新读取"));
        }
        // 计划分类保持：关联订阅不能借共享编辑改成另一类（设计 §4）。
        if input.fields.category != old_plan.fields.category {
            return Err(Error::new(
                "LINK_CATEGORY",
                "关联订阅的分类保持原类，不能在共享编辑中更改",
            ));
        }
        // 共享显示名称：原本统一时一起改；旧名称不同时只改计划侧，
        // 统一必须来自明确的「统一名称」操作，且同一事务更新双方（设计 §4）。
        let unified = old_plan.fields.name == asset.name;
        let mut fields = input.fields.clone();
        let asset_name = if let Some(name) = input.unify_name_to.as_deref() {
            let name = name.trim();
            if name.is_empty() || name.chars().count() > 80 {
                return Err(Error::new("LINK_NAME", "统一名称须为 1–80 字"));
            }
            fields.name = name.to_string();
            Some(name.to_string())
        } else if unified && input.fields.name.trim() != asset.name {
            Some(input.fields.name.trim().to_string())
        } else {
            None
        };
        save_plan(
            &tx,
            &input.plan_id,
            Some(old_plan.revision),
            &fields,
            true,
            today,
        )?;
        if let Some(extras) = &input.billing {
            crate::virtual_assets::apply_billing_extras(
                &tx,
                &input.plan_id,
                &fields,
                extras.renewal_price_cents.as_deref(),
                extras.renewal_from.as_deref(),
                extras.special_end.as_ref(),
                today,
            )?;
        }
        // 双方修订：计费编辑更新计划与档案修订，另一页旧表单冲突（§9）。
        tx.execute(
            "UPDATE virtual_assets SET revision=revision+1,name=coalesce(?2,name),updated_at=?3 WHERE id=?1",
            params![input.asset_id, asset_name, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.plan_id],
        )?;
        self.hit("link_save.before_commit")?;
        tx.commit()?;
        self.hit("link_save.after_commit")?;
        Ok(input.plan_id.clone())
    }

    /// Creates a service archive for an existing subscription plan (§4.1):
    /// one transaction, plan revision and occupancy re-checked, no payments
    /// copied or created.
    pub fn link_create(&mut self, input: &LinkCreateSave, today: &str) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("link_create", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(result);
        }
        let plan =
            plan(&tx, &input.plan_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        if plan.revision != input.plan_expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
        }
        if let Some((_, name, _)) = live_asset_of_plan(&tx, &input.plan_id)? {
            return Err(Error::new(
                "VIRTUAL_PLAN_TAKEN",
                &format!("这项计划已关联「{name}」"),
            ));
        }
        let mut fields = input.fields.clone();
        fields.billing = "subscription".into();
        fields.plan_id = Some(input.plan_id.clone());
        fields.price_cents = None;
        fields.expires = None;
        fields.stopped_on = None;
        crate::virtual_assets::validate_fields(&tx, &fields, today)?;
        let id = uid();
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO virtual_assets(id,name,kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at) VALUES(?1,?2,?3,'subscription',?4,?5,?6,?7,NULL,NULL,?8,?9,?10,NULL,0,1,?11,?11)",
            params![
                id,
                fields.name.trim(),
                fields.kind,
                fields.label_id,
                fields.pay_method.as_deref().unwrap_or(""),
                fields.provider.trim(),
                fields.purchase_date,
                input.plan_id,
                fields.url.trim(),
                fields.notes,
                now
            ],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        self.hit("link_create.before_commit")?;
        tx.commit()?;
        self.hit("link_create.after_commit")?;
        Ok(id)
    }

    /// Explicit reconciliation of a historical relation (design §6/§8).
    pub fn link_reconcile(&mut self, input: &ReconcileSave, today: &str) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("link_reconcile", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(result);
        }
        let asset = asset_ref(&tx, &input.asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))?;
        let plan = plan_ref(&tx, &input.plan_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        if asset.revision != input.asset_expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "虚拟资产已变化，请重新读取",
            ));
        }
        if plan.revision != input.plan_expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
        }
        if asset_plan_id(&tx, &asset.id)?.as_deref() != Some(plan.id.as_str()) {
            return Err(Error::new("LINK_CHANGED", "关联关系已变化，请重新读取"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        match input.action.as_str() {
            // 明确结束：计划最终结束日 + 关闭续费 + 清除旧 stopped_on，一个事务（§6）。
            "confirm_ended" => {
                if asset.deleted || plan.deleted {
                    return Err(Error::new("LINK_STATE", "确认已结束需要双方都在使用中"));
                }
                if asset.stopped_on.is_none() {
                    return Err(Error::new("LINK_STATE", "这项档案没有旧停用标记，无需核对"));
                }
                let last_used = date(
                    input
                        .last_used
                        .as_deref()
                        .ok_or_else(|| Error::new("LINK_STATE", "请确认最后使用日"))?,
                )?;
                if last_used.to_string().as_str() > today {
                    return Err(Error::new("LINK_STATE", "最后使用日不能晚于今天"));
                }
                let mut fields = crate::recurring::plan(&tx, &plan.id)
                    .ok()
                    .flatten()
                    .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?
                    .fields;
                fields.end_date = Some(last_used.to_string());
                fields.auto_renew = false;
                save_plan(&tx, &plan.id, Some(plan.revision), &fields, true, today)?;
                tx.execute(
                    "UPDATE virtual_assets SET stopped_on=NULL,revision=revision+1,updated_at=?2 WHERE id=?1",
                    params![asset.id, now],
                )?;
            }
            // 撤回误记停用：只清除旧标记；计划期限、暂停与续费值保持（§6）。
            "withdraw_stop" => {
                if asset.deleted || plan.deleted {
                    return Err(Error::new("LINK_STATE", "撤回停用需要双方都在使用中"));
                }
                if asset.stopped_on.is_none() {
                    return Err(Error::new("LINK_STATE", "这项档案没有旧停用标记，无需核对"));
                }
                tx.execute(
                    "UPDATE virtual_assets SET stopped_on=NULL,revision=revision+1,updated_at=?2 WHERE id=?1",
                    params![asset.id, now],
                )?;
            }
            "register_group" | "restore_pair" => {
                let preview =
                    repair_preview(&tx, &input.generation, &asset.id, &plan.id, &input.action)?;
                if input.preview.as_deref() != Some(preview.pair.preview.as_str()) {
                    return Err(Error::new(
                        "PREVIEW_STALE",
                        "关系修复影响已变化，请重新读取预览后再确认",
                    ));
                }
                if !preview.pair.blockers.is_empty() {
                    return Err(Error::new(
                        "LINK_BLOCKED",
                        &preview.pair.blockers.join("；"),
                    ));
                }
                let group_id = uid();
                tx.execute("INSERT INTO link_trash_groups(id,status,source_request_id,created_at,updated_at,revision) VALUES(?1,'deleted',?2,?3,?3,1)", params![group_id, input.request_id, now])?;
                for (kind, id, rev, deleted, table) in [
                    (
                        "virtual",
                        &asset.id,
                        asset.revision,
                        asset.deleted,
                        "virtual_assets",
                    ),
                    (
                        "plan",
                        &plan.id,
                        plan.revision,
                        plan.deleted,
                        "recurring_plans",
                    ),
                ] {
                    let after = if input.action == "register_group" && !deleted {
                        tx.execute(
                            &format!(
                                "UPDATE {table} SET deleted_at=?2,revision=revision+1 WHERE id=?1"
                            ),
                            params![id, now],
                        )?;
                        rev + 1
                    } else {
                        rev
                    };
                    tx.execute("INSERT INTO link_trash_members(group_id,member_kind,member_id,revision_before,revision_after,restore_member) VALUES(?1,?2,?3,?4,?5,1)", params![group_id, kind, id, rev, after])?;
                }
                if input.action == "restore_pair" {
                    restore_group_in_tx(&tx, &group_id)?;
                }
                tx.execute(
                    "INSERT INTO feature_requests VALUES(?1,?2,?3)",
                    params![input.request_id, fingerprint, group_id],
                )?;
                self.hit("link_reconcile.before_commit")?;
                tx.commit()?;
                self.hit("link_reconcile.after_commit")?;
                return Ok(group_id);
            }
            _ => return Err(Error::new("LINK_ACTION", "不支持的核对动作")),
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.asset_id],
        )?;
        self.hit("link_reconcile.before_commit")?;
        tx.commit()?;
        self.hit("link_reconcile.after_commit")?;
        Ok(input.action.clone())
    }
}

/// Backup validation for schema 33 and unpublished schema 32 data beyond what SQL CHECKs cover: group
/// shape, member sides, delete-state consistency and the one-open-group rule.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法关联删除组资料");
    // 后续清除留下的成员终态：restored 历史组的成员缺失时以此证明合法性。
    let purged_members: std::collections::BTreeSet<(String, String)> = {
        let mut q = c.prepare(
            "SELECT m.member_kind,m.member_id FROM link_trash_members m JOIN link_trash_groups g ON g.id=m.group_id WHERE g.status='purged'",
        )?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
    };
    let mut q = c.prepare(
        "SELECT id,status,source_request_id,created_at,updated_at,revision FROM link_trash_groups",
    )?;
    let groups = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (id, status, request, created, updated, revision) in groups {
        if uuid::Uuid::parse_str(&id).is_err()
            || revision < 1
            || request.trim().is_empty()
            || chrono::DateTime::parse_from_rfc3339(&created).is_err()
            || chrono::DateTime::parse_from_rfc3339(&updated).is_err()
            || !["deleted", "restored", "purged"].contains(&status.as_str())
        {
            return Err(bad());
        }
        let mut mq = c.prepare(
            "SELECT member_kind,member_id,revision_before,revision_after,restore_member FROM link_trash_members WHERE group_id=?1",
        )?;
        let members = mq
            .query_map([&id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if members.len() != 2
            || !members.iter().any(|m| m.0 == "virtual")
            || !members.iter().any(|m| m.0 == "plan")
            || members.iter().any(|m| m.2 < 1 || m.3 < m.2 || m.4 != 1)
        {
            return Err(bad());
        }
        for (kind, member, _before, after, _restore) in members {
            let table = match kind.as_str() {
                "virtual" => "virtual_assets",
                _ => "recurring_plans",
            };
            let row: Option<(bool, i64)> = c
                .query_row(
                    &format!("SELECT deleted_at IS NOT NULL,revision FROM {table} WHERE id=?1"),
                    [&member],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            match (status.as_str(), row) {
                ("deleted", Some((true, rev))) if rev == after => {}
                ("restored", Some((_, rev))) if rev >= after => {}
                // restored 组只留归属记录：成员可能已被后续组清除。缺失的
                // 成员必须能追溯到某个 purged 组（R1 的终态兼容约束）；
                // 凭空消失或仍在库里的删除态成员都不合法。
                ("restored", None) => {
                    if !purged_members.contains(&(kind.clone(), member.clone())) {
                        return Err(bad());
                    }
                }
                ("purged", None) => {}
                _ => return Err(bad()),
            }
        }
    }
    let dup: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM (SELECT m.member_id FROM link_trash_members m JOIN link_trash_groups g ON g.id=m.group_id WHERE g.status='deleted' GROUP BY m.member_id HAVING count(*)>1))",
        [],
        |r| r.get(0),
    )?;
    if dup {
        return Err(bad());
    }
    Ok(())
}

/// 写事务内复核清除摘要的入口（R7）。
pub(crate) fn purge_digest_for(c: &Connection, generation: &str, group_id: &str) -> Result<String> {
    purge_digest(c, generation, group_id)
}

/// 永久清除整组的影响预览（设计 §7.3/R7）：覆盖计划下**全部**付款（含已单删）、
/// 价格段、生效规则、特殊到期、提醒、组外引用与保护原因；摘要随后在写事务复核。
#[derive(Debug, Clone, Serialize)]
pub struct LinkPurgePreview {
    pub generation: String,
    pub preview: String,
    pub group_id: String,
    pub asset_name: String,
    pub plan_name: String,
    /// 计划下全部付款行数（有效 + 此前单删）。
    pub payments_total: i64,
    pub payments_live: i64,
    pub payments_deleted: i64,
    /// 计划侧规则 / 价格段 / 特殊到期 / 提醒将一并移除的数量。
    pub rate_segments: i64,
    pub rule_segments: i64,
    pub period_ends: i64,
    pub reminders: i64,
    /// 组外按 ID 引用同一计划的档案（阻断并说明）。
    pub external_refs: Vec<String>,
    pub blockers: Vec<String>,
}

/// 清除影响的确定性摘要：组状态、双方行、全部付款行、计划侧全部事实表、
/// 组外引用与规划引用负载。任何后续变化都会改变摘要并使确认失效。
fn purge_digest(c: &Connection, generation: &str, group_id: &str) -> Result<String> {
    let (status, revision): (String, i64) = c
        .query_row(
            "SELECT status,revision FROM link_trash_groups WHERE id=?1",
            [group_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条删除组"))?;
    let (asset_id, plan_id) = group_members(c, group_id)?;
    let mut facts = String::new();
    for (table, id) in [("virtual_assets", &asset_id), ("recurring_plans", &plan_id)] {
        let row: Option<(i64, Option<String>)> = c
            .query_row(
                &format!("SELECT revision,deleted_at FROM {table} WHERE id=?1"),
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        facts.push_str(&format!("{table}:{id}:{row:?};"));
    }
    let mut q = c.prepare(
        "SELECT id,revision,state,deleted_at IS NOT NULL FROM plan_payments WHERE plan_id=?1 ORDER BY id",
    )?;
    let payments = q
        .query_map([&plan_id], |r| {
            Ok(format!(
                "{}:{}:{}:{}",
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    let rates = crate::purge::sql_facts(
        c,
        "SELECT * FROM plan_rates WHERE plan_id=?1 ORDER BY rowid",
        &[&plan_id],
    )?;
    let rules = crate::purge::sql_facts(
        c,
        "SELECT * FROM plan_rules WHERE plan_id=?1 ORDER BY rowid",
        &[&plan_id],
    )?;
    let ends = crate::purge::sql_facts(
        c,
        "SELECT * FROM plan_period_ends WHERE plan_id=?1 ORDER BY rowid",
        &[&plan_id],
    )?;
    let reminders = crate::purge::sql_facts(
        c,
        "SELECT * FROM reminders WHERE kind='renewal' AND entity_id=?1 ORDER BY rowid",
        &[&asset_id],
    )?;
    let members = crate::purge::sql_facts(
        c,
        "SELECT * FROM link_trash_members WHERE group_id=?1 ORDER BY rowid",
        &[&group_id],
    )?;
    let mut ext = String::new();
    let mut q = c.prepare(
        "SELECT id FROM virtual_assets WHERE plan_id=?1 AND id NOT IN (SELECT member_id FROM link_trash_members WHERE group_id=?2 AND member_kind='virtual') ORDER BY id",
    )?;
    let external = q
        .query_map(params![plan_id, group_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    for e in &external {
        ext.push_str(e);
        ext.push(',');
    }
    let profile: Option<String> = c
        .query_row("SELECT payload FROM plan_profile WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()?
        .flatten();
    Ok(digest(&serde_json::to_vec(&(
        "link-purge",
        members,
        generation,
        group_id,
        status,
        revision,
        facts,
        payments,
        rates,
        rules,
        ends,
        reminders,
        ext,
        profile.as_deref().map(|p| digest(p.as_bytes())),
    ))?))
}

pub(crate) fn purge_preview(
    c: &Connection,
    generation: &str,
    group_id: &str,
) -> Result<LinkPurgePreview> {
    let (status, _): (String, i64) = c
        .query_row(
            "SELECT status,revision FROM link_trash_groups WHERE id=?1",
            [group_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条删除组"))?;
    if status != "deleted" {
        return Err(Error::new(
            "LINK_GROUP_STALE",
            "这组记录已恢复或已清除，请重新读取最近删除",
        ));
    }
    let (asset_id, plan_id) = group_members(c, group_id)?;
    let asset_name: String = c
        .query_row(
            "SELECT name FROM virtual_assets WHERE id=?1",
            [&asset_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "（已清除的服务档案）".into());
    let plan_name: String = c
        .query_row(
            "SELECT name FROM recurring_plans WHERE id=?1",
            [&plan_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "（已清除的付款计划）".into());
    let (total, live, deleted): (i64, i64, i64) = c.query_row(
            "SELECT count(*),coalesce(sum(deleted_at IS NULL),0),coalesce(sum(deleted_at IS NOT NULL),0) FROM plan_payments WHERE plan_id=?1",
            [&plan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
    let count = |sql: &str| -> Result<i64> { Ok(c.query_row(sql, [&plan_id], |r| r.get(0))?) };
    let reminders: i64 = c.query_row(
        "SELECT count(*) FROM reminders WHERE kind='renewal' AND entity_id=?1",
        [&asset_id],
        |r| r.get(0),
    )?;
    let mut q = c.prepare(
            "SELECT id FROM virtual_assets WHERE plan_id=?1 AND id NOT IN (SELECT member_id FROM link_trash_members WHERE group_id=?2 AND member_kind='virtual') ORDER BY id",
        )?;
    let external = q
        .query_map(params![plan_id, group_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    let mut blockers = Vec::new();
    for (kind, id, label) in [
        ("virtual", &asset_id, "服务档案"),
        ("plan", &plan_id, "付款计划"),
    ] {
        if let Err(e) = crate::plan_core::protect_reference(c, kind, id) {
            blockers.push(format!("{label}：{}", e.message));
        }
    }
    if !external.is_empty() {
        blockers.push("还有其他档案按 ID 引用这项计划；请先处理那些旧档案，再永久清除这组".into());
    }
    Ok(LinkPurgePreview {
        generation: generation.to_string(),
        preview: purge_digest(c, generation, group_id)?,
        group_id: group_id.to_string(),
        asset_name,
        plan_name,
        payments_total: total,
        payments_live: live,
        payments_deleted: deleted,
        rate_segments: count("SELECT count(*) FROM plan_rates WHERE plan_id=?1")?,
        rule_segments: count("SELECT count(*) FROM plan_rules WHERE plan_id=?1")?,
        period_ends: count("SELECT count(*) FROM plan_period_ends WHERE plan_id=?1")?,
        reminders,
        external_refs: external,
        blockers,
    })
}
impl Store {
    /// One read-only snapshot, including every dependent fact and protection.
    pub fn link_purge_preview(&self, group_id: &str) -> Result<LinkPurgePreview> {
        let snapshot = self.conn()?.unchecked_transaction()?;
        purge_preview(&snapshot, &self.generation(), group_id)
    }
}
