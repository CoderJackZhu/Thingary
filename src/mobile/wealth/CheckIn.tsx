import QuickUpdatePage from './QuickUpdate';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ReactNode } from 'react';
import { dayLabel, moneyText } from '../format';
import { currencyCode, currencyDecimals, rateSuggestions } from '../../currency';
import { accountGroupTotals } from '../../wealth-display';
import { canCloseInCheckIn, changeText, checkInUnfilledTargets, nextUnfilledLabel } from '../../wealth';
import type { CheckInRow, Draft } from '../../wealth';
import type { AccountGroup } from '../../account-groups';
import { useSession } from '../session';
import { useDirtyGuard, useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, ConfirmSheet, DateField, EmptyState, FormGroup, LargeTitle, MoneyField, NavBar, Notice, Sheet, TextAreaField } from '../ui';
import { enteredRow, inventoryDelta, inventoryInput, inventoryRows, inventoryTotals } from './model';
import { savedText } from './model';
import { factText, ReadState, useGroups, useRead, useWrite } from './shared';

export function Inventory({draft,groups,header,onDirty}:{draft:Draft;groups:AccountGroup[];header?:ReactNode;/** Reports whether anything was entered, so the page can ask before switching the date. */onDirty?:(dirty:boolean)=>void}) {
  const nav=useNav(), s=useSession(), [edits,setRows]=useState<Record<string,CheckInRow>>({}), [notes,setNotes]=useState(draft.existing?.notes??'');
  const [rates,setRates]=useState<Record<string,string>>(()=>Object.fromEntries(Object.entries(rateSuggestions(draft)).map(([c,v])=>[c,v.rate])));
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
    try { const input=inventoryInput(draft,rows,notes,crypto.randomUUID(),closing); await writer.write({command:'wealth_snapshot_save',label:closing.size?`${draft.date} 盘点并停用 ${closing.size} 个账户`:`${draft.date} 完整盘点`,input}); }
    catch(e){writer.setError(e instanceof Error?e.message:String(e));const key=nextUnfilled();setFlag(key?.split(':')[1]??null);}
  }
  return <><NavBar/>{header}
  <div ref={root} className="mw-inventory" onFocusCapture={e=>{focused.current=(e.target as HTMLElement).closest<HTMLElement>('[data-check-in-field]')?.dataset.checkInField??null;}}>
    {draft.existing && <Notice>正在更正 {draft.date} 的盘点。已记录金额与历史计入范围会保留，保存后替换同一次盘点。</Notice>}
    <fieldset disabled={writer.frozen} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {[...new Set(accounts.map(a=>currencyCode(a.fields.currency)).filter(c=>c!=='CNY'))].map(code=><FormGroup key={code} title={`${code} 汇率`} footer={rateSuggestions(draft)[code]?`${rateSuggestions(draft)[code].date} 记录的参考汇率，请核对。`:'每单位原币兑换人民币，手动填写。'}><div data-check-in-field={`rate:${code}`} className={flag===code&&!/^\d+$/.test(rates[code]??'')?'mw-check-flag':undefined}><MoneyField label={`${code} 本次汇率`} symbol="" places={6} value={rates[code]??''} onEnter={enter} onChange={v=>changeRate(code,v)}/></div></FormGroup>)}
      {grouped.filter(g=>g.accounts.length).map(group=><FormGroup key={group.id} title={group.name} footer={`已填小计 ${group.known ? moneyText(group.net_cents) : '待填写'}${group.partial?' · 仍有未填账户':''}`}>
        {group.accounts.map(account=>{
          const row=rows[account.id], previous=draft.rows.find(r=>r.account.id===account.id)!.previous, code=currencyCode(account.fields.currency);
          const counted=draft.existing?.entries.find(e=>e.account_id===account.id)?.counted??account.fields.counted;
          const closes=closing.has(account.id), skipped=row.state==='missing', canClose=canCloseInCheckIn(draft,account);
          if(closes||skipped) return <div className="mw-check-row mw-inputs mw-check-closed" key={account.id}>
            <div className="mw-toolbar"><span className="mw-check-title" style={closes?{textDecoration:'line-through'}:undefined}>{account.fields.name}</span><Button variant="plain" onClick={()=>mark(account.id,'fill')} ariaLabel={`撤销${account.fields.name}的${closes?'注销':'跳过'}`}>撤销</Button></div>
            <p className="mw-muted">{closes?`已注销，从${dayLabel(draft.date,s.today)}起停用；上次 ${factText(previous,account)}，视为已转出，不用填。`:`这次跳过，盘点记为不完整；上次 ${factText(previous,account)}。`}</p>
          </div>;
          const flagged=flag===account.id&&!(row.state&&row.state!=='missing'&&row.cents!=='');
          return <div className={`mw-check-row mw-inputs${flagged?' mw-check-flag':''}`} key={account.id} data-check-in-row={account.id}>
            <div className="mw-toolbar"><span className="mw-check-title">{account.fields.name}</span><span className="mw-toolbar"><span className="mw-muted">{row.state && row.cents!==''?'✓ 已填':'待填写'}</span><Button variant="plain" onClick={()=>setMenu(account.id)} ariaLabel={`${account.fields.name}更多操作`}>{canClose?'注销/跳过':'跳过'}</Button></span></div>
            <p className="mw-muted">上次 {factText(previous,account)}{account.fields.side==='liability'?' · 欠款':''}{!counted?' · 不进合计':''}</p>
            {account.fields.holding_mode ? <><div data-check-in-field={`quantity:${account.id}`}><MoneyField label={`${account.fields.name}份额`} symbol={account.fields.holding_unit??'份'} places={8} value={row.quantity_e8??''} onEnter={enter} onChange={v=>update(account.id,{quantity_e8:v})}/></div><div data-check-in-field={`price:${account.id}`}><MoneyField label={`${account.fields.name}单价`} symbol={code} places={6} value={row.unit_price_e6??''} onEnter={enter} onChange={v=>update(account.id,{unit_price_e6:v})}/></div></> : <div data-check-in-field={`amount:${account.id}`}><MoneyField label={`${account.fields.name}${code==='CNY'?'本次金额':'原币金额'}`} symbol={code==='CNY'?'¥':code} places={currencyDecimals(code)} value={code==='CNY'?row.cents:row.original_minor??''} onEnter={enter} onChange={v=>update(account.id,code==='CNY'?{cents:v}:{original_minor:v})}/></div>}
            {flagged && <p className="mw-check-flag-text" role="alert">这一项还没填。没有余额就填 0，暂时不盘点可以选「跳过」。</p>}
            {(account.fields.holding_mode || code!=='CNY') && <output>折合人民币 {row.cents!==''?moneyText(row.cents):'待填'}</output>}
          </div>;
        })}
      </FormGroup>)}
      <Button block disabled={writer.frozen} onClick={()=>nav.push('wealth.accountEdit',{},{title:'新增账户'})}>+ 新增账户</Button>
      <FormGroup><TextAreaField label="本次盘点备注" value={notes} onChange={setNotes}/></FormGroup>
    </fieldset>
    {!accounts.length && <EmptyState icon="wallet" title="这一天没有应盘账户" message="请检查账户的启用与停用日期。" action={<Button onClick={()=>nav.push('wealth.accountEdit')}>新增账户</Button>}/>}
    <div className="mw-fixed"><div className="mw-fixed-inner">{writer.error && <Notice tone="danger">{writer.error}</Notice>}<div className="mw-status" role="status">已填 {openCount-totals.missing} / {openCount}{closing.size?`（另有 ${closing.size} 个注销）`:''} · {totals.missing?'已填账户合计':'本次合计'}<br/><strong>{openCount===totals.missing?(closing.size&&!openCount?'¥0':'待填写'):moneyText(totals.net)}</strong><span className="mw-muted"> · {draft.existing?'较更正前':'较上次这些账户'} {delta===null?'未知':changeText(delta)}</span></div><div className="mw-toolbar"><Button disabled={writer.frozen || !totals.missing} onClick={nextUnfilled}>下一处未填</Button><Button variant="primary" disabled={writer.frozen || !accounts.length} onClick={()=>void save()}>保存本次盘点</Button></div></div></div>
    {menu && (()=>{const account=accounts.find(a=>a.id===menu)!, previous=draft.rows.find(r=>r.account.id===menu)!.previous;
      return <Sheet title={account.fields.name} onClose={()=>setMenu(null)} cancelLabel="取消">
        <p className="mw-muted">上次盘点 {factText(previous,account)}{previous?`（${dayLabel(previous.date,s.today)}）`:''}</p>
        <div className="mw-sheet-choices">
          <Button block onClick={()=>mark(menu,'fill')}>填写本次余额</Button>
          {canCloseInCheckIn(draft,account) && <Button block onClick={()=>mark(menu,'close')}>已注销，从这次起停用</Button>}
          <Button block variant="plain" onClick={()=>mark(menu,'skip')}>这次跳过（盘点记为不完整）</Button>
        </div></Sheet>;})()}
    {s.pending && <Notice>保存结果未确定，请先核对原请求。</Notice>}
  </div></>;
}
export function FullCheckIn({params}:PageProps) {
  const s=useSession(), [date,setDate]=useState(String(params.date??s.today)), [change,setChange]=useState(''), groups=useGroups(), entered=useRef(false);
  const generation=s.data?.summary.generation??'', pin=String(params.id??'');
  const read=useRead(`inventory:${generation}:${date}`,async()=>{const draft=await invoke<Draft>('wealth_snapshot_draft',{date});if(draft.generation!==generation || draft.date!==date || (pin && draft.existing?.id!==pin))throw Error('这条盘点或资料库已变化，请返回后重新读取。');return draft;});
  const header=<>
    <LargeTitle title={`${pin?'更正':''}${dayLabel(date, s.today)}盘点`} subtitle="对照各平台填写当前金额，零余额填 0。上次金额只作参考。"/>
    {!pin && <DateField label="盘点日期" value={date} max={s.today} disabled={s.navBlocked} onChange={v=>{if(v===date)return;if(entered.current)setChange(v);else setDate(v);}}/>}
    {change && <ConfirmSheet title="切换日期？" message={`切换到 ${dayLabel(change,s.today)} 会放弃已经填写的内容。`} confirm="切换并放弃输入" cancelLabel="继续编辑" danger busy={false} onClose={()=>setChange('')} onConfirm={()=>{entered.current=false;setDate(change);setChange('');}}/>}
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
