import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage } from './asset';
import { CentInput, Info, Segments, Switch } from './FormControls';
import { hundredthsToPct, pctToHundredths, rateText } from './plan';
import type { ProfileSave, ProfileState, RetireInputs, StoredIncomeItem, StoredSavingPhase, StoredSpendItem } from './plan';
import type { Assumptions } from './plan-params';
import { expectedSaving } from './plan-retire-calc';
import type { RetireCalc, RouteResult } from './plan-retire-calc';
import { routeById, routes } from './plan-routes';
import { workSaving } from './plan-risk';
import { yuan } from './RetireOverview';
import { submit, Unresolved } from './wealth';
import './retire.css';

type Saved = NonNullable<ProfileState['saved']>;
type Section = 'plan' | 'saving' | 'route' | 'spend' | 'income' | 'assume' | null;

/** 保存退休假设与通胀、工资增长（后两者属于 assumptions）。返回是否保存成功。 */
export function useSaver(state: ProfileState, reload: () => void, onPending: () => void) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  async function save(retire: RetireInputs, assumptions?: Assumptions): Promise<boolean> {
    const saved = state.saved as Saved;
    const input: ProfileSave = { request_id: crypto.randomUUID(), generation: state.generation, expected_revision: saved.revision, profile: { ...saved.profile, retire, assumptions: assumptions ?? saved.profile.assumptions } };
    setBusy(true); setNotice('');
    try { await submit({ command: 'plan_profile_save', input, label: '退休计划' }); onPending(); reload(); return true; }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); onPending(); return false; }
    finally { setBusy(false); }
  }
  return { busy, notice, stuck, save, clear: () => setNotice('') };
}
type Saver = ReturnType<typeof useSaver>;

function Card({ kicker, title, editing, onEdit, onCancel, onSave, saver, read, edit, tip }: { kicker: string; title: string; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void; saver: Saver; read: ReactNode; edit: ReactNode; tip?: string }) {
  return <article className="ui-card rs-card" aria-label={title}>
    <header><div><p>{kicker}</p><h3>{title}{tip && <Info text={tip}/>}</h3></div>
      {editing ? <span className="rs-actions"><button type="button" className="ui-btn" disabled={saver.busy} onClick={onCancel}>取消</button><button type="button" className="primary" disabled={saver.busy || saver.stuck} onClick={onSave}>{saver.busy ? '保存中…' : '保存'}</button></span>
        : <button type="button" className="ui-btn" aria-label={`编辑${title}`} disabled={saver.busy} onClick={onEdit}>编辑</button>}</header>
    {editing ? <>{edit}{saver.notice && <p className="notice" role="status">{saver.notice}</p>}</> : read}
  </article>;
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => <label className="rs-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
const Rows = ({ rows }: { rows: [string, ReactNode][] }) => <dl className="rs-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
const intOrNull = (t: string) => (t.trim() === '' ? null : /^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : NaN);

export function RetireSidebar({ calc, state, compare, reload, onEditingChange, onPending, initial = null }: { calc: RetireCalc; state: ProfileState; compare: () => RouteResult[] | null; reload: () => void; onEditingChange: (v: boolean) => void; onPending: () => void; initial?: Section }) {
  const saver = useSaver(state, reload, onPending);
  const [section, setSection] = useState<Section>(initial);
  useEffect(() => { onEditingChange(section !== null); return () => onEditingChange(false); }, [section, onEditingChange]);
  const saved = state.saved as Saved, r = saved.profile.retire, a = saved.profile.assumptions, nowAge = Math.floor(calc.now / 12);
  const open = (s: Section) => { saver.clear(); setSection(s); };
  const done = async (ok: Promise<boolean>) => { if (await ok) setSection(null); };
  const fire = r.mode === 'fire';
  return <div className="rd-side">
    <PlanCard r={r} nowAge={nowAge} saving={calc.plan ? workSaving(calc.plan) : calc.saving} editing={section === 'plan'} saver={saver} onEdit={() => open('plan')} onCancel={() => setSection(null)} onSave={(next) => void done(saver.save(next))} fire={fire}/>
    <SavingCard r={r} calc={calc} nowAge={nowAge} editing={section === 'saving'} saver={saver} onEdit={() => open('saving')} onCancel={() => setSection(null)} onSave={(next) => void done(saver.save(next))}/>
    <RouteCard r={r} nowAge={nowAge} compare={compare} editing={section === 'route'} saver={saver} onEdit={() => open('route')} onCancel={() => setSection(null)} onSave={(next) => void done(saver.save(next))}/>
    <SpendCard r={r} editing={section === 'spend'} saver={saver} nowAge={nowAge} derived={calc.derivedSpend} onEdit={() => open('spend')} onCancel={() => setSection(null)} onSave={(next) => void done(saver.save(next))}/>
    <IncomeCard r={r} calc={calc} editing={section === 'income'} saver={saver} nowAge={nowAge} onEdit={() => open('income')} onCancel={() => setSection(null)} onSave={(next) => void done(saver.save(next))}/>
    <AssumeCard r={r} a={a} editing={section === 'assume'} saver={saver} onEdit={() => open('assume')} onCancel={() => setSection(null)} onSave={(next, asm) => void done(saver.save(next, asm))}/>
  </div>;
}

function PlanCard({ r, nowAge, saving, editing, saver, fire, onEdit, onCancel, onSave }: { r: RetireInputs; nowAge: number; saving: number | null; editing: boolean; saver: Saver; fire: boolean; onEdit: () => void; onCancel: () => void; onSave: (r: RetireInputs) => void }) {
  const [mode, setMode] = useState(r.mode), [target, setTarget] = useState(String(r.target_age)), [horizon, setHorizon] = useState(String(r.horizon_age)), [months, setMonths] = useState(String(r.emergency_months));
  useEffect(() => { if (editing) { setMode(r.mode); setTarget(String(r.target_age)); setHorizon(String(r.horizon_age)); setMonths(String(r.emergency_months)); } }, [editing]);
  const [err, setErr] = useState('');
  function save() {
    const t = Number(target), h = Number(horizon), m = Number(months);
    if (!Number.isInteger(t) || t <= nowAge || t > 109) return setErr(`期望年龄须是大于当前年龄（${nowAge} 岁）的整数。`);
    if (!Number.isInteger(h) || h < 70 || h > 110 || h <= t) return setErr('规划终点须是 70 到 110 之间、晚于期望年龄的整数岁。');
    if (!Number.isInteger(m) || m < 0 || m > 36) return setErr('应急金线须是 0 到 36 个月。');
    setErr(''); onSave({ ...r, mode, target_age: t, horizon_age: h, emergency_months: m });
  }
  return <Card kicker="计划" title="计划输入" tip="FIRE：找到资产第一次够用的年龄，不早于期望年龄。传统：到期望年龄就开始退休，看资金够不够。两种类型共用同一套计算，只有退休开始的条件不同。" editing={editing} saver={saver} onEdit={onEdit} onCancel={onCancel} onSave={save}
    read={<Rows rows={[['计划类型', fire ? 'FIRE' : '传统'], ['当前年龄', `${nowAge} 岁`], [fire ? '期望退休年龄' : '退休年龄', `${r.target_age} 岁`], ['计划终止年龄', `${r.horizon_age} 岁`], ['有收入时每月储蓄', saving === null ? '待补充' : yuan(saving)], ['应急金线', `${r.emergency_months} 个月支出`]]}/>}
    edit={<div className="rs-form">
      <Field label="计划类型" hint="选择你的目标年龄是传统退休日期，还是希望实现财务独立的年龄。"><Segments label="计划类型" value={mode} options={[{ value: 'fire', label: 'FIRE' }, { value: 'traditional', label: '传统' }]} onChange={setMode}/></Field>
      {mode !== r.mode && <p className="rs-note">这仅改变计算模型。{mode === 'traditional' ? '期望退休年龄将成为固定的退休开始年龄。' : '退休年龄将成为期望的财务独立年龄；规划器会寻找首个可持续的年龄。'}</p>}
      <p className="muted small">当前年龄 {nowAge} 岁，由出生年月自动更新（在养老金页修改）。</p>
      <div className="rs-pair"><Field label={mode === 'fire' ? '期望退休年龄' : '退休年龄'}><input aria-label="期望退休年龄" inputMode="numeric" value={target} onChange={e => setTarget(e.target.value)}/></Field><Field label="计划终止年龄" hint="计划应覆盖至的年龄"><input aria-label="计划终止年龄" inputMode="numeric" value={horizon} onChange={e => setHorizon(e.target.value)}/></Field></div>
      <Field label="应急金线（个月支出）" hint="可支配资产低于它时提示"><input aria-label="应急金线" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value)}/></Field>
      <p className="muted small">每月储蓄在下面的「储蓄阶段」里设置。</p>
      {err && <p className="notice" role="status">{err}</p>}
    </div>}/>;
}

type PhaseDraft = { id: string; label: string; years: string; months: string; amount: string };
const centsText = (c: number) => String(c / 100);
const toPhase = (p: StoredSavingPhase): PhaseDraft => ({ id: p.id, label: p.label, years: String(Math.floor(p.from_age_months / 12)), months: String(p.from_age_months % 12), amount: centsText(p.monthly_cents) });
const phaseStart = (p: StoredSavingPhase, i: number) => (i === 0 ? '现在' : `${Math.floor(p.from_age_months / 12)} 岁${p.from_age_months % 12 ? ` ${p.from_age_months % 12} 个月` : ''}`);

function SavingCard({ r, calc, nowAge, editing, saver, onEdit, onCancel, onSave }: { r: RetireInputs; calc: RetireCalc; nowAge: number; editing: boolean; saver: Saver; onEdit: () => void; onCancel: () => void; onSave: (r: RetireInputs) => void }) {
  const [items, setItems] = useState<PhaseDraft[]>(r.saving_phases.map(toPhase)), [gap, setGap] = useState(hundredthsToPct(r.gap_share_hundredths)), [err, setErr] = useState('');
  useEffect(() => { if (editing) { setItems(r.saving_phases.map(toPhase)); setGap(hundredthsToPct(r.gap_share_hundredths)); setErr(''); } }, [editing]);
  const patch = (id: string, p: Partial<PhaseDraft>) => setItems(xs => xs.map(x => x.id === id ? { ...x, ...p } : x));
  const spend = r.spend_cents === null ? 500000 : Number(r.spend_cents);
  // 新加一段：接在上一段后面。上一段是空窗期（储蓄为负）就默认 6 个月后，否则 1 年后；第一段从现在起。
  const add = (label: string, cents: number) => setItems(xs => { const last = xs[xs.length - 1], lastFrom = last ? Number(last.years) * 12 + Number(last.months || '0') : calc.now; const from = Math.max(calc.now, last && Number(last.amount) < 0 ? lastFrom + 6 : last ? lastFrom + 12 : calc.now); return [...xs, { id: crypto.randomUUID(), label, years: String(Math.floor(from / 12)), months: String(from % 12), amount: centsText(cents) }]; });
  const fromOf = (d: PhaseDraft) => Number(d.years) * 12 + Number(d.months || '0');
  const setFrom = (id: string, months: number) => patch(id, { years: String(Math.floor(months / 12)), months: String(months % 12) });
  function save() {
    const out: StoredSavingPhase[] = [];
    for (let i = 0; i < items.length; i++) {
      const d = items[i], name = d.label.trim() || '阶段';
      const y = i === 0 ? 0 : Number(d.years), m = i === 0 ? 0 : Number(d.months || '0');
      if (!Number.isInteger(y) || !Number.isInteger(m) || y < 0 || y > 120 || m < 0 || m > 11) return setErr(`「${name}」的起始年龄须是整数岁加 0–11 个月。`);
      if (!/^-?\d{1,7}(\.\d{1,2})?$/.test(d.amount.trim())) return setErr(`「${name}」的每月储蓄请填数字（元），空窗期动用存款填负数。`);
      const from = y * 12 + m;
      if (out.length && from <= out[out.length - 1].from_age_months) return setErr(`「${name}」的起始年龄要晚于上一段。`);
      out.push({ id: d.id, label: name, from_age_months: from, monthly_cents: Math.round(Number(d.amount) * 100) });
    }
    const g = pctToHundredths(gap);
    if (g === null || g < 0 || g > 5000) return setErr('平均空窗比例请填 0 到 50 之间的百分数。');
    setErr(''); onSave({ ...r, saving_phases: out, gap_share_hundredths: g });
  }
  const measured = calc.measured;
  return <Card kicker="储蓄" title="储蓄阶段" tip="退休前每月存多少，按今天的钱。收入不会一直不变：高收入期、空窗期、清闲期各设一段，结果就按这条时间线算。空窗期没有收入时填负数，表示每月动用存款。不分阶段则全程用盘点的常态储蓄。" editing={editing} saver={saver} onEdit={onEdit} onCancel={onCancel} onSave={save}
    read={r.saving_phases.length === 0
      ? <><Rows rows={[['按盘点的常态储蓄', measured === null ? '待补充' : yuan(measured)]]}/><p className="rs-note">还没有分阶段：全程按近 12 个月盘点的中位数算。这个数含一次性大额消费和没有收入的月份，通常偏低；建议点「编辑」按自己的收入变化分几段。</p></>
      : <><ul className="rs-list">{r.saving_phases.map((p, i) => <li key={p.id}><span>{p.label}<small>{phaseStart(p, i)}起{r.gap_share_hundredths > 0 && p.monthly_cents > 0 ? ` · 折后约 ${yuan(expectedSaving(p.monthly_cents, r.gap_share_hundredths, Number(r.spend_cents ?? 0)))}/月` : ''}</small></span><b className={p.monthly_cents < 0 ? 'warn' : undefined}>{p.monthly_cents < 0 ? '−' : ''}{yuan(Math.abs(p.monthly_cents))}/月</b></li>)}</ul>
        {r.gap_share_hundredths > 0 && <p className="muted small">平均空窗 {rateText(r.gap_share_hundredths)}：有收入的阶段按期望值折算。</p>}</>}
    edit={<div className="rs-form">
      {items.map((d, i) => <div key={d.id} className="rs-item"><div className="rs-item-head"><input aria-label="阶段名称" value={d.label} onChange={e => patch(d.id, { label: e.target.value })}/><button type="button" className="ui-btn" aria-label={`移除${d.label}`} onClick={() => setItems(xs => xs.filter(x => x.id !== d.id))}>移除</button></div>
        {i === 0 ? <p className="muted small">从现在起</p> : <><Field label="几个月后开始" hint={Number.isFinite(fromOf(d)) ? `约 ${Math.floor(fromOf(d) / 12)} 岁 ${fromOf(d) % 12} 个月` : undefined}><input aria-label={`${d.label}几个月后开始`} inputMode="numeric" value={Number.isFinite(fromOf(d)) ? String(Math.max(0, fromOf(d) - calc.now)) : ''} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0) setFrom(d.id, calc.now + n); }}/></Field>
          <div className="rs-pair"><Field label="或直接填起始（岁）"><input aria-label={`${d.label}起始岁`} inputMode="numeric" value={d.years} onChange={e => patch(d.id, { years: e.target.value })}/></Field><Field label="加（个月）"><input aria-label={`${d.label}起始月`} inputMode="numeric" value={d.months} onChange={e => patch(d.id, { months: e.target.value })}/></Field></div></>}
        <Field label="每月储蓄（元）" hint="没有收入、在花存款时填负数"><input aria-label={`${d.label}每月储蓄`} inputMode="decimal" value={d.amount} onChange={e => patch(d.id, { amount: e.target.value })}/></Field></div>)}
      {items.length === 0 && <p className="muted small">还没有阶段。盘点中位数含一次性消费，建议自己填。</p>}
      <div className="rs-presets">
        <button type="button" className="ui-btn" disabled={items.length >= 30} onClick={() => add('空窗期', -spend)}>+ 空窗期</button>
        <button type="button" className="ui-btn" disabled={items.length >= 30} onClick={() => add('有收入', measured !== null && measured > 0 ? measured : 1000000)}>+ 有收入</button>
        <button type="button" className="ui-btn" disabled={items.length >= 30} onClick={() => add('清闲／稳定工作', 800000)}>+ 清闲／稳定</button>
      </div>
      <Field label="平均空窗比例（%）" hint="工作的年份里，平均有多大比例的月份没有收入（跳槽、被裁）。填了以后，有收入的阶段按「(1−比例)×储蓄 − 比例×日常生活月预算」折算，空窗月份动用日常生活预算花存款。不需要逐次填空窗；0 表示不折算。"><input aria-label="平均空窗比例" inputMode="decimal" value={gap} onChange={e => setGap(e.target.value)}/></Field>
      <p className="muted small">预设金额只是占位，请改成自己的数。空窗期默认按退休日常生活预算动用存款。近 12 个月盘点中位数：{measured === null ? '暂无' : yuan(measured)}（含一次性大额消费，仅供参考）。</p>
      {err && <p className="notice" role="status">{err}</p>}
    </div>}/>;
}

const fiText = (m: number | null) => (m === null ? '达不到' : `${Math.floor(m / 12)} 岁${m % 12 ? ` ${m % 12} 个月` : ''}`);
function RouteCard({ r, nowAge, compare, editing, saver, onEdit, onCancel, onSave }: { r: RetireInputs; nowAge: number; compare: () => RouteResult[] | null; editing: boolean; saver: Saver; onEdit: () => void; onCancel: () => void; onSave: (r: RetireInputs) => void }) {
  const [id, setId] = useState<string | null>(r.route_id), [from, setFrom] = useState(String(r.route_from_age)), [err, setErr] = useState('');
  const [results, setResults] = useState<RouteResult[] | null>(null);
  useEffect(() => { if (editing) { setId(r.route_id); setFrom(String(r.route_from_age)); setErr(''); setResults(compare()); } }, [editing]);
  function save() {
    const a = Number(from);
    if (!Number.isInteger(a) || a < Math.max(20, nowAge) || a > 70) return setErr(`换路线的年龄须是 ${Math.max(20, nowAge)} 到 70 之间的整数。`);
    setErr(''); onSave({ ...r, route_id: id, route_from_age: a });
  }
  const route = routeById(r.route_id);
  return <Card kicker="路线" title="35 岁以后的路线" tip="远期的收入没法预测，也不该把现在的收入一直外推。这里预设几条路线，每条自带每月储蓄、社保缴费基数、公积金和空窗比例，你只选一条，看看会怎样。参数是我配的假设，会标明依据；不选就沿用「储蓄阶段」。" editing={editing} saver={saver} onEdit={onEdit} onCancel={onCancel} onSave={save}
    read={route ? <><Rows rows={[['路线', route.label], ['从', `${r.route_from_age} 岁起`], ['每月储蓄', yuan(route.saving_cents)], ['社保缴费基数', yuan(route.base_cents)], ['公积金月缴存', route.hpf_cents ? yuan(route.hpf_cents) : '无'], ['平均空窗', rateText(route.gap_share_hundredths)]]}/><p className="muted small">{route.basis}</p></>
      : <p className="muted">还没选路线：{r.route_from_age} 岁以后沿用「储蓄阶段」，缴费基数和公积金也沿用个人资料里的当前值。点「编辑」选一条看看。</p>}
    edit={<div className="rs-form">
      <Field label="从几岁起换成这条路线" hint="之前沿用你自己的储蓄阶段与当前的缴费情况"><input aria-label="换路线的年龄" inputMode="numeric" value={from} onChange={e => setFrom(e.target.value)}/></Field>
      {[{ key: null as string | null, label: '不选路线', line: '沿用储蓄阶段与个人资料里的当前缴费基数', basis: '', tag: '' }, ...routes.map(x => ({ key: x.id as string | null, label: x.label, line: `每月存 ${yuan(x.saving_cents)} · 社保基数 ${yuan(x.base_cents)} · 公积金 ${x.hpf_cents ? yuan(x.hpf_cents) + '/月' : '无'} · 空窗 ${rateText(x.gap_share_hundredths)}`, basis: x.basis, tag: '示例假设' }))].map(o => {
        const res = results?.find(x => x.id === o.key);
        return <label key={String(o.key)} className="rs-item rs-route"><span className="rs-item-head"><input type="radio" name="route" checked={id === o.key} onChange={() => setId(o.key)} aria-label={o.label}/><strong>{o.label}</strong>{o.tag && <i className="ui-tag">{o.tag}</i>}</span>
          <small>{o.line}</small>{o.basis && <small className="muted">{o.basis}</small>}
          {res && <small className="rs-route-result">按它：财务独立 {fiText(res.fi_month)}{res.shortfall_month !== null ? '，退休后有支出缺口' : ''}</small>}</label>;
      })}
      {err && <p className="notice" role="status">{err}</p>}
    </div>}/>;
}

const presets: { key: string; label: string; add: string; item: Omit<StoredSpendItem, 'id'> }[] = [
  { key: 'health', label: '医疗', add: '+ 医疗', item: { label: '医疗', monthly_cents: '100000', start_age: 65, end_age: null, inflation_hundredths: null, essential: true } },
  { key: 'housing', label: '住房', add: '+ 住房', item: { label: '住房', monthly_cents: '200000', start_age: null, end_age: null, inflation_hundredths: null, essential: true } },
  { key: 'travel', label: '旅行', add: '+ 旅行', item: { label: '旅行', monthly_cents: '100000', start_age: null, end_age: 75, inflation_hundredths: null, essential: false } },
  { key: 'other', label: '其他支出', add: '+ 其他', item: { label: '其他支出', monthly_cents: '50000', start_age: null, end_age: null, inflation_hundredths: null, essential: false } },
];
type SpendDraft = { id: string; label: string; cents: string; start: string; end: string; infl: string; essential: boolean };
const toDraft = (i: StoredSpendItem): SpendDraft => ({ id: i.id, label: i.label, cents: i.monthly_cents, start: i.start_age === null ? '' : String(i.start_age), end: i.end_age === null ? '' : String(i.end_age), infl: i.inflation_hundredths === null ? '' : hundredthsToPct(i.inflation_hundredths), essential: i.essential });

function SpendCard({ r, nowAge, derived, editing, saver, onEdit, onCancel, onSave }: { r: RetireInputs; nowAge: number; derived: number | null; editing: boolean; saver: Saver; onEdit: () => void; onCancel: () => void; onSave: (r: RetireInputs) => void }) {
  const [living, setLiving] = useState(r.spend_cents ?? ''), [items, setItems] = useState<SpendDraft[]>(r.spend_items.map(toDraft)), [err, setErr] = useState('');
  useEffect(() => { if (editing) { setLiving(r.spend_cents ?? ''); setItems(r.spend_items.map(toDraft)); setErr(''); } }, [editing]);
  const patch = (id: string, p: Partial<SpendDraft>) => setItems(xs => xs.map(x => x.id === id ? { ...x, ...p } : x));
  function save() {
    if (living === '0') return setErr('日常生活月预算须大于 0；留空则暂不估算退休时间。');
    const out: StoredSpendItem[] = [];
    for (const d of items) {
      const start = intOrNull(d.start), end = intOrNull(d.end), infl = d.infl.trim() === '' ? null : pctToHundredths(d.infl);
      const name = d.label.trim() || '支出';
      if (!d.cents || d.cents === '0') return setErr(`「${name}」的月金额须大于 0。`);
      if (Number.isNaN(start) || Number.isNaN(end) || (start !== null && start > 120) || (end !== null && end > 120) || (start !== null && end !== null && end <= start)) return setErr(`「${name}」的起止年龄须是 0–120 的整数，结束晚于开始；留空表示从退休／到终点。`);
      if (d.infl.trim() !== '' && infl === null) return setErr(`「${name}」的通胀请填百分数，例如 3。`);
      out.push({ id: d.id, label: name, monthly_cents: d.cents, start_age: start, end_age: end, inflation_hundredths: infl, essential: d.essential });
    }
    setErr(''); onSave({ ...r, spend_cents: living === '' ? null : living, spend_items: out });
  }
  const monthly = (i: StoredSpendItem) => `${yuan(Number(i.monthly_cents))}/月`;
  return <Card kicker="支出" title="退休支出" tip="金额按今天的物价，每月。「日常生活」请不要含房租、房贷和车，它们由目标页的大额计划来出。必需支出优先于灵活支出得到保障；留空起始年龄表示从退休开始；独立通胀可以让医疗等项目涨得比总体通胀快。" editing={editing} saver={saver} onEdit={onEdit} onCancel={onCancel} onSave={save}
    read={<ul className="rs-list"><li><span>日常生活<small>退休起 · 终身 · 必需</small></span><b>{r.spend_cents === null ? '待填写' : yuan(Number(r.spend_cents)) + '/月'}</b></li>
      {r.spend_items.map(i => <li key={i.id}><span>{i.label}<small>{i.start_age ?? '退休'}{i.start_age === null ? '' : ' 岁'} → {i.end_age === null ? '终身' : `${i.end_age} 岁`} · {i.essential ? '必需' : '灵活'}{i.inflation_hundredths !== null ? ` · ${rateText(i.inflation_hundredths)} 通胀` : ''}</small></span><b>{monthly(i)}</b></li>)}</ul>}
    edit={<div className="rs-form">
      <Field label="日常生活（每月）" hint={derived === null ? '按今天的物价填写；留空则暂不估算' : `历史推算月支出 ${yuan(derived)}，仅供核对；大额医疗、一次性购买不代表每月都发生。`}><CentInput label="日常生活月预算" value={living} placeholder="填写自己的月预算" onChange={setLiving}/></Field>
      {items.map(d => <div key={d.id} className="rs-item"><div className="rs-item-head"><input aria-label="支出名称" value={d.label} onChange={e => patch(d.id, { label: e.target.value })}/><button type="button" className="ui-btn" aria-label={`移除${d.label}`} onClick={() => setItems(xs => xs.filter(x => x.id !== d.id))}>移除</button></div>
        <Field label="每月支出"><CentInput label={`${d.label}月金额`} value={d.cents} onChange={v => patch(d.id, { cents: v })}/></Field>
        <div className="rs-pair"><Field label="起始年龄" hint="留空：退休"><input aria-label={`${d.label}起始年龄`} inputMode="numeric" value={d.start} placeholder="退休" onChange={e => patch(d.id, { start: e.target.value })}/></Field><Field label="结束年龄" hint="留空：终身"><input aria-label={`${d.label}结束年龄`} inputMode="numeric" value={d.end} placeholder="终身" onChange={e => patch(d.id, { end: e.target.value })}/></Field></div>
        <Field label="支出类型" hint="必需支出优先于灵活支出得到保障。"><Segments label={`${d.label}支出类型`} value={d.essential ? 'e' : 'f'} options={[{ value: 'e', label: '必需' }, { value: 'f', label: '灵活' }]} onChange={v => patch(d.id, { essential: v === 'e' })}/></Field>
        <Field label="通胀覆盖（%）" hint="留空则使用计划通胀率"><input aria-label={`${d.label}通胀覆盖`} inputMode="decimal" value={d.infl} placeholder="计划通胀" onChange={e => patch(d.id, { infl: e.target.value })}/></Field></div>)}
      {items.length === 0 && <p className="muted small">暂无其他支出项。可添加预设项，再调整金额和日期（预设金额只是占位）。</p>}
      <div className="rs-presets">{presets.map(p => <button key={p.key} type="button" className="ui-btn" disabled={items.length >= 19} onClick={() => setItems(xs => [...xs, toDraft({ id: crypto.randomUUID(), ...p.item })])}>{p.add}</button>)}</div>
      <p className="muted small">当前年龄 {nowAge} 岁；起始年龄早于退休时，从退休当月开始计入。</p>
      {err && <p className="notice" role="status">{err}</p>}
    </div>}/>;
}

type IncomeDraft = { id: string; label: string; cents: string; start: string; end: string; indexed: boolean };
function IncomeCard({ r, calc, nowAge, editing, saver, onEdit, onCancel, onSave }: { r: RetireInputs; calc: RetireCalc; nowAge: number; editing: boolean; saver: Saver; onEdit: () => void; onCancel: () => void; onSave: (r: RetireInputs) => void }) {
  const toDraft = (i: StoredIncomeItem): IncomeDraft => ({ id: i.id, label: i.label, cents: i.monthly_cents, start: String(i.start_age), end: i.end_age === null ? '' : String(i.end_age), indexed: i.indexed });
  const [items, setItems] = useState<IncomeDraft[]>(r.income_items.map(toDraft)), [err, setErr] = useState('');
  useEffect(() => { if (editing) { setItems(r.income_items.map(toDraft)); setErr(''); } }, [editing]);
  const patch = (id: string, p: Partial<IncomeDraft>) => setItems(xs => xs.map(x => x.id === id ? { ...x, ...p } : x));
  function save() {
    const out: StoredIncomeItem[] = [];
    for (const d of items) {
      const start = intOrNull(d.start), end = intOrNull(d.end), name = d.label.trim() || '收入';
      if (!d.cents || d.cents === '0') return setErr(`「${name}」的月金额须大于 0。`);
      if (start === null || Number.isNaN(start) || start > 120 || Number.isNaN(end) || (end !== null && (end > 120 || end <= start))) return setErr(`「${name}」须填写起始年龄（0–120），结束年龄留空表示终身且须晚于起始。`);
      out.push({ id: d.id, label: name, monthly_cents: d.cents, start_age: start, end_age: end, indexed: d.indexed });
    }
    setErr(''); onSave({ ...r, income_items: out });
  }
  const pension = calc.proj?.pension ?? null;
  const pensionLine = pension ? <li><span>国家养老金<small>{Math.floor(pension.unlock_age_months / 12)} 岁起 · 终身 · 随通胀 · 按辞职年龄重算</small></span><b>{yuan(pension.monthly_cents)}/月</b></li> : <li><span>国家养老金<small>补齐盘点与月预算后按辞职年龄估算</small></span><b>—</b></li>;
  return <Card kicker="收入" title="退休收入" tip="税后每月，今天的钱。国家养老金由养老金页的个人资料推算，辞职越早越少，已按各自的辞职年龄重算；个人账户、公积金与个人养老金的一次性解锁也一并计入。公共养老金之外的收入（企业年金、租金、返聘等）在这里添加。" editing={editing} saver={saver} onEdit={onEdit} onCancel={onCancel} onSave={save}
    read={<><ul className="rs-list">{pensionLine}{r.income_items.map(i => <li key={i.id}><span>{i.label}<small>{i.start_age} → {i.end_age === null ? '终身' : `${i.end_age}`} 岁 · {i.indexed ? '通胀挂钩' : '固定名义'}</small></span><b>{yuan(Number(i.monthly_cents))}/月</b></li>)}</ul>
      {pension && pension.eligible === false && <p className="rs-note">按这个辞职年龄，缴费年限还差 {pension.short_months} 个月，达不到按月领取基本养老金的最低要求：月养老金按 0 计，个人账户余额近似为一次性领回。续缴或补缴凑够年限后会有月养老金，具体办法以当地规定为准。</p>}
      {pension && pension.lump_cents > 0 && <p className="muted small">另有公积金、个人养老金{pension.eligible === false ? '与个人账户余额' : ''}约 {yuan(pension.lump_cents)}（今天的钱），{Math.floor(pension.unlock_age_months / 12)} 岁一次性解锁。</p>}</>}
    edit={<div className="rs-form">
      <p className="muted small">国家养老金不用在这里填，随个人资料自动计算。</p>
      {items.map(d => <div key={d.id} className="rs-item"><div className="rs-item-head"><input aria-label="收入名称" value={d.label} onChange={e => patch(d.id, { label: e.target.value })}/><button type="button" className="ui-btn" aria-label={`移除${d.label}`} onClick={() => setItems(xs => xs.filter(x => x.id !== d.id))}>移除</button></div>
        <Field label="税后每月收入"><CentInput label={`${d.label}月收入`} value={d.cents} onChange={v => patch(d.id, { cents: v })}/></Field>
        <div className="rs-pair"><Field label="起始年龄"><input aria-label={`${d.label}起始年龄`} inputMode="numeric" value={d.start} onChange={e => patch(d.id, { start: e.target.value })}/></Field><Field label="结束年龄" hint="留空：终身"><input aria-label={`${d.label}结束年龄`} inputMode="numeric" value={d.end} placeholder="终身" onChange={e => patch(d.id, { end: e.target.value })}/></Field></div>
        <Field label="随通胀上涨" hint="关闭则为固定名义金额，实际购买力逐年下降。"><Switch label={`${d.label}随通胀上涨`} value={d.indexed} onChange={v => patch(d.id, { indexed: v })}/></Field></div>)}
      {items.length === 0 && <p className="muted small">未配置其他退休收入。</p>}
      <button type="button" className="ui-btn" disabled={items.length >= 19} onClick={() => setItems(xs => [...xs, { id: crypto.randomUUID(), label: '收入', cents: '100000', start: String(Math.max(nowAge + 1, 60)), end: '', indexed: true }])}>+ 添加退休收入</button>
      {err && <p className="notice" role="status">{err}</p>}
    </div>}/>;
}

function AssumeCard({ r, a, editing, saver, onEdit, onCancel, onSave }: { r: RetireInputs; a: Assumptions; editing: boolean; saver: Saver; onEdit: () => void; onCancel: () => void; onSave: (r: RetireInputs, a: Assumptions) => void }) {
  const [before, setBefore] = useState(''), [after, setAfter] = useState(''), [vol, setVol] = useState(''), [infl, setInfl] = useState(''), [wage, setWage] = useState(''), [err, setErr] = useState('');
  useEffect(() => { if (editing) { setBefore(hundredthsToPct(r.real_return_before_hundredths)); setAfter(hundredthsToPct(r.real_return_after_hundredths)); setVol(hundredthsToPct(r.volatility_hundredths)); setInfl(hundredthsToPct(a.inflation_hundredths)); setWage(hundredthsToPct(a.wage_growth_hundredths)); setErr(''); } }, [editing]);
  function save() {
    const b = pctToHundredths(before), f = pctToHundredths(after), v = pctToHundredths(vol), i = pctToHundredths(infl), w = pctToHundredths(wage);
    if (b === null || f === null || v === null || i === null || w === null) return setErr('各项请填百分数，例如 0、1.5。');
    if (v < 0 || v > 6000) return setErr('波动率须在 0% 到 60% 之间。');
    if (b < -1000 || b > 2000 || f < -1000 || f > 2000) return setErr('实际收益率须在 −10% 到 20% 之间。');
    if (i < -1000 || i > 2000 || w < -1000 || w > 2000) return setErr('通胀与工资增长须在 −10% 到 20% 之间。');
    setErr(''); onSave({ ...r, real_return_before_hundredths: b, real_return_after_hundredths: f, volatility_hundredths: v }, { ...a, inflation_hundredths: i, wage_growth_hundredths: w });
  }
  const real = Math.round(((1 + a.wage_growth_hundredths / 10000) / (1 + a.inflation_hundredths / 10000) - 1) * 10000);
  const warnings = [a.inflation_hundredths > 500 && '通胀假设偏高。在该通胀率下，长期支出需求会变得更加敏感。', r.volatility_hundredths > 2500 && '波动率假设偏高。结果区间可能变得非常宽。', (r.real_return_before_hundredths > 600 || r.real_return_after_hundredths > 600) && '实际收益率假设较高。预计余额对这一比率较为敏感。', real > 300 && '供款增长假设偏高。这意味着持续大幅增加储蓄。'].filter(Boolean) as string[];
  return <Card kicker="假设" title="预测假设" tip="全部是假设，不是事实。收益率按「扣除通胀后的实际收益」填写，费用已包含在内；货币基金为主的组合扣除通胀后通常接近 0。注意：每月供款来自净资产变化，已经包含了现有账户的利息与涨跌，所以这里不要再把同一笔收益重复计入。" editing={editing} saver={saver} onEdit={onEdit} onCancel={onCancel} onSave={save}
    read={<><Rows rows={[['退休前实际收益率', rateText(r.real_return_before_hundredths)], ['退休期实际收益率', rateText(r.real_return_after_hundredths)], ['年度波动率', rateText(r.volatility_hundredths)], ['通胀', rateText(a.inflation_hundredths)], ['每年供款实际增长', rateText(real)]]}/>{warnings.map(w => <p key={w} className="rs-note">{w}</p>)}</>}
    edit={<div className="rs-form">
      <p className="rs-note">每月供款来自盘点的净资产变化，已经包含了账户现有的利息和涨跌。收益率只填「在此之外还会持续增值」的部分；以现金和货币基金为主就填 0，投资仓位变大后再按实际调整。</p>
      <div className="rs-pair"><Field label="退休前实际收益率（%）" hint="储蓄期间，扣除通胀与费用"><input aria-label="退休前实际收益率" inputMode="decimal" value={before} onChange={e => setBefore(e.target.value)}/></Field><Field label="退休期实际收益率（%）" hint="开始提取后"><input aria-label="退休后实际收益率" inputMode="decimal" value={after} onChange={e => setAfter(e.target.value)}/></Field></div>
      <Field label="年度波动率（%）" hint="实际收益围绕假设值的波动幅度，只用于假设分析的市场路径；货币基金为主填 1–3，股票占比大填 12–18。"><input aria-label="年度波动率" inputMode="decimal" value={vol} onChange={e => setVol(e.target.value)}/></Field>
      <div className="rs-pair"><Field label="通胀（%）" hint="假设的年度物价涨幅，与养老金页共用"><input aria-label="通胀" inputMode="decimal" value={infl} onChange={e => setInfl(e.target.value)}/></Field><Field label="工资增长（%）" hint="与通胀之差就是供款的实际增长，也影响养老金"><input aria-label="工资增长" inputMode="decimal" value={wage} onChange={e => setWage(e.target.value)}/></Field></div>
      {err && <p className="notice" role="status">{err}</p>}
    </div>}/>;
}
