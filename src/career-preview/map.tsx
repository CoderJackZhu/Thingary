// Development-only question panels for the career preview: rest, lower contribution, insurance, retirement age. Fictional sources; nothing is stored.
import { useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { beijing } from '../plan-params.ts';
import { ageMonthsAt, careerSpan, closeMonths, delayTarget, minWindow, pensionOptions, windowMap } from '../plan-career-map.ts';
import type { DelayTarget, MaxGap, MinWindow, PensionChoice, Reason } from '../plan-career-map.ts';
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { money } from './result-text.ts';
import './map.css';

export type Question = 'rest' | 'lower' | 'switch';

/** Optional one-off inflows (share vesting, a large bonus, a side job), each in its own month. */
export function LumpsSection({ draft, patch }: { draft: CareerDraft; patch: (v: Partial<CareerDraft>) => void }) {
  const lumps = draft.lumps ?? [];
  const set = (next: NonNullable<CareerDraft['lumps']>) => patch({ lumps: next });
  return <section className="career-input"><h3>另有的大额一次性收入（选填）</h3>
    <p className="career-footnote">股票归属、大额奖金、兼职等，仅填资金截至日之后明确假设会到账、且不在月储蓄中的税后金额。已在起点资产里的钱不要再填；未确定的股权和奖金不计入。</p>
    {lumps.map((l, i) => <div key={i} className="career-lump"><MonthInput label={`第 ${i + 1} 笔到账月份`} value={l.month} onChange={v => set(lumps.map((o, j) => (j === i ? { ...o, month: v } : o)))}/><CentInput label={`第 ${i + 1} 笔金额`} placeholder="金额（元）" value={l.cents} onChange={v => set(lumps.map((o, j) => (j === i ? { ...o, cents: v } : o)))}/><button type="button" aria-label={`删除第 ${i + 1} 笔`} onClick={() => set(lumps.filter((_, j) => j !== i))}>删除</button></div>)}
    <button type="button" disabled={lumps.length >= 24} onClick={() => set([...lumps, { month: draft.transition_month ?? '', cents: '' }])}>添加一笔</button>
  </section>;
}
type Patch = (v: Partial<CareerDraft>) => void;
type Props = { sources: PlanningSources; draft: CareerDraft; patch: Patch };

const wan = (cents: number) => `¥${(cents / 1_000_000).toFixed(1)}万`;
const span = (months: number) => `${Math.floor(months / 12)} 年 ${months % 12} 个月`;
const reasonText: Record<Reason, string> = { goal: '目标时资产不够', cash: '空窗中资金先不够', prefix: '已知付款先不够，后面的收入补不回来' };
const profileOf = (s: PlanningSources) => (s.profile.status === 'ready' ? s.profile.value.saved?.profile ?? null : null);
const ageText = (s: PlanningSources, ym: string) => { const m = ageMonthsAt(s, ym); return m === null ? ym : `${ym}（${Math.floor(m / 12)} 岁 ${m % 12} 个月）`; };

const questions: { id: Question; title: string; hint: string }[] = [
  { id: 'rest', title: '保持退休目标，最长可空窗多久？', hint: '按你假设的复工后储蓄，检查现金与原退休目标；不是只看存款能花多久' },
  { id: 'lower', title: '再做多久，才可以降低投入？', hint: '高收入还要做到哪个月，之后每月少攒也不影响退休目标' },
  { id: 'switch', title: '换工作后，每月至少要攒多少？', hint: '换成别的工作或有一段空窗之后，每月最少要攒多少才能保住目标' },
];
export function QuestionPicker({ value, onChange }: { value: Question; onChange: (q: Question) => void }) {
  return <section className="career-questions" aria-label="想知道什么"><h2>你想知道什么？</h2>
    <div role="radiogroup" aria-label="想知道什么" className="career-question-grid">{questions.map(q => <label key={q.id} className={`career-question${value === q.id ? ' on' : ''}`}><input type="radio" name="career-question" checked={value === q.id} onChange={() => onChange(q.id)}/><strong>{q.title}</strong><small>{q.hint}</small></label>)}</div>
  </section>;
}

export function minText(s: PlanningSources, x: MinWindow): string {
  if (x.status === 'found') return `高收入至少要持续到 ${ageText(s, x.close_month)} 之前（约 ${span(x.months)}）`;
  if (x.status === 'already_met') return '现在关闭也满足目标';
  return x.message;
}
export function gapText(x: MaxGap): string {
  if (x.status === 'found' && x.ranges) return `可行空窗：${x.ranges.map(r => r.from === r.to ? `${r.from} 个月` : `${r.from}—${r.to} 个月`).join('、')}；最大 ${x.months} 个月，不能认为更短都满足。`;
  if (x.status === 'found') return `最多能空窗 ${x.months} 个月（${x.limit === 'end' ? '已到本次搜索上限，不向目标以后外推' : `再长：${reasonText[x.limit]}`}）`;
  if (x.status === 'none') return `检查范围内未找到可行空窗：${x.reason ? reasonText[x.reason] : '条件未齐全'}`;
  return x.message;
}
function delayText(x: DelayTarget): string {
  if (x.status === 'found') return `按这个条件原目标满足不了；逐岁检查中最早在 ${x.age} 岁满足（比原目标晚 ${x.delay_years} 年）`;
  if (x.status === 'already_met') return '原目标就能满足，不用推迟';
  if (x.status === 'not_found') return `推迟到 ${x.up_to_age} 岁也满足不了`;
  return x.message;
}

/** Retirement-age concession for the draft as filled in (needs the post-change savings estimate). */
export function DelaySection({ sources, draft }: Props) {
  const r = useMemo(() => delayTarget(sources, draft), [sources, draft]);
  return <section className="career-input"><h3>推迟目标后的逐岁对照</h3><p className="career-line">{delayText(r)}</p>
    <p className="career-footnote">只是和原目标并排看，不会改你的目标。每次检查相隔一年，不是精确到月的最早退休日。缴费仍限于原来确认的起止月份；这里没有延长缴费安排。</p></section>;
}

type Stage = 'gap' | 'recovery';
type Method = '' | 'pause' | 'self' | 'employer';
type Base = 'floor' | 'original' | 'custom';
type Selection = { method: Method; base: Base; custom: string };
const blankSelection = (): Selection => ({ method: '', base: 'floor', custom: '' });

function InsuranceComparison({ sources, draft, stage }: { sources: PlanningSources; draft: CareerDraft; stage: Stage }) {
  const [kind, setKind] = useState('pause'), [cash, setCash] = useState<string | null>(null);
  const original = profileOf(sources)?.base_cents;
  const active = draft[stage];
  const choices: PensionChoice[] = [
    { label: '当前填写', pension: active.pension ?? 'pause', cash_cents: active.insurance.monthly_cents, included: active.insurance.included, blocked: active.pension === null ? '请先填完整上面的缴费安排。' : undefined },
    { label: '对照交法', pension: kind === 'pause' ? 'pause' : kind === 'employer' ? 'unchanged' : { base_cents: kind === 'original' ? original! : beijing.base_lower_cents, hpf_monthly_cents: '0' }, cash_cents: kind === 'pause' || kind === 'employer' ? '0' : cash, included: active.insurance.included },
  ];
  const result = useMemo(() => pensionOptions(sources, draft, stage, choices), [sources, draft, stage, kind, cash]);
  return <div>
    <p className="career-footnote">这里只比较，不改变上面的填写和主答案。沿用“是否已包含”的选择；已包含时总开销或储蓄保持不变。</p>
    <FormRow label="对照交法"><select aria-label="对照交法" value={kind} onChange={e => { setKind(e.target.value); setCash(null); }}><option value="pause">停缴养老及公积金</option><option value="floor">自己交，按下限</option>{original && <option value="original">自己交，按原基数</option>}{stage === 'recovery' && <option value="employer">单位缴纳，沿用原安排</option>}</select></FormRow>
    {(kind === 'floor' || kind === 'original') && <FormRow label="对照交法：每月实际缴费（元）"><CentInput label="对照每月实际缴费" value={cash ?? ''} onChange={v => setCash(v || null)}/></FormRow>}
    <div className="career-table-wrap"><table className="career-table"><caption>按变化月 {draft.transition_month ?? "待确认"}、固定空窗 {draft.gap_months ?? "未知"} 个月比较；不反求最长空窗。更换主方案请修改上方表单。</caption><thead><tr><th>条件</th><th>这段实际缴费合计</th><th>目标时月养老金</th><th>目标时资产</th></tr></thead><tbody>{result.rows.map(r => <tr key={r.label}><th>{r.label}</th><td>{r.stage_cash_cents === null ? '待填' : money(r.stage_cash_cents)}</td><td>{r.pension ? r.pension.eligible ? money(r.pension.monthly_cents) : `缴费资格还差 ${r.pension.short_months} 个月` : '—'}</td><td>{r.assets_at_goal_cents === null ? r.judgement.issues[0] ?? '本例未计入' : money(r.assets_at_goal_cents)}</td></tr>)}</tbody></table></div>
  </div>;
}

/** One active form, immediately reflected in the shared draft. Other choices are optional comparisons. */
export function InsuranceSection({ sources, draft, patch }: Props) {
  const [stage, setStage] = useState<Stage>('gap');
  const [selection, setSelection] = useState<Record<Stage, Selection>>({ gap: blankSelection(), recovery: blankSelection() });
  const form = selection[stage], active = draft[stage], p = profileOf(sources);
  const floor = beijing.base_lower_cents, original = p?.base_cents ?? null;
  const customValid = /^\d+$/.test(form.custom) && Number(form.custom) >= Number(floor) && Number(form.custom) <= Number(beijing.base_upper_cents);
  const setForm = (next: Selection, resetCash = false) => {
    setSelection(x => ({ ...x, [stage]: next }));
    const base = next.base === 'floor' ? floor : next.base === 'original' ? original : next.custom;
    const valid = base !== null && /^\d+$/.test(base) && Number(base) >= Number(floor) && Number(base) <= Number(beijing.base_upper_cents);
    const pension = next.method === '' ? null : next.method === 'pause' ? 'pause' : next.method === 'employer' && next.base === 'original' ? 'unchanged' : valid ? { base_cents: base!, hpf_monthly_cents: '0' } : null;
    const insurance = resetCash ? { monthly_cents: next.method === 'pause' || next.method === 'employer' ? '0' : null, included: next.method === 'self' ? active.insurance.included : true } : active.insurance;
    patch({ [stage]: { ...active, pension, insurance } } as Partial<CareerDraft>);
  };
  const setInsurance = (insurance: typeof active.insurance) => patch({ [stage]: { ...active, insurance } } as Partial<CareerDraft>);
  const summary = (s: Stage) => {
    const x = draft[s], f = selection[s];
    if (!x.pension || x.insurance.monthly_cents === null) return '待填完整';
    if (f.method === 'pause') return '停缴，本项支出 0 元';
    if (f.method === 'employer') return '单位缴纳，个人部分已从工资扣除';
    return `自己交 ${money(x.insurance.monthly_cents)} / 月，${x.insurance.included ? '已含在开销或储蓄中' : '额外支付'}`;
  };
  return <section className="career-input career-insurance" id="career-insurance"><h2>社保怎么交</h2>
    <p className="career-footnote">交法会计入下方唯一的试算结果。缴费基数用于估算养老金；每月实际缴费用于计算你花出去的钱。</p>
    <FormRow label="设置哪段时间"><select aria-label="设置哪段时间" value={stage} onChange={e => setStage(e.target.value as Stage)}><option value="gap">不工作的这段时间</option><option value="recovery">恢复工作以后</option></select></FormRow>
    <FormRow label="这段时间怎么交"><select aria-label="这段时间怎么交" value={form.method} onChange={e => { const method = e.target.value as Method; setForm({ method, base: method === 'employer' && original ? 'original' : 'floor', custom: '' }, true); }}>
      <option value="">请选择交法</option><option value="pause">停缴养老及公积金</option><option value="self">自己交（灵活就业）</option>{stage === 'recovery' && <option value="employer">单位缴纳</option>}
    </select></FormRow>
    {(form.method === 'self' || form.method === 'employer') && <>
      <FormRow label="缴费基数" hint="这是计算养老缴费的基数，不是你每个月实际付的钱。"><select aria-label="缴费基数选择" value={form.base} onChange={e => setForm({ ...form, base: e.target.value as Base })}>
        <option value="floor">按下限 {money(floor)}</option>{original && <option value="original">沿用原基数 {money(original)}</option>}<option value="custom">自定义基数</option>
      </select></FormRow>
      {form.base === 'custom' && <FormRow label="自定义缴费基数（元/月）" hint={`本例范围 ${money(floor)}—${money(beijing.base_upper_cents)}`}><CentInput label="自定义缴费基数" value={form.custom} onChange={v => setForm({ ...form, custom: v })}/>{!customValid && <p className="career-footnote" role="status">请填写范围内的基数，填好后才能计算。</p>}</FormRow>}
      {form.method === 'self' ? <>
        <FormRow label="每月实际缴费（元）" hint="按缴费单填写养老、医疗等实际扣款总额；基数不会自动换算成这笔金额。"><CentInput label="每月实际缴费" value={active.insurance.monthly_cents ?? ''} onChange={v => setInsurance({ ...active.insurance, monthly_cents: v || null })}/></FormRow>
        <FormRow label={stage === 'gap' ? '前面的每月总开销包含这笔缴费吗？' : '前面的每月能攒多少，已经扣掉这笔缴费了吗？'}><select aria-label="缴费是否已包含" value={active.insurance.included ? 'included' : 'extra'} onChange={e => setInsurance({ ...active.insurance, included: e.target.value === 'included' })}><option value="included">已经包含，只计算一次</option><option value="extra">还没包含，另外扣除</option></select></FormRow>
        <p className="career-footnote">{active.insurance.monthly_cents === null ? '实际缴费还没填写，不会按 0 元计算。' : stage === 'gap' && draft.gap.spend_cents !== null ? `前面开销 ${money(draft.gap.spend_cents)} / 月${active.insurance.included ? ` 已含社保 ${money(active.insurance.monthly_cents)}，仍按 ${money(draft.gap.spend_cents)} 计算。` : ` + 社保 ${money(active.insurance.monthly_cents)}，合计 ${money(Number(draft.gap.spend_cents) + Number(active.insurance.monthly_cents))} / 月。`}` : active.insurance.included ? '沿用你填写的月储蓄，不再扣一次社保。' : `从你填写的月储蓄中另扣 ${money(active.insurance.monthly_cents)}。`}</p>
      </> : <p className="career-footnote">按工资已经扣除个人社保后的结余填写“每月能攒多少”；这里不再额外扣费。沿用原基数时也沿用原缴费起止安排。</p>}
    </>}
    {form.method === 'pause' && <p className="career-footnote">本次按养老、公积金停缴且本项支出为 0 元计算；若仍单独交医保，请把医保费用计入前面的总开销。已缴记录保留，未来缴费月数不再增加。</p>}
    <div className="career-insurance-summary" aria-label="两段缴费摘要">
      <h3>已填的缴费条件</h3>
      <ul className="career-footnote"><li>不工作期间：{summary('gap')}</li><li>恢复工作以后：{summary('recovery')}</li></ul>
      {(draft.recovery.pension === null || draft.recovery.insurance.monthly_cents === null) && stage === 'gap' && <button type="button" onClick={() => setStage('recovery')}>填写恢复工作后的社保</button>}
      {(draft.gap.pension === null || draft.gap.insurance.monthly_cents === null) && stage === 'recovery' && <button type="button" onClick={() => setStage('gap')}>填写不工作期间的社保</button>}
      <a href="#career-results">查看试算结果 ↓</a>
    </div>
    <details className="career-rules"><summary>已核实的社保规则（2026-10-08 查官方原文）</summary><ul>
      <li>按月领取基本养老金的最低缴费年限：<strong>从 2030 年 1 月 1 日起由 15 年逐步提高到 20 年，每年提高 6 个月</strong>。<a href="https://www.mot.gov.cn/hudong/xiangguanziliao/202601/t20260114_4197321.html" target="_blank" rel="noreferrer">国务院办法（交通运输部转载）</a></li>
      <li>北京灵活就业人员的职工医保：<strong>首次参保，缴费之月起 6 个月后才享受待遇；断缴 3 个月内足额补缴视为连续（欠缴期间的医疗费补支），超过 3 个月再交，视为初次参保、重新等 6 个月</strong>。<a href="https://www.beijing.gov.cn/fuwu/bmfw/bmzt/lhjyry/202507/t20250709_4145235.html" target="_blank" rel="noreferrer">首都之窗·北京市医疗保障局，2025-07-09</a></li>
      <li>领失业保险金的条件包括“失业前用人单位和本人已缴纳失业保险费满一年”和“非因本人意愿中断就业”；<strong>领取期间的职工医保费由失业保险基金缴纳</strong>。<a href="https://rsj.beijing.gov.cn/xxgk/2024zcwj/202412/t20241227_3974931.html" target="_blank" rel="noreferrer">北京市失业保险金申领发放实施办法（试行）</a></li>
      <li><strong>没有核实到：</strong>灵活就业自己缴的失业保险，能不能按同样条件领失业金——该办法没有专门说明，请向北京市人社部门确认；退休后医保的累计缴费年限要求也没有核实。</li>
    </ul></details>
  </section>;
}

/** Question 1: how long can the user rest. */
export function RestQuestion({ sources, draft, patch }: Props) {
  const extra = draft.gap.extra_income ?? { lump_cents: null, benefit_monthly_cents: null, benefit_months: null };
  const setExtra = (v: Partial<typeof extra>) => patch({ gap: { ...draft.gap, extra_income: { ...extra, ...v } } });
  return <>
    <div className="career-layout"><section className="career-input"><h2>你的情况</h2>
      <FormRow label="从哪个月开始不工作"><MonthInput label="从哪个月开始不工作" value={draft.transition_month ?? ''} onChange={v => patch({ transition_month: v || null })}/></FormRow>
      <FormRow label="不工作期间，每月到账多少（元）" hint="如失业金以外的零活收入，税后；完全没有就填 0。"><CentInput label="不工作期间每月到账" value={draft.gap.income_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, income_cents: v || null } })}/></FormRow>
      <FormRow label="不工作期间，每月总共花多少（元）" hint="生活、房租、月供、自缴社保等全部花销。"><CentInput label="不工作期间每月花销" value={draft.gap.spend_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, spend_cents: v || null } })}/></FormRow>
      <FormRow label="你估计找到新工作后每月能攒多少（元）" hint="收入拿到手、扣完全部花销后每月剩下的钱；可以是 0 或负数。"><CentInput label="你估计找到新工作后每月能攒多少" signed value={draft.recovery.monthly_cents ?? ''} onChange={v => patch({ recovery: { ...draft.recovery, monthly_cents: v || null } })}/></FormRow>
      <details><summary>资金检查条件</summary><FormRow label="空窗资金底线（元）" hint="选填：期间不想让可动用资金低于多少。"><CentInput label="空窗资金底线" value={draft.floor_cents ?? ''} onChange={v => patch({ floor_cents: v || null })}/></FormRow>
        <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e => patch({ liquid_funds_confirmed: e.target.checked })}/>这笔资金可以及时取用（不勾选就无法检查空窗中的付款）</label></details>
    </section><section className="career-input">
      <h3>补偿金与限期补助（选填）</h3>
      <FormRow label="一次性到账（元）" hint="如离职补偿、未休假折现，税后；留空表示没有。到账记在开始不工作那个月月底。"><CentInput label="一次性到账" value={extra.lump_cents ?? ''} onChange={v => setExtra({ lump_cents: v || null })}/></FormRow>
      <FormRow label="限期补助每月（元）" hint="如失业金，税后；只在下面的月数内每月月底到账，要同时填月数上限；提前恢复后不再计入。"><CentInput label="限期补助每月" value={extra.benefit_monthly_cents ?? ''} onChange={v => setExtra({ benefit_monthly_cents: v || null })}/></FormRow>
      <FormRow label="补助领取月数上限"><input aria-label="补助领取月数上限" type="number" min="0" step="1" value={extra.benefit_months ?? ''} onChange={e => setExtra({ benefit_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
    </section></div>
    <LumpsSection draft={draft} patch={patch}/>
  </>;
}

/** Question 2: how long must the high-income window last. */
export function LowerQuestion({ draft, patch }: Props) {
  return <section className="career-input"><h2>降低投入后的条件</h2>
    <FormRow label="先空窗几个月" hint="留空表示未知；0 表示直接换工作。"><input aria-label="地图空窗月数" type="number" min="0" step="1" value={draft.gap_months ?? ''} onChange={e => patch({ gap_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
    <FormRow label="不工作期间，每月到账多少（元）"><CentInput label="不工作期间每月到账" value={draft.gap.income_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, income_cents: v || null } })}/></FormRow>
    <FormRow label="不工作期间，每月总共花多少（元）"><CentInput label="不工作期间每月花销" value={draft.gap.spend_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, spend_cents: v || null } })}/></FormRow>
    <FormRow label="之后每月能攒多少（元）"><CentInput label="之后每月能攒多少" signed value={draft.recovery.monthly_cents ?? ''} onChange={v => patch({ recovery: { ...draft.recovery, monthly_cents: v || null } })}/></FormRow>
    <FormRow label="详细对照采用哪个变化月" hint="最早月份由试算搜索；此处仅用于推迟目标与社保交法的对照。"><MonthInput label="对照变化月" value={draft.transition_month ?? ''} onChange={v => patch({ transition_month: v || null })}/></FormRow>
  </section>;
}

export function LowerResult({ sources, draft, patch }: Props) {
  const bounds = careerSpan(sources);
  const current = profileOf(sources)?.retire.basic?.contribution.monthly_cents;
  const [expanded, setExpanded] = useState(false);
  const candidates = current ? [0, .25, .5, .75].map(f => String(Math.round(Number(current) * f))) : [];
  const step = bounds ? Math.max(12, Math.ceil((bounds.target - bounds.now) / 8 / 12) * 12) : 12;
  const answer = useMemo(() => minWindow(sources, draft), [sources, draft]);
  const map = useMemo(() => expanded && bounds ? windowMap(sources, draft, closeMonths(sources, step), candidates) : null, [expanded, sources, draft, step, current]);
  return <>
    <h3>保持退休目标，最早何时可以降低投入？</h3><p className="career-number">{minText(sources, answer)}</p>
    <p className="career-footnote">逐月检查所填条件，只报告最早满足的一个月，不承诺更晚都满足。月数为起点至变化月的日历跨度，起点当月可能没有完整投入。</p>
    <details onToggle={e => setExpanded(e.currentTarget.open)}><summary>展开月份与投入的条件地图</summary>
      {map && <div className="career-table-wrap"><table className="career-table"><caption>候选投入取当前投入的 0%、25%、50%、75%，仅供条件对照；空窗及缴费沿用本次条件。每格仅代表该月份。</caption>
        <thead><tr><th>之后每月攒</th>{map.closes.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{map.rows.map((row, i) => <tr key={i}><th>{money(map.recoveries[i])}</th>{row.map(c => <td key={c.close_month} className={`career-cell career-${c.verdict}`} title={c.issues.join(' ')}>{c.verdict === 'meets' ? '满足所列条件' : c.verdict === 'blocked' ? '待补条件' : c.reason === 'goal' ? `差 ${wan(c.shortfall_cents ?? 0)}` : '已知资金限制'}</td>)}</tr>)}</tbody>
      </table></div>}
    </details>
    <details><summary>推迟退休目标的对照</summary><DelaySection sources={sources} draft={draft} patch={patch}/></details>
  </>;
}

export function InsuranceAlternatives({ sources, draft }: Pick<Props, 'sources' | 'draft'>) {
  const [expanded, setExpanded] = useState(false);
  const [stage, setStage] = useState<Stage>('gap');
  return <details onToggle={e => setExpanded(e.currentTarget.open)}><summary>固定空窗长度，比较其他交法（选看）</summary>
    {expanded && <>
      <FormRow label="比较哪段时间"><select aria-label="比较哪段时间" value={stage} onChange={e => setStage(e.target.value as Stage)}><option value="gap">不工作期间</option><option value="recovery">恢复工作以后</option></select></FormRow>
      <InsuranceComparison key={stage} sources={sources} draft={draft} stage={stage}/>
    </>}
  </details>;
}
