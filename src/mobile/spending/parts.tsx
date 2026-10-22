import { useState } from 'react';
import type { ReactNode } from 'react';
import { useEntry, useNav } from '../nav-context';
import { Button, DateField, ErrorState, Fab, FormGroup, LargeTitle, Loading, NavBar, Notice, SegmentedControl, Sheet } from '../ui';
import { periodChoices, periodFromKey } from './model';
import type { PeriodKey, Tone } from './model';
import type { FinancePeriod } from '../../finance-contract';
import type { Read } from './read';
import './spending.css';

/** Title block of a spending page: back bar plus large title, or just the large title on a tab root. The 新增 action is the floating button at the bottom right. */
export function Head({ title, subtitle, add }: { title: string; subtitle?: string; add?: { label: string; onClick: () => void; disabled?: boolean } }) {
  const { isRoot } = useEntry();
  return <>
    {!isRoot && <NavBar/>}
    <LargeTitle title={title} subtitle={subtitle}/>
    {add && <Fab label={add.label} disabled={add.disabled} onClick={add.onClick}/>}
  </>;
}

/** Small status pill: 进行中、已暂停、待确认. Colour never carries the meaning alone; the text does. */
export function Tag({ tone = 'neutral', children }: { tone?: Tone | 'accent'; children: ReactNode }) {
  return <span className={`sp-tag sp-tag-${tone}`}>{children}</span>;
}

/** Loading, error (with retry) or the content. `empty` shows when the read succeeded with nothing to show. */
/** `nav` gives a modal editor its 取消 button while it has no form yet, so a failed read never traps the user. */
export function Loaded<T>({ read, what, nav, children }: { read: Read<T>; what: string; nav?: boolean; children: (data: T) => ReactNode }) {
  const state = read.error ? <ErrorState title={`${what}读取失败`} message={read.error} onRetry={read.reload}/>
    : read.loading || read.data === null ? <Loading label={`正在读取${what}…`}/> : null;
  if (state) return nav ? <div className="m-page"><NavBar/>{state}</div> : state;
  return <>{children(read.data as T)}</>;
}

/** 期间：本月 / 今年 / 全部 / 自选. 自选在弹窗里填两个日期，用桌面同一个校验器，不合法就留在弹窗里提示。 */
export function PeriodBar({ today, value, custom, onChange }: { today: string; value: PeriodKey; custom: { from: string; to: string } | null; onChange: (key: PeriodKey, custom: { from: string; to: string } | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? `${today.slice(0, 4)}-01-01`), [to, setTo] = useState(custom?.to ?? today);
  const [error, setError] = useState('');
  const apply = () => {
    const result = periodFromKey('custom', today, { from, to });
    if (!result.ok) { setError(result.error); return; }
    setError(''); setEditing(false); onChange('custom', { from, to });
  };
  return <>
    <div className="sp-period"><span>期间</span>
      <SegmentedControl label="期间" items={periodChoices} value={value} onChange={key => { if (key === 'custom') { setError(''); setEditing(true); } else onChange(key, custom); }}/></div>
    {value === 'custom' && custom && <p className="sp-period-custom">{custom.from} 至 {custom.to}（含两端）<button type="button" className="sp-link" onClick={() => { setFrom(custom.from); setTo(custom.to); setError(''); setEditing(true); }}>修改</button></p>}
    {editing && <Sheet title="自选日期" onClose={() => setEditing(false)} doneLabel="取消">
      <div className="sp-sheet-body">
        <FormGroup footer="开始和结束日期都包含在内；结束日期不能早于开始日期。">
          <DateField label="开始日期" value={from} onChange={setFrom} max={to || undefined}/>
          <DateField label="结束日期" value={to} onChange={setTo} min={from || undefined}/>
        </FormGroup>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button variant="primary" block onClick={apply}>应用</Button>
      </div>
    </Sheet>}
  </>;
}
export function periodOf(key: PeriodKey, today: string, custom: { from: string; to: string } | null): FinancePeriod {
  const result = periodFromKey(key, today, custom ?? undefined);
  return result.ok ? result.value : { kind: 'all' };
}

/** Modal editor frame: 取消 / title / 保存, error strip and the form below. */
export function EditorFrame({ title, onSave, busy, canSave = true, error, children }: { title: string; onSave: () => void; busy: boolean; canSave?: boolean; error?: string; children: ReactNode }) {
  return <div className="m-page">
    <NavBar title={title} primary={{ label: '保存', onClick: onSave, disabled: !canSave, busy }}/>
    {error && <Notice tone="danger">{error}</Notice>}
    {children}
  </div>;
}

/** Page frame with a back bar for detail pages. */
export function useBlocked(): boolean { return useNav().blocked; }
