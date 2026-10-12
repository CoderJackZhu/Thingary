//! Contract example for the investment interval review component.
//!
//! Includes `src/investment_review_component` via `#[path]` (it is
//! deliberately not registered in `lib.rs`) and exercises the acceptance
//! matrix from the product design §13.5 plus the payload/state boundaries.
//! Everything here is fictional; the module is pure memory work, so this
//! example never touches a database or the file system.
//!
//! Run: `cargo test --manifest-path src-tauri/Cargo.toml --example investment_review_contract`

#[path = "../src/investment_review_component/mod.rs"]
mod investment_review_component;

use investment_review_component::{
    endpoint_value_key, parse_cents, review_interval, Endpoint, Flow, ReviewInput, ReviewResult,
    ScopeMember,
};

// ---------------------------------------------------------------- fixtures

fn member(id: &str, kind: &str, counted: bool, cents: Option<i64>) -> ScopeMember {
    ScopeMember {
        account_id: id.to_string(),
        kind: kind.to_string(),
        counted,
        amount_cents: cents,
    }
}

fn endpoint(snapshot: &str, date: &str, members: Vec<ScopeMember>) -> Endpoint {
    Endpoint {
        snapshot_id: snapshot.to_string(),
        revision: 1,
        date: date.to_string(),
        members,
    }
}

/// Fictional single-account scope: 2026-09-30 → 2026-10-31, all cents.
fn simple_input(opening: i64, closing: i64) -> ReviewInput {
    ReviewInput {
        contract_version: 1,
        from: endpoint(
            "snap-2026-09",
            "2026-09-30",
            vec![member("acc-mix-01", "mixed", true, Some(opening))],
        ),
        to: endpoint(
            "snap-2026-10",
            "2026-10-31",
            vec![member("acc-mix-01", "mixed", true, Some(closing))],
        ),
        flow: None,
        overlapping_active_flow_ids: Vec::new(),
    }
}

/// A flow confirmed against exactly these endpoints (content keys generated,
/// never hand-built). `complete = false` whenever an amount is unknown.
fn confirmed_flow(
    from: &Endpoint,
    to: &Endpoint,
    inflow: Option<i64>,
    outflow: Option<i64>,
) -> Flow {
    Flow {
        id: "flow-2026-10".to_string(),
        revision: 1,
        from_snapshot_id: from.snapshot_id.clone(),
        from_revision: from.revision,
        from_value_key: endpoint_value_key(from),
        to_snapshot_id: to.snapshot_id.clone(),
        to_revision: to.revision,
        to_value_key: endpoint_value_key(to),
        from_date: from.date.clone(),
        to_date: to.date.clone(),
        scope_account_ids: from.members.iter().map(|m| m.account_id.clone()).collect(),
        inflow_cents: inflow,
        outflow_cents: outflow,
        confirmed_complete: inflow.is_some() && outflow.is_some(),
        unsupported_movements: false,
        notes: String::new(),
    }
}

// ---------------------------------------------------------------- demo main

fn main() {
    // Fictional demo mirroring the future Store adapter boundary: amounts
    // arrive as canonical cents strings and go through the shared parser.
    let mut input = simple_input(
        parse_cents("10000000").expect("canonical cents"),
        parse_cents("11200000").expect("canonical cents"),
    );
    input.flow = Some(confirmed_flow(
        &input.from,
        &input.to,
        Some(parse_cents("1000000").expect("canonical cents")),
        Some(parse_cents("0").expect("canonical cents")),
    ));
    match review_interval(&input) {
        ReviewResult::Ready { value } => println!(
            "虚构样例 期初 {} 分 → 期末 {} 分：区间投资损益 {} 分（仅演示，未接真实复盘）",
            value.opening_cents, value.closing_cents, value.profit_cents
        ),
        other => println!("虚构样例未就绪：{other:?}"),
    }
}

// ---------------------------------------------------------------- §13.5 matrix

#[cfg(test)]
mod tests {
    use super::*;
    use investment_review_component::{BlockedStatus, FieldIssue, MAX_CENTS};

    const Y: i64 = 100; // 1 元 = 100 分，便于按元书写样例

    fn ready_value(input: &ReviewInput) -> investment_review_component::ReviewValue {
        match review_interval(input) {
            ReviewResult::Ready { value } => value,
            other => panic!("expected ready, got {other:?}"),
        }
    }

    fn blocked(input: &ReviewInput) -> (BlockedStatus, Vec<&'static str>, Option<i64>) {
        match review_interval(input) {
            ReviewResult::Blocked {
                status,
                reasons,
                change_cents,
            } => (status, reasons, change_cents),
            other => panic!("expected blocked, got {other:?}"),
        }
    }

    fn invalid(input: &ReviewInput) -> Vec<FieldIssue> {
        match review_interval(input) {
            ReviewResult::Invalid { issues } => issues,
            other => panic!("expected invalid, got {other:?}"),
        }
    }

    #[test]
    fn design_13_5_matrix_ready_rows() {
        // (opening, closing, inflow, outflow, expected profit) in 元.
        let rows: &[(i64, i64, i64, i64, i64)] = &[
            (100_000, 110_000, 10_000, 0, 0), // 纯投入：损益 0，不称收入 10,000
            (100_000, 112_000, 10_000, 0, 2_000), // 有增值
            (100_000, 90_000, 0, 10_000, 0),  // 取回至本人银行卡：损益 0，提款不称消费
            (100_000, 100_000, 0, 2_000, 2_000), // 分红转出已含在转出合计，明细不再相加
            (100_000, 102_000, 0, 0, 2_000),  // 分红留存或再投资不是外部投入
            (100_000, 99_900, 0, 0, -100),    // 手续费留在损益里，不作为取回
            (100_000, 100_000, 0, 0, 0),      // 组合内 A→B 转账抵消，不要求双向录入
        ];
        for &(open, close, inflow, outflow, profit) in rows {
            let mut input = simple_input(open * Y, close * Y);
            input.flow = Some(confirmed_flow(
                &input.from,
                &input.to,
                Some(inflow * Y),
                Some(outflow * Y),
            ));
            let value = ready_value(&input);
            assert_eq!(
                value.opening_cents,
                open * Y,
                "opening for row {open}->{close}"
            );
            assert_eq!(
                value.closing_cents,
                close * Y,
                "closing for row {open}->{close}"
            );
            assert_eq!(value.change_cents, (close - open) * Y);
            assert_eq!(value.inflow_cents, inflow * Y);
            assert_eq!(value.outflow_cents, outflow * Y);
            assert_eq!(
                value.profit_cents,
                profit * Y,
                "profit for row {open}->{close}"
            );
        }
    }

    #[test]
    fn unknown_inflow_shows_change_but_needs_review() {
        // 100,000 → 112,000，投入未知：余额变化 +12,000，损益未知。
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.flow = Some(confirmed_flow(&input.from, &input.to, None, Some(0)));
        let (status, reasons, change) = blocked(&input);
        assert_eq!(status, BlockedStatus::NeedsReview);
        assert_eq!(reasons, vec!["incomplete_flow"]);
        assert_eq!(change, Some(12_000 * Y));
    }

    #[test]
    fn missing_flow_is_not_recorded_and_keeps_change() {
        let input = simple_input(100_000 * Y, 112_000 * Y);
        let (status, reasons, change) = blocked(&input);
        assert_eq!(status, BlockedStatus::NotRecorded);
        assert_eq!(reasons, vec!["missing_flow"]);
        assert_eq!(change, Some(12_000 * Y));
    }

    #[test]
    fn endpoint_problems_block_comparison_without_faking_numbers() {
        // 范围变更：期末多了一个账户。
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input
            .to
            .members
            .push(member("acc-fund-09", "fund", true, Some(20_000 * Y)));
        assert_eq!(
            blocked(&input),
            (BlockedStatus::NotComparable, vec!["scope_changed"], None)
        );

        // 缺值：期初某账户余额未知。
        let mut input = simple_input(0, 100_000 * Y);
        input.from.members[0].amount_cents = None;
        assert_eq!(
            blocked(&input),
            (BlockedStatus::NotComparable, vec!["missing_balance"], None)
        );

        // 证券实物转入：用户标记了未支持情形，可保存但不能确认完整。
        let mut input = simple_input(100_000 * Y, 120_000 * Y);
        let mut flow = confirmed_flow(&input.from, &input.to, Some(0), Some(0));
        flow.unsupported_movements = true;
        input.flow = Some(flow);
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec!["unsupported_movement"],
                Some(20_000 * Y)
            )
        );
    }

    // ---------------------------------------------------------------- payload

    #[test]
    fn confirmed_complete_without_amount_is_invalid() {
        let mut input = simple_input(100_000 * Y, 110_000 * Y);
        let mut flow = confirmed_flow(&input.from, &input.to, None, Some(0));
        flow.confirmed_complete = true;
        input.flow = Some(flow);
        let issues = invalid(&input);
        assert!(issues
            .iter()
            .any(|i| i.code == "confirmed_without_amount" && i.path == "flow.inflow_cents"));
        // 未知时必须取消确认；显式 0 与未知有区别。
        input.flow.as_mut().unwrap().confirmed_complete = false;
        let (status, reasons, _) = blocked(&input);
        assert_eq!(status, BlockedStatus::NeedsReview);
        assert_eq!(reasons, vec!["incomplete_flow"]);
    }

    #[test]
    fn duplicate_account_ids_are_invalid() {
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input
            .to
            .members
            .push(member("acc-mix-01", "mixed", true, Some(0)));
        let issues = invalid(&input);
        assert!(issues
            .iter()
            .any(|i| i.code == "duplicate_account" && i.path == "to.members"));
    }

    #[test]
    fn unsupported_account_kind_is_rejected_as_payload_error() {
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.to.members[0].kind = "cash".to_string();
        let issues = invalid(&input);
        assert!(issues
            .iter()
            .any(|i| i.code == "unsupported_kind" && i.path == "to.members.acc-mix-01.kind"));
    }

    #[test]
    fn endpoint_order_and_dates_are_validated() {
        // 期末早于或等于期初：非法载荷。
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.to.date = "2026-09-30".to_string();
        assert!(invalid(&input).iter().any(|i| i.code == "invalid_interval"));

        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.to.date = "2026-9-30".to_string();
        assert!(invalid(&input).iter().any(|i| i.code == "invalid_date"));

        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.from.date = "2026-02-30".to_string();
        assert!(invalid(&input).iter().any(|i| i.code == "invalid_date"));
    }

    #[test]
    fn contract_version_must_be_one() {
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.contract_version = 2;
        assert!(invalid(&input)
            .iter()
            .any(|i| i.code == "unsupported_contract_version"));
    }

    #[test]
    fn amount_boundaries_match_domain_cap() {
        let mut input = simple_input(MAX_CENTS, MAX_CENTS);
        input.flow = Some(confirmed_flow(&input.from, &input.to, Some(0), Some(0)));
        let value = ready_value(&input);
        assert_eq!(value.profit_cents, 0);

        let input = simple_input(MAX_CENTS + 1, MAX_CENTS);
        assert!(invalid(&input).iter().any(|i| i.code == "amount_range"));
    }

    #[test]
    fn negative_amounts_are_invalid_not_signed_facts() {
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.from.members[0].amount_cents = Some(-1);
        assert!(invalid(&input).iter().any(|i| i.code == "invalid_amount"));
    }

    // ---------------------------------------------------------------- scope

    #[test]
    fn member_order_never_changes_the_result() {
        let from = endpoint(
            "snap-a",
            "2026-09-30",
            vec![
                member("acc-b", "fund", true, Some(4_000 * Y)),
                member("acc-a", "investment", true, Some(6_000 * Y)),
                member("acc-c", "bond", false, None),
            ],
        );
        let to = endpoint(
            "snap-b",
            "2026-10-31",
            vec![
                member("acc-c", "bond", false, None),
                member("acc-a", "investment", true, Some(7_000 * Y)),
                member("acc-b", "fund", true, Some(4_600 * Y)),
            ],
        );
        let mut input = ReviewInput {
            contract_version: 1,
            from,
            to,
            flow: None,
            overlapping_active_flow_ids: Vec::new(),
        };
        input.flow = Some(confirmed_flow(
            &input.from,
            &input.to,
            Some(1_000 * Y),
            Some(0),
        ));

        let value = ready_value(&input);
        assert_eq!(value.opening_cents, 10_000 * Y);
        assert_eq!(value.closing_cents, 11_600 * Y);
        assert_eq!(value.profit_cents, 600 * Y);

        // 乱序重排两端与流动范围，结果不变。
        let mut shuffled = input.clone();
        shuffled.from.members.reverse();
        shuffled.to.members.reverse();
        shuffled.flow.as_mut().unwrap().scope_account_ids.reverse();
        assert_eq!(ready_value(&shuffled), value);
    }

    #[test]
    fn uncounted_members_stay_out_of_totals_but_keep_scope_identity() {
        // 同一账户两端一致地不计数：不计入金额，也不算缺余额。
        let from = endpoint(
            "snap-a",
            "2026-09-30",
            vec![
                member("acc-a", "investment", true, Some(10_000 * Y)),
                member("acc-b", "fund", false, None),
            ],
        );
        let to = endpoint(
            "snap-b",
            "2026-10-31",
            vec![
                member("acc-b", "fund", false, None),
                member("acc-a", "investment", true, Some(11_000 * Y)),
            ],
        );
        let mut input = ReviewInput {
            contract_version: 1,
            from,
            to,
            flow: None,
            overlapping_active_flow_ids: Vec::new(),
        };
        input.flow = Some(confirmed_flow(&input.from, &input.to, Some(0), Some(0)));
        let value = ready_value(&input);
        assert_eq!(value.opening_cents, 10_000 * Y);
        assert_eq!(value.closing_cents, 11_000 * Y);
        assert_eq!(value.profit_cents, 1_000 * Y);
    }

    #[test]
    fn counted_flag_change_is_a_scope_change() {
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.to.members[0].counted = false;
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NotComparable,
                vec!["empty_scope", "scope_changed"],
                None
            )
        );
    }

    #[test]
    fn empty_scope_is_not_zero_profit() {
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.from.members.clear();
        input.to.members.clear();
        input.flow = Some(Flow {
            id: "flow-x".into(),
            revision: 1,
            from_snapshot_id: input.from.snapshot_id.clone(),
            from_revision: 1,
            from_value_key: endpoint_value_key(&input.from),
            to_snapshot_id: input.to.snapshot_id.clone(),
            to_revision: 1,
            to_value_key: endpoint_value_key(&input.to),
            from_date: input.from.date.clone(),
            to_date: input.to.date.clone(),
            scope_account_ids: Vec::new(),
            inflow_cents: Some(0),
            outflow_cents: Some(0),
            confirmed_complete: true,
            unsupported_movements: false,
            notes: String::new(),
        });
        assert_eq!(
            blocked(&input),
            (BlockedStatus::NotComparable, vec!["empty_scope"], None)
        );

        // 全部成员一致不计数同样视为空范围。
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        for m in &mut input.from.members {
            m.counted = false;
        }
        for m in &mut input.to.members {
            m.counted = false;
        }
        assert_eq!(
            blocked(&input),
            (BlockedStatus::NotComparable, vec!["empty_scope"], None)
        );
    }

    // ---------------------------------------------------------------- staleness

    #[test]
    fn amount_correction_invalidates_the_confirmation() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.flow = Some(confirmed_flow(
            &input.from,
            &input.to,
            Some(10_000 * Y),
            Some(0),
        ));
        // 确认后期初盘点被更正：内容键不再匹配。
        input.from.members[0].amount_cents = Some(90_000 * Y);
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec!["stale_endpoints"],
                Some(22_000 * Y)
            )
        );
    }

    #[test]
    fn notes_only_change_keeps_the_confirmation() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.flow = Some(confirmed_flow(
            &input.from,
            &input.to,
            Some(10_000 * Y),
            Some(0),
        ));
        let before = input.clone();
        input.flow.as_mut().unwrap().notes = "备注更正：转入含年终奖".to_string();
        // 内容键不含备注：确认不应无故失效。
        assert_eq!(
            endpoint_value_key(&input.from),
            endpoint_value_key(&before.from)
        );
        assert_eq!(ready_value(&input).profit_cents, 2_000 * Y);
    }

    #[test]
    fn revision_bump_alone_does_not_invalidate() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.flow = Some(confirmed_flow(
            &input.from,
            &input.to,
            Some(10_000 * Y),
            Some(0),
        ));
        input.from.revision = 7;
        input.flow.as_mut().unwrap().from_revision = 1; // 审计信息，不参与失效判断
        assert_eq!(ready_value(&input).profit_cents, 2_000 * Y);
    }

    #[test]
    fn flow_scope_mismatch_is_stale() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        let mut flow = confirmed_flow(&input.from, &input.to, Some(10_000 * Y), Some(0));
        flow.scope_account_ids.push("acc-other-77".to_string());
        input.flow = Some(flow);
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec!["stale_endpoints"],
                Some(12_000 * Y)
            )
        );
    }

    #[test]
    fn endpoint_date_correction_is_stale() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.flow = Some(confirmed_flow(
            &input.from,
            &input.to,
            Some(10_000 * Y),
            Some(0),
        ));
        input.to.date = "2026-11-01".to_string();
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec!["stale_endpoints"],
                Some(12_000 * Y)
            )
        );
    }

    // ---------------------------------------------------------------- overlap

    #[test]
    fn overlapping_active_flow_blocks_ready() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.flow = Some(confirmed_flow(
            &input.from,
            &input.to,
            Some(10_000 * Y),
            Some(0),
        ));
        input.overlapping_active_flow_ids = vec!["flow-2026-half".to_string()];
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec!["overlapping_flow"],
                Some(12_000 * Y)
            )
        );
    }

    #[test]
    fn overlap_without_own_flow_is_reported_with_missing_flow() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        input.overlapping_active_flow_ids = vec!["flow-2026-half".to_string()];
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec!["missing_flow", "overlapping_flow"],
                Some(12_000 * Y)
            )
        );
    }

    #[test]
    fn reason_priority_inside_needs_review_is_stable() {
        let mut input = simple_input(100_000 * Y, 112_000 * Y);
        let mut flow = confirmed_flow(&input.from, &input.to, None, None);
        flow.unsupported_movements = true;
        input.overlapping_active_flow_ids = vec!["flow-2026-half".to_string()];
        // 引用一致，因此没有 stale_endpoints；其余按固定顺序收集。
        input.flow = Some(flow);
        assert_eq!(
            blocked(&input),
            (
                BlockedStatus::NeedsReview,
                vec![
                    "overlapping_flow",
                    "unsupported_movement",
                    "incomplete_flow"
                ],
                Some(12_000 * Y)
            )
        );
    }

    #[test]
    fn explicit_zero_is_different_from_unknown() {
        // 0 必须显式提供：两端 0/0 且确认完整 → ready 且损益为 0。
        let mut input = simple_input(100_000 * Y, 100_000 * Y);
        input.flow = Some(confirmed_flow(&input.from, &input.to, Some(0), Some(0)));
        assert!(input.flow.as_ref().unwrap().confirmed_complete);
        assert_eq!(ready_value(&input).profit_cents, 0);
    }
}
