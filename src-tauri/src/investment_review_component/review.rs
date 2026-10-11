//! Status pipeline: invalid → not_comparable → flow confirmation state →
//! ready. Priority and reason codes follow the contract §4; `change_cents`
//! exists only when both endpoints are comparable and their counted balances
//! are complete, independent of flow completeness.

use super::{
    endpoint_value_key, Endpoint, FieldIssue, Flow, ReviewInput, ReviewResult, ReviewValue,
    ScopeMember, REASON_EMPTY_SCOPE, REASON_INCOMPLETE_FLOW, REASON_MISSING_BALANCE,
    REASON_MISSING_FLOW, REASON_OVERLAPPING_FLOW, REASON_SCOPE_CHANGED, REASON_STALE_ENDPOINTS,
    REASON_UNSUPPORTED_MOVEMENT,
};

/// Non-ready, non-invalid outcomes. Ordering inside `reasons` is stable:
/// stale → overlap → unsupported → incomplete for review states, and
/// empty_scope → scope_changed → missing_balance for comparability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockedStatus {
    NotRecorded,
    NeedsReview,
    NotComparable,
}

pub fn review_interval(input: &ReviewInput) -> ReviewResult {
    let mut issues: Vec<FieldIssue> = Vec::new();
    super::validate::validate_input(input, &mut issues);
    if !issues.is_empty() {
        return ReviewResult::Invalid { issues };
    }

    let mut reasons: Vec<&'static str> = Vec::new();
    let from_counted = input.from.members.iter().filter(|m| m.counted).count();
    let to_counted = input.to.members.iter().filter(|m| m.counted).count();
    if from_counted == 0 || to_counted == 0 {
        reasons.push(REASON_EMPTY_SCOPE);
    }
    if member_map(&input.from) != member_map(&input.to) {
        reasons.push(REASON_SCOPE_CHANGED);
    } else if !counted_balances_complete(&input.from, &input.to) {
        // Balance completeness is only attributable when the recorded scope
        // itself matches; an empty counted scope never reaches this branch
        // with unknown balances to report.
        reasons.push(REASON_MISSING_BALANCE);
    }
    if !reasons.is_empty() {
        return ReviewResult::Blocked {
            status: BlockedStatus::NotComparable,
            reasons,
            change_cents: None,
        };
    }

    let opening = sum_counted(&input.from);
    let closing = sum_counted(&input.to);
    let change = closing - opening;

    let Some(flow) = &input.flow else {
        let mut reasons = vec![REASON_MISSING_FLOW];
        if !input.overlapping_active_flow_ids.is_empty() {
            reasons.push(REASON_OVERLAPPING_FLOW);
        }
        return ReviewResult::Blocked {
            status: BlockedStatus::NotRecorded,
            reasons,
            change_cents: Some(change),
        };
    };

    let mut reasons: Vec<&'static str> = Vec::new();
    if flow_references_stale(flow, input) {
        reasons.push(REASON_STALE_ENDPOINTS);
    }
    if !input.overlapping_active_flow_ids.is_empty() {
        reasons.push(REASON_OVERLAPPING_FLOW);
    }
    if flow.unsupported_movements {
        reasons.push(REASON_UNSUPPORTED_MOVEMENT);
    }
    if !flow.confirmed_complete || flow.inflow_cents.is_none() || flow.outflow_cents.is_none() {
        reasons.push(REASON_INCOMPLETE_FLOW);
    }
    if !reasons.is_empty() {
        return ReviewResult::Blocked {
            status: BlockedStatus::NeedsReview,
            reasons,
            change_cents: Some(change),
        };
    }

    // The only formula: closing − opening − inflow + outflow. Distributions
    // kept inside the scope are already in the balances; distributions moved
    // outside are inside `outflow`; fees stay as losses. Nothing is added a
    // second time.
    let inflow = flow.inflow_cents.unwrap_or(0);
    let outflow = flow.outflow_cents.unwrap_or(0);
    ReviewResult::Ready {
        value: ReviewValue {
            opening_cents: opening,
            closing_cents: closing,
            change_cents: change,
            inflow_cents: inflow,
            outflow_cents: outflow,
            profit_cents: closing - opening - inflow + outflow,
        },
    }
}

/// Recorded scope identity: account id → (kind, counted). Amounts are
/// deliberately excluded: they differ between the two endpoints by design.
fn member_map(endpoint: &Endpoint) -> Vec<(String, String, bool)> {
    let mut map: Vec<(String, String, bool)> = endpoint
        .members
        .iter()
        .map(|m| (m.account_id.clone(), m.kind.clone(), m.counted))
        .collect();
    map.sort_by(|a, b| a.0.cmp(&b.0));
    map
}

/// All counted members on both endpoints carry an amount.
fn counted_balances_complete(from: &Endpoint, to: &Endpoint) -> bool {
    let missing = |m: &ScopeMember| m.counted && m.amount_cents.is_none();
    !(from.members.iter().any(missing) || to.members.iter().any(&missing))
}

fn sum_counted(endpoint: &Endpoint) -> i64 {
    let total: i128 = endpoint
        .members
        .iter()
        .filter(|m| m.counted)
        .map(|m| i128::from(m.amount_cents.unwrap_or(0)))
        .sum();
    // MAX_SCOPE_MEMBERS × MAX_CENTS < 10^14, far inside i64.
    i64::try_from(total).expect("validated member cap keeps totals inside i64")
}

/// The flow was confirmed against specific endpoint content: snapshot ids,
/// recorded dates, content keys and the scope itself. A revision bump alone
/// is audit information and never counts as stale.
fn flow_references_stale(flow: &Flow, input: &ReviewInput) -> bool {
    if flow.from_snapshot_id != input.from.snapshot_id
        || flow.to_snapshot_id != input.to.snapshot_id
        || flow.from_date != input.from.date
        || flow.to_date != input.to.date
        || flow.from_value_key != endpoint_value_key(&input.from)
        || flow.to_value_key != endpoint_value_key(&input.to)
    {
        return true;
    }
    let mut flow_scope: Vec<&str> = flow.scope_account_ids.iter().map(String::as_str).collect();
    flow_scope.sort_unstable();
    let mut endpoint_scope: Vec<&str> = input
        .from
        .members
        .iter()
        .map(|m| m.account_id.as_str())
        .collect();
    endpoint_scope.sort_unstable();
    flow_scope != endpoint_scope
}
