// U20「变化」分段：两次盘点的逐账户比较、按类型的结构比较与单账户历史。
// 规则由只读命令 wealth_compare / wealth_account_history 计算，前端只展示、排序与展开（产品设计 17.14）。
import { Fragment, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset.ts';
import { Info } from './FormControls';
import { NetChart } from './WealthPage';
import { cellText, changeText, code, defaultRange, kindLabel, rateText, sortRows } from './wealth';
import type { Account, AccountHistory, Compare, CompareRow, Point, Summary } from './wealth';

type Range = { from: string; to: string };
type HistoryState = { status: 'loading' } | { status: 'ok'; data: AccountHistory } | { status: 'error'; message: string };
const NOTE = '变化含存取、转账、消费与估值，不等于投资收益；按盘点当时的类型和计入设置计算';
const stateLabel = (state: string) => state === 'entered' ? '录入' : state === 'unchanged' ? '未变' : state === 'missing' ? '未知' : state;

export function WealthChanges({ summary, accounts, initial, today, onNewAccount, onCheckIn }: {
  summary: Summary; accounts: Account[]; initial?: Range | null; today: string; onNewAccount: () => void; onCheckIn: (date: string) => void;
}) {
  const points = summary.points;
  const [range, setRange] = useState<Range | null>(() => initial ?? defaultRange(points));
  const [sort, setSort] = useState<'impact' | 'kind'>('impact');
  const [loaded, setLoaded] = useState<{ range: Range; data: Compare } | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Map<string, HistoryState>>(new Map());
  // Stale replies never render: only the compare for the current range does.
  const compare = loaded && range && loaded.range.from === range.from && loaded.range.to === range.to ? loaded.data : null;
  useEffect(() => { setHistory(new Map()); setExpanded(new Set()); }, [summary.generation]);
  useEffect(() => {
    if (!range) return;
    let live = true; setError('');
    invoke<Compare>('wealth_compare', { from: range.from, to: range.to })
      .then(c => { if (live) setLoaded({ range, data: c }); })
      .catch(e => {
        if (!live) return;
        // 正在查看的盘点被删除或变化：回到默认区间并提示（17.14.5）。
        if (code(e) === 'NOT_FOUND') {
          const fresh = defaultRange(points);
          if (fresh && (fresh.from !== range.from || fresh.to !== range.to)) { setRange(fresh); setNotice('所选盘点已删除或变化，已回到默认区间。'); return; }
        }
        setError(errorMessage(e));
      });
    return () => { live = false; };
  }, [range, summary.generation, points, retry]);
  const loadHistory = (id: string) => {
    if (history.get(id)?.status === 'ok') return;
    setHistory(m => new Map(m).set(id, { status: 'loading' }));
    invoke<AccountHistory>('wealth_account_history', { account: id })
      .then(data => setHistory(m => new Map(m).set(id, { status: 'ok', data })))
      .catch(e => setHistory(m => new Map(m).set(id, { status: 'error', message: errorMessage(e) })));
  };
  const toggle = (id: string) => {
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    if (!expanded.has(id)) loadHistory(id);
  };
  if (!accounts.length) return <div className="empty"><span className="empty-mark">¥</span><h2>先建立要定期核对的账户</h2><p>银行卡、证券、基金、公积金，以及信用卡和贷款。只需名称和类型，不需要卡号或登录信息。</p><button className="primary" onClick={onNewAccount}>新增账户</button></div>;
  if (!points.length) return <div className="empty"><span className="empty-mark">¥</span><h2>开始第一次盘点</h2><p>对照各平台，把今天的余额和欠款逐行填进来。之后每次盘点都会成为趋势上的一个点。</p><button className="primary" onClick={() => onCheckIn(today)}>开始盘点</button></div>;
  if (!range) return <>
    <div className="empty"><span className="empty-mark">¥</span><h2>至少两次盘点后可以比较</h2><p>再完成一次盘点，这里就能显示每个账户带来了多少变化。</p></div>
    <article className="ui-card ui-content">
      <div className="ui-section-head"><h3>单账户历史</h3><Info text={NOTE}/></div>
      <HistoryTable accounts={accounts} expanded={expanded} toggle={toggle} history={history} retry={loadHistory}/>
    </article>
  </>;
  // 起点必须早于终点：不满足时自动把另一端调到相邻的合法日期，不弹错误（17.14.4.1）。
  const idx = (id: string) => points.findIndex(p => p.snapshot_id === id);
  const setFrom = (id: string) => {
    const i = idx(id), t = idx(range.to);
    if (i < 0) return;
    if (i < t) setRange({ from: id, to: range.to });
    else if (i < points.length - 1) setRange({ from: id, to: points[i + 1].snapshot_id });
    else setRange({ from: points[points.length - 2].snapshot_id, to: points[points.length - 1].snapshot_id });
  };
  const setTo = (id: string) => {
    const i = idx(id), f = idx(range.from);
    if (i < 0) return;
    if (i > f) setRange({ from: range.from, to: id });
    else if (i > 0) setRange({ from: points[i - 1].snapshot_id, to: id });
    else setRange({ from: points[0].snapshot_id, to: points[1].snapshot_id });
  };
  const dateSelect = (label: string, value: string, onChange: (id: string) => void) =>
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{points.map(p => <option key={p.snapshot_id} value={p.snapshot_id}>{p.date}{!p.complete && '（不完整）'}</option>)}</select>;
  const counted = sortRows(compare ? compare.rows.filter(r => r.group !== 'uncounted') : [], sort);
  const uncounted = compare ? sortRows(compare.rows.filter(r => r.group === 'uncounted'), sort) : [];
  const reason = compare ? [compare.from.missing ? `起点盘点缺 ${compare.from.missing} 个账户` : '', compare.to.missing ? `终点盘点缺 ${compare.to.missing} 个账户` : '', compare.rows.some(r => r.group === 'scope_changed') ? '有账户改变了计入设置' : ''].filter(Boolean).join('；') : '';
  return <>
    {notice && <p className="notice" role="status">{notice}</p>}
    <article className="ui-card ui-content changes-controls">
      <label>从 {dateSelect('起点盘点', range.from, setFrom)}</label>
      <label>到 {dateSelect('终点盘点', range.to, setTo)}</label>
      <button onClick={() => { const fresh = defaultRange(points); if (fresh) setRange(fresh); }}>与上次</button>
      <Info text={NOTE}/>
    </article>
    {error ? <article className="ui-card ui-content" role="alert"><p>变化读取失败：{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></article>
      : !compare ? <p role="status" className="muted">正在读取账户变化…</p>
      : <>
        <div className="ui-metrics ui-card">
          <article><span>金融净资产变化</span><strong>{compare.reconciled ? changeText(compare.net_change_cents!) : '—'}</strong><em>{compare.reconciled && compare.net_rate_hundredths !== null ? rateText(compare.net_rate_hundredths) : ''}</em></article>
          <article><span>资产变化</span><strong>{compare.reconciled ? changeText(compare.assets_change_cents!) : '—'}</strong><em>计入范围</em></article>
          <article><span>负债变化</span><strong>{compare.reconciled ? changeText(compare.liabilities_change_cents!) : '—'}</strong><em>计入范围</em></article>
        </div>
        {!compare.reconciled && reason && <p className="muted">{reason}</p>}
        <article className="ui-card ui-content">
          <div className="ui-section-head"><h3>账户变化</h3>
            <div className="segmented changes-sort" role="group" aria-label="排序方式">
              <button aria-pressed={sort === 'impact'} onClick={() => setSort('impact')}>按影响</button>
              <button aria-pressed={sort === 'kind'} onClick={() => setSort('kind')}>按类型</button>
            </div>
          </div>
          <table className="ui-table changes-table">
            <thead><tr><th>账户</th><th className="col-kind">类型</th><th>起点</th><th>终点</th><th>变化</th><th>对净资产</th><th className="col-rate">变化率</th><th><span className="visually-hidden">展开历史</span></th></tr></thead>
            <tbody>{counted.map(r => <ChangesRow key={r.account_id} r={r} open={expanded.has(r.account_id)} onToggle={toggle} history={history.get(r.account_id)} onRetry={loadHistory}/>)}</tbody>
            <tfoot><tr><td colSpan={8}>{compare.reconciled
              ? <span>合计（计入净资产） <strong>{changeText(compare.known_effect_cents)}</strong> ＝ 净资产变化 ✓</span>
              : <span>已知账户变化合计 <strong>{changeText(compare.known_effect_cents)}</strong>{compare.missing_names.length > 0 && <span className="muted">（缺 {compare.missing_names.length} 个账户：{compare.missing_names.join('、')}）</span>}</span>}</td></tr></tfoot>
          </table>
        </article>
        {uncounted.length > 0 && <article className="ui-card ui-content">
          <div className="ui-section-head"><h3>不计入净资产</h3><Info text="这些账户的变化单独列出，不进合计，也不改变金融净资产。"/></div>
          <table className="ui-table changes-table">
            <thead><tr><th>账户</th><th className="col-kind">类型</th><th>起点</th><th>终点</th><th>变化</th><th>对净资产</th><th className="col-rate">变化率</th><th><span className="visually-hidden">展开历史</span></th></tr></thead>
            <tbody>{uncounted.map(r => <ChangesRow key={r.account_id} r={r} open={expanded.has(r.account_id)} onToggle={toggle} history={history.get(r.account_id)} onRetry={loadHistory}/>)}</tbody>
          </table>
        </article>}
        <article className="ui-card ui-content">
          <div className="ui-section-head"><h3>结构变化</h3><span className="muted">计入范围 · 资产按类型{compare.from.complete && compare.to.complete ? '' : ' · 仅已知部分'}</span></div>
          {compare.structure.length ? <table className="ui-table changes-structure"><thead><tr><th>类型</th><th>起点</th><th>终点</th><th>占比变化（百分点）</th></tr></thead>
            <tbody>{compare.structure.map(s => {
              const delta = s.from_share !== null && s.to_share !== null ? s.to_share - s.from_share : null;
              const end = (cents: string | null, share: number | null) => cents === null || share === null ? <span className="muted">—</span> : <>{money(cents)} · {(share / 100).toFixed(2)}%</>;
              return <tr key={s.kind}><td>{kindLabel(s.kind)}</td><td>{end(s.from_cents, s.from_share)}</td><td>{end(s.to_cents, s.to_share)}</td><td>{delta === null ? <span className="muted">—</span> : `${delta < 0 ? '−' : '+'}${(Math.abs(delta) / 100).toFixed(2)}`}</td></tr>;
            })}</tbody></table>
            : <p className="muted">没有计入的资产。</p>}
        </article>
      </>}
  </>;
}

function HistoryTable({ accounts, expanded, toggle, history, retry }: {
  accounts: Account[]; expanded: Set<string>; toggle: (id: string) => void; history: Map<string, HistoryState>; retry: (id: string) => void;
}) {
  return <table className="ui-table"><thead><tr><th>账户</th><th>最近金额</th><th><span className="visually-hidden">展开历史</span></th></tr></thead>
    <tbody>{accounts.map(a => <Fragment key={a.id}>
      <tr>
        <td><strong>{a.fields.name}</strong>{a.fields.institution && <small className="muted"> · {a.fields.institution}</small>}{a.fields.closed_on && <small className="muted"> · 已停用</small>}</td>
        <td>{a.latest ? money(a.latest.amount_cents) : <span className="muted">尚未盘点</span>}</td>
        <td><button className="row-expand" aria-expanded={expanded.has(a.id)} aria-label={`${expanded.has(a.id) ? '收起' : '展开'}「${a.fields.name}」的盘点历史`} onClick={() => toggle(a.id)}>{expanded.has(a.id) ? '▾' : '▸'}</button></td>
      </tr>
      {expanded.has(a.id) && <tr className="history-row"><td colSpan={3}><HistoryBlock id={a.id} name={a.fields.name} side={a.fields.side} history={history.get(a.id)} onRetry={retry}/></td></tr>}
    </Fragment>)}</tbody></table>;
}

function ChangesRow({ r, open, onToggle, history, onRetry }: {
  r: CompareRow; open: boolean; onToggle: (id: string) => void; history: HistoryState | undefined; onRetry: (id: string) => void;
}) {
  return <>
    <tr>
      <td><strong>{r.name}</strong>{r.institution && <small className="muted"> · {r.institution}</small>}
        {r.tag === 'new' && <small className="row-tag">新增账户</small>}
        {r.tag === 'closed' && <small className="row-tag">已停用</small>}
        {r.group === 'scope_changed' && <small className="row-tag">计入范围变化</small>}
      </td>
      <td className="col-kind">{kindLabel(r.kind)}</td>
      <td>{cellText(r.from, r.side)}</td>
      <td>{cellText(r.to, r.side)}</td>
      <td>{r.change_cents === null ? <span className="muted">未知</span> : r.side === 'liability' ? `欠款 ${changeText(r.change_cents)}` : changeText(r.change_cents)}</td>
      <td>{r.group === 'uncounted' ? <span className="muted">不计入</span> : r.effect_cents === null ? <span className="muted">未知</span> : changeText(r.effect_cents)}</td>
      <td className="col-rate">{r.rate_hundredths === null ? '—' : rateText(r.rate_hundredths)}</td>
      <td><button className="row-expand" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}「${r.name}」的盘点历史`} onClick={() => onToggle(r.account_id)}>{open ? '▾' : '▸'}</button></td>
    </tr>
    {open && <tr className="history-row"><td colSpan={8}><HistoryBlock id={r.account_id} name={r.name} side={r.side} history={history} onRetry={onRetry}/></td></tr>}
  </>;
}

function HistoryBlock({ id, name, side, history, onRetry }: {
  id: string; name: string; side: 'asset' | 'liability'; history: HistoryState | undefined; onRetry: (accountId: string) => void;
}) {
  if (!history || history.status === 'loading') return <p role="status" className="muted">正在读取「{name}」的盘点历史…</p>;
  if (history.status === 'error') return <div role="alert"><p>历史读取失败：{history.message}</p><button onClick={() => onRetry(id)}>重新读取</button></div>;
  const data = history.data;
  // 未知金额不画 0：complete=false 让 NetChart 只留虚线标记（W-AC07）。
  const points: Point[] = data.rows.map(row => ({ snapshot_id: row.snapshot_id, date: row.date, assets_cents: row.amount_cents ?? '0', liabilities_cents: '0', net_cents: row.amount_cents ?? '0', complete: row.amount_cents !== null, missing: row.amount_cents === null ? 1 : 0, compared_to: null, scope_changed: false, change_cents: null, change_rate_hundredths: null }));
  const known = data.rows.filter(row => row.amount_cents !== null).length;
  return <div className="account-history">
    {known > 0 ? <NetChart points={points} label={`「${name}」的金额趋势，共 ${known} 次已知金额`}/> : <p className="muted">还没有已知金额。</p>}
    <table className="ui-table"><thead><tr><th>日期</th><th>金额</th><th>与前次</th><th>状态</th><th>计入</th></tr></thead>
      <tbody>{data.rows.map(row => <tr key={row.snapshot_id}>
        <td>{row.date}</td>
        <td>{row.amount_cents === null ? <span className="muted">未知</span> : side === 'liability' ? `欠 ${money(row.amount_cents)}` : money(row.amount_cents)}</td>
        <td>{row.change_cents === null ? <span className="muted">—</span> : side === 'liability' ? `欠款 ${changeText(row.change_cents)}` : changeText(row.change_cents)}</td>
        <td>{stateLabel(row.state)}</td>
        <td>{row.counted ? '计入' : '不计入'}</td>
      </tr>)}</tbody></table>
  </div>;
}
