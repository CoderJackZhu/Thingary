// Development-only panel: window map, longest gap, social-insurance choices. Fictional sources; nothing is stored.
import { useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import { beijing } from '../plan-params.ts';
import { careerSpan, closeMonths, maxGap, minWindow, pensionOptions, windowMap } from '../plan-career-map.ts';
import type { MaxGap, MinWindow, PensionChoice, Reason } from '../plan-career-map.ts';
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { money } from './result-text.ts';
import './map.css';

const wan = (cents: number) => `¥${(cents / 1_000_000).toFixed(1)}万`;
const span = (months: number) => `${Math.floor(months / 12)} 年 ${months % 12} 个月`;
const reasonText: Record<Reason, string> = { goal: '目标时资产不够', cash: '空窗中资金先不够', prefix: '已知付款先不够，后面的收入补不回来' };
const profileOf = (s: PlanningSources) => (s.profile.status === 'ready' ? s.profile.value.saved?.profile ?? null : null);

function minText(x: MinWindow): string {
  if (x.status === 'found') return `窗口至少要持续到 ${x.close_month} 之前（约 ${span(x.months)}）`;
  if (x.status === 'already_met') return '现在关闭也满足目标';
  return x.message;
}
function gapText(x: MaxGap): string {
  if (x.status === 'found') return `最多能空窗 ${x.months} 个月（${x.limit === 'end' ? '一直到目标前都撑得住' : `再长：${reasonText[x.limit]}`}）`;
  if (x.status === 'none') return `按这个条件，不空窗也保不住：${x.reason ? reasonText[x.reason] : '条件未齐全'}`;
  return x.message;
}

export function CareerMapPanel({ sources, draft, patch }: { sources: PlanningSources; draft: CareerDraft; patch: (v: Partial<CareerDraft>) => void }) {
  const p = profileOf(sources), current = p?.retire.basic?.contribution.monthly_cents ?? null, bounds = careerSpan(sources);
  const defaults = useMemo(() => (current !== null && /^-?\d+$/.test(current) ? [0, 0.25, 0.5, 0.75].map(f => String(Math.round(Number(current) * f))) : ['0']), [current]);
  const [custom, setCustom] = useState<string[] | null>(null), [mapGap, setMapGap] = useState(0);
  const recoveries = custom ?? defaults, [pick, setPick] = useState(1), chosen = recoveries[Math.min(pick, recoveries.length - 1)] ?? '0';
  const withL = useMemo(() => { const d = structuredClone(draft); d.recovery.monthly_cents = chosen; return d; }, [draft, chosen]);
  const step = bounds ? Math.max(12, Math.ceil((bounds.target - bounds.now) / 8 / 12) * 12) : 12;
  const closes = useMemo(() => closeMonths(sources, step).slice(0, 9), [sources, step]);
  const base = useMemo(() => ({ ...structuredClone(draft), gap_months: mapGap }), [draft, mapGap]);
  const ok = recoveries.every(v => /^-?(0|[1-9]\d*)$/.test(v));
  const map = useMemo(() => (ok ? windowMap(sources, base, closes, recoveries) : null), [ok, sources, base, closes, recoveries]);
  const mins = useMemo(() => (ok ? recoveries.map(l => minWindow(sources, { ...structuredClone(base), recovery: { ...structuredClone(base.recovery), monthly_cents: l } })) : []), [ok, sources, base, recoveries]);
  const longest = useMemo(() => maxGap(sources, withL), [sources, withL]);

  const extra = draft.gap.extra_income ?? { lump_cents: null, benefit_monthly_cents: null, benefit_months: null };
  const setExtra = (v: Partial<typeof extra>) => patch({ gap: { ...draft.gap, extra_income: { ...extra, ...v } } });

  const [stage, setStage] = useState<'gap' | 'recovery'>('gap'), [cash, setCash] = useState(['0', '0', '0', '0']);
  const origBase = p?.base_cents ?? null;
  const choices: PensionChoice[] = [
    { label: '停缴', pension: 'pause', cash_cents: cash[0] },
    { label: '灵活就业自缴（下限）', pension: { base_cents: beijing.base_lower_cents, hpf_monthly_cents: '0' }, cash_cents: cash[1] },
    ...(origBase ? [{ label: '灵活就业自缴（原基数）', pension: { base_cents: origBase, hpf_monthly_cents: '0' }, cash_cents: cash[2] }] : []),
    { label: '沿用原安排（如新单位代缴）', pension: 'unchanged' as const, cash_cents: cash[3] },
  ];
  const cashIndex = (i: number) => (origBase || i < 2 ? i : 3);
  const pensions = useMemo(() => pensionOptions(sources, withL, stage, choices), [sources, withL, stage, cash]);
  const first = pensions.rows[0];

  return <section className="career-map" aria-label="窗口与社保">
    <h2>高收入窗口什么时候关闭？</h2>
    <p className="career-footnote">窗口关闭的时间没法预测，这里把它摆成一张图，你读自己认为可能的那一块。所有数字都是“按这些条件”的结果，不是概率。</p>
    <div className="career-layout"><section className="career-input"><h3>关闭之后</h3>
      <FormRow label="先空窗几个月（可为 0）" hint="图里的窗口关闭后，先空窗这么久再恢复；0 表示直接转成较低的投入。"><input aria-label="地图空窗月数" type="number" min="0" step="1" value={mapGap} onChange={e => setMapGap(Math.max(0, Math.floor(Number(e.target.value) || 0)))}/></FormRow>
      {recoveries.map((v, i) => <FormRow key={i} label={`关闭后每月净投入 ${i + 1}（元）`} hint={i === 0 ? '默认取你当前投入的 0%、25%、50%、75%，可改；负数表示动用存款。' : undefined}><CentInput label={`关闭后每月净投入 ${i + 1}`} signed value={v} onChange={x => setCustom(recoveries.map((o, j) => (j === i ? x || '0' : o)))}/></FormRow>)}
    </section><section className="career-input"><h3>要持续多久</h3>
      {ok && recoveries.map((l, i) => <p key={i} className="career-line"><strong>关闭后每月 {money(l)}</strong><br/>{minText(mins[i])}</p>)}
      {!ok && <p className="career-message">候选金额须是整数分。</p>}
      <p className="career-footnote">“持续到”按每月投入保持不变算，窗口里的收入要靠你自己的判断，这里不替你预测。</p>
    </section></div>

    {map && <section className="career-input"><h3>窗口地图</h3>
      <div className="career-table-wrap"><table className="career-table"><caption>横轴是窗口关闭的月份，纵轴是关闭后每月净投入。✓ 表示原目标满足，其余是目标时点缺的资金或先不够的原因。</caption>
        <thead><tr><th scope="col">关闭后每月</th>{map.closes.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{map.rows.map((row, i) => <tr key={i}><th scope="row">{money(map.recoveries[i])}</th>{row.map(c => <td key={c.close_month} className={`career-cell career-${c.verdict}`}>{c.verdict === 'meets' ? '✓ 满足' : c.verdict === 'blocked' ? '—' : c.reason === 'goal' ? `差 ${wan(c.shortfall_cents ?? 0)}` : c.reason === 'cash' ? '资金先不够' : '付款先不够'}</td>)}</tr>)}</tbody>
      </table></div>
    </section>}

    <section className="career-input"><h3>以下两项按哪一档“关闭后每月净投入”算</h3>
      <FormRow label="关闭后每月净投入"><select aria-label="关闭后每月净投入档位" value={Math.min(pick, recoveries.length - 1)} onChange={e => setPick(Number(e.target.value))}>{recoveries.map((v, i) => <option key={i} value={i}>{money(v)} / 月</option>)}</select></FormRow>
    </section>
    <div className="career-layout"><section className="career-input"><h3>最多能空窗几个月</h3>
      <p className="career-line">{gapText(longest)}</p>
      <p className="career-footnote">变化月份和空窗期的收支用上面“这次变化”里填的，恢复后投入取所选的一档。</p>
    </section><section className="career-input"><h3>补偿金与限期补助</h3>
      <FormRow label="一次性到账（元）" hint="如离职补偿、未休假折现，税后；留空表示没有。到账记在变化月月底。"><CentInput label="一次性到账" value={extra.lump_cents ?? ''} onChange={v => setExtra({ lump_cents: v || null })}/></FormRow>
      <FormRow label="限期补助每月（元）" hint="如失业金，税后；只在下面的月数内每月月底到账。"><CentInput label="限期补助每月" value={extra.benefit_monthly_cents ?? ''} onChange={v => setExtra({ benefit_monthly_cents: v || null })}/></FormRow>
      <FormRow label="补助领取月数"><input aria-label="补助领取月数" type="number" min="0" step="1" value={extra.benefit_months ?? ''} onChange={e => setExtra({ benefit_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
    </section></div>

    <section className="career-input"><h3>社保怎么交</h3>
      <FormRow label="比较哪一段"><select aria-label="比较哪一段" value={stage} onChange={e => setStage(e.target.value as 'gap' | 'recovery')}><option value="gap">空窗期</option><option value="recovery">恢复之后到目标前</option></select></FormRow>
      <div className="career-table-wrap"><table className="career-table"><caption>每月现金社保按缴费单填，含医疗等不进养老金的部分；养老金按所选方式重新算。{pensions.stage_months === null ? '' : `这一段共 ${pensions.stage_months} 个月。`}</caption>
        <thead><tr><th scope="col">方式</th><th scope="col">每月现金（元）</th><th scope="col">这段合计</th><th scope="col">退休时月养老金</th><th scope="col">比第一行</th><th scope="col">目标时资产</th></tr></thead>
        <tbody>{pensions.rows.map((r, i) => {
          const dc = r.stage_cash_cents !== null && first.stage_cash_cents !== null ? r.stage_cash_cents - first.stage_cash_cents : null, dp = r.pension && first.pension ? r.pension.monthly_cents - first.pension.monthly_cents : null;
          return <tr key={r.label}><th scope="row">{r.label}</th>
            <td><CentInput label={`${r.label} 每月现金`} placeholder="0" value={cash[cashIndex(i)]} onChange={v => setCash(cash.map((o, j) => (j === cashIndex(i) ? v || '0' : o)))}/></td>
            <td>{r.stage_cash_cents === null ? '—' : money(r.stage_cash_cents)}</td>
            <td>{r.pension === null ? (r.judgement.verdict === 'blocked' ? '—' : '未引用北京养老金') : r.pension.eligible ? money(r.pension.monthly_cents) : `领不到（还差 ${r.pension.short_months} 个月）`}</td>
            <td>{i === 0 ? '基准' : dc === 0 && !dp ? '与第一行相同' : dc === null ? '—' : `多花 ${money(dc)}${dp === null ? '' : `，月养老金${dp >= 0 ? '多' : '少'} ${money(Math.abs(dp))}${dc > 0 && dp > 0 ? `，约 ${(dc / (dp * 12)).toFixed(1)} 年回本` : ''}`}`}</td>
            <td>{r.assets_at_goal_cents === null ? (r.judgement.issues[0] ?? '—') : money(r.assets_at_goal_cents)}</td></tr>;
        })}</tbody></table></div>
      <p className="career-footnote">“回本”不计养老金每年上调和账户利息，只是量级参考。停缴不抹去已缴月数；医保是否继续、有没有等待期，请以官方规定为准，这里没有核实。</p>
    </section>
  </section>;
}
