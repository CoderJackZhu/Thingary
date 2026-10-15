import type { BasicCapabilities, PlanningMissing, ProfileState, SetupFields, StoredLifeEvent } from './plan.ts';
import type { Snapshot } from './wealth.ts';
import { defaultRetire, hundredthsToPct } from './plan.ts';
import { basicInput, budgetInput, draftOf, fundsInput, budgetItemsChanged } from './planning-basic-forms.ts';
import type { Draft } from './planning-basic-forms.ts';
import { costReviewRows } from './planning-cost-review.ts';

type Saved = ProfileState['saved'];
export const questions = ['希望多少岁退休，规划到多少岁？', '退休后每月大概花多少钱？', '现在有多少钱可以用来准备？', '以后还有哪些固定收入？'] as const;
export type GoalState = '0' | '1' | '2' | '2b';

export type SetupErrorLocation = { step: number; label: string };
/** Exact messages from basicInput and native profile validation. Generic money/month
 * errors can refer to hidden facts or several fields; deliberately leave them unmapped. */
export function setupErrorLocation(message: string): SetupErrorLocation | null {
  const locations: [number, string, string[]][] = [
    [0, '退休开始月份', ['目标月份格式不正确。']],
    [0, '规划终点月份', ['规划终点须晚于目标月份。']],
    [1, '退休后每月生活预算', ['退休后月支出须为大于 0 的金额']],
    [5, '退休前实际年收益', ['退休前实际收益请填百分数，例如 2 或 2.5。', '退休前实际收益率须在 -10.00% 到 20.00% 之间']],
    [5, '退休后实际年收益', ['退休后实际收益请填百分数，例如 2 或 2.5。', '退休后实际收益率须在 -10.00% 到 20.00% 之间']],
    [5, '通胀', ['通胀请填百分数，例如 2 或 2.5。']],
    [1, '应急金月数', ['应急金月数须是 0 到 36 的整数。', '请填写应急金月数。']],
  ];
  const match = locations.find(([, , messages]) => messages.includes(message));
  return match ? { step: match[0], label: match[1] } : null;
}


/** Saved choices win, including an explicit unconfirmed state. */
export const defaultIncomeMode = (saved: Saved) => saved?.profile.retire.simplified.income_mode ?? 'excluded';

export function questionProgress(saved: Saved, caps: BasicCapabilities | null) {
  const p = saved?.profile, r = p?.retire, b = r?.basic;
  const answered = [!!b && r?.simplified.time.target_month != null && r?.simplified.time.horizon_month != null, !!b && r?.spend_cents != null,
    !!b && (caps?.funds.status === 'ready' || b.start.kind === 'live' && !!caps?.context.start), !!b && r?.simplified.income_mode !== 'unconfirmed'];
  const remaining = answered.filter(v => !v).length;
  return { answered, remaining, first: Math.max(0, answered.findIndex(v => !v)) };
}

/** Only hard missing facts or invalid inputs retain state 2b. */
export function goalState(saved: Saved, caps: BasicCapabilities | null): GoalState {
  if (!saved?.profile.retire.basic) return '0';
  if (questionProgress(saved, caps).remaining) return '1';
  return caps?.requirement.status === 'ready' ? '2' : '2b';
}

export function setupDraft(saved: Saved, snapshot: Snapshot | null, wealthOn: boolean): Draft {
  const d = draftOf(saved, wealthOn ? snapshot : null);
  return { ...d, simplified: { ...d.simplified, income_mode: defaultIncomeMode(saved) }, start: !saved?.profile.retire.basic && (!wealthOn || !snapshot) ? 'simulation' : d.start };
}

/** Use the existing setup transaction: major conditions and optional contribution commit atomically. */
export function setupFields(d: Draft, saved: Saved, today: string, liveAvailable: boolean): SetupFields {
  const r = saved?.profile.retire ?? defaultRetire;
  const input = basicInput(d, saved, today);
  if (input.section !== 'basic') throw new Error('规划设置格式不正确。');
  return { basic: input.fields, budget: budgetItemsChanged(d, r) ? (budgetInput(d, r) as Extract<ReturnType<typeof budgetInput>, { section: 'budget' }>).fields : null,
    funds: d.start === 'live' && liveAvailable ? (fundsInput(d, saved, today) as Extract<ReturnType<typeof fundsInput>, { section: 'funds' }>).fields : null, simplified: structuredClone(d.simplified) };
}

export function conditionChips(saved: NonNullable<Saved>, caps: BasicCapabilities, format: (c: string) => string) {
  const p = saved.profile, r = p.retire, mode = r.simplified.income_mode;
  return [
    { text: r.simplified.time.target_month === null ? '目标月份未填' : `${r.simplified.time.target_month} 开始使用资金`, step: 0 },
    { text: r.spend_cents === null ? '每月生活费未填' : `每月生活费 ${format(r.spend_cents)}`, step: 1 },
    { text: caps.funds.status === 'ready' ? `可用资金 ${format(caps.funds.value.available_cents)}` : '可用资金待确认', step: 2 },
    { text: `收益 ${hundredthsToPct(r.real_return_before_hundredths)}% / ${hundredthsToPct(r.real_return_after_hundredths)}%${r.real_return_before_hundredths === 0 && r.real_return_after_hundredths === 0 ? '（只跑平通胀）' : ''} · 通胀 ${hundredthsToPct(p.assumptions.inflation_hundredths)}%`, step: 5 },
    { text: mode === 'excluded' ? '暂不计退休收入' : mode === 'manual' ? '计入所选手填收入' : '退休收入未选择', step: 3, prominent: mode === 'excluded' },
  ];
}

export type Refinement = { id: string; title: string; benefit: string; duration: string; action: 'costs' | 'event' | 'contribution' | 'setup' | 'reload' | 'events' | 'funds' | 'debts'; event?: StoredLifeEvent; step?: number; required: boolean; impacts?: boolean; condition?: boolean };
function pendingCostsText(saved: NonNullable<Saved>) {
  const r = saved.profile.retire;
  const { pre, post, pendingRows } = costReviewRows(draftOf(saved, null), r);
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
export function refinementCards(saved: NonNullable<Saved>, caps: BasicCapabilities, today: string, debtLabels: Readonly<Record<string, { name: string; balance: string }>> = {}): Refinement[] {
  const r = saved.profile.retire, b = r.basic;
  const missing = caps.requirement.status === 'blocked' ? caps.requirement.missing : [];
  const has = (...codes: PlanningMissing['code'][]) => missing.some(m => codes.includes(m.code));
  const cards: Refinement[] = [];
  if (missing.some(m => ['COST_SCOPE_UNKNOWN', 'COST_SCOPE_INVALID'].includes(m.code) && m.field !== 'retirement_contribution_cost')) cards.push({ id: 'costs', title: '核对有没有重复费用', benefit: pendingCostsText(saved), duration: '约 1 分钟', action: 'costs', required: true });
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
  if (has('HORIZON_INVALID', 'TIME_UNCONFIRMED')) cards.push({ id: 'assumptions', title: '调整规划时间与假设', benefit: '确认退休时间、规划终点和收益，让计算条件可以成立。', duration: '约 1 分钟', action: 'setup', step: 0, required: true });
  if (has('INCOME_UNCONFIRMED')) cards.push({ id: 'income', title: '核对退休后的收入', benefit: '重新选择仍有效的收入记录，保持已有资料。', duration: '约 1 分钟', action: 'setup', step: 3, required: true });
  if (has('FUNDS_UNCONFIRMED')) cards.push({ id: 'funds', title: '确认哪些钱可以动用', benefit: '确认这次盘点里哪些账户可以动用、哪些暂不能动用，以及各账户计入多少比例。', duration: '约 1 分钟', action: has('FUNDS_UNCONFIRMED') ? 'setup' : 'funds', step: 2, required: true });
  if (has('SOURCE_ERROR', 'SOURCE_STALE')) cards.push({ id: 'reload', title: '重新读取规划资料', benefit: '获取本次计算所需的当前资料，读取失败不会当成零。', duration: '约几秒', action: 'reload', required: true });
  const annotations = caps.annotations ?? [];
  const costs = annotations.filter(a => a.reason_code === 'COST_ASSUMED_EXTRA' || a.reason_code === 'COST_PERIOD_PENDING');
  if (costs.length && !cards.some(c => c.id === 'costs')) cards.push({ id: 'costs', title: '核对费用包含关系', benefit: [...new Set(costs.map(a => a.message))].join('；'), duration: '约 1 分钟', action: 'costs', required: false, impacts: true });
  for (const event of r.life_events) {
    const rows = annotations.filter(a => a.refinement.event_id === event.id);
    if (!rows.length || cards.some(c => c.event?.id === event.id)) continue;
    const fields = [...new Set(rows.flatMap(a => a.missing_fields))];
    const timeOnly = rows.every(a => a.reason_code === 'TIME_PENDING');
    cards.push({ id: `event:${event.id}`, title: timeOnly ? '重设大额计划的终点月份' : event.date < today.slice(0, 7) && !r.core?.occurrences.some(o => o.event_id === event.id) ? '确认已过期的大额计划' : '核对大额计划的实际资料', benefit: `${event.label} · 预计 ${event.date}。${fields.length ? '还差：' + fields.join('、') : rows.map(a => a.message).join('；')}`, duration: '约 2 分钟', action: timeOnly ? 'events' : 'event', event, required: false, impacts: true });
  }
  const debtPending = annotations.filter(a => a.reason_code === 'DEBT_UNLINKED');
  const debtText = (a: NonNullable<BasicCapabilities['annotations']>[number]) => {
    const label = debtLabels[a.source_ids[0]];
    return `${label ? `${label.name}（余额 ${label.balance}）` : '负债账户'}：${a.message.replace(/。$/, '')}`;
  };
  if (debtPending.length) {
    const names = [...new Set(debtPending.flatMap(a => a.source_ids))].map(id => {
      const label = debtLabels[id];
      return label ? `${label.name} ${label.balance === '未知' ? '余额未知' : label.balance}` : '负债账户';
    });
    const list = names.slice(0, 3).join('、');
    const intro = names.length === 1 ? `你有一笔贷款：${list}` : names.length > 3 ? `你的贷款有${list}等 ${names.length} 笔` : `你有 ${names.length} 笔贷款：${list}`;
    cards.push({ id: 'debt-review', title: '告诉我你的贷款怎么还', benefit: `${intro}。还没告诉我以后每月怎么还，所以这部分还款没算进去。填写后会算入还款，或按你的选择停止提醒。`, duration: '约 2 分钟', action: 'debts', required: false, impacts: true });
  }
  if (annotations.some(a => a.reason_code === 'DEBT_BALANCE_CHANGED') && !debtPending.length) cards.push({ id: 'debt-balance', title: '贷款余额变了，复核原安排', benefit: annotations.filter(a => a.reason_code === 'DEBT_BALANCE_CHANGED').map(debtText).join('；'), duration: '约 1 分钟', action: 'debts', required: false });
  if (annotations.some(a => a.reason_code === 'REFERENCE_PENDING')) cards.push({ id: 'references', title: '核对已有付款的来源', benefit: annotations.filter(a => a.reason_code === 'REFERENCE_PENDING').map(a => a.message).join('；'), duration: '约 2 分钟', action: 'events', required: false, impacts: true });
  if (has('INPUT_INVALID') && !cards.some(c => c.required)) cards.push({ id: 'invalid', title: '更正不成立的输入', benefit: missing.map(m => m.message).join('；'), duration: '约 1 分钟', action: 'setup', step: 5, required: true });
  return cards;
}
