import { useMemo, useState } from 'react';
import { money } from './asset';
import { CentInput, Info, Switch } from './FormControls';
import { DateInput } from './DateInput';
import type { BasicCapabilities, PlanningMissing } from './plan';
import { runway } from './plan-runway';
import { runwayLines } from './planning-basic-view';

const STALE_DAYS = 45;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const cents = (s: string) => (s === '' ? null : Number(s));
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/** Independent temporary tool: no birthday, retirement target or profile save required. */
export function RunwayCard({ caps, today, onOwner }: { caps: BasicCapabilities | null; today: string; onOwner: (owner: PlanningMissing['owner'], field?: string) => void }) {
  const [income, setIncome] = useState(''), [none, setNone] = useState(false), [spend, setSpend] = useState(''), [floor, setFloor] = useState('');
  const [manual, setManual] = useState(false), [start, setStart] = useState(''), [date, setDate] = useState(today), [months, setMonths] = useState(60);
  const funds = caps?.funds;
  const useManual = manual || !funds;
  const balance = useManual ? cents(start) : funds?.status === 'ready' ? Number(funds.value.available_cents) : null;
  const anchor = useManual ? date : funds?.status === 'ready' ? funds.value.date : '';
  const dateError = balance !== null && (!validDate(anchor) || anchor > today) ? '请选择有效的截至日，不能晚于今天。' : null;
  const incomeCents = none ? 0 : cents(income), spendCents = cents(spend), floorCents = cents(floor);
  const out = useMemo(() => balance !== null && !dateError && incomeCents !== null && spendCents !== null
    ? runway({ start_cents: balance, income_cents: incomeCents, spend_cents: spendCents, floor_cents: floorCents, months })
    : null, [balance, dateError, incomeCents, spendCents, floorCents, months]);
  const lines = out && runwayLines(out, { set: floorCents !== null, cents: String(floorCents ?? 0) }, money);
  const stale = validDate(anchor) && daysBetween(anchor, today) > STALE_DAYS;
  return <article className="ui-card ui-content plan-runway" aria-label="资金能撑多久">
    <details><summary>资金能撑多久 · 当前收支临时计算</summary>
      <p className="muted small">无需退休目标或养老金资料。只看当前收支持续时能付几个月，不预测复工；输入不保存，也不改变长期计划。</p>
      {funds && <div className="plan-runway-switch"><Switch label="改用手填模拟资金" value={manual} onChange={setManual}/><span>改用手填模拟资金</span></div>}
      {useManual ? <div className="plan-runway-fields">
        <label className="rs-field"><span>当前可动用资金（元）</span><CentInput label="当前可动用资金" value={start} placeholder="只填能用于支付的资金" onChange={setStart}/></label>
        <div className="rs-field"><span>资金截至日</span><DateInput label="资金截至日" value={date} max={today} onChange={setDate}/></div>
      </div> : funds?.status === 'blocked' ? <>
        <p className="muted">可用资金尚未确认。可以回答准备资金的问题，或改用手填金额独立试算。</p><button type="button" className="ui-btn" onClick={() => onOwner('funds')}>确认现在可用的钱</button>
      </> : funds?.status === 'ready' ? <p className="muted small">起点：{funds.value.kind === 'simulation' ? '手填金额' : '实际盘点'}，截至 {funds.value.date} 可以动用的资金 {money(funds.value.available_cents)}。</p> : null}
      {stale && <p className="notice" role="status">起点已是 {daysBetween(anchor, today)} 天前的资料，计算从该截至日开始；之后实际发生的变化未覆盖，不能当成今天余额。</p>}
      <div className="plan-runway-fields">
        <label className="rs-field"><span>每月可靠到账（元）</span><CentInput label="每月可靠到账" value={none ? '' : income} disabled={none} placeholder="只填确定会到账的" onChange={setIncome}/></label>
        <label className="rs-field"><span>每月必要开销（元）</span><CentInput label="每月必要开销" value={spend} placeholder="当前必要开销合计" onChange={setSpend}/></label>
        <label className="rs-field"><span>希望至少保留的资金（元，选填）</span><CentInput label="希望至少保留的资金（选填）" value={floor} placeholder="不填只检查支付能力" onChange={setFloor}/></label>
        <label className="rs-field"><span>检查期间</span><select aria-label="资金检查期间" value={months} onChange={e => setMonths(Number(e.target.value))}>{[12, 24, 60, 120].map(n => <option key={n} value={n}>{n} 个月</option>)}</select></label>
      </div>
      <div className="plan-runway-switch"><Switch label="目前没有可靠到账" value={none} onChange={setNone}/><span>目前没有可靠到账</span></div>
      <p className="muted small">留空表示未知，没有到账请明确打开。必要开销应包含当前房租、月供、社保等；这些费用不从退休预算或大额计划自动添加，避免重复。</p>
      {!out && <p className="muted small" role="status">{dateError ?? (balance === null ? '请提供可用资金起点。' : incomeCents === null ? '请填写每月可靠到账，或打开「目前没有可靠到账」。' : '请填写每月必要开销。')}</p>}
      {lines && <div role="status">
        <p className={`plan-req-main ${lines.tone}`}><strong>{lines.main}</strong></p>
        {lines.floor && <p className={lines.tone === 'warn' ? 'warn' : 'muted'}>{lines.floor}</p>}
      </div>}
      <p className="muted small">从截至日后按完整月检查：月初先付开销，月底再到账。底线检查付款后的最低余额。资金不足以付整月不等于余额已耗尽。</p>
      <p className="muted small">固定当前收支，不计投资收益、通胀、未来大额事件及月供结束；不是完整未来现金流预测。<Info text="这与退休所需投入是独立问题；本次临时输入关闭页面后丢弃，不保存到预计投入或其他页面。"/></p>
    </details>
  </article>;
}
