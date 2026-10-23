// 固定虚构夹具：仅供组件测试与独立预览使用，全部数字编造。
// input/result 成对出现；result 是端口会返回的领域结果样例（按产品设计
// §13.5 手工填写），组件本身不复算。内容键是字面量，与 Rust 生成格式
// 一致（["snapshot_id","date",[[account_id,kind,counted,amount_cents],…]]
// 按账户升序、未知为 null）；界面代码从不拼接内容键。

import type { InvestmentEndpointV1, InvestmentFlowV1, InvestmentReviewInputV1, InvestmentReviewResultV1 } from './model.ts';
import { t } from '../i18n.ts';
const FROM_KEY =
  '["snap-2026-06-30","2026-06-30",[["acc-bond-03","bond",false,null],["acc-fund-02","fund",true,"4000000"],["acc-inv-01","investment",true,"6000000"]]]';
const TO_KEY_BASE =
  '["snap-2026-09-30","2026-09-30",[["acc-bond-03","bond",false,null],["acc-fund-02","fund",true,"4480000"],["acc-inv-01","investment",true,"6720000"]]]';
const TO_KEY_ZERO =
  '["snap-2026-09-30","2026-09-30",[["acc-bond-03","bond",false,null],["acc-fund-02","fund",true,"4400000"],["acc-inv-01","investment",true,"6600000"]]]';
const TO_KEY_NEGATIVE =
  '["snap-2026-09-30","2026-09-30",[["acc-bond-03","bond",false,null],["acc-fund-02","fund",true,"3996000"],["acc-inv-01","investment",true,"5994000"]]]';

function fromEndpoint(members: InvestmentEndpointV1['members']): InvestmentEndpointV1 {
  return { snapshot_id: 'snap-2026-06-30', revision: 4, date: '2026-06-30', members };
}

function toEndpoint(members: InvestmentEndpointV1['members']): InvestmentEndpointV1 {
  return { snapshot_id: 'snap-2026-09-30', revision: 2, date: '2026-09-30', members };
}

/** 期初 ¥60,000 + ¥40,000；acc-bond-03 两端一致地不计数。 */
function baseMembers(toInv = '6720000', toFund = '4480000') {
  return {
    from: [
      { account_id: 'acc-inv-01', kind: 'investment', counted: true, amount_cents: '6000000' },
      { account_id: 'acc-fund-02', kind: 'fund', counted: true, amount_cents: '4000000' },
      { account_id: 'acc-bond-03', kind: 'bond', counted: false, amount_cents: null },
    ] satisfies InvestmentEndpointV1['members'],
    to: [
      { account_id: 'acc-inv-01', kind: 'investment', counted: true, amount_cents: toInv },
      { account_id: 'acc-fund-02', kind: 'fund', counted: true, amount_cents: toFund },
      { account_id: 'acc-bond-03', kind: 'bond', counted: false, amount_cents: null },
    ] satisfies InvestmentEndpointV1['members'],
  };
}

/** 已按 base 端点确认过的流动记录（虚构）。 */
export function confirmedFlowFixture(patch: Partial<InvestmentFlowV1> = {}): InvestmentFlowV1 {
  return {
    id: 'flow-2026-q3',
    revision: 3,
    from_snapshot_id: 'snap-2026-06-30',
    from_revision: 4,
    from_value_key: FROM_KEY,
    to_snapshot_id: 'snap-2026-09-30',
    to_revision: 2,
    to_value_key: TO_KEY_BASE,
    from_date: '2026-06-30',
    to_date: '2026-09-30',
    scope_account_ids: ['acc-inv-01', 'acc-fund-02', 'acc-bond-03'],
    inflow_cents: '1000000',
    outflow_cents: '0',
    confirmed_complete: true,
    unsupported_movements: false,
    notes: '转入含一笔季度结余',
    ...patch,
  };
}

function reviewInput(
  from: InvestmentEndpointV1,
  to: InvestmentEndpointV1,
  flow: InvestmentFlowV1 | null,
  overlapping: string[] = [],
): InvestmentReviewInputV1 {
  return { contract_version: 1, from, to, flow, overlapping_active_flow_ids: overlapping };
}

export const FIXTURE_TODAY = '2026-10-12';

export type FixtureKey =
  | 'ready-profit'
  | 'ready-zero'
  | 'ready-negative'
  | 'incomplete-flow'
  | 'not-recorded'
  | 'scope-changed'
  | 'missing-balance'
  | 'empty-scope'
  | 'stale-endpoints'
  | 'overlapping-flow'
  | 'unsupported-movement'
  | 'invalid-input';

export const reviewFixtures: Record<FixtureKey, { input: InvestmentReviewInputV1; result: InvestmentReviewResultV1 }> = {
  // §13.5：100,000 → 112,000，转入 10,000／转出 0 ⇒ 损益 +2,000。
  'ready-profit': {
    input: reviewInput(fromEndpoint(baseMembers().from), toEndpoint(baseMembers().to), confirmedFlowFixture()),
    result: {
      status: 'ready',
      value: {
        opening_cents: '10000000',
        closing_cents: '11200000',
        change_cents: '1200000',
        inflow_cents: '1000000',
        outflow_cents: '0',
        profit_cents: '200000',
      },
    },
  },
  // §13.5：纯投入 100,000 → 110,000，转入 10,000 ⇒ 损益 0。
  'ready-zero': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint(baseMembers('6600000', '4400000').to),
      confirmedFlowFixture({ to_value_key: TO_KEY_ZERO }),
    ),
    result: {
      status: 'ready',
      value: {
        opening_cents: '10000000',
        closing_cents: '11000000',
        change_cents: '1000000',
        inflow_cents: '1000000',
        outflow_cents: '0',
        profit_cents: '0',
      },
    },
  },
  // §13.5：手续费 100 已扣余额 ⇒ 损益 −100，费用不作为取回抹掉损失。
  'ready-negative': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint(baseMembers('5994000', '3996000').to),
      confirmedFlowFixture({ inflow_cents: '0', outflow_cents: '0', notes: '', to_value_key: TO_KEY_NEGATIVE }),
    ),
    result: {
      status: 'ready',
      value: {
        opening_cents: '10000000',
        closing_cents: '9990000',
        change_cents: '-10000',
        inflow_cents: '0',
        outflow_cents: '0',
        profit_cents: '-10000',
      },
    },
  },
  // §13.5：转入未知 ⇒ 余额变化 +12,000 可见，损益未知。
  'incomplete-flow': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint(baseMembers().to),
      confirmedFlowFixture({ inflow_cents: null, confirmed_complete: false }),
    ),
    result: { status: 'needs_review', reasons: ['incomplete_flow'], change_cents: '1200000' },
  },
  'not-recorded': {
    input: reviewInput(fromEndpoint(baseMembers().from), toEndpoint(baseMembers().to), null),
    result: { status: 'not_recorded', reasons: ['missing_flow'], change_cents: '1200000' },
  },
  'scope-changed': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint([...baseMembers().to, { account_id: 'acc-mix-04', kind: 'mixed', counted: true, amount_cents: '2000000' }]),
      null,
    ),
    result: { status: 'not_comparable', reasons: ['scope_changed'], change_cents: null },
  },
  'missing-balance': {
    input: reviewInput(
      fromEndpoint(baseMembers().from.map(m => (m.account_id === 'acc-fund-02' ? { ...m, amount_cents: null } : m))),
      toEndpoint(baseMembers().to),
      null,
    ),
    result: { status: 'not_comparable', reasons: ['missing_balance'], change_cents: null },
  },
  'empty-scope': {
    input: reviewInput(
      fromEndpoint(baseMembers().from.map(m => ({ ...m, counted: false }))),
      toEndpoint(baseMembers().to.map(m => ({ ...m, counted: false }))),
      null,
    ),
    result: { status: 'not_comparable', reasons: ['empty_scope'], change_cents: null },
  },
  // 确认后期初被更正（acc-inv-01 期初改为 ¥50,000）⇒ 内容键过期。
  'stale-endpoints': {
    input: reviewInput(
      fromEndpoint(baseMembers().from.map(m => (m.account_id === 'acc-inv-01' ? { ...m, amount_cents: '5000000' } : m))),
      toEndpoint(baseMembers().to),
      confirmedFlowFixture(),
    ),
    result: { status: 'needs_review', reasons: ['stale_endpoints'], change_cents: '2200000' },
  },
  'overlapping-flow': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint(baseMembers().to),
      confirmedFlowFixture(),
      ['flow-2026-h1'],
    ),
    result: { status: 'needs_review', reasons: ['overlapping_flow'], change_cents: '1200000' },
  },
  'unsupported-movement': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint(baseMembers().to),
      confirmedFlowFixture({ unsupported_movements: true, confirmed_complete: false }),
    ),
    result: { status: 'needs_review', reasons: ['unsupported_movement', 'incomplete_flow'], change_cents: '1200000' },
  },
  // 领域拒绝样例：确认完整但金额为空。
  'invalid-input': {
    input: reviewInput(
      fromEndpoint(baseMembers().from),
      toEndpoint(baseMembers().to),
      confirmedFlowFixture({ inflow_cents: null, confirmed_complete: true }),
    ),
    result: {
      status: 'invalid',
      issues: [
        {
          path: 'flow.inflow_cents',
          code: 'confirmed_without_amount',
          message: t('已确认完整时金额必须明确：未知请先留空并取消确认，零必须显式填 0'),
        },
      ],
    },
  },
};
