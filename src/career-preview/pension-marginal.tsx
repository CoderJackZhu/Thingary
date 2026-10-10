import { CoverageNote } from '../CoverageNote';
import { useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import type { PlanningSources } from '../plan-basic-contract.ts';
import { beijing, paramsFor } from '../plan-params.ts';
import { marginalPension } from './pension-marginal.ts';
import { money } from './result-text.ts';

/** Read-only: what a stretch of self-paid months buys in monthly pension. A rough difference, not an entitlement. */
export function PensionMarginal({ sources }: { sources: PlanningSources }) {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile ?? null : null;
  const [months, setMonths] = useState('12'), [base, setBase] = useState<'floor' | 'original' | 'custom'>('floor'), [custom, setCustom] = useState(''), [cash, setCash] = useState<string | null>(null);
  const region = p ? paramsFor(p, sources.today) ?? beijing : beijing;
  const baseCents = base === 'floor' ? region.base_lower_cents : base === 'original' ? p?.base_cents ?? '' : custom;
  const r = useMemo(() => marginalPension(sources, { months: Number(months), base_cents: baseCents ?? '', cash_cents: cash }), [sources, months, baseCents, cash]);
  return <><CoverageNote sources={sources} compact/><details className="career-marginal"><summary>多交社保换来多少养老金？（粗估，只做比较）</summary>
    <p className="career-footnote">比较“从现在起不再交”和“再多交这么多个月”，只看退休后每月养老金的差。职工养老金的绝对金额尚未完整校准，所以这里只比差，数值是量级参考，不是待遇核定，也不进入上面的答案。</p>
    <FormRow label="再多交几个月"><input aria-label="再多交几个月" type="number" min="1" max="600" step="1" value={months} onChange={e => setMonths(e.target.value)}/></FormRow>
    <FormRow label="按哪个基数交"><select aria-label="多交社保的基数" value={base} onChange={e => setBase(e.target.value as 'floor' | 'original' | 'custom')}><option value="floor">下限 {money(region.base_lower_cents)}</option>{p?.base_cents && <option value="original">原来的基数 {money(p.base_cents)}</option>}<option value="custom">自己填</option></select></FormRow>
    {base === 'custom' && <FormRow label="自己填的缴费基数（元/月）"><CentInput label="自选缴费基数" value={custom} onChange={setCustom}/></FormRow>}
    <FormRow label="这段每月你自己掏的现金（元）" hint="按缴费单填，含医疗等；填了才能算多少年回本。"><CentInput label="多交社保每月现金" value={cash ?? ''} onChange={v => setCash(v || null)}/></FormRow>
    {r.status === 'blocked' ? <p className="career-message" role="status">{r.message}</p> : <div className="career-delta" role="status" aria-live="polite">
      <p>不再交：退休后每月约 {r.stopped.eligible ? money(r.stopped.monthly_cents) : `领不到（缴费还差 ${r.stopped.short_months} 个月）`}；再多交 {r.paying.contribution_months} 个月：{r.paying.eligible ? money(r.paying.monthly_cents) : `仍领不到（还差 ${r.paying.short_months} 个月）`}。</p>
      <p><strong>每月养老金相差约 {money(r.delta_monthly_cents)}</strong>（今天的钱）{!r.stopped.eligible && r.paying.eligible ? '，其中包括“补够缴费年限、从领不到变成能领”的差别' : ''}。</p>
      {!r.paying.eligible && <p className="career-footnote">这些月份还没补够最低缴费年限，所以养老金暂时看不出增加：它们是在靠近领取资格，不是白交。</p>}
      <p>{r.cash_total_cents === null ? '填上每月现金，就能算多少年回本。' : `这段合计要自己掏 ${money(r.cash_total_cents)}${r.payback_years === null ? '，养老金没有增加，谈不上回本。' : `，约 ${r.payback_years.toFixed(1)} 年回本（不计养老金上调和利息）。`}`}</p>
    </div>}
  </details></>;
}
