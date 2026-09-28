import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { DateInput } from './DateInput';
import { batchSummary, dateError, earliestAction, stateBlock, type BatchRow } from './batch-select';

// D19 first batch: a selection panel in the summary column and one table per
// action. Every row starts at “保持不变”; “全部设为” fills a whole column.
export type BatchKind = 'classify' | 'label' | 'retire' | 'activate' | 'exclude' | 'delete';
export type BatchInput = { request_id: string; generation: string; action: Exclude<BatchKind, never>; items: Record<string, unknown>[] };
type Choice = { id: string; name: string; enabled: boolean };
const stateText = { active: '使用中', retired: '已退役', sold: '已售出' } as const;
const exclusionLabels = [['total', '总价'], ['daily', '日均'], ['statistics', '统计'], ['timeline', '时间轴']] as const;
export const batchVerb: Record<BatchKind, string> = { classify: '设置分类与渠道', label: '设置状态标签', retire: '退役', activate: '重新启用', exclude: '设置统计口径', delete: '删除' };

function useRows(ids: string[], version: number) {
  const [rows, setRows] = useState<BatchRow[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let live = true; setError('');
    invoke<BatchRow[]>('batch_rows', { ids }).then(r => { if (live) setRows(r); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [ids.join(','), version]);
  return { rows, error };
}

export function BatchPanel({ ids, version, onClear, onOpen }: { ids: string[]; version: number; onClear: () => void; onOpen: (kind: BatchKind) => void }) {
  const { rows, error } = useRows(ids, version);
  const s = rows ? batchSummary(rows) : null;
  const states = s ? [['active', s.states.active], ['retired', s.states.retired], ['sold', s.states.sold]].filter(([, n]) => n).map(([k, n]) => `${stateText[k as keyof typeof stateText]} ${n}`).join(' · ') : '';
  return <div className="summary-body batch-panel">
    <div className="panel-top"><span>批量操作</span><button aria-label="取消选择" onClick={onClear}>×</button></div>
    <h2 className="batch-count">已选 {ids.length} 件</h2>
    {error ? <p role="alert">{error}</p> : !s ? <p className="muted small" role="status">正在读取…</p> : <>
      <p className="muted small">{states}</p>
      <dl className="facts"><dt>购入合计</dt><dd>{money(s.total)}</dd><dt>金额未知</dt><dd>{s.unknown} 件</dd></dl>
      <div className="batch-actions">
        <button onClick={() => onOpen('classify')}>设置分类与渠道…</button>
        <button onClick={() => onOpen('label')}>设置状态标签…</button>
        {s.states.active > 0 && <button onClick={() => onOpen('retire')}>退役…</button>}
        {s.states.active === 0 && s.states.retired > 0 && <button onClick={() => onOpen('activate')}>重新启用…</button>}
        <button onClick={() => onOpen('exclude')}>统计口径…</button>
        <button className="danger" onClick={() => onOpen('delete')}>删除 {ids.length} 件…</button>
      </div>
    </>}
    <p className="muted batch-hint">⌘ 点击加选 · ⇧ 点击连选 · ⌘A 全选当前筛选结果 · Esc 取消</p>
  </div>;
}

type RowValue = { category: string; channel: string; label: string; on: boolean; date: string; exclude: BatchRow['exclude'] };
const KEEP = 'keep';

export function BatchDialog({ kind, ids, generation, today, onClose, onDone }: { kind: BatchKind; ids: string[]; generation: string; today: string; onClose: () => void; onDone: (input: BatchInput, changed: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), request = useRef<string | null>(null);
  const { rows, error } = useRows(ids, 0);
  const [choices, setChoices] = useState<Record<string, Choice[]>>({});
  const [values, setValues] = useState<Record<string, RowValue>>({});
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    const kinds = kind === 'classify' ? ['category', 'channel'] : kind === 'label' ? ['label'] : [];
    void Promise.all(kinds.map(k => invoke<{ items: Choice[] }>('choice_list', { kind: k }).then(r => [k, r.items.filter(i => i.enabled)] as const)))
      .then(list => setChoices(Object.fromEntries(list))).catch(e => setNotice(errorMessage(e)));
  }, [kind]);
  useEffect(() => {
    if (!rows) return;
    const action = kind === 'activate' ? 'activate' : 'retire';
    setValues(Object.fromEntries(rows.map(r => [r.id, { category: KEEP, channel: KEEP, label: KEEP, on: (kind === 'retire' || kind === 'activate') && !stateBlock(r, action), date: today, exclude: { ...r.exclude } }])));
  }, [rows]);
  // Any edit after a failed save starts a new request; an unchanged retry
  // reuses the id, so a reply lost after commit cannot apply twice.
  function set(id: string, part: Partial<RowValue>) { request.current = null; setValues(v => ({ ...v, [id]: { ...v[id], ...part } })); }
  function fill(part: Partial<RowValue>) { request.current = null; setValues(v => Object.fromEntries(Object.entries(v).map(([id, value]) => { const row = rows?.find(r => r.id === id); return [id, row && blocked(row) ? value : { ...value, ...part }]; }))); }
  const action = kind === 'activate' ? 'activate' : 'retire';
  const blocked = (r: BatchRow) => (kind === 'retire' || kind === 'activate') ? stateBlock(r, action) : '';
  const norm = (v: string | null) => v ?? '';
  function change(r: BatchRow): Record<string, unknown> | null {
    const v = values[r.id]; if (!v || blocked(r)) return null;
    const base = { asset_id: r.id, expected_revision: r.revision };
    if (kind === 'classify') {
      const item: Record<string, unknown> = { ...base };
      if (v.category !== KEEP && v.category !== norm(r.category_id)) item.category_id = v.category || null;
      if (v.channel !== KEEP && v.channel !== norm(r.channel_id)) item.channel_id = v.channel || null;
      return Object.keys(item).length > 2 ? item : null;
    }
    if (kind === 'label') return v.label !== KEEP && v.label !== norm(r.label_id) ? { ...base, label_id: v.label || null } : null;
    if (kind === 'exclude') return JSON.stringify(v.exclude) !== JSON.stringify(r.exclude) ? { ...base, exclude: v.exclude } : null;
    if (kind === 'retire' || kind === 'activate') return v.on ? { ...base, date: v.date } : null;
    return base;
  }
  const items = rows ? rows.map(change).filter((i): i is Record<string, unknown> => !!i) : [];
  const invalid = (kind === 'retire' || kind === 'activate') && !!rows?.some(r => values[r.id]?.on && !blocked(r) && dateError(r, values[r.id].date, today));
  async function save() {
    if (busy || !items.length || invalid) return;
    setBusy(true); setNotice('');
    request.current ??= crypto.randomUUID();
    const input: BatchInput = { request_id: request.current, generation, action: kind, items };
    try { const out = await invoke<{ changed: number }>('batch_change', { input }); onDone(input, out.changed); }
    catch (e) { setNotice(errorMessage(e) + ' 本次没有保存任何更改。'); }
    finally { setBusy(false); }
  }
  const options = (list: Choice[] | undefined, empty: string) => [<option key={KEEP} value={KEEP}>保持不变</option>, <option key="none" value="">{empty}</option>, ...(list ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)];
  const nameOf = (list: Choice[] | undefined, id: string | null, empty: string) => id ? list?.find(c => c.id === id)?.name ?? '已停用的项' : empty;
  const changed = (r: BatchRow) => !!change(r);
  const title = kind === 'delete' ? `删除 ${ids.length} 件物品？` : `${kind === 'classify' ? '批量分类' : kind === 'label' ? '批量状态标签' : kind === 'exclude' ? '批量统计口径' : kind === 'retire' ? '批量退役' : '批量重新启用'} · 为 ${ids.length} 件物品分别设置`;
  const note = { classify: '每行默认保持不变；在“全部设为”选择可一次填满整列，再单独改个别行。', label: '每行默认保持不变；在“全部设为”选择可一次填满整列。', exclude: '勾选表示不计入对应口径；表头可整列勾选或取消。', retire: '日期默认今天，不早于购入与上一条状态记录；不适用的行不参与保存。', activate: '日期默认今天，不早于上一条状态记录；不适用的行不参与保存。', delete: '删除用于录错或重复的记录。这些物品及它们的维护、保障、关联支出会从各处隐藏，可从“最近删除”逐件恢复。已经不用、送人或丢失了？请改用“退役”；卖掉了请用“售出”。' }[kind];
  return <dialog ref={dialog} className="editor batch-editor" aria-labelledby="batch-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="eyebrow">物品 · 批量操作</p><h2 id="batch-title">{title}</h2><p className="muted">{note}</p></div>
      <div className="editor-header-actions"><button disabled={busy} onClick={onClose}>取消</button><button className={kind === 'delete' ? 'danger' : 'primary'} disabled={busy || !items.length || invalid} onClick={() => void save()}>{busy ? '正在保存…' : kind === 'delete' ? `移入最近删除` : `保存 ${items.length} 项更改`}</button></div></header>
    {notice && <p className="notice" role="alert">{notice}</p>}
    {error ? <p role="alert">{error}</p> : !rows ? <p className="muted" role="status">正在读取…</p> : kind === 'delete'
      ? <ul className="batch-names">{rows.slice(0, 8).map(r => <li key={r.id}>{r.name}</li>)}{rows.length > 8 && <li className="muted">等共 {rows.length} 件</li>}</ul>
      : <table className="distribution-table check-in-table"><thead>{kind === 'classify' ? <tr><th>物品</th><th>当前分类</th><th>新分类</th><th>当前渠道</th><th>新渠道</th></tr>
        : kind === 'label' ? <tr><th>物品</th><th>当前标签</th><th>新标签</th></tr>
        : kind === 'exclude' ? <tr><th>物品</th>{exclusionLabels.map(([k, l]) => <th key={k}>不计入{l}</th>)}</tr>
        : <tr><th>物品</th><th>当前状态</th><th>{batchVerb[kind]}</th><th>日期</th></tr>}</thead>
        <tbody>
          <tr className="batch-fill"><td><strong>全部设为</strong></td>{kind === 'classify' ? <><td/><td><select aria-label="全部设为分类" value="" onChange={e => fill({ category: e.target.value === '-' ? '' : e.target.value })}><option value="" disabled>选择…</option><option value="-">未分类</option>{choices.category?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td><td/><td><select aria-label="全部设为渠道" value="" onChange={e => fill({ channel: e.target.value === '-' ? '' : e.target.value })}><option value="" disabled>选择…</option><option value="-">未选择</option>{choices.channel?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td></>
            : kind === 'label' ? <><td/><td><select aria-label="全部设为标签" value="" onChange={e => fill({ label: e.target.value === '-' ? '' : e.target.value })}><option value="" disabled>选择…</option><option value="-">未设置</option>{choices.label?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td></>
            : kind === 'exclude' ? exclusionLabels.map(([k, l]) => { const all = rows.every(r => values[r.id]?.exclude[k]); return <td key={k}><label><input type="checkbox" aria-label={'全部不计入' + l} checked={all} onChange={e => { request.current = null; setValues(v => Object.fromEntries(Object.entries(v).map(([id, value]) => [id, { ...value, exclude: { ...value.exclude, [k]: e.target.checked } }]))); }}/> 整列</label></td>; })
            : <><td/><td><label><input type="checkbox" aria-label={'全部' + batchVerb[kind]} checked={rows.filter(r => !blocked(r)).every(r => values[r.id]?.on)} onChange={e => fill({ on: e.target.checked })}/> {batchVerb[kind]}</label></td><td><DateInput id="batch-fill-date" label="全部设为日期" value={today} max={today} onChange={v => v && fill({ date: v })}/></td></>}</tr>
          {rows.map(r => { const v = values[r.id]; if (!v) return null; const reason = blocked(r); const err = (kind === 'retire' || kind === 'activate') && v.on && !reason ? dateError(r, v.date, today) : '';
            return <tr key={r.id} aria-disabled={!!reason || undefined}><td><strong>{r.name}</strong></td>
              {kind === 'classify' ? <><td>{nameOf(choices.category, r.category_id, '未分类')}</td><td><select aria-label={r.name + ' 新分类'} value={v.category} onChange={e => set(r.id, { category: e.target.value })}>{options(choices.category, '未分类')}</select>{v.category !== KEEP && v.category !== norm(r.category_id) && <small className="batch-changed">将更改</small>}</td><td>{nameOf(choices.channel, r.channel_id, '未选择')}</td><td><select aria-label={r.name + ' 新渠道'} value={v.channel} onChange={e => set(r.id, { channel: e.target.value })}>{options(choices.channel, '未选择')}</select>{v.channel !== KEEP && v.channel !== norm(r.channel_id) && <small className="batch-changed">将更改</small>}</td></>
              : kind === 'label' ? <><td>{nameOf(choices.label, r.label_id, '未设置')}</td><td><select aria-label={r.name + ' 新标签'} value={v.label} onChange={e => set(r.id, { label: e.target.value })}>{options(choices.label, '未设置')}</select>{changed(r) && <small className="batch-changed">将更改</small>}</td></>
              : kind === 'exclude' ? exclusionLabels.map(([k, l]) => <td key={k}><input type="checkbox" aria-label={`${r.name} 不计入${l}`} checked={v.exclude[k]} onChange={e => set(r.id, { exclude: { ...v.exclude, [k]: e.target.checked } })}/></td>)
              : reason ? <><td>{stateText[r.state]}</td><td colSpan={2}>{reason}，不参与保存</td></>
              : <><td>{stateText[r.state]}</td><td><label><input type="checkbox" aria-label={`${r.name} ${batchVerb[kind]}`} checked={v.on} onChange={e => set(r.id, { on: e.target.checked })}/> {batchVerb[kind]}</label></td><td><DateInput id={'batch-date-' + r.id} label={r.name + ' 日期'} value={v.date} min={earliestAction(r)} max={today} disabled={!v.on} invalid={!!err} onChange={d => d && set(r.id, { date: d })}/>{err && <small className="error">{err}</small>}</td></>}
            </tr>; })}
        </tbody></table>}
  </dialog>;
}
