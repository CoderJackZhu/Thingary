import type { RetireInputs, StoredSavingPhase } from './plan.ts';
import { costSources, emptyCore } from './plan-core.ts';
import type { PlanningCore } from './plan-core.ts';
import type { Snapshot } from './wealth.ts';

export type SetupPhase = { id: string; label: string; from_age_months: number; monthly: string };
/** Suggestions live only in the dialog until explicit confirmation. Historical rows are never saving inputs. */
export function setupCore(r: RetireInputs, snapshot: Snapshot | null, today: string): PlanningCore {
  const core = structuredClone(r.core ?? emptyCore(today));
  for (const e of snapshot?.entries ?? []) if (e.counted && e.side === 'asset' && !core.fund_rules.some(f => f.account_id === e.account_id)) {
    core.fund_rules.push({ account_id: e.account_id, availability: e.kind === 'cash' ? 'available' : 'restricted', share_hundredths: 10000 });
  }
  return core;
}
/** Save only the planning profile. Preserve occurrence/payment/loan facts and all event IDs. */
export function finishSetup(r: RetireInputs, core: PlanningCore, phases: SetupPhase[], annual: string, nowMonths: number): RetireInputs {
  validateSetupGoal(r, nowMonths);
  return finishStages(r, core, phases, annual, nowMonths);
}
export function validateSetupGoal(r: RetireInputs, nowMonths: number) {
  if (!Number.isInteger(r.target_age) || r.target_age < 20 || r.target_age * 12 <= nowMonths || r.target_age > 109) throw new Error('目标年龄须至少 20 岁、晚于当前年龄，且不超过 109 岁。');
  if (!Number.isInteger(r.horizon_age) || r.horizon_age < 70 || r.horizon_age > 110 || r.horizon_age <= r.target_age) throw new Error('规划终点须为 70 到 110 岁，并晚于目标年龄。');
  if (r.spend_cents == null || !/^\d+$/.test(r.spend_cents) || BigInt(r.spend_cents) <= 0n) throw new Error('请明确填写大于 0 的退休后每月生活预算。');
  if (!Number.isInteger(r.emergency_months) || r.emergency_months < 0 || r.emergency_months > 36) throw new Error('应急金须为 0 到 36 个月。');
}
function finishStages(r: RetireInputs, core: PlanningCore, phases: SetupPhase[], annual: string, nowMonths: number): RetireInputs {
  if (!phases.length) throw new Error('请设置从现在开始的未来净投入。');
  const saving_phases: StoredSavingPhase[] = phases.map((p, i) => {
    if (!p.label.trim()) throw new Error('请填写阶段名称。');
    if (!/^-?\d+$/.test(p.monthly) || !Number.isSafeInteger(Number(p.monthly))) throw new Error(`${p.label}：请填写每月净投入；未知不能当作 0。`);
    if (!Number.isInteger(p.from_age_months) || (i === 0 ? p.from_age_months !== 0 : p.from_age_months <= Math.max(nowMonths, phases[i - 1].from_age_months)) || p.from_age_months >= r.target_age * 12) throw new Error('第一阶段从现在开始；后续阶段须依年龄递增并早于目标年龄。');
    return { id: p.id, label: p.label.trim(), from_age_months: p.from_age_months, monthly_cents: Number(p.monthly) };
  });
  for (const rule of core.fund_rules) if (!Number.isInteger(rule.share_hundredths) || rule.share_hundredths < 0 || rule.share_hundredths > 10000) throw new Error('账户参与比例须为 0 到 100%。');
  if (core.personal_pension_account_id && !core.fund_rules.some(f => f.account_id === core.personal_pension_account_id && f.availability === 'restricted' && f.share_hundredths === 10000)) throw new Error('个人养老金必须关联参与比例为 100% 的受限账户。');
  if (core.hpf_monthly_cents === null || !/^\d+$/.test(core.hpf_monthly_cents)) throw new Error('请确认未来公积金月缴存；不计未来缴存请明确填 0。');
  if ((Number(annual) > 0 || core.personal_pension_account_id) && !core.personal_pension_balance_confirmed) throw new Error('请核对已有个人养老金余额。');
  const sources = costSources(r.life_events.filter(e => e.included || core.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')), annual);
  for (const phase of saving_phases) for (const source of sources) {
    const rule = core.costs.find(c => c.phase_id === phase.id && c.source_id === source.id);
    if (!rule) throw new Error(`${phase.label}：请核对「${source.label}」是否已含在净投入中。`);
    if (rule.included && !/^\d+$/.test(rule.reference_cents)) throw new Error(`${source.label}：请填写已含参考额。`);
  }
  return { ...structuredClone(r), setup_completed: true, route_id: null, saving_phases, core: { ...structuredClone(core), costs: core.costs.filter(c => saving_phases.some(p => p.id === c.phase_id)) } };
}
