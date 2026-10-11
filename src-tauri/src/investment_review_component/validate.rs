//! Payload validation for [`super::ReviewInput`]. Every rule here mirrors the
//! contract: the UI may pre-check for UX, but these checks are never skipped
//! by the domain side. Issues use stable ids in `path`, not member indexes.

use super::{
    Endpoint, FieldIssue, Flow, ReviewInput, MAX_CENTS, MAX_FLOW_NOTE_CHARS, MAX_ID_CHARS,
    MAX_SCOPE_MEMBERS, SUPPORTED_KINDS,
};

pub(super) fn validate_input(input: &ReviewInput, issues: &mut Vec<FieldIssue>) {
    if input.contract_version != super::CONTRACT_VERSION {
        issues.push(FieldIssue::new(
            "contract_version",
            "unsupported_contract_version",
            format!(
                "不支持的协议版本 {}，本组件只接受 1",
                input.contract_version
            ),
        ));
    }
    validate_endpoint(&input.from, "from", issues);
    validate_endpoint(&input.to, "to", issues);
    if date_ok(&input.from.date) && date_ok(&input.to.date) && input.from.date >= input.to.date {
        issues.push(FieldIssue::new(
            "to.date",
            "invalid_interval",
            format!(
                "期末日期 {} 必须晚于期初日期 {}；区间为 (期初, 期末]",
                input.to.date, input.from.date
            ),
        ));
    }
    if let Some(flow) = &input.flow {
        validate_flow(flow, issues);
    }
    for id in &input.overlapping_active_flow_ids {
        validate_id(id, "overlapping_active_flow_ids", issues);
    }
}

fn validate_id(value: &str, path: &str, issues: &mut Vec<FieldIssue>) {
    if value.is_empty() || value.chars().count() > MAX_ID_CHARS {
        issues.push(FieldIssue::new(
            path,
            "invalid_id",
            "ID 必须是非空且不超过 100 字符的稳定字符串",
        ));
    }
}

fn validate_endpoint(endpoint: &Endpoint, label: &str, issues: &mut Vec<FieldIssue>) {
    validate_id(
        &endpoint.snapshot_id,
        &format!("{label}.snapshot_id"),
        issues,
    );
    if endpoint.revision < 0 {
        issues.push(FieldIssue::new(
            &format!("{label}.revision"),
            "invalid_revision",
            "修订号不能为负",
        ));
    }
    if !date_ok(&endpoint.date) {
        issues.push(FieldIssue::new(
            &format!("{label}.date"),
            "invalid_date",
            format!("{} 不是合法的 YYYY-MM-DD 日历日期", endpoint.date),
        ));
    }
    if endpoint.members.len() > MAX_SCOPE_MEMBERS {
        issues.push(FieldIssue::new(
            &format!("{label}.members"),
            "too_many_members",
            format!("投资范围成员超过 {} 个", MAX_SCOPE_MEMBERS),
        ));
    }
    let mut seen: Vec<&str> = Vec::new();
    for (index, member) in endpoint.members.iter().enumerate() {
        // Prefer the stable account id in the path; fall back to the index
        // only when the id itself is the broken field.
        let base = if member.account_id.is_empty() {
            format!("{label}.members[{index}]")
        } else {
            format!("{label}.members.{}", member.account_id)
        };
        validate_id(&member.account_id, &format!("{base}.account_id"), issues);
        if !SUPPORTED_KINDS.contains(&member.kind.as_str()) {
            issues.push(FieldIssue::new(
                &format!("{base}.kind"),
                "unsupported_kind",
                format!(
                    "账户类型 {} 不在投资范围支持列表（investment/mixed/fund/bond）；现金／存款、公积金和负债不得混入",
                    member.kind
                ),
            ));
        }
        if let Some(cents) = member.amount_cents {
            validate_amount(cents, &format!("{base}.amount_cents"), issues);
        }
        if member.account_id.is_empty() {
            continue;
        }
        if seen.contains(&member.account_id.as_str()) {
            issues.push(FieldIssue::new(
                &format!("{label}.members"),
                "duplicate_account",
                format!("投资范围中账户 {} 重复出现", member.account_id),
            ));
        } else {
            seen.push(member.account_id.as_str());
        }
    }
}

fn validate_flow(flow: &Flow, issues: &mut Vec<FieldIssue>) {
    validate_id(&flow.id, "flow.id", issues);
    if flow.revision < 0 || flow.from_revision < 0 || flow.to_revision < 0 {
        issues.push(FieldIssue::new(
            "flow.revision",
            "invalid_revision",
            "流动记录的修订号不能为负",
        ));
    }
    validate_id(&flow.from_snapshot_id, "flow.from_snapshot_id", issues);
    validate_id(&flow.to_snapshot_id, "flow.to_snapshot_id", issues);
    // 内容键是领域函数生成的紧凑 JSON，长度随成员数自然增长；这里只要求
    // 非空，不套用稳定 ID 的 100 字符上限。
    for (path, key) in [
        ("flow.from_value_key", &flow.from_value_key),
        ("flow.to_value_key", &flow.to_value_key),
    ] {
        if key.is_empty() {
            issues.push(FieldIssue::new(
                path,
                "invalid_value_key",
                "计算内容键由领域函数生成及复核，不能为空或由界面拼接",
            ));
        }
    }
    for (path, date) in [
        ("flow.from_date", &flow.from_date),
        ("flow.to_date", &flow.to_date),
    ] {
        if !date_ok(date) {
            issues.push(FieldIssue::new(
                path,
                "invalid_date",
                format!("{date} 不是合法的 YYYY-MM-DD 日历日期"),
            ));
        }
    }
    if date_ok(&flow.from_date) && date_ok(&flow.to_date) && flow.from_date >= flow.to_date {
        issues.push(FieldIssue::new(
            "flow.to_date",
            "invalid_interval",
            "流动区间同样要求 (期初, 期末]，期末必须晚于期初",
        ));
    }
    if let Some(cents) = flow.inflow_cents {
        validate_amount(cents, "flow.inflow_cents", issues);
    }
    if let Some(cents) = flow.outflow_cents {
        validate_amount(cents, "flow.outflow_cents", issues);
    }
    // Confirming completeness with an unknown amount is a payload error:
    // zero must be explicit and unknown is not zero.
    if flow.confirmed_complete {
        for (path, has) in [
            ("flow.inflow_cents", flow.inflow_cents.is_some()),
            ("flow.outflow_cents", flow.outflow_cents.is_some()),
        ] {
            if !has {
                issues.push(FieldIssue::new(
                    path,
                    "confirmed_without_amount",
                    "已确认完整时金额必须明确：未知请先留空并取消确认，零必须显式填 0",
                ));
            }
        }
    }
    if flow.notes.chars().count() > MAX_FLOW_NOTE_CHARS {
        issues.push(FieldIssue::new(
            "flow.notes",
            "invalid_notes",
            format!("备注超过 {} 字", MAX_FLOW_NOTE_CHARS),
        ));
    }
    let mut seen: Vec<&str> = Vec::new();
    for id in &flow.scope_account_ids {
        validate_id(id, "flow.scope_account_ids", issues);
        if !id.is_empty() {
            if seen.contains(&id.as_str()) {
                issues.push(FieldIssue::new(
                    "flow.scope_account_ids",
                    "duplicate_account",
                    format!("流动记录的投资范围中账户 {id} 重复出现",),
                ));
            } else {
                seen.push(id.as_str());
            }
        }
    }
}

fn validate_amount(cents: i64, path: &str, issues: &mut Vec<FieldIssue>) {
    if cents < 0 {
        issues.push(FieldIssue::new(
            path,
            "invalid_amount",
            "输入金额必须是非负整数分；未知用 null，不用负数或零替代",
        ));
    } else if cents > MAX_CENTS {
        issues.push(FieldIssue::new(
            path,
            "amount_range",
            format!("金额超出可保存范围（最多 {MAX_CENTS} 分）"),
        ));
    }
}

/// Strict real-calendar check for `YYYY-MM-DD` (rejects `2026-9-30`,
/// `2026-02-30`, …).
pub(super) fn date_ok(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let year: i32 = value[0..4].parse().unwrap_or(0);
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    chrono::NaiveDate::from_ymd_opt(year, month, day).is_some()
}
