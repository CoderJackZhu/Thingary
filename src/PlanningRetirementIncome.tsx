import { useState } from 'react';
import { money } from './asset';
import { CentInput, FormRow, Switch } from './FormControls';
import type { Draft } from './planning-basic-forms';
export function IncomeQuestion({ d, setD, patch, frozen, onPension, savedBeijing, fullChoice = false }: { d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>; patch: (v: Partial<Draft>) => void; frozen: boolean; onPension: () => void; savedBeijing: boolean; fullChoice?: boolean }) {
  const [adding, setAdding] = useState(false);
  return <section className="form-block">
    <div className="plan-income-modes" role="radiogroup" aria-label="退休收入计入方式">
      {[{ value: 'excluded' as const, label: '先不算（推荐先这样）', hint: '暂不计退休收入，先看只靠自己准备的结果。' }, { value: 'manual' as const, label: '我自己填一笔', hint: '只计入你选中的退休收入。' }].map(m => <label key={m.value} className="plan-choice"><input type="radio" name="income-mode" aria-label={m.label} checked={d.incomeMode === m.value} disabled={frozen} onChange={() => patch({ incomeMode: m.value })}/><span><strong>{m.label}</strong><small>{m.hint}</small></span></label>)}
      {fullChoice ? <label className="plan-choice"><input type="radio" name="income-mode" aria-label="北京养老金估算" checked={d.incomeMode === 'beijing'} disabled={frozen} onChange={() => patch({ incomeMode: 'beijing' })}/><span><strong>北京养老金估算</strong><small>按北京规则作参考估算，需要未来缴费安排和社保资料，不代表待遇核定结果。</small></span></label>
        : <div className="plan-choice planning-pension-saved"><span><strong>{d.incomeMode === 'beijing' ? '已选北京养老金估算' : '国家养老金'}</strong><small>补充以后怎么缴费，算入退休收入；已有社保资料会保留。</small><button type="button" className="ui-link" disabled={frozen} onClick={onPension}>{savedBeijing || d.incomeMode === 'beijing' ? '核对国家养老金' : '现在添加'}</button></span></div>}
    </div>
    {(d.incomeMode === 'manual' || d.incomeMode === 'beijing') && <>
        {d.incomeItems.length === 0 && d.incomeMode === 'manual' && <p className="muted small">还没有手填的收入。添加一笔，例如企业年金、租金或返聘。</p>}
        {d.incomeItems.map(i => { const pick = d.picks[i.id] ?? { on: false, role: 'other' as const }; return <div key={i.id} className="plan-income-pick"><label><input type="checkbox" aria-label={`计入${i.label}`} checked={pick.on} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, on: e.target.checked } } })}/> {i.label} {money(i.monthly_cents)}/月 · {i.start_age} 岁起</label>
          {d.incomeMode === 'manual' && pick.on && <select aria-label={`${i.label}的角色`} value={pick.role} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, role: e.target.value as 'state_pension' | 'other' } } })}><option value="other">其他收入</option><option value="state_pension">国家养老金</option></select>}</div>; })}
        <button type="button" className="ui-btn" disabled={frozen} onClick={() => setAdding(true)}>+ 添加一笔退休收入</button>
        {adding && <NewIncome onCancel={() => setAdding(false)} onAdd={item => { setD(x => ({ ...x, incomeItems: [...x.incomeItems, item], picks: { ...x.picks, [item.id]: { on: true, role: 'other' } } })); setAdding(false); }}/>}
      </>}

  </section>;
}

function NewIncome({ onAdd, onCancel }: { onAdd: (i: Draft['incomeItems'][number]) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(''), [cents, setCents] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [indexed, setIndexed] = useState(true), [err, setErr] = useState('');
  function add() {
    const s = Number(start), e = end.trim() === '' ? null : Number(end);
    if (!label.trim()) return setErr('请填写名称。');
    if (!cents || cents === '0') return setErr('每月金额须大于 0。');
    if (!Number.isInteger(s) || s < 0 || s > 120 || start.trim() === '') return setErr('请填写起始年龄（0–120 的整数）。');
    if (e !== null && (!Number.isInteger(e) || e <= s || e > 120)) return setErr('结束年龄须晚于起始，留空表示终身。');
    onAdd({ id: crypto.randomUUID(), label: label.trim(), monthly_cents: cents, start_age: s, end_age: e, indexed });
  }
  return <div className="plan-new-income" role="group" aria-label="添加退休收入">
    <FormRow label="名称"><input aria-label="收入名称" value={label} onChange={e => setLabel(e.target.value)}/></FormRow>
    <FormRow label="税后每月收入" hint="今天的钱"><CentInput label="税后每月收入" value={cents} onChange={setCents}/></FormRow>
    <FormRow label="起始年龄"><input aria-label="收入起始年龄" inputMode="numeric" value={start} onChange={e => setStart(e.target.value)}/></FormRow>
    <FormRow label="结束年龄" hint="留空：终身"><input aria-label="收入结束年龄" inputMode="numeric" value={end} placeholder="终身" onChange={e => setEnd(e.target.value)}/></FormRow>
    <FormRow label="随通胀上涨"><Switch label="随通胀上涨" value={indexed} onChange={setIndexed}/></FormRow>
    {err && <p className="notice" role="alert">{err}</p>}
    <div className="rs-actions"><button type="button" className="ui-btn" onClick={onCancel}>取消</button><button type="button" className="primary" onClick={add}>加入列表</button></div>
  </div>;
}
