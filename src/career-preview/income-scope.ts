// Temporary preview assumptions only. Never amend facts, auto-adopt policy output, or release a pool.
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { StoredIncomeItem } from '../plan.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { validCareerAmount } from '../plan-career-contract.ts';

export type IncomeDraft = { mode: 'saved' | 'manual' | 'excluded'; selected: string[]; items: (Omit<StoredIncomeItem, 'start_age'> & { start_age: number | null })[]; /** This trial ignores housing fund and personal pension pools (balances, release, future deposits); conservative, nothing is deleted. */ excludePools?: boolean };
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
  const poolFound = housing || core?.personal_pension_account_id || (hpf != null && hpf !== '0') || (pp != null && pp !== '0') || stagePool;
  if (poolFound && !input.excludePools)
    return blocked('pool_blocked', ['本次资料涉及公积金或个人养老金池，首版不估算它们的释放；改选退休收入口径不能放行。可勾选“本次不计公积金和个人养老金”只用可动用的钱来算（偏保守），已有账户和转入记录不会被删除。']);

  // No pool dependency: contribution bases cannot affect this financial path's external income.
  const financialDraft = structuredClone(draft);
  financialDraft.gap.pension = financialDraft.recovery.pension = 'unchanged';
  const copy = structuredClone(sources), ret = copy.profile.status === 'ready' ? copy.profile.value.saved!.profile.retire : null;
  if (input.excludePools && copy.profile.status === 'ready' && copy.profile.value.saved) {
    // Temporary copy only: pools are left out of the plan, never deleted or turned into spendable money.
    const cp = copy.profile.value.saved.profile, cc = cp.retire.core;
    cp.personal_pension_annual_cents = '0';
    if (cc) {
      cc.hpf_monthly_cents = '0'; cc.personal_pension_account_id = null;
      const snap = copy.snapshot.status === 'ready' ? copy.snapshot.value : null;
      for (const e of snap?.entries ?? []) if (e.kind === 'housing_fund' && e.account_id) {
        const rule = cc.fund_rules.find(x => x.account_id === e.account_id);
        if (rule) { rule.availability = 'excluded'; rule.share_hundredths = 0; } else cc.fund_rules.push({ account_id: e.account_id, availability: 'excluded', share_hundredths: 0 });
      }
    }
  }
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
