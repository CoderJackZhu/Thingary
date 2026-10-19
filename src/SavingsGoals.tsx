import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CentInput, FormRow } from './FormControls';
import { DateInput } from './DateInput';
import { YearSelect } from './YearSelect';
import { CloseButton } from './CloseButton';
import { kindLabel, storedPending, Unresolved } from './wealth';
import { useRestored } from './undo';
import { writeSavingsGoal } from './savings-goals-port';
import { savingsAccountEligible, savingsProgress, savingsRestricted } from './savings-goals';
import type { SavingsGoal, SavingsGoalView, SavingsRead } from './savings-goals';
import './savings-goals.css';

export function financialAmountsHidden() { try { return localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { return false; } }

export function SavingsGoals({ generation, today, version, compact = false, hideAmounts, blocked = false, onEditingChange, onPendingChange, onManage, onNewAccount, focusRequested = false, onFocusDone }: {
  generation: string; today: string; version?: unknown; compact?: boolean; hideAmounts?: boolean; blocked?: boolean;
  onEditingChange?: (editing: boolean) => void; onPendingChange?: () => void; onManage?: () => void; onNewAccount?: () => void; focusRequested?: boolean; onFocusDone?: () => void;
}) {
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [attempt, setAttempt] = useState(0), [localHidden, setLocalHidden] = useState(financialAmountsHidden);
  const scope = JSON.stringify([generation, compact ? null : year, version, attempt]);
  const [state, setState] = useState<{ scope: string; data: SavingsRead | null; error: string } | null>(null);
  const [editing, setEditing] = useState<{ goal: SavingsGoal | null; data: SavingsRead } | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [armed, setArmed] = useState<string | null>(null);
  const lock = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const reload = () => setAttempt(n => n + 1);
  useRestored(reload);
  useEffect(() => {
    let live = true;
    invoke<SavingsRead>('savings_goals_read', { generation, year: compact ? null : year }).then(data => {
      if (live) setState({ scope, data: data.generation === generation ? data : null, error: data.generation === generation ? '' : '资料已切换，请重新读取。' });
    }).catch(e => { if (live) setState({ scope, data: null, error: errorMessage(e) }); });
    return () => { live = false; };
  }, [scope]);
  useEffect(() => { onEditingChange?.(!!editing || busy); return () => onEditingChange?.(false); }, [editing, busy, onEditingChange]);
  const data = state?.scope === scope ? state.data : null;
  const error = state?.scope === scope ? state.error : '';
  const hidden = hideAmounts ?? localHidden;
  const frozen = blocked || busy || !!storedPending();
  const hasEligibleAccount = !!data?.accounts.some(account => savingsAccountEligible(account, today));
  useEffect(() => {
    if (!focusRequested || (!data && !error)) return;
    heading.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
    onFocusDone?.();
  }, [focusRequested, data, error, onFocusDone]);
  async function remove(g: SavingsGoal) {
    if (lock.current || frozen) return;
    lock.current = true; setBusy(true); setNotice('');
    try { await writeSavingsGoal('savings_goals_trash', { request_id: crypto.randomUUID(), generation, id: g.id, expected_revision: g.revision, deleted: true }, '删除存钱目标'); setArmed(null); reload(); }
    catch (e) { setNotice(errorMessage(e)); onPendingChange?.(); }
    finally { lock.current = false; setBusy(false); }
  }
  if (compact && !error && (!data || !data.goals.length)) return null;
  return <section className="ui-card ui-content savings-goals" aria-label="存钱目标">
    <div className="ui-section-head"><h3 ref={heading} tabIndex={-1}>存钱目标</h3>{compact && onManage && <button type="button" className="ui-link" onClick={onManage}>管理目标 →</button>}{!compact && <div className="savings-actions"><button type="button" onClick={() => { const value = !localHidden; setLocalHidden(value); try { localStorage.setItem('thingary.hide-financial-amounts.v1', value ? '1' : '0'); } catch { /* display preference only */ } }}>{hidden ? '显示目标金额' : '隐藏目标金额'}</button><button type="button" disabled={!data || frozen || (!hasEligibleAccount && !onNewAccount)} onClick={() => { if (!data || frozen) return; if (hasEligibleAccount) setEditing({ goal: null, data }); else onNewAccount?.(); }}>{data && !hasEligibleAccount ? '先添加资产账户' : '新增存钱目标'}</button></div>}</div>
    {(!compact || !!data?.goals.length) && <p className="muted small">{data?.goals.length ? '关联账户余额仅作参考，不预留或扣减资金，也不调整退休规划。余额达标不代表可立即动用。' : '为应急金、旅行等设定金额并关联账户，每次完整盘点后查看进度。'}</p>}
    {notice && <p role="alert">{notice}</p>}
    {error ? <p role="alert">存钱目标读取失败：{error}<button type="button" onClick={reload}>重新读取</button></p> : !data ? <p role="status">正在读取存钱目标…</p> : <>
      {!compact && !hasEligibleAccount && <p className="muted">存钱目标需要关联一个可用的资产账户。先添加账户，再设置目标；房产和负债不能关联。</p>}
      {(hasEligibleAccount || data.goals.length > 0) && (data.basis ? <p className="muted small">依据 {data.basis.date} 完整盘点{data.newer_incomplete ? '；较新的记录不完整，仍采用这次完整盘点' : ''}</p> : <p className="muted">尚无完整盘点，余额与进度暂未知。</p>)}
      {!data.goals.length ? hasEligibleAccount ? <p className="ui-empty">设一个目标，每次盘点后看余额离目标多远。</p> : null : <div className="savings-grid">{(compact ? data.goals.slice(0, 2) : data.goals).map(view => <GoalCard key={view.goal.id} view={view} data={data} hidden={hidden} compact={compact} onEdit={() => setEditing({ goal: view.goal, data })} onDelete={() => armed === view.goal.id ? void remove(view.goal) : setArmed(view.goal.id)} armed={armed === view.goal.id} disabled={frozen}/>)}</div>}
      {compact && data.goals.length > 2 && <p className="muted small">共 {data.goals.length} 个目标，这里显示前 2 个；其余可在管理目标中查看。</p>}
      {!compact && !!data.goals.length && <div className="savings-history"><YearSelect value={year} todayYear={Number(today.slice(0, 4))} recorded={data.years} intent="records" onChange={setYear} disabled={!!editing || frozen}/><span className="muted small">历史按当前目标设置回看；改金额或账户会改变曲线，不表示当时已预留资金。</span></div>}
    </>}
    {editing && <GoalEditor key={`${generation}:${editing.goal?.id ?? 'new'}`} generation={generation} today={today} initial={editing.goal} data={editing.data} onClose={saved => { setEditing(null); onPendingChange?.(); if (saved) reload(); }}/>}
  </section>;
}

function GoalCard({ view, data, hidden, compact, onEdit, onDelete, armed, disabled }: { view: SavingsGoalView; data: SavingsRead; hidden: boolean; compact: boolean; onEdit: () => void; onDelete: () => void; armed: boolean; disabled: boolean }) {
  const g = view.goal, p = savingsProgress(g.fields, view.observations, data.basis, data.today);
  const amount = (cents: string | null) => hidden ? '******' : cents === null ? '—' : money(cents);
  return <article className="savings-card">
    <div className="ui-section-head"><h4>{g.fields.name}</h4>{!compact && <div className="savings-actions"><button type="button" disabled={disabled} onClick={onEdit}>编辑</button><button type="button" className="danger" disabled={disabled} onClick={onDelete}>{armed ? '确认移入最近删除' : '删除…'}</button></div>}</div>
    <p className="savings-amount">{!p.complete ? '已知部分 ' : ''}<strong>{amount(p.known_cents)}</strong><span> / {amount(g.fields.target_cents)}</span></p>
    {!hidden && p.percent_hundredths !== null && <progress max={10000} value={p.percent_hundredths} aria-label={`${g.fields.name}关联余额进度`}/>}
    <p>{p.reached === null ? `${p.missing} 个账户余额未知${p.unavailable ? `，${p.unavailable} 个关联账户需处理` : ''}` : p.reached ? '该次盘点余额达标' : `还差 ${amount(p.gap_cents)}`}</p>
    {!compact && g.fields.target_date && <p className="muted small">目标日期 {g.fields.target_date}{p.deadline === 'past' ? ' · 目标日期已过' : p.deadline === 'today' ? ' · 目标日期为今天' : p.deadline === 'this_month' ? ' · 目标在本月，请直接核对差额' : ''}</p>}
    {!compact && p.monthly_cents !== null && <p>按该次盘点计算，每月平均还需 {amount(p.monthly_cents)}<small className="muted">（从盘点下个月起，含目标月，共 {p.months} 个月；不计收益、费用或期间实际收支）</small></p>}
    {!!view.shared_account_ids.length && <p className="muted small">部分账户也关联其他目标，资金未分别预留。</p>}
    {view.planning_overlap === true && <p className="muted small">关联资金也用于退休规划，本目标不会从中扣减。</p>}
    {view.planning_overlap === null && <p className="muted small">规划来源未读取，暂不能判断资金是否重复使用。</p>}
    {view.observations.some(o => savingsRestricted(o.kind)) && <p className="muted small">包含可能受限的账户，这里只比较账面余额。</p>}
    {!compact && <details><summary>关联账户与历史回看</summary><ul>{view.observations.map(o => <li key={o.account_id}>{o.name} · {kindLabel(o.kind)} · {o.status === 'known' ? amount(o.amount_cents) : o.reason}</li>)}</ul>
      <p className="muted small">{data.year} 年 · 按当前目标金额和关联账户回看；从 {g.created_on} 建立后开始展示。</p>
      {!hidden && <GoalHistoryChart view={view} today={data.today}/>}
      {!view.history.length ? <p>该年没有目标建立后的完整盘点记录。</p> : <div className="table-scroll"><table className="ui-table"><thead><tr><th>盘点日期</th><th>关联余额</th><th>口径</th></tr></thead><tbody>{view.history.map(h => { const hp = savingsProgress(g.fields, h.observations, h.basis, data.today); return <tr key={h.basis.snapshot_id}><td>{h.basis.date}</td><td>{amount(hp.known_cents)}</td><td>{!hp.complete ? '账户金额缺失，不能完整比较' : hp.reached ? '按当前设置余额达标' : '按当前设置回看'}</td></tr>; })}</tbody></table></div>}
    </details>}
  </article>;
}

function GoalHistoryChart({ view, today }: { view: SavingsGoalView; today: string }) {
  const rows = view.history.map(h => ({ date: h.basis.date, progress: savingsProgress(view.goal.fields, h.observations, h.basis, today) }));
  const known = rows.filter(r => r.progress.complete);
  if (known.length < 2) return <p className="muted small">完整目标余额不足两次，暂不画趋势。</p>;
  const values = known.map(r => Number(r.progress.known_cents)), target = Number(view.goal.fields.target_cents);
  const min = Math.min(...values, target), max = Math.max(...values, target), span = max - min || 1;
  const day = (date: string) => Date.parse(date + 'T00:00:00Z');
  const start = day(rows[0].date), duration = Math.max(86400000, day(rows.at(-1)!.date) - start);
  const x = (date: string) => 12 + (day(date) - start) / duration * 576;
  const y = (cents: string | number) => 112 - (Number(cents) - min) / span * 92;
  let connect = false;
  const path = rows.map(r => {
    if (!r.progress.complete || r.progress.known_cents === null) { connect = false; return ''; }
    const value = `${connect ? 'L' : 'M'}${x(r.date)} ${y(r.progress.known_cents)}`; connect = true; return value;
  }).join(' ');
  return <figure className="savings-chart"><figcaption className="muted small">关联余额趋势 · 缺项处断开，虚线为当前目标金额</figcaption><svg viewBox="0 0 600 140" role="img" aria-label="按当前目标设置回看的关联余额趋势"><line x1="12" x2="588" y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeDasharray="5 4"/><path d={path} fill="none" stroke="var(--accent)" strokeWidth="2"/>{known.map(r => <circle key={r.date} cx={x(r.date)} cy={y(r.progress.known_cents!)} r="3" fill="var(--accent)"><title>{r.date} · {money(r.progress.known_cents)}</title></circle>)}</svg><div className="savings-chart-dates"><span>{rows[0].date}</span><span>{rows.at(-1)!.date}</span></div></figure>;
}

function GoalEditor({ generation, today, initial, data, onClose }: { generation: string; today: string; initial: SavingsGoal | null; data: SavingsRead; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [fields, setFields] = useState(initial?.fields ?? { name: '', target_cents: '', target_date: null as string | null, notes: '' });
  const [ids, setIds] = useState(initial?.account_ids ?? []);
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>('input')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => setFields(f => ({ ...f, [key]: value }));
  const candidates = data.accounts.filter(a => savingsAccountEligible(a, today));
  const old = data.goals.find(v => v.goal.id === initial?.id)?.observations ?? [];
  const invalid = old.filter(o => !candidates.some(a => a.id === o.account_id));
  async function save() {
    if (lock.current || stuck) return;
    if (!fields.name.trim() || !/^\d+$/.test(fields.target_cents) || BigInt(fields.target_cents) <= 0n || !ids.length) { setError('请填写名称、正的目标金额，并至少关联一个账户。'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await writeSavingsGoal('savings_goals_save', { request_id: crypto.randomUUID(), generation, id: initial?.id ?? null, expected_revision: initial?.revision ?? null, fields, account_ids: ids }, '存钱目标'); onClose(true); }
    catch (e) { setStuck(e instanceof Unresolved); setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const toggle = (id: string, checked: boolean) => setIds(current => checked ? [...current.filter(v => v !== id), id] : current.filter(v => v !== id));
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="savings-goal-editor-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 存钱目标</p><h2 id="savings-goal-editor-heading">{initial ? '编辑存钱目标' : '新增存钱目标'}</h2></div><CloseButton type="button" aria-label="关闭存钱目标表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存目标'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="名称"><input aria-label="目标名称" value={fields.name} maxLength={60} disabled={busy || stuck} onChange={e => set('name', e.target.value)} placeholder="例如 应急金"/></FormRow>
      <FormRow label="目标金额"><CentInput label="目标金额" value={fields.target_cents} disabled={busy || stuck} onChange={v => set('target_cents', v)}/></FormRow>
      <FormRow label="目标日期" hint="可留空；有日期才显示按盘点计算的月度补足参考"><DateInput value={fields.target_date ?? ''} yearIntent="near" allowClear disabled={busy || stuck} onChange={v => set('target_date', v || null)}/></FormRow>
      <fieldset disabled={busy || stuck}><legend>关联资产账户</legend><p className="muted small">不预留资金；受限余额或投资估值不保证可立即动用。房产不提供关联。</p>{candidates.map(a => <label className="savings-account-choice" key={a.id}><input type="checkbox" checked={ids.includes(a.id)} onChange={e => toggle(a.id, e.target.checked)}/>{a.fields.name} · {kindLabel(a.fields.kind)}{savingsRestricted(a.fields.kind) ? '（可能受限）' : ''}</label>)}{invalid.map(o => <label className="savings-account-choice" key={o.account_id}><input type="checkbox" checked={ids.includes(o.account_id)} disabled={!ids.includes(o.account_id)} onChange={e => toggle(o.account_id, e.target.checked)}/>{o.name}（旧关联需处理，可取消）</label>)}{!candidates.length && <p>先添加可关联的资产账户。</p>}</fieldset>
      {initial && <p className="muted small">修改金额或关联账户后，历史将按新设置重新回看。</p>}
    </section>
    <section className="form-block form-notes"><label>备注<textarea maxLength={500} value={fields.notes} disabled={busy || stuck} onChange={e => set('notes', e.target.value)}/></label></section>
    {error && <p className="notice" role="alert">{error}</p>}
  </form></dialog>;
}
