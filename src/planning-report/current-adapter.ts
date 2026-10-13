import type { BasicCapabilities, PlanningAnnotation, PlanningSources, RequirementResult } from '../plan-basic-contract.ts';
import { timeLabel } from '../plan-ledger.ts';
import type { Assumption, ContributionDirection, CurrentSummary, CurrentSummaryMode, CurrentSummaryOutcome, FundRow, MissingItem, Money, ReportInputV1 } from './model.ts';
import { parseReportInput, validDate, validMonth } from './model.ts';

const money = (cents: string | null, basis: Money['basis'] = 'estimated'): Money => ({ kind: 'money', cents, basis: cents === null ? 'unknown' : basis });
const requirementAmount = (result: RequirementResult): string | null => result.status === 'found' || result.status === 'no_positive_contribution' ? result.monthly_cents : null;
const monthEnd = (month: string | null): string | null => month && validDate(`${month}-01`) ? `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}` : null;
const annotationLabels: Record<PlanningAnnotation['reason_code'], string> = {
  INCOME_INCOMPLETE: '未来收入资料不完整，该项未计入。', TIME_PENDING: '费用或安排的起止月份待核对，该部分未计入。',
  EVENT_OVERDUE: '计划日期已过，实际发生状态待核对。', PAYMENT_PENDING: '实际付款资料待核对。', LOAN_PENDING: '计划贷款资料待核对。',
  DEBT_UNLINKED: '已有负债的还款安排待核对。', DEBT_EXCLUDED: '已有负债的还款按选择未计入。', DEBT_BALANCE_CHANGED: '已有负债的盘点余额已变化，还款安排待核对。',
  REFERENCE_PENDING: '计划的实际来源引用待核对。', COST_ASSUMED_EXTRA: '费用包含关系待核对，暂按额外计入。', COST_PERIOD_PENDING: '费用适用期间待核对。',
  POOL_NOT_USED: '暂时取不出的钱未计入本次可用资金。', TRANSFER_PENDING: '暂时取不出的钱的可用条件待核对，该转移未计入。',
};

/** Pure projection of one saved calculation context. No reads, writes or invented historical results. */
export function currentReportInput(sources: PlanningSources, caps: BasicCapabilities, generatedOn: string): ReportInputV1 {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  if (!sources.modules.planning || !saved?.profile.retire.basic) throw new Error('请先保存当前规划条件，再查看报告。');
  if (caps.context.generation !== sources.generation || caps.context.write_version !== sources.write_version || caps.context.revision !== saved.revision || caps.context.source !== 'saved') throw new Error('报告来源已变化，请重新读取当前规划。');
  const p = saved.profile, r = p.retire, b = r.basic!;
  const limitedCoverage = (caps.annotations ?? []).some(item => item.effect !== 'none' && item.treatment !== 'included');
  const missing: MissingItem[] = [];
  const addMissing = (id: string, label: string, impact: MissingItem['impact'] = 'degrades', hint: string | null = null) => {
    if (!missing.some(row => row.id === id)) missing.push({ id, label, impact, hint });
  };
  for (const capability of [caps.funds, caps.requirement, caps.prediction]) if (capability.status === 'blocked') for (const item of capability.missing) addMissing(`${item.code}:${item.field}`, item.message, item.capability === 'prediction' ? 'blocks_headline' : 'degrades');
  for (const item of caps.annotations ?? []) addMissing(item.id, annotationLabels[item.reason_code], item.effect !== 'none' && item.treatment !== 'included' ? 'blocks_headline' : 'degrades', item.effect === 'requirement_lower' ? '所需投入可能偏低。' : item.effect === 'requirement_higher' ? '所需投入可能偏高。' : '请在目标中核对这项依据。');
  const assumptions: Assumption[] = [];
  const add = (id: string, label: string, value: Assumption['value'], source: Assumption['source'] = 'estimated') => assumptions.push({ id, label, value, source, confirmed_on: null });
  add('profile-revision', '生成时的已保存规划修订', { kind: 'text', text: String(saved.revision) }, 'confirmed');
  add('contribution', '未来每月净投入（独立假设，不是收入事实）', money(b.contribution.monthly_cents), b.contribution.monthly_cents === null ? 'unknown' : 'estimated');
  add('budget', '完整生活预算／月', money(r.spend_cents), r.spend_cents === null ? 'unknown' : 'estimated');
  add('target-month', '目标月份', r.simplified.time.target_month === null ? { kind: 'unknown' } : { kind: 'text', text: r.simplified.time.target_month });
  add('horizon-month', '所选预测终点月份', r.simplified.time.horizon_month === null ? { kind: 'unknown' } : { kind: 'text', text: r.simplified.time.horizon_month });
  add('horizon-end', '所选预测期间截至日（月末）', { kind: 'date', date: monthEnd(r.simplified.time.horizon_month) });
  add('return-before', '目标前实际年收益条件', { kind: 'ratio', hundredths: r.real_return_before_hundredths });
  add('return-after', '目标后实际年收益条件', { kind: 'ratio', hundredths: r.real_return_after_hundredths });
  add('inflation', '年通胀条件', { kind: 'ratio', hundredths: p.assumptions.inflation_hundredths });
  add('volatility', '市场模拟年度波动条件（不参与本报告确定性结果）', { kind: 'ratio', hundredths: r.volatility_hundredths });
  add('income-mode', '未来收入计入方式', { kind: 'text', text: r.simplified.income_mode === 'excluded' ? '本次不计未来收入' : r.simplified.income_mode === 'manual' ? '仅计选定手填未来收入' : '尚未选择' }, r.simplified.income_mode === 'excluded' ? 'excluded' : r.simplified.income_mode === 'unconfirmed' ? 'unknown' : 'estimated');
  for (const [index, income] of (r.simplified.income_mode === 'manual' ? r.simplified.future_incomes.filter(row => row.included) : []).entries()) {
    add(`income-${index + 1}`, `未来收入 ${index + 1}／月`, money(income.monthly_cents), income.monthly_cents === null ? 'unknown' : 'estimated');
    add(`income-time-${index + 1}`, `未来收入 ${index + 1}适用条件`, { kind: 'text', text: `开始 ${income.start_month ?? '未知'}；结束 ${income.end_month ?? '至规划终点'}；${income.growth === 'fixed_nominal' ? '固定名义金额' : '保持购买力'}；金额基准 ${income.basis === 'start_month' ? income.start_month ?? '未知' : income.basis_month ?? '未知'}` });
  }
  for (const [phase, rows] of [['净投入', b.contribution_costs], ['退休预算', b.retirement_costs]] as const) for (const [index, row] of rows.entries()) {
    add(`${phase}-cost-${index + 1}`, `${phase}费用 ${index + 1}包含方式`, { kind: 'text', text: row.treatment === 'included' ? '已包含，按参考额还原后扣实际排期' : row.treatment === 'extra' ? '额外计入' : '本次排除' }, row.treatment === 'excluded' ? 'excluded' : 'estimated');
    if (row.treatment === 'included') add(`${phase}-reference-${index + 1}`, `${phase}费用 ${index + 1}参考额`, money(row.reference_cents));
  }
  if (caps.requirement.status === 'ready') for (const [label, result] of [['所设收益', caps.requirement.value.set], ['偏低收益', caps.requirement.value.lower], ['偏高收益', caps.requirement.value.upper]] as const) {
    const amount = requirementAmount(result);
    add(`requirement-${label}`, `${label}条件下所需月投入（不是预计能力）`, money(amount), amount === null ? 'unknown' : 'estimated');
    add(`requirement-return-${label}`, `${label}的两段实际年收益`, { kind: 'text', text: `${result.before_hundredths / 100}% / ${result.after_hundredths / 100}%` });
    if (amount === null) addMissing(`requirement-${label}`, `${label}条件下尚无可用的所需投入结果。`, 'degrades', 'message' in result ? result.message : '在所选搜索范围内未找到结果。');
  }
  const funds: FundRow[] = [];
  if (b.start.kind === 'simulation') funds.push({ id: 'simulation', name: '模拟起点', availability: 'available', amount: money(b.start.available_cents), note: '手填规划假设，不是实际账户盘点。' });
  else if (sources.modules.wealth && sources.snapshot.status === 'ready' && sources.snapshot.value) {
    const snapshot = sources.snapshot.value;
    const entries = [...snapshot.entries].filter(row => row.counted).sort((a, c) => a.account_id < c.account_id ? -1 : a.account_id > c.account_id ? 1 : 0);
    for (const [index, row] of entries.entries()) {
      const rule = r.core?.fund_rules.find(rule => rule.account_id === row.account_id);
      if (row.side === 'asset' && rule?.availability === 'excluded') continue;
      if (row.side === 'asset' && !rule) { addMissing(`unconfirmed-${index + 1}-purpose`, `待核对来源 ${index + 1}的规划用途未确认，本预览未将其列为可用资金或暂时取不出的钱。`); continue; }
      const cents = row.amount_cents === null ? null : row.side === 'liability' ? row.amount_cents : (BigInt(row.amount_cents) * BigInt(rule?.share_hundredths ?? 10000) / 10000n).toString();
      const alias = funds.length + 1;
      funds.push({ id: `account-${alias}`, name: `账户 ${alias}`, availability: row.side === 'liability' ? 'debt' : rule?.availability === 'available' ? 'available' : 'restricted', amount: money(cents, 'known'), note: `截至 ${snapshot.date}的盘点名义金额${row.side === 'asset' ? `；采用份额 ${(rule?.share_hundredths ?? 10000) / 100}%` : '；本金不再从可用现金重复扣除'}。` });
    }
  }
  // v1 cannot label a month-only gap or retain the ledger's payment timing. Omit these rather than invent a day or zero-filled series.
  addMissing('preview-scope', '本预览未展示逐月资金趋势、逐项购买结果和历史实际对照。', 'info', '请在目标与深入分析查看已有明细；本报告不代表冻结基准。');
  if (r.life_events.length || r.spend_items.length || r.core?.debt_repayments?.length || r.core?.releases.length) addMissing('arrangement-details', '结果沿用当前计算中的计划、还款、费用与资金释放安排，本预览未逐项展开这些条件。', 'info', '请在目标中核对完整安排与来源。');
  let headline: ReportInputV1['headline'] = { status: 'incomplete', amount: money(null), date: null };
  if (caps.prediction.status === 'ready') {
    const prediction = caps.prediction.value;
    add('terminal', '所选终点的预计可用资金（所设金额基准）', money(Number.isSafeInteger(Math.round(prediction.outcome.at_horizon)) ? String(Math.round(prediction.outcome.at_horizon)) : null));
    add('coverage', '所选条件覆盖判定', { kind: 'text', text: prediction.outcome.success ? limitedCoverage ? '已纳入条件在所选有限期间可覆盖；仍有影响计算的待核对项' : '所选有限期间完整预算已覆盖' : '所选条件未满足完整目标' });
    if (prediction.outcome.success && prediction.terminal === 'surplus' && !limitedCoverage) headline = { status: 'ok', amount: money(null), date: monthEnd(r.simplified.time.horizon_month) };
    else if (prediction.terminal === 'no_margin') addMissing('terminal-no-margin', '所选有限期间预算可覆盖，但终点没有余量，不代表终点以后安全。', 'blocks_headline');
    else if (!prediction.outcome.success) addMissing('target-not-covered', '按已保存净投入，所选条件未满足完整目标。', 'blocks_headline', '本预览不把月度缺口伪装为某个具体日期或单一缺口金额。');
  }
  // 当前报告受控结论与关键结果：只投影同一批已保存 caps，不改变算法、不计算新模型。
  const requiredCents = caps.requirement.status === 'ready' ? requirementAmount(caps.requirement.value.set) : null;
  const estimatedCents = b.contribution.monthly_cents;
  let contributionDirection: ContributionDirection = 'unknown';
  if (estimatedCents !== null && /^-?\d+$/.test(estimatedCents)) {
    const amount = BigInt(estimatedCents);
    contributionDirection = amount < 0n ? 'withdrawal' : amount === 0n ? 'none' : 'contribution';
  }
  // 负数投入是取用，不当作储蓄余量，因此不给能力减需求。
  const differenceCents = (contributionDirection === 'contribution' || contributionDirection === 'none') && requiredCents !== null && /^-?\d+$/.test(requiredCents)
    ? (BigInt(estimatedCents as string) - BigInt(requiredCents)).toString() : null;
  let terminalCents: string | null = null;
  const mode: CurrentSummaryMode = r.mode === 'fire' ? 'fire' : 'traditional';
  let outcome: CurrentSummaryOutcome = 'incomplete';
  let expectedRetirementMonth: string | null = null;
  if (caps.prediction.status === 'ready') {
    const prediction = caps.prediction.value;
    terminalCents = Number.isSafeInteger(Math.round(prediction.outcome.at_horizon)) ? String(Math.round(prediction.outcome.at_horizon)) : null;
    const monthOf = (index: number | null): string | null => index === null ? null : timeLabel(prediction.plan, index);
    expectedRetirementMonth = mode === 'fire' ? monthOf(prediction.projection.fi_month) : monthOf(prediction.outcome.retire_month);
    if (!prediction.outcome.success) outcome = 'not_covered';
    else if (prediction.terminal === 'no_margin') outcome = 'no_margin';
    else if (limitedCoverage) outcome = 'provisional';
    else outcome = 'covered';
  }
  const currentSummary: CurrentSummary = {
    outcome, mode,
    target_month: r.simplified.time.target_month !== null && validMonth(r.simplified.time.target_month) ? r.simplified.time.target_month : null,
    horizon_month: r.simplified.time.horizon_month !== null && validMonth(r.simplified.time.horizon_month) ? r.simplified.time.horizon_month : null,
    expected_retirement_month: expectedRetirementMonth,
    required_contribution: money(requiredCents),
    estimated_contribution: money(estimatedCents),
    contribution_direction: contributionDirection,
    difference: money(differenceCents),
    terminal_available: money(terminalCents),
    available_funds: money(caps.funds.status === 'ready' ? caps.funds.value.available_cents : null, b.start.kind === 'simulation' ? 'estimated' : 'known'),
    budget: money(r.spend_cents),
    before_return: { kind: 'ratio', hundredths: r.real_return_before_hundredths },
    after_return: { kind: 'ratio', hundredths: r.real_return_after_hundredths },
  };
  const input: ReportInputV1 = { contract_version: 1, kind: 'current', status: 'partial', subject_name: '当前规划', other_name: null, generated_on: generatedOn, source_date: caps.context.start.date, monetary_basis_date: caps.context.monetary_basis_date, scenario_revision: null, model_version: caps.context.model_version, headline, next_step: { label: '核对当前目标的条件与结果', detail: '需求金额和未来净投入是不同条件；报告仅保留生成时的只读快照。' }, current_summary: currentSummary, funds, goals: [], assumptions, series: [], differences: [], missing };
  const parsed = parseReportInput(input);
  if (!parsed.ok) throw new Error('当前报告数据无法识别，请重新读取规划。');
  return parsed.report;
}
