import { useEffect, useRef, useState } from 'react';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info } from './FormControls';
import { MissingList } from './PlanningRequirement';
import type { BasicCapabilities, PlanningMissing, PlanningSources, ProfileState } from './plan';
import { draftOf, fundsInput } from './planning-basic-forms';
import type { Draft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import { buildBasicCapabilities } from './plan-basic';
import { overlayPlanningDrafts } from './planning-draft';
import { kindLabel } from './wealth';
import type { Account, Snapshot } from './wealth';

/** Account purposes, future housing-fund deposit and an existing personal-pension account. Used by setup and by the funds card. */
export function FundsEditor({ d, patch, frozen, snapshot, accounts, live, hideHpf, focusIds, accountsOnly = false, confirmPension = false, issue, annualPension }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; snapshot: Snapshot | null; accounts: Account[]; live: boolean; hideHpf?: boolean; focusIds?: Set<string>; accountsOnly?: boolean; confirmPension?: boolean; issue?: ConfirmationIssue | null; annualPension?: string | null }) {
  const [linking, setLinking] = useState(false);
  const name = (id: string, kind: string) => accounts.find(a => a.id === id)?.fields.name ?? `${kindLabel(kind)}（历史账户）`;
  const assets = snapshot?.entries.filter(e => e.counted && e.side === 'asset') ?? [];
  const update = (id: string, v: Partial<Draft['funds'][number]>) => patch({ funds: d.funds.map(f => f.account_id === id ? { ...f, ...v } : f) });
  return <>
    {live && snapshot && <>
      <p className="muted small">截至 {snapshot.date} 的完整盘点。这里只设资金是否参与规划，不改变实际余额；建议现金可动用、其他资产暂不能动用，请确认。</p>
      {assets.filter(e => !focusIds || focusIds.has(e.account_id)).map(e => { const rule = d.funds.find(f => f.account_id === e.account_id); if (!rule) return null; const label = name(e.account_id, e.kind); return <FormRow key={e.account_id} label={label} hint={`${kindLabel(e.kind)} · 已记录 ${money(e.amount_cents)}`}><span className="plan-fund-controls"><select aria-label={`${label}规划用途`} value={rule.availability} disabled={frozen} onChange={v => update(e.account_id, { availability: v.target.value as typeof rule.availability })}><option value="available" disabled={e.kind === 'housing_fund'}>可动用</option><option value="restricted">受限：暂不能动用</option><option value="excluded">本计划不参与</option></select><input type="number" aria-label={`${label}参与比例`} min="0" max="100" value={rule.share_hundredths / 100} disabled={frozen} onChange={v => update(e.account_id, { share_hundredths: Math.round(Number(v.target.value) * 100) })}/> %</span></FormRow>; })}
    </>}
    {!hideHpf && <FormRow label="未来公积金月缴存" hint="留空表示未知；明确没有填 0"><CentInput label="未来公积金月缴存" value={d.hpf} disabled={frozen} placeholder="0.00" onChange={v => patch({ hpf: v })}/></FormRow>}
    {!accountsOnly && <details open={confirmPension || !!d.ppAccount || linking}>
      <summary>已有个人养老金余额</summary>
      <ConfirmationField label="已有个人养老金余额" attention={confirmPension} focus={confirmPension} issue={issue} controlLabel={linking || d.ppConfirmed && !!d.ppAccount ? '关联个人养老金账户' : undefined}>
        {confirmPension && <p>{Number(annualPension ?? 0) > 0 ? `你有个人养老金（每年约 ${money(annualPension!)}）。` : '本次计算需要核对个人养老金账户。'}请确认账户里已有的余额：没有，就选下面的“没有”。</p>}
        <div role="radiogroup" aria-label="已有个人养老金余额">
          <label className="plan-choice"><input type="radio" name="personal-pension-balance" aria-label="我没有已有的个人养老金余额" disabled={frozen} checked={d.ppConfirmed && !d.ppAccount && !linking} onChange={() => { setLinking(false); patch({ ppAccount: '', ppConfirmed: true }); }}/><span>我没有已有的个人养老金余额</span></label>
          {live && snapshot && <label className="plan-choice"><input type="radio" name="personal-pension-balance" aria-label="关联到下面的账户" disabled={frozen} checked={linking || d.ppConfirmed && !!d.ppAccount} onChange={() => { setLinking(true); patch({ ppConfirmed: !!d.ppAccount }); }}/><span>关联到下面的账户</span></label>}
        </div>
        {(linking || d.ppConfirmed && !!d.ppAccount) && <FormRow label="关联个人养老金账户" hint="仅参与比例 100% 的受限账户"><select aria-label="关联个人养老金账户" value={d.ppAccount} disabled={frozen} onChange={e => patch({ ppAccount: e.target.value, ppConfirmed: e.target.value !== '' })}><option value="">请选择已有余额所在的账户</option>{assets.filter(e => e.kind !== 'housing_fund' && d.funds.some(x => x.account_id === e.account_id && x.availability === 'restricted' && x.share_hundredths === 10000)).map(e => <option key={e.account_id} value={e.account_id}>{name(e.account_id, e.kind)} · {money(e.amount_cents)}</option>)}</select></FormRow>}
      </ConfirmationField>
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
    {f.status === 'ready' ? <p>{f.value.kind === 'simulation' ? '模拟起点' : '实际盘点'}，截至 {f.value.date} · 可以动用 {money(f.value.available_cents)} · 暂不能动用 {money(f.value.restricted_cents)} · 欠款 {money(f.value.debt_cents)}</p>
      : <MissingList missing={f.missing as PlanningMissing[]} onOwner={o => { if (o === 'funds') setEditing(true); }}/>}
    {editing && <FundsDialog sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={close}/>}
  </article>;
}

export function FundsDialog({ sources, saved, snapshot, accounts, today, reload, onPending, onClose, completion = false }: { sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void; completion?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [d, setD] = useState(() => draftOf(saved, snapshot, today)), [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false), [issue, setIssue] = useState<ConfirmationIssue | null>(null);
  const [confirmPension] = useState(() => completion && (() => { const c = buildBasicCapabilities(sources); return c.requirement.status === 'blocked' && c.requirement.missing.some(m => m.field.includes('personal_pension')); })());
  const unconfirmed = new Set(snapshot?.entries.filter(e => e.counted && e.side === 'asset' && !saved.profile.retire.core?.fund_rules.some(f => f.account_id === e.account_id)).map(e => e.account_id));
  const live = saved.profile.retire.basic?.start.kind !== 'simulation', frozen = saver.busy || saver.stuck;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function save() {
    if (frozen) return;
    let input; try { input = fundsInput(d, saved, today); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    if (completion) {
      const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, [input]));
      const missing = caps.requirement.status === 'blocked' ? caps.requirement.missing.filter(m => m.owner === 'funds') : [];
      if (missing.length) { setIssue(old => ({ label: '已有个人养老金余额', attempt: (old?.attempt ?? 0) + 1 })); return; }
    }
    setIssue(null);
    if (await saver.save(input)) onClose(true);
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="funds-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 资金</p><h2 id="funds-heading">核对可用资金</h2></div><CloseButton type="button" aria-label="关闭资金核对" disabled={saver.busy} onClick={() => onClose(false)}/>{saver.stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : '确认并保存'}</button>}</header>
    <section className="form-block">{live && (unconfirmed.size > 0 || confirmPension) && <><p>{unconfirmed.size > 0 ? `只需核对 ${unconfirmed.size} 个新增或尚未确认的账户，其他用途已保留。` : '这次只需确认个人养老金已有余额，账户用途已保留。'}</p><label><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}/> 显示已确认账户</label></>}<FundsEditor confirmPension={confirmPension} issue={issue} annualPension={saved.profile.personal_pension_annual_cents} focusIds={live && !showAll && (unconfirmed.size > 0 || confirmPension) ? unconfirmed : undefined} d={d} patch={v => setD(x => ({ ...x, ...v }))} frozen={frozen} snapshot={snapshot} accounts={accounts} live={live} hideHpf={completion}/></section>
    {(error || saver.notice) && <p role="status" className="notice">{error || saver.notice}</p>}
  </form></dialog>;
}
