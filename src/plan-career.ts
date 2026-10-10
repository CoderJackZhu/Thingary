// Opt-in, read-only scenario compiler. No dependency from basic consumers or persistence.
import { annotationSummary, uniqueAnnotations } from './plan-annotations.ts';
import { prepareBasicPlan, solveBasicRequirement } from './plan-basic.ts';
import type { BasicPlanCompiler } from './plan-basic.ts';
import type { PlanningSources, CostScope } from './plan-basic-contract.ts';
import type { ContributionPeriod } from './plan-pension-path.ts';
import { pensionPeriodIssue } from './plan-pension-path.ts';
import { beijing, paramsFor } from './plan-params.ts';
import { monthIndex } from './plan-events.ts';
import { project, outcome } from './plan-ledger.ts';
import type { Plan, Flow, MonthAudit } from './plan-ledger.ts';
import { careerBlocked as blocked, careerIssue as issue, validCareerAmount as amount, validCareerMonth as month, careerMonth as ym } from './plan-career-contract.ts';
import type { CareerDraft, CareerStage, CareerIssue, CareerEvaluation, CareerCash } from './plan-career-contract.ts';

function stageIssues(stage: CareerStage, field: string): CareerIssue[] {
  const errors: CareerIssue[] = [];
  const label = field === 'gap' ? '空窗阶段' : '恢复阶段';
  if (stage.costs === null) errors.push(issue(`${field}.costs`, '请确认该阶段费用的包含范围。'));
  else for (const c of stage.costs) if (!['included', 'extra', 'excluded'].includes(c.treatment) || (c.treatment === 'included' && !amount(c.reference_cents))) errors.push(issue(`${field}.costs`, '已含费用须有合法的非负参考额。'));
  if (!stage.pension) errors.push(issue(`${field}.pension`, `请确认${label}的缴费安排；每月能攒多少不决定停不停缴。`));
  if (typeof stage.pension === 'object' && stage.pension !== null && stage.pension.base_cents === '0') errors.push(issue(`${field}.pension`, '缴费基数须大于零；不缴费请明确选择停缴。'));
  if (typeof stage.pension === 'object' && stage.pension !== null && stage.pension.hpf_monthly_cents === '') errors.push(issue(`${field}.pension`, `请填写${label}的公积金每月入账合计；没有缴存请选择“本段不缴存”。`));
  if (!amount(stage.insurance.monthly_cents)) errors.push(issue(`${field}.insurance`, `请确认${label}的现金自缴费用，明确没有才填零。`));
  return errors;
}
function withCosts(sources: PlanningSources, costs: CostScope[]): PlanningSources {
  const copy = structuredClone(sources);
  if (copy.profile.status === 'ready' && copy.profile.value.saved?.profile.retire.basic) copy.profile.value.saved.profile.retire.basic.contribution_costs = structuredClone(costs);
  return copy;
}
function override(stage: CareerStage, from: string, to: string): ContributionPeriod[] {
  if (from >= to || !stage.pension || stage.pension === 'unchanged') return [];
  return [{ from_month: from, to_month: to, ...(stage.pension === 'pause' ? { base_cents: '0', hpf_monthly_cents: '0' } : stage.pension) }];
}
const clipped = (flows: Flow[], from: number, to: number): Flow[] => flows.map(f => ({ ...f, from_month: Math.max(from, f.from_month), to_month: Math.min(to, f.to_month ?? to) })).filter(f => f.from_month < f.to_month);

/** No sources or draft are mutated. Unknown recovery only blocks the long-term abilities. */
export function evaluateCareerScenario(sources: PlanningSources, draft: CareerDraft, options: { requirement?: 'calculate' | 'skip' } = {}): CareerEvaluation {
  const basic = prepareBasicPlan(sources, '0');
  const notes = ['职业条件仅用于本次比较，不改变基础计划。', '工作阶段只知道每月能攒多少；未完整检查这些区间的月内生活付款。', '空窗按月初支出、月底到账检查，金额为所示基准日购买力。'];
  const fail = (errors: CareerIssue[]): CareerEvaluation => ({ context: basic.context, model_version: 'career-prototype-1', annotations: basic.annotations, notes: [...annotationSummary(basic.annotations), ...notes], cash: blocked(errors), requirement: blocked(errors), prediction: blocked(errors) });
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  if (!p?.birth_month || !p.retire.basic || !basic.context.start.date) return fail(basic.plan.status === 'blocked' ? basic.plan.missing.map(m => issue(m.field, m.message)) : [issue('sources', '请先确认通用资料、出生年月和资金截至日。')]);
  const birth = monthIndex(p.birth_month), anchor = basic.context.start.date, now = monthIndex(anchor.slice(0, 7)) - birth;
  const r = p.retire, target = (r.target_age ?? r.horizon_age) * 12;
  if (!month(draft.transition_month)) return fail([issue('transition_month', '请确认变化月份与原退休目标。')]);
  const transition = monthIndex(draft.transition_month) - birth;
  if (transition < now || transition >= target) return fail([issue('transition_month', '变化须在资金起点当月或之后，且早于原目标退休月。')]);
  if (draft.gap_months !== null && (!Number.isInteger(draft.gap_months) || draft.gap_months < 0 || draft.gap_months > 1200)) return fail([issue('gap_months', '空窗月数须为0至1200的整数，未知可留空。')]);
  const recovery = draft.gap_months === null ? null : transition + draft.gap_months;
  if (recovery === null && !month(draft.check_until_month)) return fail([issue('check_until_month', '恢复时间未知，请选择局部检查的结束月份。')]);
  const gapEnd = Math.min(recovery ?? monthIndex(draft.check_until_month!) - birth, target);
  if (gapEnd < transition || (recovery === null && gapEnd === transition)) return fail([issue('check_until_month', '检查结束月须晚于变化月。')]);
  if (recovery !== null && recovery > target) notes.push('恢复晚于原目标；空窗检查仅覆盖到目标月之前。');
  const hasGap = gapEnd > transition;
  const errors = hasGap ? stageIssues(draft.gap, 'gap') : [];
  if (hasGap && (!amount(draft.gap.income_cents) || !amount(draft.gap.spend_cents))) errors.push(issue('gap', '请分别确认空窗可靠到账与开销，未知不能作为零。'));
  const extra = draft.gap.extra_income;
  if (extra) {
    const benefit = extra.benefit_monthly_cents !== null && Number(extra.benefit_monthly_cents) > 0;
    if ((extra.lump_cents !== null && !amount(extra.lump_cents)) || (extra.benefit_monthly_cents !== null && !amount(extra.benefit_monthly_cents))) errors.push(issue('gap.extra_income', '补偿金和限期补助须是合法非负整数分，没有就留空。'));
    else if ((benefit && (extra.benefit_months === null || extra.benefit_months < 1)) || (extra.benefit_months !== null && extra.benefit_months > 0 && extra.benefit_monthly_cents === null)) errors.push(issue('gap.extra_income', '启用限期补助须同时确认金额和领取月数上限，不能把缺项当零。'));
    if (extra.benefit_months !== null && (!Number.isInteger(extra.benefit_months) || extra.benefit_months < 0 || extra.benefit_months > 1200)) errors.push(issue('gap.extra_income', '限期补助月数上限须是0至1200的整数；提前恢复时停止计入。'));
  }
  const lumps = draft.lumps ?? [];
  if (lumps.length > 24) errors.push(issue('lumps', '一次性到账最多填 24 笔。'));
  for (const l of lumps) {
    if (!month(l.month) || !amount(l.cents)) errors.push(issue('lumps', '一次性到账须有合法的月份和非负金额，没有就删掉这一行。'));
    else if (monthIndex(l.month) - birth < now || monthIndex(l.month) - birth >= target || (l.month === anchor.slice(0, 7) && +anchor.slice(8, 10) === new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate())) errors.push(issue('lumps', `${l.month} 不在资金截至日之后、原目标之前；已到账金额请计入起点资产，不在此重复录入。`));
  }
  if (draft.floor_cents !== null && !amount(draft.floor_cents)) errors.push(issue('floor_cents', '底线须为合法非负整数分，或留空。'));
  const current = r.basic!.contribution.monthly_cents;
  const days = new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate();
  const needsCurrent = transition > now + (+anchor.slice(8, 10) === days ? 1 : 0);
  if (needsCurrent && !amount(current, true)) errors.push(issue('current_contribution', '变化前每月能攒多少还不知道，不能推算未来的起点资金。'));
  if (errors.length) return fail(errors);
  const recoveryErrors = recovery !== null && recovery < target ? stageIssues(draft.recovery, 'recovery') : [];
  const recoveryPeriods = recovery !== null && recovery < target && !recoveryErrors.length ? override(draft.recovery, ym(birth + recovery), ym(birth + target)) : [];
  const recoveryPeriodIssue = pensionPeriodIssue(recoveryPeriods, (paramsFor(p, sources.today) ?? beijing));
  if (recoveryPeriodIssue) recoveryErrors.push(issue('recovery.pension', recoveryPeriodIssue));
  const periods = [ ...(hasGap ? override(draft.gap, draft.transition_month, ym(birth + gapEnd)) : []),
    ...(!recoveryErrors.length ? recoveryPeriods : []) ];
  const prepare = (source: PlanningSources) => {
    const complete = prepareBasicPlan(source, '0', periods);
    if (complete.plan.status === 'ready') return complete;
    recoveryErrors.push(...complete.plan.missing.map(m => issue(m.field, m.message)));
    // Missing retirement-only inputs must not erase an otherwise known gap check.
    return prepareBasicPlan(source, '0', periods, 'accumulation');
  };
  const postInputReady = !recoveryErrors.length;
  const pre = transition > now ? prepare(sources) : null;
  const gap = hasGap ? prepare(withCosts(sources, draft.gap.costs!)) : null;
  const post = recovery !== null && recovery < target && postInputReady ? prepare(withCosts(sources, draft.recovery.costs!)) : null;
  const first = transition > now ? pre : (hasGap ? gap : post);
  for (const prepared of [first, ...(hasGap ? [gap] : [])]) if (!prepared || prepared.plan.status === 'blocked') return fail(prepared?.plan.status === 'blocked' ? prepared.plan.missing.map(m => issue(m.field, m.message)) : [issue('recovery', '恢复阶段条件未完整确认。')]);
  if (post?.plan.status === 'blocked') recoveryErrors.push(...post.plan.missing.map(m => issue(`recovery.${m.field}`, m.message)));
  const used = [transition > now ? pre : null, hasGap ? gap : null, recovery !== null && recovery < target ? post : null];
  const annotations = uniqueAnnotations(used.flatMap(p => p?.annotations ?? []));
  notes.unshift(...annotationSummary(annotations));
  const initial = first!.plan.status === 'ready' ? first!.plan.value : null;
  if (!initial) return fail([issue('sources', '资料不完整，暂时无法试算。')]);
  const gapCompiler = gap?.plan.status === 'ready' ? gap.plan.value : null;
  const postCompiler = post?.plan.status === 'ready' ? post.plan.value : null;
  if (hasGap && gapCompiler && Number(draft.gap.spend_cents) < gapCompiler.included_reference_cents + (draft.gap.insurance.included ? Number(draft.gap.insurance.monthly_cents) : 0)) return fail([issue('gap.spend_cents', '空窗已含费用参考额超过总开销，请核对范围。')]);
  const before = initial.before, after = initial.after;
  const skeleton = { ...initial.compile(0, before, after), annotations };
  const compile = (candidate: number, rb = before, ra = after): Plan => {
    const flow: Flow[] = [];
    const append = (compiler: BasicPlanCompiler, from: number, to: number, stage?: CareerStage) => {
      flow.push(...clipped(compiler.compile(0, rb, ra).saving_flows ?? [], from, to));
      if (stage) {
        const cost = Number(stage.insurance.monthly_cents);
        flow.push({ label: '本次自缴现金费用', from_month: from, to_month: to, cents: -cost, nominal: false, essential: true, timing: 'start', prorate_first: true });
        if (stage.insurance.included) flow.push({ label: '自缴已含金额还原', from_month: from, to_month: to, cents: cost, nominal: false, essential: false, prorate_first: true });
      }
    };
    if (transition > now) append(initial, now, transition);
    if (hasGap && gapCompiler) {
      append(gapCompiler, transition, gapEnd, draft.gap);
      const benefitMonths = Math.min(extra?.benefit_months ?? 0, gapEnd - transition);
      if (extra?.benefit_monthly_cents && Number(extra.benefit_monthly_cents) > 0 && benefitMonths > 0) flow.push({ label: '空窗期限期补助', from_month: transition, to_month: transition + benefitMonths, cents: Number(extra.benefit_monthly_cents), nominal: false, essential: false });
      const ordinary = Number(draft.gap.spend_cents) - gapCompiler.included_reference_cents - (draft.gap.insurance.included ? Number(draft.gap.insurance.monthly_cents) : 0);
      // The paired flows add timing, not another expense: net gap already contains it.
      flow.push({ label: '空窗普通开销月初支付', from_month: transition, to_month: gapEnd, cents: -ordinary, nominal: false, essential: true, timing: 'start', prorate_first: true },
        { label: '空窗时点还原', from_month: transition, to_month: gapEnd, cents: ordinary, nominal: false, essential: false, prorate_first: true });
    }
    // One-off inflows the user entered (share vesting, bonuses): end of their month, independent of the candidate.
    for (const l of lumps) if (Number(l.cents) > 0) { const at = monthIndex(l.month) - birth; flow.push({ label: '一次性到账', from_month: at, to_month: at + 1, cents: Number(l.cents), nominal: false, essential: false }); }
    // A lump sum (severance) arrives with the change itself, with or without a gap.
    if (extra?.lump_cents && Number(extra.lump_cents) > 0) flow.push({ label: '变化时一次性到账', from_month: transition, to_month: transition + 1, cents: Number(extra.lump_cents), nominal: false, essential: false });
    if (postCompiler && recovery !== null && recovery < target) append(postCompiler, recovery, target, draft.recovery);
    return { ...skeleton, mode: 'traditional', r_before_hundredths: rb, r_after_hundredths: ra, saving_cents: 0, saving_flows: flow,
      saving_phases: [{ from_month: now, cents: Number(current ?? 0) }, { from_month: transition, cents: hasGap ? Number(draft.gap.income_cents) - Number(draft.gap.spend_cents) : candidate }, ...(hasGap ? [{ from_month: gapEnd, cents: candidate }] : [])] };
  };
  return finishCareer(basic.context, draft, notes, birth, transition, gapEnd, recovery, target, compile, recoveryErrors, options.requirement !== 'skip');
}

function finishCareer(context: CareerEvaluation['context'], draft: CareerDraft, notes: string[], birth: number, transition: number, gapEnd: number, recovery: number | null, target: number, compile: (n: number, rb?: number, ra?: number) => Plan, recoveryErrors: CareerIssue[], calculateRequirement: boolean): CareerEvaluation {
  const zero = compile(0), audit: MonthAudit[] = [];
  const year = Number(zero.anchor_date!.slice(0, 4));
  if (![zero.r_before_hundredths, zero.r_after_hundredths].every(r => Number.isFinite(r) && r >= -1000 && r <= 2000)) {
    const errors = [issue('returns', '收益条件超出当前合法范围，未运行本次情景。')];
    return { context, model_version: 'career-prototype-1', annotations: zero.annotations, notes, cash: blocked(errors), requirement: blocked(errors), prediction: blocked(errors) };
  }
  project(zero, year, { onMonth: p => audit.push(p) });
  const negative = (p: MonthAudit) => Math.min(p.start_cents, p.after_payments_cents, p.after_unlock_cents, p.end_cents) < 0;
  const priorFailure = audit.find(p => p.month < transition && negative(p));
  let cash: CareerEvaluation['cash'];
  let cashValue: CareerCash | null = null;
  if (gapEnd === transition) cash = blocked([issue('gap_months', '本条件没有空窗区间。')]);
  else if (!draft.liquid_funds_confirmed) cash = blocked([issue('liquid_funds_confirmed', '资金可及时动用的条件未确认，不能给付款安全结论。')]);
  else if (priorFailure) cash = blocked([issue('funds', `空窗开始前的${ym(birth + priorFailure.month)}已出现已知资金不足。`)]);
  else {
    let minimum = Infinity, failure: number | null = null, floor: number | null = null;
    for (const point of audit.filter(p => p.month >= transition && p.month < gapEnd)) {
      const low = Math.min(point.start_cents, point.after_payments_cents, point.after_unlock_cents, point.end_cents);
      minimum = Math.min(minimum, low);
      if (floor === null && draft.floor_cents !== null && low <= Number(draft.floor_cents)) floor = point.month;
      if (low < 0) { failure = point.month; break; }
    }
    cashValue = { from_month: ym(birth + transition), until_month: ym(birth + gapEnd), budget_scope: draft.gap.budget_scope,
      minimum_cents: String(Math.round(minimum)), first_shortfall_month: failure === null ? null : ym(birth + failure), floor_month: floor === null ? null : ym(birth + floor), timing: 'expenses_first_income_last' };
    cash = { status: 'ready', value: cashValue };
  }
  const errors = [...recoveryErrors];
  if (recovery === null) errors.push(issue('gap_months', '恢复时间未知；仅检查明确的空窗期间，不计算长期目标需求。'));
  if (gapEnd > transition && draft.gap.budget_scope !== 'complete') errors.push(issue('gap.budget_scope', '目前只确认必要开销；完整目标需求还需要空窗总开销。'));
  let requirement: CareerEvaluation['requirement'];
  if (errors.length) requirement = blocked(errors);
  else if (recovery! >= target) requirement = { status: 'ready', value: { status: 'no_recovery_interval', message: '原目标前没有恢复后的积累区间，不能反求这段月投入。' } };
  else {
    // At recovery, only payments BEFORE the first candidate deposit are immutable.
    const prefix = audit.find(p => p.month < recovery! ? negative(p) : p.month === recovery && Math.min(p.start_cents, p.after_payments_cents) < 0);
    if (prefix) requirement = { status: 'ready', value: { status: 'prefix_payment_gap', message: `${ym(birth + prefix.month)}的已知付款不足不能用之后的月投入补救。` } };
    else if (cashValue?.floor_month && Number(cashValue.minimum_cents) < Number(draft.floor_cents)) requirement = { status: 'ready', value: { status: 'prefix_floor_breach', message: '空窗资金已低于本次设定底线；后续投入不能改变这段条件。' } };
    else if (!calculateRequirement) requirement = blocked([issue('requirement', '本次候选只检查给定投入，不执行需求反求。')]);
    else requirement = { status: 'ready', value: solveBasicRequirement(compile, zero.r_before_hundredths, zero.r_after_hundredths) };
  }
  const predictionIssue = recovery !== null && recovery >= target
    ? issue('gap_months', '原目标前没有恢复后的积累区间，不计算这段投入预测。')
    : issue('recovery.monthly_cents', draft.recovery.monthly_cents === null ? '你估计的找到新工作后每月能攒多少还没填；算出的“至少要攒多少”不会自动当成你的收入。' : '你估计的找到新工作后每月能攒多少须是合法整数分，可以是零或负数（负数表示每月要动用存款）。');
  let prediction: CareerEvaluation['prediction'] = blocked(errors.length ? errors : [predictionIssue]);
  if (!errors.length && recovery !== null && recovery < target && amount(draft.recovery.monthly_cents, true)) {
    const plan = compile(Number(draft.recovery.monthly_cents)), projection = project(plan, year);
    prediction = { status: 'ready', value: { plan, projection, outcome: outcome(plan, projection) } };
  }
  if (draft.floor_cents !== null && !draft.liquid_funds_confirmed) {
    notes.push('底线因可动用条件未确认而未检查，目标需求不代表底线已满足。');
  }
  if (cashValue?.first_shortfall_month) notes.push('最低金额截至首次不足；负数表示按条件推演的缺口，不代表已借入资金。');
  return { context, model_version: 'career-prototype-1', annotations: zero.annotations, notes, cash, requirement, prediction };
}
