import { useState } from 'react';
import { money } from './asset';
import { CentInput, FormRow, Switch } from './FormControls';
import { rateText } from './plan';
import { incomeInflationContext, retirementIncomeToday } from './planning-basic-forms';
import type { Draft, IncomePick } from './planning-basic-forms';
export function IncomeQuestion({ d, setD, patch, frozen, onPension, savedEmployee, fullChoice = false, today }: { d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>; patch: (v: Partial<Draft>) => void; frozen: boolean; onPension: () => void; savedEmployee: boolean; fullChoice?: boolean; today: string }) {
  const [adding, setAdding] = useState(false);
  return <section className="form-block">
    <div className="plan-income-modes" role="radiogroup" aria-label="退休收入计入方式">
      {[{ value: 'excluded' as const, label: '先不算（推荐先这样）', hint: '暂不计退休收入，先看只靠自己准备的结果。' }, { value: 'manual' as const, label: '我自己填一笔', hint: '只计入你选中的退休收入。' }].map(m => <label key={m.value} className="plan-choice"><input type="radio" name="income-mode" aria-label={m.label} checked={d.incomeMode === m.value} disabled={frozen} onChange={() => patch({ incomeMode: m.value })}/><span><strong>{m.label}</strong><small>{m.hint}</small></span></label>)}
      {fullChoice ? <label className="plan-choice"><input type="radio" name="income-mode" aria-label="职工养老金估算" checked={d.incomeMode === 'employee'} disabled={frozen} onChange={() => patch({ incomeMode: 'employee' })}/><span><strong>职工养老金估算</strong><small>按全国统一公式和你所在地的参数估算，需要未来缴费安排和社保资料，不代表待遇核定结果。</small></span></label>
        : <div className="plan-choice planning-pension-saved"><span><strong>{d.incomeMode === 'employee' ? '已选职工养老金估算' : '国家养老金'}</strong><small>补充以后怎么缴费，算入退休收入；已有社保资料会保留。</small><button type="button" className="ui-link" disabled={frozen} onClick={onPension}>{savedEmployee || d.incomeMode === 'employee' ? '核对国家养老金' : '现在添加'}</button></span></div>}
    </div>
    {d.incomeMode === 'manual' && <p className="muted small">多数地区的社保 App 或人社网站有养老金测算，可以把测算结果填在这里，角色选“国家养老金”。城乡居民养老保险、机关事业单位或有视同缴费年限的情况，建议用这种方式。</p>}
    {(d.incomeMode === 'manual' || d.incomeMode === 'employee') && <>
        {d.incomeItems.length === 0 && d.incomeMode === 'manual' && <p className="muted small">还没有手填的收入。添加一笔，例如企业年金、租金或返聘。</p>}
        {d.incomeItems.map(i => { const pick = d.picks[i.id] ?? { on: false, role: 'other' as const }; return <div key={i.id} className="plan-income-pick"><label><input type="checkbox" aria-label={`计入${i.label}`} checked={pick.on} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, on: e.target.checked } } })}/> {i.label} {money(i.monthly_cents)}/月 · {i.start_age} 岁起</label>
          {d.incomeMode === 'manual' && pick.on && <select aria-label={`${i.label}的角色`} value={pick.role} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, role: e.target.value as 'state_pension' | 'other' } } })}><option value="other">其他收入</option><option value="state_pension">国家养老金</option></select>}</div>; })}
        <button type="button" className="ui-btn" disabled={frozen} onClick={() => setAdding(true)}>+ 添加一笔退休收入</button>
        {adding && <NewIncome statePension={d.incomeMode === 'manual'} birth={d.birth} infl={d.infl} today={today} frozen={frozen} onCancel={() => setAdding(false)} onAdd={(item, role) => { setD(x => ({ ...x, incomeItems: [...x.incomeItems, item], picks: { ...x.picks, [item.id]: { on: true, role } } })); setAdding(false); }}/>}
      </>}

  </section>;
}

export function NewIncome({ onAdd, onCancel, birth, infl, today, frozen = false, statePension = true }: { onAdd: (i: Draft['incomeItems'][number], role: IncomePick['role']) => void; onCancel: () => void; birth: string; infl: string; today: string; frozen?: boolean; statePension?: boolean }) {
  const [label, setLabel] = useState(''), [cents, setCents] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [indexed, setIndexed] = useState(true), [err, setErr] = useState('');
  const [role, setRole] = useState<IncomePick['role']>('other'), [future, setFuture] = useState(false);
  const context = incomeInflationContext(birth, infl, today), discounted = retirementIncomeToday(cents, start, birth, infl, today);
  function add() {
    if (frozen) return;
    const s = Number(start), e = end.trim() === '' ? null : Number(end);
    if (!label.trim()) return setErr('请填写名称。');
    if (!cents || cents === '0') return setErr('每月金额须大于 0。');
    if (!Number.isInteger(s) || s < 0 || s > 120 || start.trim() === '') return setErr('请填写起始年龄（0–120 的整数）。');
    if (e !== null && (!Number.isInteger(e) || e <= s || e > 120)) return setErr('结束年龄须晚于起始，留空表示终身。');
    if (future && discounted === null) return setErr('请核对出生年月、通胀、起始年龄和金额，折算结果须大于 0。');
    onAdd({ id: crypto.randomUUID(), label: label.trim(), monthly_cents: future ? discounted! : cents, start_age: s, end_age: e, indexed }, role);
  }
  return <div className="plan-new-income" role="group" aria-label="添加退休收入">
    {/* 职工养老金估算已计国家养老金，手填的同角色项会被排除，不提供快捷入口。 */}
    {statePension && <button type="button" className="ui-btn" disabled={frozen} onClick={() => { setLabel('国家养老金'); setRole('state_pension'); }}>国家养老金（测算结果）</button>}
    <FormRow label="名称"><input disabled={frozen} aria-label="收入名称" value={label} onChange={e => setLabel(e.target.value)}/></FormRow>
    <FormRow label="税后每月收入" hint={future ? '退休那年的金额' : '今天的钱'}><CentInput disabled={frozen} label="税后每月收入" value={cents} onChange={setCents}/></FormRow>
    <FormRow label="起始年龄"><input disabled={frozen} aria-label="收入起始年龄" inputMode="numeric" value={start} onChange={e => setStart(e.target.value)}/></FormRow>
    <FormRow label="结束年龄" hint="留空：终身"><input disabled={frozen} aria-label="收入结束年龄" inputMode="numeric" value={end} placeholder="终身" onChange={e => setEnd(e.target.value)}/></FormRow>
    <FormRow label="这是退休那年的金额"><Switch label="这是退休那年的金额" value={future} disabled={frozen || context === null} onChange={setFuture}/></FormRow>
    {context === null && <p className="muted small">先填写出生年月和通胀假设才能折算。</p>}
    {future && discounted !== null && <p className="muted small" role="status">约合今天的 {money(discounted)}/月（按通胀 {context ? rateText(Math.round(context.rate * 10000)) : infl + '%'} 折算）</p>}
    <FormRow label="随通胀上涨"><Switch disabled={frozen} label="随通胀上涨" value={indexed} onChange={setIndexed}/></FormRow>
    {err && <p className="notice" role="alert">{err}</p>}
    <div className="rs-actions"><button type="button" className="ui-btn" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={frozen} onClick={add}>加入列表</button></div>
  </div>;
}
