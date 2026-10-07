import { useEffect, useRef, useState } from 'react';
import { CentInput, FormRow, Info } from './FormControls';
import { CloseButton } from './CloseButton';
import { money } from './asset';
import { kindLabel } from './wealth';
import type { Account, Snapshot } from './wealth';
import type { ProfileState, RetireInputs } from './plan';
import { costSources, emptyCore, normalizeFunds } from './plan-core';
import type { PlanningCore } from './plan-core';
import { useSaver } from './RetireSidebar';
export function PlanningCoreCard({ state, snapshot, accounts, today, reload, onPending, onEditingChange }: { state: ProfileState; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void }) {
  const [editing, setEditing] = useState(false), saver = useSaver(state, reload, onPending);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  if (!state.saved || !snapshot) return null;
  const r = state.saved.profile.retire, funds = normalizeFunds(snapshot, r.core);
  return <article className="ui-card ui-content" aria-label="规划资金核对"><div className="ui-section-head"><h3>规划资金与费用<Info text="金融净资产、规划可用资金和受限资金各自计算。债务本金不先扣现金，还款按实际余期延续。资金范围及费用包含关系需要明确确认。"/></h3><button className="ui-btn" disabled={saver.busy || saver.stuck} onClick={() => setEditing(true)}>核对资金与费用</button></div>
    <p>截至 {snapshot.date} 收盘 · 金融净资产 {money(funds.net === null ? null : String(funds.net))} · 规划可用 {money(funds.missing.length || funds.available === null ? null : String(funds.available))} · 受限 {money(String(funds.restricted))} · 余债 {money(String(funds.debt))}</p>
    <p className="muted small">未来净投入采用独立保存的阶段假设。第一期按盘点后剩余天数折算；同月支出先用已有资金支付。</p>
    {funds.missing.length > 0 && <p role="status" className="notice">资金规则待确认；受限与待核对余额不用于支付。</p>}
    {saver.notice && <p role="status" className="notice">{saver.notice}</p>}
    {editing && <CoreDialog r={r} snapshot={snapshot} accounts={accounts} today={today} annual={state.saved.profile.personal_pension_annual_cents} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} onClose={() => setEditing(false)} onSave={async core => { if (await saver.save({ ...r, core })) setEditing(false); }}/>}
  </article>;
}
function CoreDialog({ r, snapshot, accounts, today, annual, busy, stuck, notice, onClose, onSave }: { r: RetireInputs; snapshot: Snapshot; accounts: Account[]; today: string; annual: string; busy: boolean; stuck: boolean; notice: string; onClose: () => void; onSave: (c: PlanningCore) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [core, setCore] = useState<PlanningCore>(() => structuredClone(r.core ?? { ...emptyCore(today), fund_rules: snapshot.entries.filter(e => e.counted && e.side === 'asset').map(e => ({ account_id: e.account_id, availability: e.kind === 'cash' ? 'available' : 'restricted', share_hundredths: 10000 })) }));
  const name = (id: string, kind: string) => accounts.find(a => a.id === id)?.fields.name ?? `${kindLabel(kind)}（历史账户）`;
  const sources = costSources(r.life_events, annual), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const patch = (p: Partial<PlanningCore>) => setCore(c => ({ ...c, ...p }));
  const save = () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(core.monetary_basis_date)) return setError('请填写金额基准日期。'); onSave(core); };
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="core-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); save(); }}>
    <header><div><p className="eyebrow">规划 · 核对</p><h2 id="core-heading">资金与费用假设</h2></div><CloseButton type="button" aria-label="关闭资金核对" disabled={busy} onClick={onClose}/><button className="primary" disabled={busy || stuck}>{busy ? '保存中…' : '确认并保存'}</button></header>
    <section className="form-block"><FormRow label="金额基准日期" hint="与盘点收盘日独立；首次保存后固定，避免重新解释已有金额"><input type="date" aria-label="金额基准日期" value={core.monetary_basis_date} disabled={busy || !!r.core} onChange={e => patch({ monetary_basis_date: e.target.value })}/></FormRow>
    <p>起点：{snapshot.date} 的完整盘点。仅明确可用资产用于支付；未覆盖的负债会阻止完整结论。</p>
    {snapshot.entries.filter(e => e.counted && e.side === 'asset').map(e => { const f = core.fund_rules.find(f => f.account_id === e.account_id); return <FormRow key={e.account_id} label={name(e.account_id, e.kind)} hint={money(e.amount_cents)}><select aria-label={`可用性 ${name(e.account_id, e.kind)}`} value={f?.availability ?? ''} disabled={busy} onChange={v => patch({ fund_rules: [...core.fund_rules.filter(f => f.account_id !== e.account_id), { account_id: e.account_id, availability: v.target.value as 'available', share_hundredths: f?.share_hundredths ?? 10000 }] })}><option value="" disabled>待确认</option><option value="available" disabled={e.kind === 'housing_fund'}>可动用</option><option value="restricted">受限</option><option value="excluded">本情景排除</option></select><input aria-label={`参与比例 ${name(e.account_id, e.kind)}`} type="number" min="0" max="100" value={(f?.share_hundredths ?? 10000) / 100} disabled={busy} onChange={v => patch({ fund_rules: [...core.fund_rules.filter(f => f.account_id !== e.account_id), { account_id: e.account_id, availability: f?.availability ?? 'restricted', share_hundredths: Math.round(Number(v.target.value) * 100) }] })}/> %</FormRow>; })}
    <FormRow label="未来公积金月缴存" hint="工资扣缴及单位缴存，只增加受限池，不再扣税后净投入。留空待确认，明确0保留。"><CentInput label="未来公积金月缴存" value={core.hpf_monthly_cents ?? ''} disabled={busy} onChange={v => patch({ hpf_monthly_cents: v === '' ? null : v })}/></FormRow>
    <FormRow label="已有个人养老金账户" hint="仅参与比例100%的独立受限账户；未来现金转入扣一次，领取时转回可用池。未选则不假造已有余额。"><select aria-label="已有个人养老金账户" disabled={busy} value={core.personal_pension_account_id ?? ''} onChange={e => patch({ personal_pension_account_id: e.target.value || null })}><option value="">未关联已有余额</option>{snapshot.entries.filter(e => e.counted && e.side === 'asset' && e.kind !== 'housing_fund' && core.fund_rules.some(f => f.account_id === e.account_id && f.availability === 'restricted' && f.share_hundredths === 10000)).map(e => <option key={e.account_id} value={e.account_id}>{name(e.account_id, e.kind)} · {money(e.amount_cents)}</option>)}</select></FormRow>
    <FormRow label="个人养老金余额核对"><label><input type="checkbox" aria-label="个人养老金余额已核对" checked={core.personal_pension_balance_confirmed ?? false} disabled={busy} onChange={e => patch({ personal_pension_balance_confirmed: e.target.checked })}/> 已核对已有余额；未关联账户表示明确没有已有余额</label></FormRow>
    {r.saving_phases.map(phase => <div key={phase.id}><h3>{phase.label} · 费用包含关系</h3>{sources.map(source => { const rule = core.costs.find(c => c.phase_id === phase.id && c.source_id === source.id); return <FormRow key={source.id} label={source.label} hint="已含：保存参考额，先还原再扣本期费用；额外：只扣一次。"><select aria-label={`${phase.label} ${source.label}包含关系`} value={rule ? rule.included ? 'included' : 'extra' : ''} disabled={busy} onChange={e => patch({ costs: [...core.costs.filter(c => !(c.phase_id === phase.id && c.source_id === source.id)), ...(e.target.value ? [{ phase_id: phase.id, source_id: source.id, included: e.target.value === 'included', reference_cents: '0' }] : [])] })}><option value="">待核对</option><option value="extra">额外计入</option><option value="included" disabled={source.id !== 'personal_pension' && !core.occurrences.some(o => o.status === 'occurred' && source.id.startsWith(`event:${o.event_id}:`))}>净投入已含（已发生）</option></select>{rule?.included && <CentInput label={`${phase.label} ${source.label}已含参考额`} value={rule.reference_cents} disabled={busy} onChange={v => patch({ costs: core.costs.map(c => c === rule ? { ...c, reference_cents: v } : c) })}/>}</FormRow>; })}</div>)}
    <p className="muted small">其他受限资产的解锁尚未建模；需按实际可用性核对，不会自动解锁。公积金按现有退休估算解锁。保存不改变真实余额。</p></section>
    {(error || notice) && <p role="status" className="notice">{error || notice}</p>}
  </form></dialog>;
}
