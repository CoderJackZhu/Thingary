import QuickUpdatePage from './QuickUpdate';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ReactNode } from 'react';
import { dayLabel, moneyText } from '../format';
import { currencyCode, currencyDecimals, rateHint, rateSuggestions } from '../../currency';
import { checkInRates } from '../../currency-picker.ts';
import { accountGroupTotals } from '../../wealth-display';
import { canCloseInCheckIn, changeText, checkInUnfilledTargets, nextUnfilledLabel, prefilledCount } from '../../wealth';
import type { CheckInRow, Draft } from '../../wealth';
import type { AccountGroup } from '../../account-groups';
import { useSession } from '../session';
import { useDirtyGuard, useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, ConfirmSheet, DateField, EmptyState, FormGroup, LargeTitle, MoneyField, NavBar, Notice, Sheet, TextAreaField } from '../ui';
import { enteredRow, inventoryDelta, inventoryInput, inventoryRows, inventoryTotals } from './model';
import { savedText } from './model';
import { factText, ReadState, useGroups, useRead, useWrite } from './shared';
import { t as tr } from '../../i18n.ts';
export function Inventory({draft,groups,header,onDirty}:{draft:Draft;groups:AccountGroup[];header?:ReactNode;/** Reports whether anything was entered, so the page can ask before switching the date. */onDirty?:(dirty:boolean)=>void}) {
  const nav=useNav(), s=useSession(), [edits,setRows]=useState<Record<string,CheckInRow>>({}), [notes,setNotes]=useState(draft.existing?.notes??'');
  const [rates,setRates]=useState<Record<string,string>>(()=>checkInRates(draft.rows.map(r=>currencyCode(r.account.fields.currency)),rateSuggestions(draft)));
  // An account added from this page appears on the next read without losing what was typed.
  const rows={...inventoryRows(draft),...edits};
  const writer=useWrite(()=>{s.setNotice(savedText(draft.date,s.today));setTimeout(()=>s.setNotice(''),6000);nav.pop();}),[flag,setFlag]=useState<string|null>(null), root=useRef<HTMLDivElement>(null), focused=useRef<string|null>(null);
  const [closing,setClosing]=useState<ReadonlySet<string>>(()=>new Set()), [menu,setMenu]=useState<string|null>(null);
  const dirty=Object.keys(edits).length>0||closing.size>0||notes!==(draft.existing?.notes??'');
  useDirtyGuard(dirty);
  useEffect(()=>{onDirty?.(dirty);},[dirty]);
  const totals=inventoryTotals(draft,rows,closing), delta=inventoryDelta(draft,rows,closing);
  const accounts=draft.rows.map(r=>r.account), openCount=accounts.length-closing.size, grouped=accountGroupTotals(accounts,groups,accounts.map(a=>{const saved=draft.existing?.entries.find(e=>e.account_id===a.id),row=rows[a.id];return {account_id:a.id,state:row.state??'missing',side:saved?.side??a.fields.side,kind:saved?.kind??a.fields.kind,counted:saved?.counted??a.fields.counted,amount_cents:closing.has(a.id)?'0':row.state&&row.state!=='missing'&&row.cents!==''?row.cents:null};}),false);
  function update(id:string, patch:Partial<CheckInRow>) {
    const account=accounts.find(a=>a.id===id)!, next={...rows[id],...patch}, code=currencyCode(account.fields.currency);
    setRows(old=>({...old,[id]:enteredRow(account,code==='CNY'?next.cents:next.original_minor??'',next.quantity_e8??'',next.unit_price_e6??'',rates[code]??'')}));
  }
  function changeRate(code:string,rate:string) {
    setRates(old=>({...old,[code]:rate}));
    setRows(old=>Object.fromEntries(Object.entries(old).map(([id,row])=>{
      const account=accounts.find(a=>a.id===id)!;
      return [id,currencyCode(account.fields.currency)===code && row.edited ? enteredRow(account,row.original_minor??'',row.quantity_e8??'',row.unit_price_e6??'',rate) : row];
    })));
  }
  function mark(id:string, choice:'close'|'skip'|'fill') {
    setMenu(null);
    setClosing(old=>{const next=new Set(old);if(choice==='close')next.add(id);else next.delete(id);return next;});
    setRows(old=>({...old,[id]:choice==='skip'?{state:'missing',cents:''}:{state:null,cents:''}}));
    if(choice==='fill')setTimeout(()=>root.current?.querySelector<HTMLInputElement>(`[data-check-in-field$=":${id}"] input`)?.focus(),0);
  }
  function nextUnfilled() {
    const targets=checkInUnfilledTargets(accounts.filter(a=>!closing.has(a.id)&&rows[a.id].state!=='missing').map(a=>({id:a.id,name:a.fields.name,currency:currencyCode(a.fields.currency),holding_mode:!!a.fields.holding_mode})),rates,rows);
    const controls=[...(root.current?.querySelectorAll<HTMLElement>('[data-check-in-field]')??[])];
    const key=nextUnfilledLabel(targets.map(t=>t.key),focused.current);
    const input=controls.find(c=>c.dataset.checkInField===key)?.querySelector<HTMLInputElement>('input');
    input?.focus(); input?.scrollIntoView({block:'center',behavior:'smooth'});
    return key;
  }
  /** Return on an amount field: go to the next unfilled one, or close the keyboard when everything is filled. */
  function enter() {
    if(!totals.missing){(document.activeElement as HTMLElement|null)?.blur();return;}
    nextUnfilled();
  }
  async function save() {
    try { const input=inventoryInput(draft,rows,notes,crypto.randomUUID(),closing); await writer.write({command:'wealth_snapshot_save',label:closing.size?tr('{date} 盘点并停用 {size} 个账户', { date: draft.date, size: closing.size }):tr('{date} 完整盘点', { date: draft.date }),input}); }
    catch(e){writer.setError(e instanceof Error?e.message:String(e));const key=nextUnfilled();setFlag(key?.split(':')[1]??null);}
  }
  return <><NavBar/>{header}
    {!draft.existing && prefilledCount(rows)>0 && <Notice>{tr('{n} 个账户已按上次金额预填（沿用），没变的不用动；金额变了直接改。预填的账户在历史里会标为沿用。', { n: prefilledCount(rows) })} <button type="button" className="mw-link" onClick={()=>setRows(old=>({...old,...Object.fromEntries(Object.entries(rows).filter(([,r])=>r.state==='unchanged'&&!r.edited).map(([id])=>[id,{state:null,cents:''} as CheckInRow]))}))}>{tr('清除预填')}</button></Notice>}
  <div ref={root} className="mw-inventory" onFocusCapture={e=>{focused.current=(e.target as HTMLElement).closest<HTMLElement>('[data-check-in-field]')?.dataset.checkInField??null;}}>
    {draft.existing && <Notice>{tr('正在更正 {date} 的盘点。已记录金额与历史计入范围会保留，保存后替换同一次盘点。', { date: draft.date })}</Notice>}
    <fieldset disabled={writer.frozen} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {[...new Set(accounts.map(a=>currencyCode(a.fields.currency)).filter(c=>c!=='CNY'))].map(code=><FormGroup key={code} title={tr('{code} 汇率', { code })} footer={rateHint(code, rateSuggestions(draft)[code], draft.date)}><div data-check-in-field={`rate:${code}`} className={flag===code&&!/^\d+$/.test(rates[code]??'')?'mw-check-flag':undefined}><MoneyField label={tr('{code} 本次汇率', { code })} symbol="" places={6} value={rates[code]??''} onEnter={enter} onChange={v=>changeRate(code,v)}/></div></FormGroup>)}
      {grouped.filter(g=>g.accounts.length).map(group=><FormGroup key={group.id} title={group.name} footer={tr('已填小计 {v1}{v2}', { v1: group.known ? moneyText(group.net_cents) : tr('待填写'), v2: group.partial?tr(' · 仍有未填账户'):'' })}>
        {group.accounts.map(account=>{
          const row=rows[account.id], previous=draft.rows.find(r=>r.account.id===account.id)!.previous, code=currencyCode(account.fields.currency);
          const counted=draft.existing?.entries.find(e=>e.account_id===account.id)?.counted??account.fields.counted;
          const closes=closing.has(account.id), skipped=row.state==='missing', canClose=canCloseInCheckIn(draft,account);
          if(closes||skipped) return <div className="mw-check-row mw-inputs mw-check-closed" key={account.id}>
            <div className="mw-toolbar"><span className="mw-check-title" style={closes?{textDecoration:'line-through'}:undefined}>{account.fields.name}</span><Button variant="plain" onClick={()=>mark(account.id,'fill')} ariaLabel={tr('撤销{name}的{v2}', { name: account.fields.name, v2: closes?tr('注销'):tr('跳过') })}>{tr('撤销')}</Button></div>
            <p className="mw-muted">{closes?tr('已注销，从{v1}起停用；上次 {v2}，视为已转出，不用填。', { v1: dayLabel(draft.date,s.today), v2: factText(previous,account) }):tr('这次跳过，盘点记为不完整；上次 {v1}。', { v1: factText(previous,account) })}</p>
          </div>;
          const flagged=flag===account.id&&!(row.state&&row.state!=='missing'&&row.cents!=='');
          return <div className={`mw-check-row mw-inputs${flagged?' mw-check-flag':''}`} key={account.id} data-check-in-row={account.id}>
            <div className="mw-toolbar"><span className="mw-check-title">{account.fields.name}</span><span className="mw-toolbar"><span className="mw-muted">{row.state && row.cents!==''?tr('✓ 已填'):tr('待填写')}</span><Button variant="plain" onClick={()=>setMenu(account.id)} ariaLabel={tr('{name}更多操作', { name: account.fields.name })}>{canClose?tr('注销/跳过'):tr('跳过')}</Button></span></div>
            <p className="mw-muted">{tr('上次 {v1}', { v1: factText(previous,account) })}{account.fields.side==='liability'?tr(' · 欠款'):''}{!counted?tr(' · 不进合计'):''}</p>
            {account.fields.holding_mode ? <><div data-check-in-field={`quantity:${account.id}`}><MoneyField label={tr('{name}份额', { name: account.fields.name })} symbol={account.fields.holding_unit??tr('份')} places={8} value={row.quantity_e8??''} onEnter={enter} onChange={v=>update(account.id,{quantity_e8:v})}/></div><div data-check-in-field={`price:${account.id}`}><MoneyField label={tr('{name}单价', { name: account.fields.name })} symbol={code} places={6} value={row.unit_price_e6??''} onEnter={enter} onChange={v=>update(account.id,{unit_price_e6:v})}/></div></> : <div data-check-in-field={`amount:${account.id}`}><MoneyField label={`${account.fields.name}${code==='CNY'?tr('本次金额'):tr('原币金额')}`} symbol={code==='CNY'?'¥':code} places={currencyDecimals(code)} value={code==='CNY'?row.cents:row.original_minor??''} onEnter={enter} onChange={v=>update(account.id,code==='CNY'?{cents:v}:{original_minor:v})}/></div>}
            {flagged && <p className="mw-check-flag-text" role="alert">{tr('这一项还没填。没有余额就填 0，暂时不盘点可以选「跳过」。')}</p>}
            {(account.fields.holding_mode || code!=='CNY') && <output>{tr('折合人民币')} {row.cents!==''?moneyText(row.cents):tr('待填')}</output>}
          </div>;
        })}
      </FormGroup>)}
      <Button block disabled={writer.frozen} onClick={()=>nav.push('wealth.accountEdit',{},{title:tr('新增账户')})}>{tr('+ 新增账户')}</Button>
      <FormGroup><TextAreaField label={tr('本次盘点备注')} value={notes} onChange={setNotes}/></FormGroup>
    </fieldset>
    {!accounts.length && <EmptyState icon="wallet" title={tr('这一天没有应盘账户')} message={tr('请检查账户的启用与停用日期。')} action={<Button onClick={()=>nav.push('wealth.accountEdit')}>{tr('新增账户')}</Button>}/>}
    <div className="mw-fixed"><div className="mw-fixed-inner">{writer.error && <Notice tone="danger">{writer.error}</Notice>}<div className="mw-status" role="status">{tr('已填')} {openCount-totals.missing} / {openCount}{closing.size?tr('（另有 {size} 个注销）', { size: closing.size }):''} · {totals.missing?tr('已填账户合计'):tr('本次合计')}<br/><strong>{openCount===totals.missing?(closing.size&&!openCount?'¥0':tr('待填写')):moneyText(totals.net)}</strong><span className="mw-muted"> · {draft.existing?tr('较更正前'):tr('较上次这些账户')} {delta===null?tr('未知'):changeText(delta)}</span></div><div className="mw-toolbar"><Button disabled={writer.frozen || !totals.missing} onClick={nextUnfilled}>{tr('下一处未填')}</Button><Button variant="primary" disabled={writer.frozen || !accounts.length} onClick={()=>void save()}>{tr('保存本次盘点')}</Button></div></div></div>
    {menu && (()=>{const account=accounts.find(a=>a.id===menu)!, previous=draft.rows.find(r=>r.account.id===menu)!.previous;
      return <Sheet title={account.fields.name} onClose={()=>setMenu(null)} cancelLabel={tr('取消')}>
        <p className="mw-muted">{tr('上次盘点 {v1}', { v1: factText(previous,account) })}{previous?`（${dayLabel(previous.date,s.today)}）`:''}</p>
        <div className="mw-sheet-choices">
          <Button block onClick={()=>mark(menu,'fill')}>{tr('填写本次余额')}</Button>
          {canCloseInCheckIn(draft,account) && <Button block onClick={()=>mark(menu,'close')}>{tr('已注销，从这次起停用')}</Button>}
          <Button block variant="plain" onClick={()=>mark(menu,'skip')}>{tr('这次跳过（盘点记为不完整）')}</Button>
        </div></Sheet>;})()}
    {s.pending && <Notice>{tr('保存结果未确定，请先核对原请求。')}</Notice>}
  </div></>;
}
export function FullCheckIn({params}:PageProps) {
  const s=useSession(), [date,setDate]=useState(String(params.date??s.today)), [change,setChange]=useState(''), groups=useGroups(), entered=useRef(false);
  const generation=s.data?.summary.generation??'', pin=String(params.id??'');
  const read=useRead(`inventory:${generation}:${date}`,async()=>{const draft=await invoke<Draft>('wealth_snapshot_draft',{date});if(draft.generation!==generation || draft.date!==date || (pin && draft.existing?.id!==pin))throw Error(tr('这条盘点或资料库已变化，请返回后重新读取。'));return draft;});
  const header=<>
    <LargeTitle title={tr('{v1}{v2}盘点', { v1: pin?tr('更正'):'', v2: dayLabel(date, s.today) })} subtitle={tr('对照各平台填写当前金额，零余额填 0。新盘点已按上次金额预填，没变的不用动。')}/>
    {!pin && <DateField label={tr('盘点日期')} value={date} max={s.today} disabled={s.navBlocked} onChange={v=>{if(v===date)return;if(entered.current)setChange(v);else setDate(v);}}/>}
    {change && <ConfirmSheet title={tr('切换日期？')} message={tr('切换到 {v1} 会放弃已经填写的内容。', { v1: dayLabel(change,s.today) })} confirm={tr('切换并放弃输入')} cancelLabel={tr('继续编辑')} danger busy={false} onClose={()=>setChange('')} onConfirm={()=>{entered.current=false;setDate(change);setChange('');}}/>}
  </>;
  const ready=!!read.value && !!groups.value && !read.error && !s.error;
  return <div className="m-page m-wealth mw-checkin">
    {ready ? <Inventory key={`${generation}:${date}:${read.value!.existing?.revision??0}`} draft={read.value!} groups={groups.value!} header={header} onDirty={d=>{entered.current=d;}}/> : <>
      <NavBar/>{header}
      <ReadState error={read.error||groups.error||s.error} loading={!read.value||!groups.value} reload={()=>{read.reload();groups.reload();s.reload();}}/>
    </>}
  </div>;
}

export default function CheckIn(props:PageProps) {
  return props.params.accountId ? <QuickUpdatePage params={{id:props.params.accountId}}/> : <FullCheckIn {...props}/>;
}
