import QuickUpdatePage from './QuickUpdate';
import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from '../../asset';
import { currencyCode, currencyDecimals, rateSuggestions } from '../../currency';
import { accountGroupTotals } from '../../wealth-display';
import { changeText, checkInUnfilledTargets, nextUnfilledLabel } from '../../wealth';
import type { CheckInRow, Draft } from '../../wealth';
import type { AccountGroup } from '../../account-groups';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, Card, DateField, EmptyState, FormGroup, LargeTitle, MoneyField, NavBar, Notice, TextAreaField } from '../ui';
import { enteredRow, inventoryDelta, inventoryInput, inventoryRows, inventoryTotals } from './model';
import { factText, ReadState, useGroups, useRead, useWrite } from './shared';

export function Inventory({draft,groups}:{draft:Draft;groups:AccountGroup[]}) {
  const nav=useNav(), s=useSession(), [rows,setRows]=useState(()=>inventoryRows(draft)), [notes,setNotes]=useState(draft.existing?.notes??'');
  const [rates,setRates]=useState<Record<string,string>>(()=>Object.fromEntries(Object.entries(rateSuggestions(draft)).map(([c,v])=>[c,v.rate])));
  const writer=useWrite(()=>nav.pop()), root=useRef<HTMLDivElement>(null), focused=useRef<string|null>(null);
  const totals=inventoryTotals(draft,rows), delta=inventoryDelta(draft,rows);
  const accounts=draft.rows.map(r=>r.account), grouped=accountGroupTotals(accounts,groups,accounts.map(a=>{const saved=draft.existing?.entries.find(e=>e.account_id===a.id),row=rows[a.id];return {account_id:a.id,state:row.state??'missing',side:saved?.side??a.fields.side,kind:saved?.kind??a.fields.kind,counted:saved?.counted??a.fields.counted,amount_cents:row.state&&row.cents!==''?row.cents:null};}),false);
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
  function nextUnfilled() {
    const targets=checkInUnfilledTargets(accounts.map(a=>({id:a.id,name:a.fields.name,currency:currencyCode(a.fields.currency),holding_mode:!!a.fields.holding_mode})),rates,rows);
    const controls=[...(root.current?.querySelectorAll<HTMLElement>('[data-check-in-field]')??[])];
    const key=nextUnfilledLabel(targets.map(t=>t.key),focused.current);
    const input=controls.find(c=>c.dataset.checkInField===key)?.querySelector<HTMLInputElement>('input');
    input?.focus(); input?.scrollIntoView({block:'center',behavior:'smooth'});
  }
  async function save() {
    try { const input=inventoryInput(draft,rows,notes,crypto.randomUUID()); await writer.write({command:'wealth_snapshot_save',label:`${draft.date} 完整盘点`,input}); }
    catch(e){writer.setError(e instanceof Error?e.message:String(e));nextUnfilled();}
  }
  return <div ref={root} className="mw-inventory" onFocusCapture={e=>{focused.current=(e.target as HTMLElement).closest<HTMLElement>('[data-check-in-field]')?.dataset.checkInField??null;}}>
    {draft.existing && <Notice>正在更正 {draft.date} 的盘点。已记录金额与历史计入范围会保留，保存后替换同一次盘点。</Notice>}
    <fieldset disabled={writer.frozen} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {[...new Set(accounts.map(a=>currencyCode(a.fields.currency)).filter(c=>c!=='CNY'))].map(code=><FormGroup key={code} title={`${code} 汇率`} footer={rateSuggestions(draft)[code]?`${rateSuggestions(draft)[code].date} 记录的参考汇率，请核对。`:'每单位原币兑换人民币，手动填写。'}><div data-check-in-field={`rate:${code}`}><MoneyField label={`${code} 本次汇率`} symbol="" places={6} value={rates[code]??''} onChange={v=>changeRate(code,v)}/></div></FormGroup>)}
      {grouped.filter(g=>g.accounts.length).map(group=><FormGroup key={group.id} title={group.name} footer={`已填小计 ${group.known ? money(group.net_cents) : '待填写'}${group.partial?' · 仍有未填账户':''}`}>
        {group.accounts.map(account=>{
          const row=rows[account.id], previous=draft.rows.find(r=>r.account.id===account.id)!.previous, code=currencyCode(account.fields.currency);
          const counted=draft.existing?.entries.find(e=>e.account_id===account.id)?.counted??account.fields.counted;
          return <div className="mw-check-row mw-inputs" key={account.id}>
            <div className="mw-toolbar"><span className="mw-check-title">{account.fields.name}</span><span className="mw-muted">{row.state && row.cents!==''?'✓ 已填':'待填写'}</span></div>
            <p className="mw-muted">上次 {factText(previous,account)}{account.fields.side==='liability'?' · 欠款':''}{!counted?' · 不进合计':''}</p>
            {account.fields.holding_mode ? <><div data-check-in-field={`quantity:${account.id}`}><MoneyField label={`${account.fields.name}份额`} symbol={account.fields.holding_unit??'份'} places={8} value={row.quantity_e8??''} onChange={v=>update(account.id,{quantity_e8:v})}/></div><div data-check-in-field={`price:${account.id}`}><MoneyField label={`${account.fields.name}单价`} symbol={code} places={6} value={row.unit_price_e6??''} onChange={v=>update(account.id,{unit_price_e6:v})}/></div></> : <div data-check-in-field={`amount:${account.id}`}><MoneyField label={`${account.fields.name}${code==='CNY'?'本次金额':'原币金额'}`} symbol={code==='CNY'?'¥':code} places={currencyDecimals(code)} value={code==='CNY'?row.cents:row.original_minor??''} onChange={v=>update(account.id,code==='CNY'?{cents:v}:{original_minor:v})}/></div>}
            {(account.fields.holding_mode || code!=='CNY') && <output>折合人民币 {row.cents!==''?money(row.cents):'待填'}</output>}
          </div>;
        })}
      </FormGroup>)}
      <FormGroup><TextAreaField label="本次盘点备注" value={notes} onChange={setNotes}/></FormGroup>
    </fieldset>
    {!accounts.length && <EmptyState title="这一天没有应盘账户" message="请检查账户的启用与停用日期。" action={<Button onClick={()=>nav.push('wealth.accountEdit')}>新增账户</Button>}/>}
    <div className="mw-fixed"><div className="mw-fixed-inner">{writer.error && <Notice tone="danger">{writer.error}</Notice>}<div className="mw-status" role="status">已填 {accounts.length-totals.missing} / {accounts.length} · {totals.missing?'已填账户合计':'本次合计'}<br/><strong>{accounts.length===totals.missing?'待填写':money(totals.net)}</strong><span className="mw-muted"> · {draft.existing?'较更正前':'较上次这些账户'} {delta===null?'未知':changeText(delta)}</span></div><div className="mw-toolbar"><Button disabled={writer.frozen || !totals.missing} onClick={nextUnfilled}>下一处未填</Button><Button variant="primary" disabled={writer.frozen || !accounts.length} onClick={()=>void save()}>保存本次盘点</Button></div></div></div>
    {s.pending && <Notice>保存结果未确定，请先核对原请求。</Notice>}
  </div>;
}
export function FullCheckIn({params}:PageProps) {
  const s=useSession(), [date,setDate]=useState(String(params.date??s.today)), [change,setChange]=useState(''), groups=useGroups();
  const generation=s.data?.summary.generation??'', pin=String(params.id??'');
  const read=useRead(`inventory:${generation}:${date}`,async()=>{const draft=await invoke<Draft>('wealth_snapshot_draft',{date});if(draft.generation!==generation || draft.date!==date || (pin && draft.existing?.id!==pin))throw Error('这条盘点或资料库已变化，请返回后重新读取。');return draft;});
  return <div className="m-page m-wealth mw-checkin"><NavBar title={pin?'更正盘点':'完整盘点'}/><LargeTitle title={`${date.slice(5)} 盘点`} subtitle="对照各平台填写当前金额，零余额填 0。上次金额只作参考。"/>
    {!pin && <DateField label="盘点日期" value={date} max={s.today} disabled={s.navBlocked} onChange={v=>{if(v!==date)setChange(v);}}/>}
    {change && <Card><p>切换日期会放弃当前输入。</p><Button onClick={()=>setChange('')}>保留输入</Button><Button onClick={()=>{setDate(change);setChange('');}}>确认切换日期</Button></Card>}
    <ReadState error={read.error||groups.error||s.error} loading={!read.value||!groups.value} reload={()=>{read.reload();groups.reload();s.reload();}}/>
    {read.value && groups.value && !read.error && !s.error && <Inventory key={`${generation}:${date}:${read.value.existing?.revision??0}`} draft={read.value} groups={groups.value}/>}
  </div>;
}

export default function CheckIn(props:PageProps) {
  return props.params.accountId ? <QuickUpdatePage params={{id:props.params.accountId}}/> : <FullCheckIn {...props}/>;
}
