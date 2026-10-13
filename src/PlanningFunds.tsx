import { MonthInput } from './DateInput';
import { useEffect, useRef, useState } from 'react';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info } from './FormControls';
import { MissingList } from './PlanningRequirement';
import type { BasicCapabilities, PlanningMissing, PlanningSources, ProfileState } from './plan';
import { draftOf, fundsInput } from './planning-basic-forms';
import type { Draft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { buildBasicCapabilities } from './plan-basic';
import { overlayPlanningDrafts } from './planning-draft';
import { kindLabel } from './wealth';
import type { Account, Snapshot } from './wealth';

/** Account purposes never change factual balances or infer policy releases. */
export function FundsEditor({ d, patch, frozen, snapshot, accounts, live, focusIds }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; snapshot: Snapshot | null; accounts: Account[]; live: boolean; hideHpf?: boolean; focusIds?: Set<string>; accountsOnly?: boolean }) {
  const name = (id: string, kind: string) => accounts.find(a => a.id === id)?.fields.name ?? `${kindLabel(kind)}（历史账户）`;
  const assets = snapshot?.entries.filter(e => e.counted && e.side === 'asset') ?? [];
  const update = (id: string, v: Partial<Draft['funds'][number]>) => patch({ funds: d.funds.map(f => f.account_id === id ? { ...f, ...v } : f) });
  return <>
    {live && snapshot && <>
      <p className="muted small">截至 {snapshot.date} 的完整盘点。可用资金包括现金、存款和准备变现用于本计划的基金、证券等投资，按盘点价值及参与比例计入，不改变实际余额。新增现金及投资账户先建议可动用，请逐项确认；有锁定期、不能赎回或不准备动用的资产，改为暂不能动用或本计划不参与。</p>
      {assets.filter(e => !focusIds || focusIds.has(e.account_id)).map(e => { const rule = d.funds.find(f => f.account_id === e.account_id); if (!rule) return null; const label = name(e.account_id, e.kind); return <FormRow key={e.account_id} label={label} hint={`${kindLabel(e.kind)} · 已记录 ${money(e.amount_cents)}`}><span className="plan-fund-controls"><select aria-label={`${label}规划用途`} value={rule.availability} disabled={frozen} onChange={v => update(e.account_id, { availability: v.target.value as typeof rule.availability })}><option value="available" disabled={e.kind === 'housing_fund'}>可动用</option><option value="restricted">暂不能动用</option><option value="excluded">本计划不参与</option></select><input type="number" aria-label={`${label}参与比例`} min="0" max="100" value={rule.share_hundredths / 100} disabled={frozen} onChange={v => update(e.account_id, { share_hundredths: Math.round(Number(v.target.value) * 100) })}/> %</span></FormRow>; })}
    </>}
    {live && <details><summary>暂时取不出的钱（公积金、个人养老金等）预计何时可用（选填）</summary><p className="muted small">仅安排已有账户资金的释放，不推算税费或未来缴存，不创建实际到账记录。不确定金额可以留空。</p>
      {d.releases.map(release => { const change = (v: Partial<typeof release>) => patch({ releases: d.releases.map(r => r.id === release.id ? { ...r, ...v } : r) }); return <section className="form-block" key={release.id} aria-label="暂时取不出的钱的可用安排">
        <FormRow label="资金账户"><select aria-label="释放资金账户" value={release.account_id} disabled={frozen} onChange={e => change({ account_id: e.target.value })}><option value="">请选择受限账户</option>{assets.filter(e => d.funds.some(f => f.account_id === e.account_id && f.availability === 'restricted')).map(e => <option value={e.account_id} key={e.account_id}>{name(e.account_id, e.kind)}</option>)}</select></FormRow>
        <FormRow label="预计可用月份"><MonthInput yearIntent="long" label="预计可用月份" value={release.month} disabled={frozen} allowClear onChange={month => change({ month })}/></FormRow>
        <FormRow label="预计可用净额" hint="不知道可以留空，明确没有填 0"><CentInput label="预计可用净额" value={release.net_cents ?? ''} disabled={frozen} onChange={v => change({ net_cents: v === '' ? null : v })}/></FormRow>
        <label><input type="checkbox" checked={release.estimated} disabled={frozen} onChange={e => change({ estimated: e.target.checked })}/>这是估计金额</label>
        <label><input type="checkbox" checked={release.excludes_future_deposits} disabled={frozen} onChange={e => change({ excludes_future_deposits: e.target.checked })}/>确认不含未来缴存</label>
        <button type="button" className="ui-link" disabled={frozen} onClick={() => patch({ releases: d.releases.filter(r => r.id !== release.id) })}>删除释放安排</button>
      </section>; })}
      <button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ releases: [...d.releases, { id: crypto.randomUUID(), account_id: '', month: '', net_cents: null, estimated: false, excludes_future_deposits: false }] })}>添加释放安排</button>
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
    <div className="ui-section-head"><h3>规划资金<Info text="可以动用的钱和暂不能动用的钱（如公积金）分开算；欠款本金不会先从现金里扣掉。哪些钱可以动用需要你确认。"/></h3><button ref={button} className="ui-btn" onClick={() => setEditing(true)}>核对可用资金</button></div>
    {f.status === 'ready' ? <p>{f.value.kind === 'simulation' ? '手填金额' : '实际盘点'}，截至 {f.value.date} · 可以动用 {money(f.value.available_cents)} · 暂不能动用 {money(f.value.restricted_cents)} · 欠款 {money(f.value.debt_cents)}</p>
      : <MissingList missing={f.missing as PlanningMissing[]} onOwner={o => { if (o === 'funds') setEditing(true); }}/>}
    {editing && <FundsDialog sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={close}/>}
  </article>;
}

export function FundsDialog({ sources, saved, snapshot, accounts, today, reload, onPending, onClose, completion = false }: { sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void; completion?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [d, setD] = useState(() => draftOf(saved, snapshot)), [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const unconfirmed = new Set(snapshot?.entries.filter(e => e.counted && e.side === 'asset' && !saved.profile.retire.core?.fund_rules.some(f => f.account_id === e.account_id)).map(e => e.account_id));
  const live = saved.profile.retire.basic?.start.kind !== 'simulation', frozen = saver.busy || saver.stuck;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function save() {
    if (frozen) return;
    let input; try { input = fundsInput(d, saved, today); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    if (completion) {
      const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, [input]));
      const missing = caps.requirement.status === 'blocked' ? caps.requirement.missing.filter(m => m.owner === 'funds') : [];
      if (missing.length) { setError(missing.map(m => m.message).join(' ')); return; }
    }
    setError('');
    if (await saver.save(input)) onClose(true);
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="funds-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 资金</p><h2 id="funds-heading">核对可用资金</h2></div><CloseButton type="button" aria-label="关闭资金核对" disabled={saver.busy} onClick={() => onClose(false)}/>{saver.stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : '确认并保存'}</button>}</header>
    <section className="form-block">{live && (unconfirmed.size > 0) && <><p>{unconfirmed.size > 0 ? `只需核对 ${unconfirmed.size} 个新增或尚未确认的账户，其他用途已保留。` : '这次只需确认个人养老金已有余额，账户用途已保留。'}</p><label><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}/> 显示已确认账户</label></>}<FundsEditor focusIds={live && !showAll && (unconfirmed.size > 0) ? unconfirmed : undefined} d={d} patch={v => setD(x => ({ ...x, ...v }))} frozen={frozen} snapshot={snapshot} accounts={accounts} live={live} hideHpf={completion}/></section>
    {(error || saver.notice) && <p role="status" className="notice">{error || saver.notice}</p>}
  </form></dialog>;
}
