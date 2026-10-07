import { useEffect, useRef, useState } from 'react';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info } from './FormControls';
import { MissingList } from './PlanningRequirement';
import type { BasicCapabilities, PlanningMissing, PlanningSources, ProfileState } from './plan';
import { draftOf, fundsInput } from './planning-basic-forms';
import type { Draft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { kindLabel } from './wealth';
import type { Account, Snapshot } from './wealth';

/** Account purposes, future housing-fund deposit and an existing personal-pension account. Used by setup and by the funds card. */
export function FundsEditor({ d, patch, frozen, snapshot, accounts, live }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; snapshot: Snapshot | null; accounts: Account[]; live: boolean }) {
  const name = (id: string, kind: string) => accounts.find(a => a.id === id)?.fields.name ?? `${kindLabel(kind)}（历史账户）`;
  const assets = snapshot?.entries.filter(e => e.counted && e.side === 'asset') ?? [];
  const update = (id: string, v: Partial<Draft['funds'][number]>) => patch({ funds: d.funds.map(f => f.account_id === id ? { ...f, ...v } : f) });
  return <>
    {live && snapshot && <>
      <p className="muted small">截至 {snapshot.date} 的完整盘点。这里只设资金是否参与规划，不改变实际余额；建议现金可动用、其他资产受限，请确认。</p>
      {assets.map(e => { const rule = d.funds.find(f => f.account_id === e.account_id); if (!rule) return null; const label = name(e.account_id, e.kind); return <FormRow key={e.account_id} label={label} hint={`${kindLabel(e.kind)} · 已记录 ${money(e.amount_cents)}`}><select aria-label={`${label}规划用途`} value={rule.availability} disabled={frozen} onChange={v => update(e.account_id, { availability: v.target.value as typeof rule.availability })}><option value="available" disabled={e.kind === 'housing_fund'}>可动用</option><option value="restricted">受限：暂不能动用</option><option value="excluded">本计划不参与</option></select><input type="number" aria-label={`${label}参与比例`} min="0" max="100" value={rule.share_hundredths / 100} disabled={frozen} onChange={v => update(e.account_id, { share_hundredths: Math.round(Number(v.target.value) * 100) })}/> %</FormRow>; })}
    </>}
    <FormRow label="未来公积金月缴存" hint="留空表示未知；明确没有填 0"><CentInput label="未来公积金月缴存" value={d.hpf} disabled={frozen} placeholder="0.00" onChange={v => patch({ hpf: v })}/></FormRow>
    {live && snapshot && <details open={!!d.ppAccount}><summary>已有个人养老金余额</summary>
      <FormRow label="关联个人养老金账户" hint="仅参与比例 100% 的受限账户"><select aria-label="关联个人养老金账户" value={d.ppAccount} disabled={frozen} onChange={e => patch({ ppAccount: e.target.value, ppConfirmed: false })}><option value="">明确没有已有余额</option>{assets.filter(e => e.kind !== 'housing_fund' && d.funds.some(x => x.account_id === e.account_id && x.availability === 'restricted' && x.share_hundredths === 10000)).map(e => <option key={e.account_id} value={e.account_id}>{name(e.account_id, e.kind)} · {money(e.amount_cents)}</option>)}</select></FormRow>
      <label><input type="checkbox" aria-label="确认已有个人养老金余额" checked={d.ppConfirmed} disabled={frozen} onChange={e => patch({ ppConfirmed: e.target.checked })}/> 我已核对余额；未关联账户表示没有已有余额</label>
    </details>}
  </>;
}

/** Goals-page card: shared funds capability plus one action to confirm purposes (funds section only). */
export function FundsCard({ caps, sources, saved, snapshot, accounts, today, reload, onPending, onEditingChange, openRef }: { caps: BasicCapabilities; sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; openRef?: React.MutableRefObject<(() => void) | null> }) {
  const [editing, setEditing] = useState(false), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  useEffect(() => { if (openRef) openRef.current = () => setEditing(true); }, [openRef]);
  const f = caps.funds;
  const close = (ok: boolean) => { setEditing(false); if (ok) reload(); requestAnimationFrame(() => button.current?.focus()); };
  return <article className="ui-card ui-content" aria-label="规划资金">
    <div className="ui-section-head"><h3>规划资金<Info text="规划可用资金与受限资金分别计算，债务本金不先扣现金。资金范围需要你明确确认。"/></h3><button ref={button} className="ui-btn" onClick={() => setEditing(true)}>核对资金范围</button></div>
    {f.status === 'ready' ? <p>{f.value.kind === 'simulation' ? '模拟起点' : '实际盘点'}，截至 {f.value.date} · 规划可用 {money(f.value.available_cents)} · 受限 {money(f.value.restricted_cents)} · 余债 {money(f.value.debt_cents)}</p>
      : <MissingList missing={f.missing as PlanningMissing[]} onOwner={o => { if (o === 'funds') setEditing(true); }}/>}
    {editing && <FundsDialog sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={close}/>}
  </article>;
}

function FundsDialog({ sources, saved, snapshot, accounts, today, reload, onPending, onClose }: { sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [d, setD] = useState(() => draftOf(saved, snapshot, today)), [error, setError] = useState('');
  const live = saved.profile.retire.basic?.start.kind !== 'simulation', frozen = saver.busy || saver.stuck;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function save() {
    let input; try { input = fundsInput(d, saved, today); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    if (await saver.save(input)) onClose(true);
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="funds-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 资金</p><h2 id="funds-heading">核对资金范围</h2></div><CloseButton type="button" aria-label="关闭资金核对" disabled={saver.busy} onClick={() => onClose(false)}/>{saver.stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : '确认并保存'}</button>}</header>
    <section className="form-block"><FundsEditor d={d} patch={v => setD(x => ({ ...x, ...v }))} frozen={frozen} snapshot={snapshot} accounts={accounts} live={live}/></section>
    {(error || saver.notice) && <p role="status" className="notice">{error || saver.notice}</p>}
  </form></dialog>;
}
