import { useRef, useState } from 'react';
import { accountKindHint, assetKinds, liabilityKinds, selectAccountKind } from '../../wealth';
import type { Account, AccountFields } from '../../wealth';
import { currencies, currencyCode, validCurrency } from '../../currency';
import { holdingSupported } from '../../holdings';
import { groupNameError } from '../../account-groups';
import type { AccountGroup } from '../../account-groups';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, FormGroup, FormRow, MoneyField, NavBar, Notice, SelectField, Switch, TextAreaField, TextField } from '../ui';
import { ReadState, useGroups, useWrite, WealthGate } from './shared';

export function Editor({ account, groups, reloadGroups }: { account: Account | null; groups: AccountGroup[]; reloadGroups: () => void }) {
  const nav = useNav(), s = useSession(), generation = s.data!.summary.generation;
  const [fields,setFields] = useState<AccountFields>(account?.fields ?? {name:'',institution:'',side:'asset',kind:'cash',counted:true,opened_on:s.today,closed_on:null,notes:''});
  const choice = useRef<boolean | null>(account?.fields.counted ?? null);
  const writer = useWrite(()=>nav.pop()), [newGroup,setNewGroup] = useState(false), [groupName,setGroupName] = useState('');
  
  // Group creation is a separate reversible write. Preserve the account form across receipt recovery.
  const groupWriter = useWrite(()=>{ setNewGroup(false); reloadGroups(); });
  const set = <K extends keyof AccountFields>(key: K, value: AccountFields[K]) => setFields(old=>({...old,[key]:value}));
  function chooseKind(kind: string) {
    if (!['property','vehicle'].includes(kind) && (fields.purchase_cents != null || fields.purchased_on || account?.fields.purchase_cents != null || account?.fields.purchased_on)) { writer.setError('请先清空并保存购入价和购入日期，再更改类型。'); return; }
    setFields(old=>({...selectAccountKind(old,kind,choice.current),...(!holdingSupported(kind)?{holding_mode:false,holding_unit:null}:{})}));
  }
  async function save() {
    if (!fields.name.trim()) { writer.setError('请填写账户名称。'); return; }
    if (!validCurrency(currencyCode(fields.currency))) { writer.setError('币种须为三位大写字母。'); return; }
    const normalized = {...fields,...(fields.group_id&&!groups.some(g=>g.id===fields.group_id)?{group_id:null}:{}),name:fields.name.trim(),institution:fields.institution.trim()};
    if (normalized.currency === 'CNY') delete normalized.currency;
    if (!normalized.holding_mode) { delete normalized.holding_mode; delete normalized.holding_unit; }
    if (normalized.holding_unit == null) delete normalized.holding_unit;
    await writer.write({command:'wealth_account_save',label:`账户 ${normalized.name}`,input:{request_id:crypto.randomUUID(),generation,id:account?.id ?? null,expected_revision:account?.revision ?? null,fields:normalized}});
  }
  const frozen = writer.frozen || groupWriter.frozen;
  return <div className="m-page m-wealth"><NavBar title={account?'编辑账户':'新增账户'} primary={{label:'保存',onClick:()=>void save(),disabled:frozen}}/>
    <p className="mw-muted">只记名称与类型，不需要卡号、密码或登录信息。</p>
    {(writer.error || groupWriter.error) && <div className="mw-editor-alert"><Notice tone="danger">{writer.error || groupWriter.error}</Notice></div>}
    <fieldset disabled={frozen} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <FormGroup title="账户资料">
        <TextField label="名称" value={fields.name} maxLength={80} onChange={v=>set('name',v)}/>
        <TextField label="平台" value={fields.institution} maxLength={80} hint="银行、券商等机构，可留空。" onChange={v=>set('institution',v)}/>
        <SelectField label="资产或负债" value={fields.side} disabled={!!account} onChange={side=>chooseKind(side==='asset'?'cash':'credit_card')} options={[{id:'asset',label:'资产'},{id:'liability',label:'负债'}]} hint={account?'建立后不能更改。':'负债盘点时填写欠款金额。'}/>
        <SelectField label="类型" value={fields.kind} onChange={chooseKind} options={(fields.side==='asset'?assetKinds:liabilityKinds).map(([id,label])=>({id,label}))}/>
        <TextField label="币种" value={currencyCode(fields.currency)} maxLength={3} disabled={!!account?.has_entries} hint={account?.has_entries?'已有记录，币种不能更改。':'三位大写代码；汇率手填，不联网。'} onChange={v=>set('currency',v.toUpperCase())}/>
        <p className="mw-muted">常用：{currencies.map(([code])=>code).join('、')}</p>
        <SelectField label="分组" value={fields.group_id ?? ''} onChange={v=>v==='__new__'?setNewGroup(true):v==='__manage__'?nav.push('wealth.groups'):set('group_id',v||null)} options={[{id:'',label:'未分组'},...groups.filter((g,i,a)=>a.findIndex(x=>x.id===g.id)===i).map(g=>({id:g.id,label:g.name})),{id:'__new__',label:'新建分组…'},{id:'__manage__',label:'管理分组…'}]}/>
        <DateField label="启用日期" value={fields.opened_on} max={s.today} onChange={v=>set('opened_on',v)}/>
        {account && <DateField label="停用日期" value={fields.closed_on??''} max={s.today} allowClear hint="停用后不再出现在之后的盘点里；有盘点记录的账户只能停用，不能删除。" onChange={v=>set('closed_on',v||null)}/>}
        <FormRow label="计入金融净资产"><Switch label="计入金融净资产" checked={fields.counted} disabled={fields.kind==='property'} onChange={v=>{choice.current=v;set('counted',v);}}/></FormRow>
        {holdingSupported(fields.kind) && <><FormRow label="按持仓记录" hint="一个账户一个持仓，金额由份额与手填单价计算。"><Switch label="按持仓记录" checked={!!fields.holding_mode} onChange={v=>setFields(f=>({...f,holding_mode:v,...(!v?{holding_unit:null}:{})}))}/></FormRow>{fields.holding_mode && <TextField label="持仓单位" value={fields.holding_unit??''} maxLength={8} hint="可留空，默认显示份。" onChange={v=>set('holding_unit',v||null)}/>}</>}
      </FormGroup>
      {accountKindHint(fields.kind) && <Notice>{accountKindHint(fields.kind)}</Notice>}
      {['property','vehicle'].includes(fields.kind) && <FormGroup title="购入信息（可选）" footer="只用于显示估值涨跌，不参与净资产或规划。"><MoneyField label="购入价" value={fields.purchase_cents??''} onChange={v=>set('purchase_cents',v||null)}/><DateField label="购入日期" value={fields.purchased_on??''} max={s.today} allowClear onChange={v=>set('purchased_on',v||null)}/></FormGroup>}
      <FormGroup><TextAreaField label="备注" value={fields.notes} onChange={v=>set('notes',v)}/></FormGroup>
    </fieldset>
    {newGroup && <FormGroup title="新建分组"><TextField label="分组名称" value={groupName} maxLength={40} onChange={setGroupName}/><Button disabled={frozen} onClick={()=>{const error=groupNameError(groupName); if(error){groupWriter.setError(error);return;} void groupWriter.write({command:'account_group_save',label:'新增账户分组',input:{request_id:crypto.randomUUID(),generation,id:null,expected_revision:null,name:groupName.trim()}});}}>创建分组</Button><Button disabled={frozen} onClick={()=>setNewGroup(false)}>取消</Button><p className="mw-muted">创建后重新打开分组选择即可使用。</p></FormGroup>}
  </div>;
}
export default function AccountEdit({params}:PageProps) {
  const s = useSession(), groups = useGroups(), id = String(params.id??'');
  const account = s.data?.accounts.find(a=>a.id===id) ?? null;
  return <WealthGate><ReadState error={groups.error} reload={groups.reload} loading={!groups.value && !groups.error}/>{id && !account ? <div className="m-page"><NavBar title="编辑账户"/><Notice>账户已删除或变化，请返回后重新读取。</Notice></div> : groups.value && s.data && <Editor key={`${s.data.summary.generation}:${id}`} account={account} groups={groups.value} reloadGroups={groups.reload}/>}</WealthGate>;
}
