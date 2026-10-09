import type { BasicCapabilities, PlanningMissing, ProfileState, SetupFields, StoredLifeEvent } from './plan.ts';
import type { Snapshot } from './wealth.ts';
import { defaultRetire, hundredthsToPct } from './plan.ts';
import { basicInput, budgetInput, draftOf, fundsInput, incomeItemsChanged } from './planning-basic-forms.ts';
import type { Draft, IncomeMode } from './planning-basic-forms.ts';
import { costReviewRows } from './planning-cost-review.ts';

type Saved = ProfileState['saved'];
export const questions = ['你想在几岁退休？', '退休后每月大概花多少钱？', '现在有多少钱可以用来准备？', '退休后有哪些收入要算进去？'] as const;
export type GoalState = '0' | '1' | '2' | '2b';

export type SetupErrorLocation = { step: number; label: string };
/** Exact messages from basicInput and native profile validation. Generic money/month
 * errors can refer to hidden facts or several fields; deliberately leave them unmapped. */
export function setupErrorLocation(message: string): SetupErrorLocation | null {
  const locations: [number, string, string[]][] = [
    [0, '出生年月', ['出生年月格式应为 YYYY-MM', '出生年月须早于本月']],
    [0, '想在几岁退休？', ['目标年龄须是 20 到 109 的整数。', '期望退休年龄须在 20 岁与规划终点之间']],
    [1, '退休后每月生活预算', ['退休后月支出须为大于 0 的金额']],
    [5, '规划到几岁', ['规划终点须是 70 到 110 的整数。', '请填写规划终点。']],
    [5, '退休前实际年收益', ['退休前实际收益请填百分数，例如 2 或 2.5。', '退休前实际收益率须在 -10.00% 到 20.00% 之间']],
    [5, '退休后实际年收益', ['退休后实际收益请填百分数，例如 2 或 2.5。', '退休后实际收益率须在 -10.00% 到 20.00% 之间']],
    [5, '通胀', ['通胀请填百分数，例如 2 或 2.5。']],
    [5, '应急金月数', ['应急金月数须是 0 到 36 的整数。', '请填写应急金月数。']],
  ];
  const match = locations.find(([, , messages]) => messages.includes(message));
  return match ? { step: match[0], label: match[1] } : null;
}


/** Counts persisted contents only. Career trials are currently unsaved and have no stored count. */
export function moreToolsBadges(saved: Saved): string[] {
  const count = saved?.profile.retire.life_events.length ?? 0;
  return count ? [`大额计划 ${count} 项`] : [];
}

/** Saved choices win, including Beijing; having pension facts alone is not a choice. */
export const defaultIncomeMode = (saved: Saved): IncomeMode => saved?.profile.retire.basic?.retirement_income.mode ?? 'excluded';

export function questionProgress(saved: Saved, caps: BasicCapabilities | null) {
  const p = saved?.profile, r = p?.retire, b = r?.basic;
  const answered = [!!b && p?.birth_month != null && r?.target_age != null, !!b && r?.spend_cents != null,
    !!b && (caps?.funds.status === 'ready' || b.start.kind === 'live' && !!caps?.context.start), !!b && b.retirement_income.mode !== null];
  const remaining = answered.filter(v => !v).length;
  return { answered, remaining, first: Math.max(0, answered.findIndex(v => !v)) };
}

/** Only hard missing facts or invalid inputs retain state 2b. */
export function goalState(saved: Saved, caps: BasicCapabilities | null): GoalState {
  if (!saved?.profile.retire.basic) return '0';
  if (questionProgress(saved, caps).remaining) return '1';
  return caps?.requirement.status === 'ready' ? '2' : '2b';
}

export function setupDraft(saved: Saved, snapshot: Snapshot | null, today: string, wealthOn: boolean): Draft {
  const d = draftOf(saved, wealthOn ? snapshot : null, today);
  return { ...d, incomeMode: defaultIncomeMode(saved), start: !saved?.profile.retire.basic && (!wealthOn || !snapshot) ? 'simulation' : d.start };
}

/** Use the existing setup transaction. Hidden pension facts and contribution dates are never rewritten. */
export function setupFields(d: Draft, saved: Saved, today: string, liveAvailable: boolean): SetupFields {
  const r = saved?.profile.retire ?? defaultRetire;
  const input = basicInput(d, saved, today);
  if (input.section !== 'basic') throw new Error('规划设置格式不正确。');
  if (r.basic) input.fields.basic.pension_contributions = { ...r.basic.pension_contributions };
  return { basic: input.fields, budget: incomeItemsChanged(d, r) ? (budgetInput(d, r) as Extract<ReturnType<typeof budgetInput>, { section: 'budget' }>).fields : null,
    funds: d.start === 'live' && liveAvailable ? (fundsInput(d, saved, today) as Extract<ReturnType<typeof fundsInput>, { section: 'funds' }>).fields : null, pension: null };
}

export function retirementMonth(birth: string, age: string): string | null {
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(birth) || !/^\d+$/.test(age)) return null;
  const month = Number(birth.slice(5, 7)), years = Number(age);
  if (month < 1 || month > 12 || years < 20 || years > 109) return null;
  return `${Number(birth.slice(0, 4)) + years} 年 ${month} 月`;
}

export function conditionChips(saved: NonNullable<Saved>, caps: BasicCapabilities, format: (c: string) => string) {
  const p = saved.profile, r = p.retire, mode = r.basic?.retirement_income.mode;
  return [
    { text: r.target_age === null ? '退休年龄未填' : `${r.target_age} 岁退休`, step: 0 },
    { text: r.spend_cents === null ? '每月生活费未填' : `每月生活费 ${format(r.spend_cents)}`, step: 1 },
    { text: caps.funds.status === 'ready' ? `可用资金 ${format(caps.funds.value.available_cents)}` : '可用资金待确认', step: 2 },
    { text: `收益 ${hundredthsToPct(r.real_return_before_hundredths)}% / ${hundredthsToPct(r.real_return_after_hundredths)}% · 通胀 ${hundredthsToPct(p.assumptions.inflation_hundredths)}%`, step: 5 },
    { text: mode === 'excluded' ? '暂不计退休收入' : mode === 'beijing' ? '已选北京养老金估算' : mode === 'manual' ? '计入所选手填收入' : '退休收入未选择', step: 3, prominent: mode === 'excluded' },
  ];
}

export type Refinement = { id: string; title: string; benefit: string; duration: string; action: 'pension' | 'costs' | 'event' | 'contribution' | 'setup' | 'reload' | 'events' | 'funds'; event?: StoredLifeEvent; step?: number; required: boolean; impacts?: boolean };
function pendingCostsText(saved: NonNullable<Saved>, today: string) {
  const r = saved.profile.retire;
  const { pre, post, pendingRows } = costReviewRows(draftOf(saved, null, today), r, saved.profile.personal_pension_annual_cents);
  // A fee needing review both before and after retirement is still one named project.
  const pending = new Map(pendingRows.map(s => [s.id, s.label]));
  // Invalid/duplicate saved rows are also reviewed by CostsDialog, then removed by its existing save.
  for (const [key, list] of [['contribution_costs', pre], ['retirement_costs', post]] as const) {
    const seen = new Set<string>();
    for (const row of r.basic?.[key] ?? []) {
      const source = list.find(s => s.id === row.source_id);
      if (!source || seen.has(row.source_id)) pending.set(row.source_id, source?.label ?? '旧费用记录');
      seen.add(row.source_id);
    }
  }
  const names = [...pending.values()], count = pending.size;
  if (!count) return '核对已保存的费用设置，避免把同一项费用算两次。';
  return `${names.slice(0, 2).join('、')}${count > 2 ? '等' : ''} ${count} 项：核对是否已经含在生活费里，避免重复计算。`;
}
export function refinementCards(saved: NonNullable<Saved>, caps: BasicCapabilities, today: string): Refinement[] {
  const r = saved.profile.retire, b = r.basic;
  const missing = caps.requirement.status === 'blocked' ? caps.requirement.missing : [];
  const has = (...codes: PlanningMissing['code'][]) => missing.some(m => codes.includes(m.code));
  const cards: Refinement[] = [];
  if (b?.retirement_income.mode !== 'beijing' || has('PENSION_FACTS_UNKNOWN', 'PENSION_CONTRIBUTIONS_UNKNOWN')) cards.push({ id: 'pension', title: b?.retirement_income.mode === 'beijing' ? '核对北京养老金资料' : '算上国家养老金', benefit: b?.retirement_income.mode === 'beijing' ? missing.filter(m => m.owner === 'pension').map(m => m.message).join('；') : '把国家养老金算进去，通常会让每月需要存的钱变少；需要核对社保资料。', duration: '约 5 分钟', action: 'pension', required: has('PENSION_FACTS_UNKNOWN', 'PENSION_CONTRIBUTIONS_UNKNOWN') });
  if (has('COST_SCOPE_UNKNOWN', 'COST_SCOPE_INVALID')) cards.push({ id: 'costs', title: '核对有没有重复费用', benefit: pendingCostsText(saved, today), duration: '约 1 分钟', action: 'costs', required: true });
  if (has('OCCURRENCE_UNCONFIRMED')) {
    const pending = r.life_events.filter(e => {
      const o = r.core?.occurrences.find(o => o.event_id === e.id);
      return o?.status !== 'cancelled' && (e.included || o?.status === 'occurred') && (missing.some(m => m.field === `life_events.${e.id}` || m.message.includes(e.label)) || (!o && e.date < today.slice(0, 7)) || (b?.start.kind === 'simulation' && o?.status === 'occurred'));
    });
    // Linked events always open individually; unlinked debt/reference issues retain the existing table entry.
    if (!pending.length || missing.some(m => m.code === 'OCCURRENCE_UNCONFIRMED' && (m.message.includes('负债账户') || m.field === 'reference_issues'))) cards.push({ id: 'payments', title: '核对已有贷款与付款', benefit: '检查已保存的大额计划、实际付款和剩余贷款，让计算接上已有的还款安排。', duration: '约 2 分钟', action: 'events', required: true });
    for (const event of pending) cards.push({ id: `event:${event.id}`, title: '确认已过期的大额计划', benefit: `${event.label} · 预计 ${event.date}。核对是否发生、取消或改期，让计算采用正确的付款安排。`, duration: '每项约 2 分钟', action: 'event', event, required: true });
  }
  if (b?.contribution.monthly_cents == null) cards.push({ id: 'contribution', title: '估一估每月能存多少', benefit: '对比目标需要存的钱和你实际估计能存的钱，不影响先看需求。', duration: '约 1 分钟', action: 'contribution', required: false });
  if (has('HORIZON_INVALID')) cards.push({ id: 'assumptions', title: '调整规划时间与假设', benefit: '确认退休时间、规划终点和收益，让计算条件可以成立。', duration: '约 1 分钟', action: 'setup', step: 5, required: true });
  if (has('INCOME_SOURCE_UNKNOWN')) cards.push({ id: 'income', title: '核对退休后的收入', benefit: '重新选择仍有效的收入记录，保持已有资料。', duration: '约 1 分钟', action: 'setup', step: 3, required: true });
  if (has('POOL_UNCONFIRMED', 'FUNDS_UNCONFIRMED')) cards.push({ id: 'funds', title: '确认哪些钱可以动用', benefit: '核对暂时不能动用的账户，避免把这些钱提前算入。', duration: '约 1 分钟', action: has('FUNDS_UNCONFIRMED') ? 'setup' : 'funds', step: 2, required: true });
  if (has('SOURCE_ERROR', 'SOURCE_STALE')) cards.push({ id: 'reload', title: '重新读取规划资料', benefit: '获取本次计算所需的当前资料，读取失败不会当成零。', duration: '约几秒', action: 'reload', required: true });
  if (b?.retirement_income.mode === 'beijing' && missing.some(m => m.owner === 'pension' || m.code === 'POOL_UNCONFIRMED')) cards.push({ id: 'income-switch', title: '改选“先不算”先看结果', benefit: '你选择了北京养老金估算，还差社保资料；也可以改选“先不算”先看结果。原有养老资料保留。', duration: '约几秒', action: 'setup', step: 3, required: false });
  const annotations = caps.annotations ?? [];
  const costs = annotations.filter(a => a.reason_code === 'COST_ASSUMED_EXTRA' || a.reason_code === 'COST_PERIOD_PENDING');
  if (costs.length && !cards.some(c => c.id === 'costs')) cards.push({ id: 'costs', title: '核对费用包含关系', benefit: `${[...new Set(costs.map(a => a.message.split('的')[0]))].join('、')}：待核对包含关系；暂按额外费用计入，可能重复包含。`, duration: '约 1 分钟', action: 'costs', required: false, impacts: true });
  for (const event of r.life_events) {
    const rows = annotations.filter(a => a.refinement.event_id === event.id);
    if (!rows.length || cards.some(c => c.event?.id === event.id)) continue;
    const fields = [...new Set(rows.flatMap(a => a.missing_fields))];
    cards.push({ id: `event:${event.id}`, title: event.date < today.slice(0, 7) && !r.core?.occurrences.some(o => o.event_id === event.id) ? '确认已过期的大额计划' : '核对大额计划的实际资料', benefit: `${event.label} · 预计 ${event.date}。${fields.length ? '还差：' + fields.join('、') : rows.map(a => a.message).join('；')}`, duration: '约 2 分钟', action: 'event', event, required: false, impacts: true });
  }
  if (annotations.some(a => ['DEBT_UNLINKED', 'REFERENCE_PENDING'].includes(a.reason_code))) cards.push({ id: 'debt-review', title: '核对已有贷款与付款', benefit: annotations.filter(a => ['DEBT_UNLINKED', 'REFERENCE_PENDING'].includes(a.reason_code)).map(a => a.message).join('；'), duration: '约 2 分钟', action: 'events', required: false, impacts: true });
  if (annotations.some(a => a.reason_code === 'TRANSFER_PENDING')) cards.push({ id: 'transfer', title: '核对未来缴存安排', benefit: '未来缴存期间待核对，这部分付款暂未计入。', duration: '约 1 分钟', action: 'pension', required: false, impacts: true });
  if (has('INPUT_INVALID') && !cards.some(c => c.required)) cards.push({ id: 'invalid', title: '更正不成立的输入', benefit: missing.map(m => m.message).join('；'), duration: '约 1 分钟', action: 'setup', step: 5, required: true });
  return cards;
}
