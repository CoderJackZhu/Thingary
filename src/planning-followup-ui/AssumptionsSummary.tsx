import { useEffect, useRef, useState } from 'react';
import type { AssumptionReadV1, FollowupRead, PlanningFollowupPortV1 } from '../planning-followup-contract';
import { AssumptionsEditor } from './AssumptionsEditor';
import { assumptionSummary, confirmationText } from './model';
import './planning-followup-ui.css';

export function AssumptionsSummary({ port, generation, writeVersion, blocked = false, reload, onPending, onEditingChange }: {
  port: PlanningFollowupPortV1; generation: string; writeVersion: number; blocked?: boolean;
  reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void;
}) {
  const [read, setRead] = useState<FollowupRead<AssumptionReadV1> | null>(null), [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { onEditingChange(open); return () => onEditingChange(false); }, [open, onEditingChange]);
  useEffect(() => {
    let live = true; setRead(null);
    port.readAssumptions(generation).then(v => { if (live) setRead(v.status === 'ready' && v.value.generation !== generation ? { status: 'error', code: 'GENERATION_MISMATCH', message: '资料库已变化，请重新读取。' } : v); }).catch(e => { if (live) setRead({ status: 'error', code: 'READ_ERROR', message: String(e) }); });
    return () => { live = false; };
  }, [port, generation, writeVersion, retry]);
  return <aside className="ui-card ui-content" aria-label="规划试算假设">
    {!read ? <p role="status">正在读取试算假设…</p> : read.status !== 'ready' ? <p role="alert">{read.message}<button className="ui-btn" onClick={() => setRetry(n => n + 1)}>重新读取</button></p> : <>
      <p className={`pfu-confirm ${read.value.confirmation}`}>{confirmationText[read.value.confirmation]}</p>
      <p>{assumptionSummary(read.value)}</p>
      <p className="muted small">收益已扣通胀与费用；0% 表示只跑平通胀。波动率仅用于市场模拟，默认 5% 是程序试算值。</p>
      <button ref={opener} className="ui-btn" disabled={blocked || open} onClick={() => setOpen(true)}>核对收益与波动假设</button>
    </>}
    {open && <AssumptionsEditor port={port} generation={generation} onPending={onPending} onClose={saved => { setOpen(false); if (saved) { setRetry(n => n + 1); reload(); } requestAnimationFrame(() => opener.current?.focus()); }}/>} 
  </aside>;
}
