import { PlanningOccurrenceDialog } from './PlanningOccurrenceDialog';
import { emptyCore } from './plan-core';
import type { Occurrence, PlanningCore } from './plan-core';
import type { Plan } from './plan-ledger';
import type { Account, Snapshot } from './wealth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info, Segments, Switch } from './FormControls';
import { hundredthsToPct, pctToHundredths } from './plan';
import type { RetireInputs, StoredLifeEvent } from './plan';
import { eventImpact, monthIndex, offsetOf, totalImpact } from './plan-events';
import type { EventImpact } from './plan-events';
import { toEvent } from './plan-retire-calc';
import type { RetirePlan } from './PlanningRetire';
import { isReady } from './PlanningRetire';
import { useSaver } from './RetireSidebar';
import { yuan } from './RetireOverview';
import './retire.css';

type Kind = StoredLifeEvent['kind'];
const kindText: Record<Kind, string> = { house: '买房', car: '买车', other: '其他' };
const monthLabel = (today: string, offset: number) => { const i = monthIndex(today) + offset; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const delayText = (d: number | null, base: number | null, w: number | null) => base === null ? '本来就达不到' : w === null ? '70 岁前达不到' : d === 0 ? '几乎无影响' : `推迟约 ${d! >= 12 ? `${Math.floor(d! / 12)} 年${d! % 12 ? ` ${d! % 12} 个月` : ''}` : `${d} 个月`}`;
const cents = (yuanAmount: number) => String(Math.round(yuanAmount * 100));

/** 示例预设：金额只是占位，按自己的情况改。日期按「几年后」放在当月。 */
const presets: { key: string; label: string; years: number; make: (date: string) => Omit<StoredLifeEvent, 'id'> }[] = [
  { key: 'bj', label: '北京买房', years: 7, make: date => ({ label: '北京买房', kind: 'house', date, included: true, price_cents: cents(4_500_000), down_cents: cents(1_500_000), extra_cents: cents(100_000), loan_rate_hundredths: 350, loan_years: 30, holding_cents: cents(1500), rent_saved_cents: cents(2700), cycle_years: null, until_age: null, resale_cents: '0' }) },
  { key: 'tier2', label: '二三线买房', years: 7, make: date => ({ label: '二三线买房', kind: 'house', date, included: false, price_cents: cents(1_500_000), down_cents: cents(450_000), extra_cents: cents(50_000), loan_rate_hundredths: 350, loan_years: 30, holding_cents: cents(800), rent_saved_cents: cents(2000), cycle_years: null, until_age: null, resale_cents: '0' }) },
  { key: 'home', label: '老家全款', years: 7, make: date => ({ label: '老家全款买房', kind: 'house', date, included: false, price_cents: cents(400_000), down_cents: cents(400_000), extra_cents: cents(30_000), loan_rate_hundredths: 350, loan_years: 30, holding_cents: cents(300), rent_saved_cents: cents(1500), cycle_years: null, until_age: null, resale_cents: '0' }) },
  { key: 'car', label: '二手车', years: 2, make: date => ({ label: '二手车', kind: 'car', date, included: true, price_cents: cents(70_000), down_cents: cents(70_000), extra_cents: '0', loan_rate_hundredths: 350, loan_years: 3, holding_cents: cents(1200), rent_saved_cents: '0', cycle_years: 5, until_age: 60, resale_cents: cents(20_000) }) },
  { key: 'other', label: '其他大额', years: 3, make: date => ({ label: '其他大额支出', kind: 'other', date, included: true, price_cents: cents(50_000), down_cents: cents(50_000), extra_cents: '0', loan_rate_hundredths: 350, loan_years: 1, holding_cents: '0', rent_saved_cents: '0', cycle_years: null, until_age: null, resale_cents: '0' }) },
];

/** Where the plan card reads and writes: the original plan (whole profile) or the basic plan (events section). */
export type EventsStore = {
  retire: RetireInputs; snapshot: Snapshot | null; accounts: Account[];
  busy: boolean; stuck: boolean; notice: string;
  /** Replaces the life events and the core (occurrences, cost rules) in one write. */
  write: (events: StoredLifeEvent[], core: PlanningCore | null | undefined) => Promise<boolean>;
  /** Present only when the shared service produced a prediction; otherwise `blocked` says why per-row impact is hidden. */
  ready: { plan: Plan; plan0: Plan } | null; blocked: string; onContribution?: () => void;
};

/** The original plan keeps its whole-profile save. */
export function LegacyPlanningEvents({ plan, today, onEditingChange, onPending }: { plan: RetirePlan; today: string; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const { state, calc, reload } = plan;
  const saver = useSaver(state ?? { generation: '', saved: null }, reload, onPending);
  const saved = state?.saved ?? null;
  if (!saved) return null;
  const retire = saved.profile.retire, ready = !!calc && isReady(calc) && !!calc.plan0;
  const store: EventsStore = { retire, snapshot: plan.snapshot ?? null, accounts: plan.accounts, busy: saver.busy, stuck: saver.stuck, notice: saver.notice, ready: ready ? { plan: calc!.plan!, plan0: calc!.plan0! } : null, blocked: '资料待补齐',
    write: (events, core) => saver.save({ ...retire, life_events: events, core }) };
  return <PlanningEvents store={store} today={today} onEditingChange={onEditingChange}/>;
}

/** 目标页的「大额计划」卡：买房、买车、其他。每件拆成一次性现金支出与持续的月度收支，并入退休账本；这里逐件看影响并开关是否计入。 */
export function PlanningEvents({ store, today, onEditingChange }: { store: EventsStore; today: string; onEditingChange: (v: boolean) => void }) {
  const [editing, setEditing] = useState<{ draft: StoredLifeEvent; isNew: boolean } | null>(null), [confirm, setConfirm] = useState<string | null>(null);
  const [occurring, setOccurring] = useState<StoredLifeEvent | null>(null);
  const saver = store, retire = store.retire, events = retire.life_events, ready = store.ready;
  useEffect(() => { onEditingChange(editing !== null || occurring !== null); return () => onEditingChange(false); }, [editing, occurring, onEditingChange]);
  const emergency = ready ? retire.emergency_months * (ready.plan.items[0]?.monthly_cents ?? 0) : 0;
  const rows = useMemo(() => {
    if (!ready) return null;
    const P0 = { ...ready.plan0, anchor_date: ready.plan.anchor_date, core: retire.core, basis_factor: ready.plan.basis_factor, first_month_fraction: ready.plan.first_month_fraction }, evs = events.map(toEvent);
    return { items: evs.filter(e => e.date >= today.slice(0, 7) && !retireOccurrence(retire, e.id)).map(e => ({ e, impact: eventImpact(P0, e, offsetOf(e.date, ready.plan.anchor_date ?? today), emergency) as EventImpact })), total: totalImpact(P0, evs.filter(e => e.included && !retireOccurrence(retire, e.id)).map(e => ({ e, offset: offsetOf(e.date, ready.plan.anchor_date ?? today) }))) };
  }, [ready, retire, events, today, emergency]);
  const write = (next: StoredLifeEvent[]) => store.write(next, retire.core ? { ...retire.core, costs: retire.core.costs.filter(c => c.source_id === 'personal_pension' || next.some(e => c.source_id.startsWith(`event:${e.id}:`))), occurrences: retire.core.occurrences.filter(o => next.some(e => e.id === o.event_id)) } : retire.core);
  async function saveOccurrence(o: Occurrence) { const core = retire.core ?? emptyCore(today); if (await store.write(events, { ...core, occurrences: [...core.occurrences.filter(x => x.event_id !== o.event_id), o] })) setOccurring(null); }
  async function toggle(id: string, included: boolean) { await write(events.map(e => (e.id === id ? { ...e, included } : e))); }
  async function remove(id: string) { setConfirm(null); await write(events.filter(e => e.id !== id)); }
  // 已经有一套房计入时，新加的房默认不计入，避免两套房同时发生；想比较方案就只勾选其中一套。
  const add = (key: string) => { const p = presets.find(x => x.key === key)!, d = p.make(monthLabel(today, p.years * 12)); setEditing({ isNew: true, draft: { id: crypto.randomUUID(), ...d, included: d.kind === 'house' ? d.included && !events.some(x => x.kind === 'house' && x.included) : d.included } }); };
  return <article className="ui-card ui-content plan-goal plan-events" aria-label="大额计划">
    <div className="ui-section-head"><div><p className="eyebrow">买房、买车与其他</p><h3>大额计划<Info text="把房和车算进来：每件拆成一次性现金支出（首付、杂费、换车净支出）和持续的月度收支（月供、持有成本、不再付的房租），并入同一个退休计算。「日常生活」预算请不要再含房租、房贷和车。这里只估算，不扣你真实的资产，也不划拨。"/></h3></div>
      <span className="rs-presets">{presets.map(p => <button key={p.key} type="button" className="ui-btn" disabled={saver.busy || events.length >= 20} onClick={() => add(p.key)}>+ {p.label}</button>)}</span></div>
    {saver.notice && <p className="notice" role="status">{saver.notice}</p>}
    {events.length === 0 ? <p className="muted">还没有大额计划。现在租房、短期不会买，但几年内买房买车是大概率的事：先放一个设想进来，看对退休的影响。金额只是占位，请按自己的情况改；可以放几套方案（北京、二三线、老家）并排比较，只勾选其中一套计入。</p> : <>
      <div className="plan-table-scroll" tabIndex={0} role="region" aria-label="大额计划列表"><table className="ui-table plan-event-table"><thead><tr><th>计划</th><th className="amount">总价 / 首付</th><th>买后每月</th><th>首付付得起吗</th><th>对退休的影响（只算这一件）</th><th>计入</th><th/></tr></thead>
        <tbody>{events.map(s => { const i = rows?.items.find(x => x.e.id === s.id)?.impact; return <tr key={s.id} className={s.included || retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred') ? undefined : 'closed'}>
          <td><b>{s.label}</b><small className="muted">{retire.core?.occurrences.find(o => o.event_id === s.id)?.status === 'occurred' ? '已确认发生 · 后续费用继续' : retire.core?.occurrences.find(o => o.event_id === s.id)?.status === 'cancelled' ? '已取消' : s.date < today.slice(0, 7) ? '日期已过，待核对' : '未确认发生'}</small><small className="muted">{kindText[s.kind]} · {s.date}{s.kind === 'car' && s.cycle_years ? ` · 每 ${s.cycle_years} 年换` : ''}</small></td>
          <td className="amount">{yuan(Number(s.price_cents))}<small className="muted">首付 {yuan(Number(s.down_cents))}</small></td>
          <td>{i && i.payment_nominal > 0 ? <>月供 {yuan(i.payment_nominal)}<small className="muted">固定名义金额</small></> : <span className="muted">{retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred' && o.loan && Number(o.loan.principal_cents) > 0) ? '余债按已核对剩余期延续' : '待测算'}</span>}{Number(s.holding_cents) > 0 && <small className="muted">{s.kind === 'car' ? '养车' : '持有'} {yuan(Number(s.holding_cents))}</small>}
            {i && (i.payment_nominal > 0 || Number(s.holding_cents) > 0) && <small className={i.saving_not_positive ? 'warn' : 'muted'}>买后每月储蓄约 {yuan(i.saving_after)}{i.saving_not_positive ? '，要靠当时的收入支撑' : ''}</small>}</td>
          <td>{!i ? <span className="muted">{retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred') ? '按实际付款核对接续' : store.blocked}{store.onContribution && !retire.core?.occurrences.some(o => o.event_id === s.id) && <button type="button" className="ui-link" onClick={store.onContribution}>填写预计投入</button>}</span> : i.short === 0 ? <>够：{s.date} 时可支配资产约 {yuan(i.assets_at_date)}<small className="muted">需 {yuan(i.cash_needed)}（含应急金线）</small></> : <><span className="warn">差 {yuan(i.short)}</span><small className="muted">需 {yuan(i.cash_needed)}；{i.earliest_offset === null ? '按当前储蓄不会够' : `最早约 ${monthLabel(ready?.plan.anchor_date ?? today, i.earliest_offset)} 够`}</small></>}</td>
          <td>{i ? <>{delayText(i.delay_months, i.base_fi, i.with_fi)}{s.kind === 'house' && <small className="muted">{i.sweep.map(w => `${w.years} 年后买：${w.delay_months === null ? '达不到' : w.delay_months === 0 ? '无影响' : `+${w.delay_months} 个月`}`).join('；')}</small>}</> : <span className="muted">—</span>}</td>
          <td><Switch label={`计入${s.label}`} value={s.included || !!retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred')} disabled={saver.busy || !!retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred')} onChange={v => void toggle(s.id, v)}/></td>
          <td className="rs-actions"><button type="button" className="ui-btn" disabled={saver.busy || saver.stuck} onClick={() => setOccurring(s)}>发生核对</button><button type="button" className="ui-btn" disabled={saver.busy} onClick={() => setEditing({ isNew: false, draft: s })}>编辑</button>
            {confirm === s.id ? <button type="button" className="danger" disabled={saver.busy} onClick={() => void remove(s.id)}>确认删除</button> : <button type="button" className="ui-btn" disabled={saver.busy || !!retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred')} onClick={() => setConfirm(s.id)}>删除</button>}</td></tr>; })}</tbody></table></div>
      {rows && !retire.core?.occurrences.some(o => o.status === 'occurred') && rows.items.some(x => x.e.included) && <p>已计入的几件一起发生：<strong>{delayText(rows.total.delay_months, rows.total.base_fi, rows.total.with_fi)}</strong>（相对于都不发生）。已经含在上面的退休结论里。</p>}
      {rows && rows.items.filter(x => x.e.kind === 'house' && x.e.included).length > 1 && <p className="rs-note">有多套房同时计入，会按都买来算；比较方案时请只勾选一套。</p>}
    </>}
    <details className="plan-explanation"><summary>怎么算的</summary><p className="muted small">首付、杂费在计划月份一次性扣；贷款本金按买房那天的名义价格算，等额本息、固定名义月供，到期结束，所以实际购买力逐年下降；月供与持有成本在退休前压低每月储蓄，退休后算进支出；买房后不再付的房租会补回每月储蓄（只算退休前）；买车可设换车周期、截止年龄和每次卖旧车回收，每次实际花的是「价格减回收」。「首付付得起吗」按当前储蓄推演到计划月份的可支配资产，对照首付、杂费与应急金线。价格按今天的钱，默认实际不涨价，想保守就填高一点。公积金贷款与提取暂未单独建模。</p></details>
    {occurring && <PlanningOccurrenceDialog event={occurring} existing={retire.core?.occurrences.find(o => o.event_id === occurring.id)} snapshot={store.snapshot} accounts={store.accounts} today={today} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} onClose={() => setOccurring(null)} onSave={o => void saveOccurrence(o)}/>}
    {editing && <EventDialog draft={editing.draft} isNew={editing.isNew} today={today} events={events} busy={saver.busy} onClose={() => setEditing(null)} onSave={async ev => { const next = editing.isNew ? [...events, ev] : events.map(x => (x.id === ev.id ? ev : x)); if (await write(next)) setEditing(null); }} notice={saver.notice}/>}
  </article>;
}

function EventDialog({ draft, isNew, today, busy, notice, onClose, onSave }: { draft: StoredLifeEvent; isNew: boolean; today: string; events: StoredLifeEvent[]; busy: boolean; notice: string; onClose: () => void; onSave: (e: StoredLifeEvent) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind>(draft.kind), [label, setLabel] = useState(draft.label), [date, setDate] = useState(draft.date);
  const [price, setPrice] = useState(draft.price_cents), [down, setDown] = useState(draft.down_cents), [extra, setExtra] = useState(draft.extra_cents);
  const [rate, setRate] = useState(hundredthsToPct(draft.loan_rate_hundredths)), [years, setYears] = useState(String(draft.loan_years));
  const [holding, setHolding] = useState(draft.holding_cents), [rent, setRent] = useState(draft.rent_saved_cents), [resale, setResale] = useState(draft.resale_cents);
  const [cycle, setCycle] = useState(draft.cycle_years === null ? '' : String(draft.cycle_years)), [until, setUntil] = useState(draft.until_age === null ? '' : String(draft.until_age));
  const [included, setIncluded] = useState(draft.included), [err, setErr] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const financed = Number(price || 0) > Number(down || 0);
  function save() {
    const stop = (m: string) => setErr(m);
    if (!label.trim()) return stop('请填写名称。');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) return stop('计划月份格式须是 YYYY-MM；过去日期将显示待核对。');
    if (!price || price === '0') return stop('请填写总价。');
    if (Number(down || 0) > Number(price)) return stop('首付不能高于总价。');
    const r = pctToHundredths(rate), y = Number(years);
    if (financed && (r === null || r < 0 || r > 2000)) return stop('贷款利率请填 0 到 20 之间的百分数。');
    if (financed && (!Number.isInteger(y) || y < 1 || y > 40)) return stop('贷款年限须是 1 到 40 的整数。');
    const c = cycle.trim() === '' ? null : Number(cycle), u = until.trim() === '' ? null : Number(until);
    if (c !== null && (!Number.isInteger(c) || c < 1 || c > 40)) return stop('换车周期须是 1 到 40 的整数年，留空表示只买一次。');
    if (u !== null && (!Number.isInteger(u) || u < 0 || u > 120)) return stop('截止年龄须是 0 到 120 的整数。');
    setErr('');
    onSave({ ...draft, id: draft.id, label: label.trim(), kind, date, included, price_cents: price, down_cents: down || '0', extra_cents: extra || '0', loan_rate_hundredths: financed ? (r as number) : draft.loan_rate_hundredths, loan_years: financed ? y : draft.loan_years, holding_cents: holding || '0', rent_saved_cents: kind === 'house' ? rent || '0' : '0', cycle_years: kind === 'car' ? c : null, until_age: kind === 'car' ? u : null, resale_cents: kind === 'car' ? resale || '0' : '0' });
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="event-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); save(); }}>
    <header><div><p className="eyebrow">规划 · 大额计划</p><h2 id="event-heading">{isNew ? '新增' : '编辑'}大额计划</h2><p className="muted">金额都按「今天的钱」；这些是设想，不是事实，不会扣你真实的资产。</p></div><CloseButton type="button" aria-label="关闭大额计划表单" disabled={busy} onClick={onClose}/><div className="editor-header-actions"><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div></header>
    <section className="form-block">
      <FormRow label="类型"><Segments label="类型" value={kind} options={[{ value: 'house', label: '买房' }, { value: 'car', label: '买车' }, { value: 'other', label: '其他' }]} onChange={setKind} disabled={busy}/></FormRow>
      <FormRow label="名称" hint="例如「北京买房」「二手车」"><input aria-label="名称" value={label} disabled={busy} onChange={e => setLabel(e.target.value)}/></FormRow>
      <FormRow label="计划购买月份" hint="还不确定就填大概的月份，也可以在列表里看 5、7、10 年后买的差别"><input type="month" aria-label="计划购买月份" value={date} disabled={busy} onChange={e => setDate(e.target.value)}/></FormRow>
      <FormRow label="总价"><CentInput label="总价" value={price} disabled={busy} onChange={setPrice}/></FormRow>
      <FormRow label="首付 / 一次付清的现金" hint="等于总价就是全款，没有贷款"><CentInput label="首付" value={down} disabled={busy} onChange={setDown}/></FormRow>
      <FormRow label={kind === 'house' ? '一次性杂费（税费、中介、装修等）' : '一次性杂费'}><CentInput label="杂费" value={extra} disabled={busy} onChange={setExtra}/></FormRow>
      {financed && <><FormRow label="贷款年利率（%）" hint="这是假设；商贷与公积金贷款利率不同，公积金贷款暂未单独建模"><input aria-label="贷款年利率" inputMode="decimal" value={rate} disabled={busy} onChange={e => setRate(e.target.value)}/></FormRow>
        <FormRow label="贷款年限（年）" hint="等额本息，月供固定名义金额"><input aria-label="贷款年限" inputMode="numeric" value={years} disabled={busy} onChange={e => setYears(e.target.value)}/></FormRow></>}
      {kind !== 'other' && <FormRow label={kind === 'house' ? '每月物业、取暖、维修等持有成本' : '每月养车费（保险、停车、充电或油费、保养）'}><CentInput label="每月持有成本" value={holding} disabled={busy} onChange={setHolding}/></FormRow>}
      {kind === 'house' && <FormRow label="买房后不再付的月房租" hint="现在的房租已经算在你的每月储蓄里；买房后这部分补回来，只算退休前"><CentInput label="省下的月房租" value={rent} disabled={busy} onChange={setRent}/></FormRow>}
      {kind === 'car' && <>
        <FormRow label="换车周期（年）" hint="留空表示只买这一辆；车是快消品，常见 4 到 6 年换一次"><input aria-label="换车周期" inputMode="numeric" value={cycle} placeholder="只买一次" disabled={busy} onChange={e => setCycle(e.target.value)}/></FormRow>
        <FormRow label="用到几岁为止" hint="之后不再换车，养车费也停；留空到规划终点"><input aria-label="用车截止年龄" inputMode="numeric" value={until} placeholder="规划终点" disabled={busy} onChange={e => setUntil(e.target.value)}/></FormRow>
        <FormRow label="每次换车卖旧车回收" hint="每次换车实际花的是价格减去这笔"><CentInput label="卖旧车回收" value={resale} disabled={busy} onChange={setResale}/></FormRow></>}
      <FormRow label="计入退休估算" hint="关掉只保留这个设想，不影响退休结论"><Switch label="计入退休估算" value={included} disabled={busy} onChange={setIncluded}/></FormRow>
    </section>
    {(err || notice) && <p className="notice" role="status">{err || notice}</p>}
    <Info text="退休后月预算「日常生活」请不要再含房租、房贷、车；这些由大额计划来出。"/>
  </form></dialog>;
}

function retireOccurrence(r: RetireInputs, id: string) { return r.core?.occurrences.some(o => o.event_id === id); }
