// Temporary preview assumptions only. Never amend facts, auto-adopt policy output, or release a pool.
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { StoredIncomeItem } from '../plan.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { validCareerAmount } from '../plan-career-contract.ts';

export type IncomeDraft = { mode: 'saved' | 'manual' | 'excluded'; selected: string[]; items: (Omit<StoredIncomeItem, 'start_age'> & { start_age: number | null })[] };
export type ScopeStatus = 'ready' | 'source_blocked' | 'pool_blocked' | 'policy_blocked' | 'income_blocked';
export function incomeDraft(sources: PlanningSources): IncomeDraft {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  return { mode: 'saved', selected: p?.retire.basic?.retirement_income.selected.map(x => x.id) ?? [], items: structuredClone(p?.retire.income_items ?? []) };
}

export function prepareIncomeScope(sources: PlanningSources, draft: CareerDraft, input: IncomeDraft) {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  const blocked = (status: Exclude<ScopeStatus, 'ready'>, issues: string[]) => ({ status, issues, sources: null, cashSources: null, draft: structuredClone(draft) } as const);
  if (!p?.retire.basic || sources.profile.status !== 'ready' || sources.profile.value.generation !== sources.generation)
    return blocked('source_blocked', ['通用资料未就绪或来源已变化，请重新读取。']);
  const core = p.retire.core;
  const hpf = core?.hpf_monthly_cents;
  const pp = p.personal_pension_annual_cents;
  const housing = p.retire.basic.start.kind === 'live' && sources.modules.wealth && sources.snapshot.status === 'ready'
    && sources.snapshot.value?.entries.some(e => {
      const rule = core?.fund_rules.find(x => x.account_id === e.account_id);
      return e.counted && e.side === 'asset' && e.kind === 'housing_fund' && e.amount_cents !== '0' && rule?.availability !== 'excluded' && rule?.share_hundredths !== 0;
    });
  const stagePool = [draft.gap.pension, draft.recovery.pension].some(x => x && typeof x === 'object' && x.hpf_monthly_cents !== '0');
  if (housing || core?.personal_pension_account_id || (hpf != null && hpf !== '0') || (pp != null && pp !== '0') || stagePool)
    return blocked('pool_blocked', ['本次资料涉及公积金或个人养老金池估算，首版暂不支持；不能只改退休收入选项放行，也不会删除已有账户或转入。']);

  // No pool dependency: contribution bases cannot affect this financial path's external income.
  const financialDraft = structuredClone(draft);
  financialDraft.gap.pension = financialDraft.recovery.pension = 'unchanged';
  const copy = structuredClone(sources), ret = copy.profile.status === 'ready' ? copy.profile.value.saved!.profile.retire : null;
  const mode = input.mode === 'saved' ? p.retire.basic.retirement_income.mode : input.mode;
  const selected = input.mode === 'saved' ? p.retire.basic.retirement_income.selected.map(x => x.id) : input.selected;
  const items = input.mode === 'saved' ? p.retire.income_items : input.items;
  const issues: string[] = [];
  if (mode === 'manual') {
    if (!selected.length) issues.push('请选择至少一笔手填退休收入；若一笔也不计，请主动选择“不计任何退休收入”。');
    if (new Set(selected).size !== selected.length) issues.push('退休收入来源重复，请重新选择。');
    for (const id of selected) {
      const matches = items.filter(x => x.id === id), item = matches[0];
      if (matches.length !== 1) { issues.push('所选退休收入来源不存在或重复，请重新选择。'); continue; }
      if (!item.label.trim() || !validCareerAmount(item.monthly_cents) || !Number.isInteger(item.start_age) || item.start_age === null || item.start_age < 0 || item.start_age > 120
        || (item.end_age !== null && (!Number.isInteger(item.end_age) || item.end_age <= item.start_age || item.end_age > 120)) || typeof item.indexed !== 'boolean')
        issues.push(`${item.label || '手填收入'}：请确认名称、非负月金额、开始年龄和晚于开始的结束年龄；未填金额不按零。`);
    }
  }
  // Cash preparation must not invoke the old Beijing estimate or certify unknown retirement inputs.
  const cashSources = structuredClone(copy);
  if (cashSources.profile.status === 'ready') cashSources.profile.value.saved!.profile.retire.basic!.retirement_income = { mode: null, selected: [] };
  if (mode === 'beijing') return { status: 'policy_blocked' as const, issues: ['北京养老金自动联动尚未核准；请选择本次明确的手填／不计收入口径，或只检查已知空窗。'], sources: null, cashSources, draft: financialDraft };
  if (mode === null || issues.length) return { status: 'income_blocked' as const, issues: issues.length ? issues : ['请选择本次退休收入计入方式。'], sources: null, cashSources, draft: financialDraft };
  if (ret) {
    ret.income_items = structuredClone(items) as StoredIncomeItem[];
    ret.basic!.retirement_income = { mode, selected: mode === 'excluded' ? [] : selected.map(id => ({
      ...p.retire.basic!.retirement_income.selected.find(x => x.id === id), id,
      source_id: p.retire.basic!.retirement_income.selected.find(x => x.id === id)?.source_id ?? `career-income:${id}`,
      role: p.retire.basic!.retirement_income.selected.find(x => x.id === id)?.role ?? 'other',
    })) };
  }
  return { status: 'ready' as const, issues: [], sources: copy, cashSources, draft: financialDraft };
}
