import { money } from './asset';
import { CoverageNote } from './CoverageNote';
import { retractOccurrence } from './plan-occurrence-actions';
import { MonthInput } from './DateInput';
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
import { yuan } from './RetireOverview';
import './retire.css';
import { t } from './i18n.ts';
type Kind = StoredLifeEvent['kind'];
const kindText: Record<Kind, string> = { house: t('买房'), car: t('买车'), other: t('其他') };
const monthLabel = (today: string, offset: number) => { const i = monthIndex(today) + offset; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const delayText = (d: number | null, base: number | null, w: number | null) => base === null ? t('本来就达不到') : w === null ? t('所选规划终点前达不到') : d === 0 ? t('几乎无影响') : t('推迟约 {v1}', { v1: d! >= 12 ? `${Math.floor(d! / 12)} 年${d! % 12 ? ` ${d! % 12} 个月` : ''}` : `${d} 个月` });
const cents = (yuanAmount: number) => String(Math.round(yuanAmount * 100));

/** 「其他」类型的预设：一次性支出 + 可选的每月持续支出与每隔几年重复；untilYears 是从计划月份起持续的年数。 */
const other = (date: string, label: string, o: { price: number; down: number; holding?: number; cycle?: number; untilYears?: number }): Omit<StoredLifeEvent, 'id'> => ({
  label, kind: 'other', date, included: true, price_cents: cents(o.price), down_cents: cents(o.down), extra_cents: '0', loan_rate_hundredths: 350, loan_years: 1,
  holding_cents: cents(o.holding ?? 0), rent_saved_cents: '0', cycle_years: o.cycle ?? null, until_month: o.untilYears ? addYears(date, o.untilYears) : null, time_unconfirmed: false, resale_cents: '0',
});
const addYears = (month: string, years: number) => `${Number(month.slice(0, 4)) + years}${month.slice(4)}`;
/** 示例预设：金额只是占位，按自己的情况改。日期按「几年后」放在当月。 */
const presets: { key: string; label: string; years: number; make: (date: string) => Omit<StoredLifeEvent, 'id'> }[] = [
  { key: 'house', label: t('买房'), years: 7, make: date => ({ label: t('买房'), kind: 'house', date, included: true, price_cents: cents(1_500_000), down_cents: cents(450_000), extra_cents: cents(50_000), loan_rate_hundredths: 350, loan_years: 30, holding_cents: cents(800), rent_saved_cents: cents(2000), cycle_years: null, until_month: null, time_unconfirmed: false, resale_cents: '0' }) },
  { key: 'car', label: t('买车'), years: 2, make: date => ({ label: t('买车'), kind: 'car', date, included: true, price_cents: cents(100_000), down_cents: cents(100_000), extra_cents: '0', loan_rate_hundredths: 350, loan_years: 3, holding_cents: cents(1200), rent_saved_cents: '0', cycle_years: 8, until_month: null, time_unconfirmed: false, resale_cents: cents(20_000) }) },
  // 常用模板：都是「其他」类型加预设字段（一次性支出、可选分期、每月持续支出、每隔几年重复、持续到哪个月），不另起计算。金额只是占位。
  { key: 'reno', label: t('装修'), years: 2, make: date => other(date, t('装修'), { price: 200_000, down: 200_000 }) },
  { key: 'wedding', label: t('婚礼与彩礼'), years: 2, make: date => other(date, t('婚礼与彩礼'), { price: 300_000, down: 300_000 }) },
  { key: 'child', label: t('生育与养孩子'), years: 2, make: date => other(date, t('生育与养孩子'), { price: 30_000, down: 30_000, holding: 3_000, untilYears: 22 }) },
  { key: 'edu', label: t('子女教育'), years: 5, make: date => other(date, t('子女教育'), { price: 40_000, down: 40_000, cycle: 1, untilYears: 11 }) },
  { key: 'travel', label: t('旅行'), years: 1, make: date => other(date, t('旅行'), { price: 20_000, down: 20_000, cycle: 1, untilYears: 9 }) },
  { key: 'other', label: t('其他大额'), years: 3, make: date => ({ label: t('其他大额支出'), kind: 'other', date, included: true, price_cents: cents(50_000), down_cents: cents(50_000), extra_cents: '0', loan_rate_hundredths: 350, loan_years: 1, holding_cents: '0', rent_saved_cents: '0', cycle_years: null, until_month: null, time_unconfirmed: false, resale_cents: '0' }) },
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
  const write = (next: StoredLifeEvent[]) => store.write(next, retire.core ? { ...retire.core, occurrences: retire.core.occurrences.filter(o => next.some(e => e.id === o.event_id)) } : retire.core);
  async function saveOccurrence(o: Occurrence | null) { const core = retire.core ?? emptyCore(today); if (await store.write(events, { ...core, occurrences: o ? [...core.occurrences.filter(x => x.event_id !== o.event_id), o] : retractOccurrence(core.occurrences, core.occurrences.find(x => x.event_id === occurring?.id)?.id ?? '') })) setOccurring(null); }
  async function toggle(id: string, included: boolean) { await write(events.map(e => (e.id === id ? { ...e, included } : e))); }
  async function usePlanningHorizon(id: string) { await write(events.map(e => e.id === id ? { ...e, until_month: null, time_unconfirmed: false } : e)); }
  async function remove(id: string) { setConfirm(null); await write(events.filter(e => e.id !== id)); }
  // 已经有一套房计入时，新加的房默认不计入，避免两套房同时发生；想比较方案就只勾选其中一套。
  const add = (key: string) => { const p = presets.find(x => x.key === key)!, d = p.make(monthLabel(today, p.years * 12)); setEditing({ isNew: true, draft: { id: crypto.randomUUID(), ...d, included: d.kind === 'house' ? d.included && !events.some(x => x.kind === 'house' && x.included) : d.included } }); };
  return <article className="ui-card ui-content plan-goal plan-events" aria-label={t('大额计划')}><CoverageNote annotations={store.ready?.plan.annotations} compact/>
    <div className="ui-section-head"><div><p className="eyebrow">{t('买房、买车、装修、婚礼、养孩子与更多 · 影响目标结果')}</p><h3>{t('大额计划')}<Info text={retire.basic ? t('首付等一次性支出和月供等持续费用都算进退休测算。请核对这些费用是否已经含在生活费里，没含的另算一次。这里只估算，不扣实际资金。') : t('把房和车算进来：每件拆成一次性现金支出（首付、杂费、换车净支出）和持续的月度收支（月供、持有成本、不再付的房租），并入同一个退休计算。「日常生活」预算请不要再含房租、房贷和车。这里只估算，不扣你真实的资产，也不划拨。')}/></h3><p className="muted small">{t('未来设想填好购买月份和金额后，打开计入开关就会重算；不用填写实际付款或贷款余额。只有已经发生的购买才需要核对实际资料。')}</p></div>
      <span className="rs-presets">{presets.map(p => <button key={p.key} type="button" className="ui-btn" disabled={saver.busy || events.length >= 20} onClick={() => add(p.key)}>+ {p.label}</button>)}</span></div>
    {saver.notice && <p className="notice" role="status">{saver.notice}</p>}
    {events.length === 0 ? <p className="muted">{t('还没有大额计划。需要比较大额支出时，可以从上面的模板添加一个设想（买房、买车、装修、婚礼与彩礼、生育与养孩子、子女教育、旅行，或其他）；预设金额与年限仅作占位，请按自己的情况修改，只勾选本次要计入的安排。')}</p> : <>
      <div className="plan-table-scroll" tabIndex={0} role="region" aria-label={t('大额计划列表')}><table className="ui-table plan-event-table"><thead><tr><th>{t('计划')}</th><th className="amount">{t('总价 / 首付')}</th><th>{t('买后每月')}</th><th>{t('首付付得起吗')}</th><th>{t('对退休的影响（只算这一件）')}</th><th>{t('计入')}</th><th/></tr></thead>
        <tbody>{events.map(s => { const i = rows?.items.find(x => x.e.id === s.id)?.impact; return <tr key={s.id} className={s.included || retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred') ? undefined : 'closed'}>
          <td><b>{s.label}</b><small className="muted">{retire.core?.occurrences.find(o => o.event_id === s.id)?.status === 'occurred' ? t('已标发生 · 后续资料见核对清单') : retire.core?.occurrences.find(o => o.event_id === s.id)?.status === 'cancelled' ? t('已取消') : s.date < today.slice(0, 7) ? t('日期已过，请确认是否发生') : t('尚未发生 · 按预计排期')}</small><small className="muted">{kindText[s.kind]} · {s.date}{s.kind === 'car' && s.cycle_years ? t(' · 每 {cycle_years} 年换', { cycle_years: s.cycle_years }) : ''}</small>{s.time_unconfirmed && <small className="warn">{t('持有／循环终点待重设，该部分未计入。请编辑此计划。')}</small>}</td>
          <td className="amount">{money(s.price_cents)}<small className="muted">{t('首付 {v1}', { v1: money(s.down_cents) })}</small></td>
          <td>{i && i.payment_nominal > 0 ? <>{t('月供 {v1}', { v1: yuan(i.payment_nominal) })}<small className="muted">{t('每月实际还款金额不变')}</small></> : <span className="muted">{retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred' && o.loan && Number(o.loan.principal_cents) > 0) ? t('剩余欠款按核对过的剩余期数继续还') : t('待测算')}</span>}{Number(s.holding_cents) > 0 && <small className="muted">{s.kind === 'car' ? t('养车') : t('持有')} {money(s.holding_cents)}</small>}
            {i && (i.payment_nominal > 0 || Number(s.holding_cents) > 0) && <small className={i.saving_not_positive ? 'warn' : 'muted'}>{t('买后每月储蓄约 {v1}', { v1: yuan(i.saving_after) })}{i.saving_not_positive ? t('，要靠当时的收入支撑') : ''}</small>}</td>
          <td>{!i ? <span className="muted">{retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred') ? t('按实际付款继续计算') : store.blocked}{store.onContribution && !retire.core?.occurrences.some(o => o.event_id === s.id) && <button type="button" className="ui-link" onClick={store.onContribution}>{t('估计每月能存多少钱')}</button>}</span> : i.short === 0 ? <>{t('够：{date} 时可支配资产约 {v2}', { date: s.date, v2: yuan(i.assets_at_date) })}<small className="muted">{t('需 {v1}（含应急金线）', { v1: yuan(i.cash_needed) })}</small></> : <><span className="warn">{t('差 {v1}', { v1: yuan(i.short) })}</span><small className="muted">{t('需 {v1}；', { v1: yuan(i.cash_needed) })}{i.earliest_offset === null ? t('按当前储蓄不会够') : t('最早约 {v1} 够', { v1: monthLabel(ready?.plan.anchor_date ?? today, i.earliest_offset) })}</small></>}</td>
          <td>{i ? <>{delayText(i.delay_months, i.base_fi, i.with_fi)}{s.kind === 'house' && <small className="muted">{i.sweep.map(w => t('{years} 年后买：{v2}', { years: w.years, v2: w.delay_months === null ? '达不到' : w.delay_months === 0 ? '无影响' : `+${w.delay_months} 个月` })).join('；')}</small>}</> : <span className="muted">—</span>}</td>
          <td><Switch label={t('计入{label}', { label: s.label })} value={s.included || !!retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred')} disabled={saver.busy || saver.stuck || !!retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred')} onChange={v => void toggle(s.id, v)}/></td>
          <td><div className="rs-actions">{s.time_unconfirmed && <button type="button" className="ui-btn" aria-label={t('{label}按规划终点计算', { label: s.label })} disabled={saver.busy || saver.stuck} onClick={() => void usePlanningHorizon(s.id)}>{t('按规划终点计算')}</button>}<button type="button" className="ui-btn" disabled={saver.busy || saver.stuck} onClick={() => setOccurring(s)}>{retire.core?.occurrences.some(o => o.event_id === s.id) || s.date < today.slice(0, 7) ? t('发生核对') : t('已发生？')}</button><button id={`plan-event-edit-${s.id}`} type="button" className="ui-btn" disabled={saver.busy || saver.stuck} onClick={() => setEditing({ isNew: false, draft: s })}>{s.time_unconfirmed ? t('重设终点') : t('编辑')}</button>
            {confirm === s.id ? <button type="button" className="danger" disabled={saver.busy} onClick={() => void remove(s.id)}>{t('确认删除')}</button> : <button type="button" className="ui-btn" disabled={saver.busy || !!retire.core?.occurrences.some(o => o.event_id === s.id && o.status === 'occurred')} onClick={() => setConfirm(s.id)}>{t('删除')}</button>}</div></td></tr>; })}</tbody></table></div>
      {rows && !retire.core?.occurrences.some(o => o.status === 'occurred') && rows.items.some(x => x.e.included) && <p>{t('已计入的几件一起发生：')}<strong>{delayText(rows.total.delay_months, rows.total.base_fi, rows.total.with_fi)}</strong>{t('（相对于都不发生）。已经含在上面的退休结论里。')}</p>}
      {rows && rows.items.filter(x => x.e.kind === 'house' && x.e.included).length > 1 && <p className="rs-note">{t('有多套房同时计入，会按都买来算；比较方案时请只勾选一套。')}</p>}
    </>}
    <details className="plan-explanation"><summary>{t('怎么算的')}</summary><p className="muted small">{t('首付、杂费在计划月份一次性扣；借款金额按购买时预计的实际价格算，采用等额本息（每月还款总额相同），到期停止；物价变化只影响折算成今天的钱，不改变每月实际还款金额；月供与持有成本在退休前压低每月储蓄，退休后算进支出；省租先核对是否已经算入生活费或每月能存的钱，省下的房租不会自动加到每月能存的钱里；买车可设换车周期、截止年龄和每次卖旧车回收，每次实际花的是「价格减回收」；其他类的模板（装修、婚礼、养孩子、教育、旅行）都是同一套：一次性支出、可选分期，加上可选的每月持续支出和每隔几年重复，可设持续到哪个月；教育和旅行重复时每次花的是总价，没有回收。「首付付得起吗」按当前储蓄推演到计划月份的可支配资产，对照首付、杂费与应急金线。价格按今天的钱，默认实际不涨价，想保守就填高一点。公积金贷款与提取暂未单独建模。')}</p></details>
    {occurring && <PlanningOccurrenceDialog event={occurring} existing={retire.core?.occurrences.find(o => o.event_id === occurring.id)} snapshot={store.snapshot} accounts={store.accounts} today={today} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} onClose={() => setOccurring(null)} onSave={o => void saveOccurrence(o)}/>}
    {editing && <EventDialog basic={!!retire.basic} draft={editing.draft} isNew={editing.isNew} busy={saver.busy} onClose={() => setEditing(null)} onSave={async ev => { const next = editing.isNew ? [...events, ev] : events.map(x => (x.id === ev.id ? ev : x)); if (await write(next)) setEditing(null); }} notice={saver.notice}/>}
  </article>;
}

function EventDialog({ basic, draft, isNew, busy, notice, onClose, onSave }: { basic: boolean; draft: StoredLifeEvent; isNew: boolean; busy: boolean; notice: string; onClose: () => void; onSave: (e: StoredLifeEvent) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind>(draft.kind), [label, setLabel] = useState(draft.label), [date, setDate] = useState(draft.date);
  const [price, setPrice] = useState(draft.price_cents), [down, setDown] = useState(draft.down_cents), [extra, setExtra] = useState(draft.extra_cents);
  const [rate, setRate] = useState(hundredthsToPct(draft.loan_rate_hundredths)), [years, setYears] = useState(String(draft.loan_years));
  const [holding, setHolding] = useState(draft.holding_cents), [rent, setRent] = useState(draft.rent_saved_cents), [resale, setResale] = useState(draft.resale_cents);
  const [cycle, setCycle] = useState(draft.cycle_years === null ? '' : String(draft.cycle_years)), [until, setUntil] = useState(draft.until_month ?? '');
  const [included, setIncluded] = useState(draft.included), [err, setErr] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const financed = Number(price || 0) > Number(down || 0);
  function save() {
    const stop = (m: string) => setErr(m);
    if (!label.trim()) return stop(t('请填写名称。'));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) return stop(t('计划月份格式须是 YYYY-MM；过去日期需确认是否已经发生。'));
    if (!price || price === '0') return stop(t('请填写总价。'));
    if (Number(down || 0) > Number(price)) return stop(t('首付不能高于总价。'));
    const r = pctToHundredths(rate), y = Number(years);
    if (financed && (r === null || r < 0 || r > 2000)) return stop(t('贷款利率请填 0 到 20 之间的百分数。'));
    if (financed && (!Number.isInteger(y) || y < 1 || y > 40)) return stop(t('贷款年限须是 1 到 40 的整数。'));
    const c = cycle.trim() === '' ? null : Number(cycle), u = until.trim() === '' ? null : until;
    const repeat = kind === 'car' ? t('换车周期') : t('重复周期');
    if (c !== null && (!Number.isInteger(c) || c < 1 || c > 40)) return stop(t('{repeat}须是 1 到 40 的整数年，留空表示只发生一次。', { repeat }));
    if (u !== null && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(u) || u < date)) return stop(t('截止月份须不早于计划月份。'));
    setErr('');
    onSave({ ...draft, id: draft.id, label: label.trim(), kind, date, included, price_cents: price, down_cents: down || '0', extra_cents: extra || '0', loan_rate_hundredths: financed ? (r as number) : draft.loan_rate_hundredths, loan_years: financed ? y : draft.loan_years, holding_cents: holding || '0', rent_saved_cents: kind === 'house' ? rent || '0' : '0', cycle_years: kind === 'house' ? null : c, until_month: kind === 'house' ? null : u, time_unconfirmed: false, resale_cents: kind === 'car' ? resale || '0' : '0' });
  }
  return <dialog ref={dialog} className="editor asset-editor" aria-labelledby="event-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); save(); }}>
    <header><div><p className="eyebrow">{t('规划 · 大额计划')}</p><h2 id="event-heading">{isNew ? t('新增') : t('编辑')}{t('大额计划')}</h2><p className="muted">{t('金额都按「今天的钱」；这些是设想，不是事实，不会扣你真实的资产。')}</p></div><CloseButton type="button" aria-label={t('关闭大额计划表单')} disabled={busy} onClick={onClose}/><div className="editor-header-actions"><button className="primary" disabled={busy}>{busy ? t('保存中…') : t('保存')}</button></div></header>
    <div className="editor-body"><section className="form-block">
      <FormRow label={t('类型')}><Segments label={t('类型')} value={kind} options={[{ value: 'house', label: t('买房') }, { value: 'car', label: t('买车') }, { value: 'other', label: t('其他') }]} onChange={setKind} disabled={busy}/></FormRow>
      <FormRow label={t('名称')} hint={t('例如「买房」「换车」「装修」')}><input aria-label={t('名称')} value={label} disabled={busy} onChange={e => setLabel(e.target.value)}/></FormRow>
      <FormRow label={t('计划购买月份')} hint={t('还不确定就填大概的月份，也可以在列表里看 5、7、10 年后买的差别')}><MonthInput yearIntent="long" label={t('计划购买月份')} value={date} disabled={busy} onChange={setDate}/></FormRow>
      <FormRow label={t('总价')}><CentInput label={t('总价')} value={price} disabled={busy} onChange={setPrice}/></FormRow>
      <FormRow label={t('首付 / 一次付清的现金')} hint={t('等于总价就是全款，没有贷款')}><CentInput label={t('首付')} value={down} disabled={busy} onChange={setDown}/></FormRow>
      <FormRow label={kind === 'house' ? t('一次性杂费（税费、中介、装修等）') : t('一次性杂费')}><CentInput label={t('杂费')} value={extra} disabled={busy} onChange={setExtra}/></FormRow>
      {financed && <><FormRow label={t('贷款年利率（%）')} hint={t('这是假设；商贷与公积金贷款利率不同，公积金贷款暂未单独建模')}><input aria-label={t('贷款年利率')} inputMode="decimal" value={rate} disabled={busy} onChange={e => setRate(e.target.value)}/></FormRow>
        <FormRow label={t('贷款年限（年）')} hint={t('等额本息，每月实际还款总额相同')}><input aria-label={t('贷款年限')} inputMode="numeric" value={years} disabled={busy} onChange={e => setYears(e.target.value)}/></FormRow></>}
      <FormRow label={kind === 'house' ? t('每月物业、取暖、维修等持有成本') : kind === 'car' ? t('每月养车费（保险、停车、充电或油费、保养）') : t('每月持续支出（如养孩子、赡养；没有可留空）')}><CentInput label={kind === 'other' ? t('每月持续支出') : t('每月持有成本')} value={holding} disabled={busy} onChange={setHolding}/></FormRow>
      {kind === 'house' && <FormRow label={t('买房后不再付的月房租')} hint={basic ? t('省下的房租不会自动加到每月能存的钱里；退休后只从预算里已含的房租中扣除，不超过这个金额') : t('现在的房租已经算在你的每月储蓄里；买房后这部分补回来，只算退休前')}><CentInput label={t('省下的月房租')} value={rent} disabled={busy} onChange={setRent}/></FormRow>}
      {kind !== 'house' && <>
        <FormRow label={kind === 'car' ? t('换车周期（年）') : t('每隔几年重复一次（年）')} hint={kind === 'car' ? t('留空表示只买这一辆；车是快消品，常见 4 到 6 年换一次') : t('留空表示只发生一次；旅行、每年的学费可填 1')}><input aria-label={kind === 'car' ? t('换车周期') : t('重复周期')} inputMode="numeric" value={cycle} placeholder={kind === 'car' ? t('只买一次') : t('只一次')} disabled={busy} onChange={e => setCycle(e.target.value)}/></FormRow>
        <FormRow label={kind === 'car' ? t('用到哪个月份') : t('持续到哪个月份')} hint={kind === 'car' ? t('之后不再换车，养车费也停；留空到规划终点') : t('之后不再重复，每月持续支出也停；留空到规划终点')}><MonthInput yearIntent="long" label={kind === 'car' ? t('用车截止月份') : t('持续截止月份')} value={until} disabled={busy} allowClear onChange={setUntil}/></FormRow>
        {kind === 'car' && <FormRow label={t('每次换车卖旧车回收')} hint={t('每次换车实际花的是价格减去这笔')}><CentInput label={t('卖旧车回收')} value={resale} disabled={busy} onChange={setResale}/></FormRow>}</>}
      <FormRow label={t('计入退休估算')} hint={t('关掉只保留这个设想，不影响退休结论')}><Switch label={t('计入退休估算')} value={included} disabled={busy} onChange={setIncluded}/></FormRow>
    </section>
    {(err || notice) && <p className="notice" role="status">{err || notice}</p>}
    <Info text={basic ? t('基础总预算可包含房租、房贷和车；请在预算明细确认已含或额外，避免重复。') : t('退休后月预算「日常生活」请不要再含房租、房贷、车；这些由大额计划来出。')}/>
    </div>
  </form></dialog>;
}

function retireOccurrence(r: RetireInputs, id: string) { return r.core?.occurrences.some(o => o.event_id === id); }
