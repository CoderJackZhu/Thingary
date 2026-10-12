import { money } from './asset';
import { financePeriodContains, type FinancePeriod } from './finance-contract';
import { incomeCategories, incomeCategoryTotals } from './income-classification';
import { hpfSummary, incomeHpfTotals } from './plan';
import type { Income, IncomeList } from './plan';

export function IncomeRecords({ incomes, onOpen, onNew, disabled, period, search }: { incomes: IncomeList; onOpen: (i: Income) => void; onNew: () => void; disabled: boolean; period: FinancePeriod; search?: string }) {
  const table = (rows: Income[]) => <table className="ui-table plan-income"><thead><tr><th>到账日期</th><th>来源分类</th><th className="amount">税后到账</th><th className="amount">公积金缴存</th><th>备注</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.id}><td><button className="link-cell" disabled={disabled} onClick={() => onOpen(r)}>{r.fields.date}</button></td><td>{incomeCategories[r.fields.category ?? 'unclassified']}</td><td className="amount">{money(r.fields.net_cents)}</td><td className="amount">{r.fields.hpf_cents === null ? '未知' : money(r.fields.hpf_cents)}</td><td className="muted">{r.fields.notes}</td></tr>)}</tbody></table>;
  // Controlled view: the host owns the period. The summary always comes from the full period set; search only filters the table.
  const periodRows = incomes.rows.filter(r => financePeriodContains(period, r.fields.date));
  const hasRecords = periodRows.length > 0;
  const hpf = incomeHpfTotals(periodRows);
  const netTotal = periodRows.reduce((sum, r) => sum + BigInt(r.fields.net_cents), 0n).toString();
  const query = (search ?? '').trim().toLowerCase();
  const rows = query ? periodRows.filter(r => [r.fields.date, incomeCategories[r.fields.category ?? 'unclassified'], r.fields.notes ?? ''].some(value => value.trim().toLowerCase().includes(query))) : periodRows;
  const searching = query.length > 0;
  const noMatches = searching && hasRecords && rows.length === 0;
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>收入记录</h3><span>{searching ? `搜索到 ${rows.length} 条` : hasRecords ? `${periodRows.length} 条 · 同日可多笔` : '尚未记录'}</span></div>
    <p className="muted small">期间合计</p>
    <dl className="plan-facts" aria-label="期间合计"><div><dt>已记录到账</dt><dd>{hasRecords ? money(netTotal) : '尚未记录'}</dd></div><div><dt>记录笔数</dt><dd>{hasRecords ? `${periodRows.length} 笔` : '尚未记录'}</dd></div><div><dt>公积金缴存</dt><dd>{hasRecords ? hpfSummary(hpf.total, hpf.known, hpf.unknown, money) : '尚未记录'}</dd></div></dl>
    <p className="muted small">已记录收入仅说明到账构成，不再加到资产余额或投资损益；搜索只筛选明细，期间合计不变。</p>
    <dl className="plan-facts">{incomeCategoryTotals(periodRows).map(r => <div key={r.category}><dt>{incomeCategories[r.category]} · {r.count} 笔</dt><dd>{money(r.cents)}</dd></div>)}</dl>
    {rows.length ? table(rows) : noMatches
      ? <div className="empty"><span className="empty-mark">¥</span><h2>没有匹配的收入记录</h2><p>期间合计不受搜索影响。</p><button className="primary" disabled={disabled} onClick={onNew}>记一笔收入</button></div>
      : <div className="empty"><span className="empty-mark">¥</span><h2>尚未记录</h2><p>本期还没有记录到账收入；未知不等于零。可记录实际到账的税后收入和公积金缴存。</p><button className="primary" disabled={disabled} onClick={onNew}>记一笔收入</button></div>}
  </article>;
}
