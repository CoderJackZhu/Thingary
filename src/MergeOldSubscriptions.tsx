// 旧订阅合并提示：升级前独立保存的订阅档案与同名计划，由用户逐对确认后关联。
// 只做关联，不覆盖、不删除；未勾选的保持原样，「暂不处理」后同一对不再提示。
import { useEffect, useRef, useState } from 'react';
import { errorMessage, money } from './asset';
import { linkMergeView } from './link';
import type { MergeInput, MergePair, MergeView } from './link';
import { intervalUnit } from './recurring';
import { submit, Unresolved } from './wealth';

const KEY = 'thingary.merge-dismissed.v1';
const pairKey = (p: MergePair) => `${p.asset_id}|${p.plan_id}`;
function dismissed(): string[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } }
function dismiss(keys: string[]) { try { localStorage.setItem(KEY, JSON.stringify([...new Set([...dismissed(), ...keys])])); } catch { /* 偏好只是便利，失败时下次再提示 */ } }

export function MergeNotice({ refresh, disabled, onDone }: { refresh: number; disabled: boolean; onDone: (message: string) => void }) {
  const [view, setView] = useState<MergeView | null>(null), [open, setOpen] = useState(false), [hidden, setHidden] = useState(0);
  useEffect(() => {
    let live = true;
    // 发现候选只是便利：读取失败时不打扰，页面本身的读取错误另有提示。
    linkMergeView().then(v => { if (live) setView(v); }).catch(() => { if (live) setView(null); });
    return () => { live = false; };
  }, [refresh, hidden]);
  const skip = dismissed();
  const pairs = view?.pairs.filter(p => !skip.includes(pairKey(p))) ?? [];
  if (!view || !pairs.length) return null;
  return <>
    <div className="notice" role="note">发现 {pairs.length} 对旧记录可能是同一个订阅（{pairs.map(p => p.plan_name).join('、')}）：升级前分别保存的服务档案和付款计划。
      <button className="ui-link" disabled={disabled} onClick={() => setOpen(true)}>查看并合并…</button>
      <button className="ui-link" onClick={() => { dismiss(pairs.map(pairKey)); setHidden(n => n + 1); }}>暂不处理</button></div>
    {open && <MergeDialog generation={view.generation} pairs={pairs} onClose={saved => { setOpen(false); if (saved) setHidden(n => n + 1); }} onDone={onDone} />}
  </>;
}

function MergeDialog({ generation, pairs, onClose, onDone }: { generation: string; pairs: MergePair[]; onClose: (saved: boolean) => void; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 没有旧单次价格的默认勾选；有金额的需要用户看过后自己勾。
  const [picked, setPicked] = useState<string[]>(() => pairs.filter(p => !p.asset_price_cents).map(pairKey));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function run() {
    const chosen = pairs.filter(p => picked.includes(pairKey(p)));
    if (!chosen.length) { setNotice('请至少勾选一对。'); return; }
    setBusy(true); setNotice('');
    const input: MergeInput = { request_id: crypto.randomUUID(), generation, pairs: chosen.map(p => ({ asset_id: p.asset_id, asset_expected_revision: p.asset_revision, plan_id: p.plan_id, plan_expected_revision: p.plan_revision })) };
    try {
      await submit({ command: 'link_merge', input, label: `合并 ${chosen.length} 个旧订阅` });
      onDone(`已合并 ${chosen.length} 个订阅；付款记录保持原样，没有新增或删除任何付款。`);
      onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog merge-dialog" aria-labelledby="merge-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="merge-title">合并旧订阅</h2>
    <p className="muted">名称相同、且各自只有一条的旧记录。合并只把服务档案挂到付款计划上，不新增也不删除任何付款；没勾选的保持原样。</p>
    {stuck ? <p className="notice" role="status">保存结果未确认，请先核对上一次请求。</p> : <ul className="merge-list">
      {pairs.map(p => <li key={pairKey(p)}><label><input type="checkbox" checked={picked.includes(pairKey(p))} disabled={busy} onChange={e => setPicked(c => e.target.checked ? [...c, pairKey(p)] : c.filter(k => k !== pairKey(p)))} />
        <strong>{p.plan_name}</strong></label>
        <small className="muted">付款计划：{money(p.amount_cents)}／{intervalUnit({ interval_days: p.interval_days, interval_months: p.interval_months })} · {p.paid_count ? `已记录 ${p.paid_count} 笔共 ${money(p.paid_cents)}` : '未记录付款'}</small>
        <small className="muted">旧服务档案：{p.provider || '未填提供方'}{p.stopped_on ? ` · 已于 ${p.stopped_on} 停用（合并后需核对停用记录）` : ''}</small>
        {(p.asset_price_cents || p.asset_expires) && <small className="warn-text">档案原有{p.asset_price_cents ? `单次价格 ${money(p.asset_price_cents)}` : ''}{p.asset_price_cents && p.asset_expires ? '、' : ''}{p.asset_expires ? `到期日 ${p.asset_expires}` : ''}：合并后不再单独计入重要支出（以付款记录为准，避免重复），原值会写进档案备注。若这笔钱不在付款记录里，请先不要合并。</small>}
      </li>)}
    </ul>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>取消</button><button type="button" className="primary" disabled={busy || stuck || !picked.length} onClick={() => void run()}>{busy ? '合并中…' : `合并所选 ${picked.length} 对`}</button></div>
  </dialog>;
}
