import { HoldingInput } from "./HoldingInput";
import { holdingText } from "./holdings";
import { holdingQuickChange } from "./wealth";
import type { HoldingQuickMode } from "./wealth";
import { CurrencyInput } from './CurrencyInput';
import { currencyCode, currencyDecimals, currencyAmount, rateLabel, rateSuggestions } from './currency';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow } from './FormControls';
import { errorMessage, money } from './asset';
import { code, quickChanges, quickDateMin, quickDeltaLabel, quickPrevious, quickFact, quickTransferPairs, resolvePending, storedPending, submit, Unresolved } from './wealth';
import type { Account, Draft, Point, QuickMode, QuickUpdate, Snapshot } from './wealth';
import './quick-update.css';

/** The original account editor remains mounted under this modal, including its draft. */
export function QuickUpdateDialog({ account, generation, today, points, onClose }: {
  account: Account; generation: string; today: string; points: Point[]; onClose: (saved: boolean, snapshot?: Snapshot) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false);
  const [date, setDate] = useState(today), [mode, setMode] = useState<QuickMode>('balance');
  const [values, setValues] = useState({ balance: '', delta: '', transfer: '' });
  const [holdingMode,setHoldingMode]=useState<HoldingQuickMode>('replace');
  const [holdingValues,setHoldingValues]=useState({replace:'',replacePrice:'',quantity:'',quantityPrice:'',price:''});
  const [rates, setRates] = useState<Record<string,string>>({});
  const [from, setFrom] = useState(''), [to, setTo] = useState(account.id), [note, setNote] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), [retry, setRetry] = useState(0);
  const minimum = quickDateMin(points), frozen = busy || stuck;
  let hidden = false;
  try { hidden = localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { /* Same session fallback as existing views. */ }
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  useEffect(() => {
    let live = true; setDraft(null); setError('');
    invoke<Draft>('wealth_snapshot_draft', { date }).then(next => {
      if (!live) return;
      if (next.generation !== generation) { setError('资料库已切换，请关闭后重新打开。'); return; }
      setDraft(next);
      setHoldingValues(old=>({...old,quantityPrice:old.quantityPrice || quickFact(next,account.id)?.unit_price_e6 || ''}));
      setRates(old => ({ ...Object.fromEntries(Object.entries(rateSuggestions(next)).map(([c,s])=>[c,s.rate])), ...old }));
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [date, retry, generation]);
  const pairs = draft ? quickTransferPairs(draft) : [];
  const pairKey = pairs.map(pair => `${pair.from}:${pair.to}`).join('|');
  useEffect(() => {
    const sources = pairs.map(pair => pair.from);
    const selectedFrom = sources.includes(from) ? from : sources.includes(account.id) ? account.id : sources[0] ?? '';
    const targets = pairs.filter(pair => pair.from === selectedFrom).map(pair => pair.to);
    if (from !== selectedFrom) setFrom(selectedFrom);
    if (!targets.includes(to)) setTo(targets.includes(account.id) ? account.id : targets[0] ?? '');
  }, [pairKey, from, to, account.id]);
  const previous = draft ? quickPrevious(draft, account.id) : null;
  const selectedCode = currencyCode(draft?.rows.find(r=>r.account.id===(mode==='transfer'?from:account.id))?.account.fields.currency ?? account.fields.currency);
  const holding = draft?.rows.find(r=>r.account.id===account.id)?.account.fields.holding_mode ?? account.fields.holding_mode;
  const holdingPrevious = draft ? quickFact(draft,account.id) : null;
  const showFact = (id: string, next?: QuickUpdate['changes'][number]) => {
    const fact=next??(draft?quickFact(draft,id):null),code=currencyCode(draft?.rows.find(r=>r.account.id===id)?.account.fields.currency);
    if(fact?.amount_cents==null)return '未知'; if(hidden)return '••••';
    const position=holdingText(fact,account.fields.holding_mode?(account.fields.holding_unit??'份'):null,code);
    const result=code==='CNY'?money(fact.amount_cents):`${fact.original_minor!=null?currencyAmount(code,fact.original_minor):'原币未知'} ≈ ${money(fact.amount_cents)} · 汇率 ${fact.fx_rate_micro?rateLabel(fact.fx_rate_micro):'未知'}`;
    return position?`${position} = ${result}`:result;
  };
  let changes: QuickUpdate['changes'] = [], invalid = '';
  if (draft) {
    try { changes = holding ? [holdingQuickChange(draft,account.id,holdingMode,holdingMode==='quantity'?holdingValues.quantity:holdingValues.replace,holdingMode==='replace'?holdingValues.replacePrice:holdingMode==='quantity'?holdingValues.quantityPrice:holdingValues.price,rates[selectedCode]??'')] : quickChanges(draft, account.id, mode, values[mode], from, to, rates[selectedCode]??''); }
    catch (e) { invalid = errorMessage(e); }
  }
  async function save() {
    if (submitting.current || frozen || !draft || draft.date !== date || date < minimum || date > today || invalid) return;
    if ([...note].length > 500 || note.includes('\0')) { setNotice('备注最多 500 字，且不能含空字符。'); return; }
    const input: QuickUpdate = { request_id: crypto.randomUUID(), generation: draft.generation, date, note, changes };
    submitting.current = true; setBusy(true); setNotice('');
    try { const result = await submit<Snapshot>({ command: 'wealth_quick_update', input, label: `${account.fields.name} 快速更新` }); onClose(true, result); }
    catch (e) {
      if (e instanceof Unresolved) setStuck(true);
      if (code(e) === 'QUICK_STALE') { setNotice('金额已经变化，已重新读取原余额；你的输入已保留，请核对新的预览后再保存。'); setDraft(null); setRetry(n => n + 1); }
      else if (code(e) === 'QUICK_DATE') { setNotice('已有更新的盘点，请关闭后重新打开，选择最近盘点当天或之后的日期。'); setError('快速更新不能早于最近一次盘点。'); }
      else setNotice(e instanceof Error ? e.message : errorMessage(e));
    } finally { submitting.current = false; setBusy(false); }
  }
  async function verify() {
    const pending = storedPending();
    if (!pending || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const outcome = await resolvePending(pending);
      if (outcome === 'saved') { onClose(true); return; }
      if (outcome === 'stale') { onClose(false); return; }
      setStuck(false); setNotice('已确认没有保存。输入已保留，请核对原余额后再保存。'); setRetry(n => n + 1);
    } catch (e) { setNotice(errorMessage(e) + ' 原请求已保留，请稍后再核对。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor quick-update-editor" aria-labelledby="quick-update-heading" onCancel={event => { event.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">账户与盘点</p><h2 id="quick-update-heading">快速更新 · {account.fields.name}</h2><p className="muted">只改这次需要更新的账户，其他账户沿用已有金额；没有金额的仍保留未知。</p></div><CloseButton type="button" disabled={busy} aria-label="关闭快速更新" onClick={() => onClose(false)}/></header>
    {holding ? <div className="page-tabs quick-update-modes" role="group" aria-label="持仓更新方式">{([['replace','修改余额'],['quantity','增减持仓'],['price','更新价格']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={holdingMode===key} disabled={frozen||!draft||(key!=='replace'&&(holdingPrevious?.amount_cents==null||holdingPrevious?.quantity_e8==null))} onClick={()=>{setHoldingMode(key);setNotice('');}}>{label}</button>)}</div> : <div className="page-tabs quick-update-modes" role="group" aria-label="更新方式">{([['balance', '修改余额'], ['delta', '增减金额'], ['transfer', '转账']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} disabled={frozen || !draft || (key === 'delta' && previous === null) || (key === 'transfer' && !pairs.length)} onClick={() => { setMode(key); setNotice(''); }}>{label}</button>)}</div>}
    <section className="form-block"><FormRow label="日期" hint={`不能早于最近盘点${minimum === '1900-01-01' ? '' : ` ${minimum}`}，也不能晚于今天。`}><DateInput id="quick-update-date" value={date} min={minimum} max={today} disabled={frozen} onChange={value => { if (value) { setDate(value); setNotice(''); } }}/></FormRow>
      {error ? <div role="alert"><p>原金额读取失败：{error}</p><button type="button" disabled={frozen} onClick={() => setRetry(n => n + 1)}>重新读取</button></div> : !draft ? <p role="status">正在读取原金额…</p> : <>
        {!draft.rows.some(row => row.account.id === account.id) && <p role="status" className="muted">这个账户不在所选日期的盘点范围内。历史金额请到盘点记录更正。</p>}
        {!holding && holdingPrevious?.quantity_e8!=null && <p className="notice">从这次开始按余额记录。</p>}
        {draft.existing && <p className="notice">当天已有盘点，保存将更正这次记录，其他账户保留原记录。</p>}
        {holding ? <div className="quick-holding-fields"><p>原持仓：{showFact(account.id)}</p>{holdingPrevious?.quantity_e8==null&&<p className="notice">从这次开始按持仓记录。</p>}{holdingMode!=='price'&&<FormRow label={holdingMode==='quantity'?'份额变化':'新的份额'} hint={holdingMode==='quantity'?'增加填正数，减少填负数；结果不能小于0。':'一个账户记录一个持仓。'}><HoldingInput label={holdingMode==='quantity'?'持仓份额变化':'持仓份额'} places={8} signed={holdingMode==='quantity'} value={holdingMode==='quantity'?holdingValues.quantity:holdingValues.replace} disabled={frozen} onChange={value=>setHoldingValues(old=>({...old,[holdingMode==='quantity'?'quantity':'replace']:value}))}/></FormRow>}<FormRow label={`单价（${selectedCode}）`} hint={holdingMode==='quantity'?'默认沿用上次单价，可修改。':'手动填写单价，不联网取价。'}><HoldingInput label="持仓单价" places={6} value={holdingMode==='replace'?holdingValues.replacePrice:holdingMode==='quantity'?holdingValues.quantityPrice:holdingValues.price} disabled={frozen} onChange={value=>setHoldingValues(old=>({...old,[holdingMode==='replace'?'replacePrice':holdingMode==='quantity'?'quantityPrice':'price']:value}))}/></FormRow><p className="muted small">持仓账户请用增减持仓；不参与转账，不记录交易成本或收益。</p></div> : mode !== 'transfer' ? <><p>原{account.fields.side === 'liability' ? '欠款' : '余额'}：{showFact(account.id)}</p><FormRow label={mode === 'balance' ? account.fields.side === 'liability' ? '新的欠款' : '新的余额' : quickDeltaLabel(account.fields.side)} hint={mode === 'delta' ? '增加填正数，减少填负数。' : '填写更新后的金额，零余额明确填 0。'}>{selectedCode==='CNY'?<CentInput label={mode === 'balance' ? '新的余额或欠款' : quickDeltaLabel(account.fields.side)} value={values[mode]} signed={mode === 'delta'} disabled={frozen} onChange={value => setValues(old => ({ ...old, [mode]: value }))}/>:<CurrencyInput key={selectedCode+mode} label={mode==='balance'?`新的原币余额 ${selectedCode}`:`原币增减 ${selectedCode}`} places={currencyDecimals(selectedCode)} value={values[mode]} signed={mode==='delta'} disabled={frozen} onChange={value=>setValues(old=>({...old,[mode]:value}))}/>}</FormRow></> : <>
          <FormRow label="转出账户"><select aria-label="转出账户" value={from} disabled={frozen} onChange={event => setFrom(event.target.value)}>{draft.rows.filter(row => pairs.some(pair => pair.from === row.account.id)).map(row => <option key={row.account.id} value={row.account.id}>{row.account.fields.name}</option>)}</select></FormRow>
          <FormRow label="转入／还款账户"><select aria-label="转入或还款账户" value={to} disabled={frozen} onChange={event => setTo(event.target.value)}>{draft.rows.filter(row => pairs.some(pair => pair.from === from && pair.to === row.account.id)).map(row => <option key={row.account.id} value={row.account.id}>{row.account.fields.name}{row.account.fields.side === 'liability' ? '（还款）' : ''}</option>)}</select></FormRow>
          <FormRow label="转账金额">{selectedCode==='CNY'?<CentInput label="转账金额" value={values.transfer} disabled={frozen} onChange={value => setValues(old => ({ ...old, transfer: value }))}/>:<CurrencyInput key={selectedCode} label={`原币转账金额 ${selectedCode}`} places={currencyDecimals(selectedCode)} value={values.transfer} disabled={frozen} onChange={value=>setValues(old=>({...old,transfer:value}))}/>}</FormRow><p className="muted small">持仓账户请用增减持仓。只支持金额已知、计入范围相同的资产转出。两个账户的金额变化相互抵消，净资产不变；其他账户的计入范围变化仍按盘点比较提示。</p>
        </>}
        {selectedCode!=='CNY'&&<FormRow label={`${selectedCode} 本次汇率`} hint={draft&&rateSuggestions(draft)[selectedCode]?`${rateSuggestions(draft)[selectedCode].date}记录的汇率；手动填写，每单位原币兑换人民币。`:'请手动填写每单位原币兑换的人民币，不联网。'}><CurrencyInput label="快速更新汇率" places={6} value={rates[selectedCode]??''} disabled={frozen} onChange={value=>setRates(old=>({...old,[selectedCode]:value}))}/></FormRow>}
        {previous === null && <p className="muted small">还没有这个账户的金额，请用修改余额。</p>}
        {!holding && !pairs.length && <p className="muted small">暂时没有金额已知、计入范围相同的转账组合；不同范围请分别修改余额。</p>}
        {invalid && (holding || values[mode] !== '') && <p role="alert">{invalid}</p>}
        {changes.length > 0 && <div className="quick-update-preview" aria-live="polite">{changes.map(change => <p key={change.account_id}>{draft.rows.find(row => row.account.id === change.account_id)?.account.fields.name}：{showFact(change.account_id)} → {showFact(change.account_id,change)}</p>)}</div>}
      </>}
    </section>
    <section className="form-block form-notes"><label htmlFor="quick-update-note">备注（可选，最多 500 字）</label><textarea id="quick-update-note" maxLength={500} value={note} disabled={frozen} onChange={event => setNote(event.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
    <footer className="editor-header-actions">{stuck ? <><button type="button" disabled={busy} onClick={() => void verify()}>核对结果</button><button type="button" disabled={busy} onClick={() => onClose(false)}>关闭，稍后核对</button></> : <><button type="button" disabled={busy} onClick={() => onClose(false)}>取消</button><button className="primary" disabled={busy || !draft || !!error || !!invalid || date < minimum || date > today}>{busy ? '保存中…' : '保存快速更新'}</button></>}</footer>
  </form></dialog>;
}
