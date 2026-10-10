import { useState } from 'react';
import { money } from './asset';
import { CentInput, FormRow, Switch } from './FormControls';
import { pctToHundredths, rateText } from './plan';
import type { StoredSpendItem } from './plan';
import { ownAgeWhenChild, withSpendItem, withoutSpendItem } from './planning-basic-forms';
import type { Draft } from './planning-basic-forms';

const MAX_ITEMS = 20;
type Template = { key: string; label: string; hint: string; start?: string };
const templates: Template[] = [
  { key: 'child', label: '子女教育', hint: '退休后仍要负担的学费、生活费；填孩子现在几岁和供到几岁，自动换算成你的年龄。' },
  { key: 'parents', label: '赡养父母', hint: '结束年龄可以填父母约 90 岁时你的年龄；不确定就留空，算到规划终点。' },
  { key: 'care', label: '医疗与护理', hint: '例如从 75 岁起；医疗费用可能涨得比通胀快，可以填更高的每年上涨（这是假设）。', start: '75' },
];
const ageText = (i: StoredSpendItem) => `${i.start_age === null ? '退休起' : `${i.start_age} 岁起`} → ${i.end_age === null ? '规划终点' : `${i.end_age} 岁`}`;

/** 退休后的阶段性支出：只在退休后计入，按「额外」叠加在生活费总额之上；退休前的花费已在每月能存多少里。 */
export function SpendItems({ d, setD, frozen, today }: { d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>; frozen: boolean; today: string }) {
  const [adding, setAdding] = useState(false);
  return <details className="form-block" open={d.spendItems.length > 0 || adding}><summary>退休后另有阶段性支出（选填）</summary>
    <p className="muted small">例如退休后还要供孩子上学、赡养父母或护理费用。这些按“额外”计入，生活费总额里不要再包含；只计算退休后的月份，年龄都按你自己的年龄。</p>
    {d.spendItems.length > 0 && <ul className="rs-list">{d.spendItems.map(i => <li key={i.id}><span>{i.label}<small>{ageText(i)} · {i.essential ? '必需' : '灵活'}{i.inflation_hundredths === null ? '' : ` · 每年上涨 ${rateText(i.inflation_hundredths)}`}</small></span><b>{money(i.monthly_cents)}/月</b><button type="button" className="ui-link" disabled={frozen} onClick={() => setD(x => withoutSpendItem(x, i.id))}>删除</button></li>)}</ul>}
    {!adding && <button type="button" className="ui-btn" disabled={frozen || d.spendItems.length >= MAX_ITEMS} onClick={() => setAdding(true)}>+ 添加一笔阶段性支出</button>}
    {d.spendItems.length >= MAX_ITEMS && <p className="muted small">最多 {MAX_ITEMS} 项。</p>}
    {adding && <NewSpend target={d.target} birth={d.birth} today={today} frozen={frozen} onCancel={() => setAdding(false)} onAdd={item => { setD(x => withSpendItem(x, item)); setAdding(false); }}/>}
  </details>;
}

function NewSpend({ target, birth, today, frozen, onAdd, onCancel }: { target: string; birth: string; today: string; frozen: boolean; onAdd: (i: StoredSpendItem) => void; onCancel: () => void }) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [label, setLabel] = useState(''), [cents, setCents] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [essential, setEssential] = useState(true), [infl, setInfl] = useState(''), [err, setErr] = useState('');
  const [child, setChild] = useState(''), [until, setUntil] = useState('22');
  const childEnd = template?.key === 'child' ? ownAgeWhenChild(birth, today, child, until) : null;
  const endAge = template?.key === 'child' && end === '' ? childEnd : /^\d+$/.test(end.trim()) ? Number(end) : null;
  const beforeRetire = endAge !== null && /^\d+$/.test(target) && endAge <= Number(target);
  const pick = (t: Template) => { setTemplate(t); setLabel(t.label); setStart(t.start ?? ''); setEssential(true); setErr(''); };
  const age = (t: string) => t.trim() === '' ? null : /^\d+$/.test(t.trim()) && Number(t) <= 120 ? Number(t) : undefined;
  function add() {
    const s = age(start), e = template?.key === 'child' && end === '' ? childEnd : age(end), rate = infl.trim() === '' ? null : pctToHundredths(infl);
    if (!label.trim() || label.trim().length > 40) return setErr('请填写名称（不超过 40 字）。');
    if (!cents || cents === '0') return setErr('每月金额须大于 0。');
    if (s === undefined || e === undefined) return setErr('年龄请填 0–120 的整数，或留空。');
    if (s !== null && e !== null && e <= s) return setErr('结束年龄须晚于开始年龄。');
    if (rate === null && infl.trim() !== '' || rate !== null && (rate < -1000 || rate > 2000)) return setErr('每年上涨请填 -10 到 20 之间的百分数，或留空跟随通胀。');
    onAdd({ id: crypto.randomUUID(), label: label.trim(), monthly_cents: cents, start_age: s, end_age: e, inflation_hundredths: rate, essential });
  }
  return <div className="plan-new-income" role="group" aria-label="添加阶段性支出">
    <span className="plan-goal-actions plan-return-presets">{templates.map(t => <button key={t.key} type="button" className="ui-btn" aria-pressed={template?.key === t.key} disabled={frozen} onClick={() => pick(t)}>{t.label}</button>)}</span>
    {template && <p className="muted small">{template.hint}</p>}
    <FormRow label="名称"><input aria-label="支出名称" value={label} disabled={frozen} onChange={e => setLabel(e.target.value)}/></FormRow>
    <FormRow label="每月金额" hint="今天的钱"><CentInput label="阶段性支出每月金额" value={cents} disabled={frozen} onChange={setCents}/></FormRow>
    {template?.key === 'child' && <>
      <FormRow label="孩子现在几岁"><input aria-label="孩子现在几岁" inputMode="numeric" value={child} disabled={frozen} onChange={e => setChild(e.target.value)}/></FormRow>
      <FormRow label="供到孩子几岁"><input aria-label="供到孩子几岁" inputMode="numeric" value={until} disabled={frozen} onChange={e => setUntil(e.target.value)}/></FormRow>
      {end === '' && <p className="muted small" role="status">{childEnd === null ? '先填出生年月和孩子年龄，才能换算成你的年龄。' : `结束于你约 ${childEnd} 岁时。`}</p>}
    </>}
    <FormRow label="从你几岁开始" hint="留空：从退休起"><input aria-label="支出开始年龄" inputMode="numeric" value={start} disabled={frozen} onChange={e => setStart(e.target.value)}/></FormRow>
    <FormRow label="到你几岁结束" hint={template?.key === 'child' ? '留空：按上面的孩子年龄换算' : '留空：到规划终点'}><input aria-label="支出结束年龄" inputMode="numeric" value={end} disabled={frozen} onChange={e => setEnd(e.target.value)}/></FormRow>
    <FormRow label="每年上涨（%）" hint="留空跟随通胀；这是假设"><input aria-label="支出每年上涨" inputMode="decimal" value={infl} disabled={frozen} onChange={e => setInfl(e.target.value)}/></FormRow>
    <FormRow label="必需支出" hint="关掉表示可以压缩的灵活支出"><Switch label="必需支出" value={essential} disabled={frozen} onChange={setEssential}/></FormRow>
    {beforeRetire && <p className="notice" role="status">这笔支出在你 {target} 岁退休前就结束了，不会影响结果：退休前的花费请算进每月能存多少里。</p>}
    {err && <p className="notice" role="alert">{err}</p>}
    <div className="rs-actions"><button type="button" className="ui-btn" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={frozen} onClick={add}>加入列表</button></div>
  </div>;
}
