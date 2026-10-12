import { useState } from 'react';
import { money } from './asset';
import { incomeCategories, incomeCategoryTotals } from './income-classification';
import { hpfSummary, incomeHpfTotals } from './plan';
import type { Income, IncomeList } from './plan';

export function IncomeRecords({ incomes, onOpen, onNew, disabled }: { incomes: IncomeList; onOpen: (i: Income) => void; onNew: () => void; disabled: boolean }) {
  const [month, setMonth] = useState('');
  const months = [...new Set(incomes.rows.map(r => r.fields.date.slice(0, 7)))].sort().reverse();
  const rows = incomes.rows.filter(r => !month || r.fields.date.startsWith(month));
  const hpf = incomeHpfTotals(rows);
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>收入记录</h3><span>{rows.length} 条 · 同日可多笔</span></div><label className="review-period-picker">到账月份 <select aria-label="筛选收入月份" value={month} onChange={e => setMonth(e.target.value)}><option value="">全部月份</option>{month && !months.includes(month) && <option value={month}>{month}（暂无记录）</option>}{months.map(m => <option key={m} value={m}>{m}</option>)}</select></label><p>已记录公积金缴存：{rows.length ? hpfSummary(hpf.total, hpf.known, hpf.unknown, money) : "尚未记录"}</p>
    <p className="muted small">已记录收入仅说明到账构成，不再加到资产余额或投资损益。</p><dl className="plan-facts">{incomeCategoryTotals(rows).map(r => <div key={r.category}><dt>{incomeCategories[r.category]} · {r.count} 笔</dt><dd>{money(r.cents)}</dd></div>)}</dl>
    {rows.length ? <table className="ui-table plan-income"><thead><tr><th>到账日期</th><th>来源分类</th><th className="amount">税后到账</th><th className="amount">公积金缴存</th><th>备注</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td><button className="link-cell" disabled={disabled} onClick={() => onOpen(r)}>{r.fields.date}</button></td><td>{incomeCategories[r.fields.category ?? 'unclassified']}</td><td className="amount">{money(r.fields.net_cents)}</td><td className="amount">{r.fields.hpf_cents === null ? '未知' : money(r.fields.hpf_cents)}</td><td className="muted">{r.fields.notes}</td></tr>)}</tbody></table>
      : <div className="empty"><span className="empty-mark">¥</span><h2>{month ? '这个月还没有收入记录' : '还没有收入记录'}</h2>{month && <button className="ui-btn" onClick={() => setMonth('')}>查看全部月份</button>}<p>可记录实际到账的税后收入和公积金缴存；无收入记录仍能查看资产变化。公积金提取是账户间转移，不用记。</p><button className="primary" disabled={disabled} onClick={onNew}>记一笔收入</button></div>}
  </article>;
}
