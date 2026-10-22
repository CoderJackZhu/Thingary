import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VirtualAsset, VirtualOverview } from '../../virtual';
import { billingModes, virtualKinds } from '../../virtual';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { DateField, FormGroup, FormRow, MoneyField, Notice, SegmentedControl, SelectField, Switch, TextAreaField, TextField } from '../ui';
import { autoCredit, canSwitchBilling, isComplexPlan, isLegacyLink, validateVirtual, virtualDraft, virtualSave } from './forms';
import type { VirtualDraft } from './forms';
import { PlanFields } from './PlanFields';
import { EditorFrame, Loaded } from './parts';
import { useRead, useSaver } from './read';

type Label = { id: string; name: string; enabled: boolean };

/** spending.virtualEdit: add or edit a virtual asset (subscription, one-time purchase or stored value). */
export default function VirtualEdit({ params }: PageProps) {
  const id = typeof params.id === 'string' ? params.id : null;
  const read = useRead(async () => {
    const [overview, labels] = await Promise.all([invoke<VirtualOverview>('virtual_overview'), invoke<{ items: Label[] }>('choice_list', { kind: 'label' }).then(r => r.items).catch(() => [] as Label[])]);
    const item = id ? overview.items.find(v => v.id === id) ?? null : null;
    if (id && !item) throw new Error('这项虚拟资产已不存在，可能已被删除。');
    return { generation: overview.generation, item, labels };
  }, id ?? 'new');
  return <Loaded nav read={read} what="虚拟资产">{data => <Form generation={data.generation} item={data.item} labels={data.labels}/>}</Loaded>;
}

function Form({ generation, item, labels }: { generation: string; item: VirtualAsset | null; labels: Label[] }) {
  const { today } = useSession(), saver = useSaver();
  const [d, setD] = useState<VirtualDraft>(() => virtualDraft(item, today)), [problem, setProblem] = useState('');
  const f = d.fields, mode = f.billing, locked = isLegacyLink(item) || isComplexPlan(item);
  const setF = (patch: Partial<VirtualDraft['fields']>) => { setProblem(''); setD(x => ({ ...x, fields: { ...x.fields, ...patch } })); };
  const setTopup = (patch: Partial<VirtualDraft['firstTopup']>) => { setProblem(''); setD(x => ({ ...x, firstTopup: { ...x.firstTopup, ...patch } })); };
  const labelOptions = [{ id: '', label: '未设置' }, ...labels.filter(l => l.enabled || l.id === f.label_id).map(l => ({ id: l.id, label: l.name }))];
  const credit = autoCredit(d.firstTopup);
  function switchBilling(next: string) {
    const check = canSwitchBilling(item, next);
    if (!check.ok) { setProblem(check.message); return; }
    setF({ billing: next as typeof f.billing });
  }
  function save() {
    const check = validateVirtual(item, d, today);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'virtual_save', input: virtualSave(item, d, generation, today, requestId), label: `虚拟资产 ${f.name.trim()}` }), { close: true });
  }
  const off = saver.busy;
  return <EditorFrame title={item ? '编辑虚拟资产' : '新增虚拟资产'} onSave={save} busy={saver.busy} error={problem || saver.error}>
    <FormGroup>
      <TextField label="名称" value={f.name} onChange={name => setF({ name })} placeholder="例如：Notion、域名、咖啡储值卡" maxLength={80} disabled={off}/>
      <div className="m-form-row m-stacked"><SegmentedControl label="计费方式" value={mode} items={billingModes.map(([id, label]) => ({ id, label }))} onChange={switchBilling}/></div>
      <SelectField label="类型" value={f.kind} onChange={kind => setF({ kind: kind as typeof f.kind })} options={virtualKinds.map(([id, label]) => ({ id, label }))} disabled={off}/>
      <SelectField label="标签" value={f.label_id ?? ''} onChange={v => setF({ label_id: v || null })} options={labelOptions} disabled={off} hint="与实物标签同一套；新建标签请在电脑上操作"/>
      <TextField label="服务商" value={f.provider} onChange={provider => setF({ provider })} disabled={off}/>
    </FormGroup>
    {mode === 'subscription' && (locked
      ? <Notice>{isLegacyLink(item) ? '这是旧版关联的订阅，没有服务开始日期；手机上只能改档案信息，请在电脑上补充开始日期。' : '这个订阅用了固定天数、试用、暂停或分段价格等高级设置，手机上只能改档案信息；付款设置请在电脑上修改。'}</Notice>
      : <PlanFields value={d.plan.rent} onChange={rent => setD(x => ({ ...x, plan: { ...x.plan, rent } }))} today={today} rent={false} disabled={off}/>)}
    {mode === 'single' && <FormGroup footer="永久有效时不要填有效至；不再使用了就填结束使用日期。">
      <MoneyField label="购买价格" value={f.price_cents ?? ''} onChange={v => setF({ price_cents: v || null })} hint="不确定就留空，显示为价格未知" disabled={off}/>
      <DateField label="购买日期" value={f.purchase_date ?? ''} onChange={v => setF({ purchase_date: v || null })} allowClear disabled={off}/>
      <FormRow label="永久有效"><Switch label="永久有效" checked={d.perpetual} onChange={perpetual => { setProblem(''); setD(x => ({ ...x, perpetual, fields: perpetual ? { ...x.fields, expires: null } : x.fields })); }} disabled={off}/></FormRow>
      {!d.perpetual && <DateField label="有效至" value={f.expires ?? ''} onChange={v => setF({ expires: v || null })} allowClear disabled={off}/>}
    </FormGroup>}
    {mode === 'topup' && <FormGroup footer="没有到期日就留空。余额在详情里单独记录。">
      <DateField label="额度到期日" value={f.expires ?? ''} onChange={v => setF({ expires: v || null })} allowClear disabled={off}/>
    </FormGroup>}
    {mode === 'topup' && !item && <FormGroup title="首次充值" footer="可选。实付计入重要支出；赠送额度不算花费。">
      <FormRow label="同时记录首次充值"><Switch label="同时记录首次充值" checked={d.withTopup} onChange={withTopup => setD(x => ({ ...x, withTopup }))} disabled={off}/></FormRow>
      {d.withTopup && <>
        <DateField label="充值日期" value={d.firstTopup.topup_date ?? ''} onChange={v => setTopup({ topup_date: v || null })} disabled={off}/>
        <MoneyField label="实付" value={d.firstTopup.paid_cents ?? ''} onChange={v => setTopup({ paid_cents: v })} hint="未知就留空，不会记成 0" disabled={off}/>
        <MoneyField label="赠送" value={d.firstTopup.gift_cents ?? ''} onChange={v => setTopup({ gift_cents: v || null })} disabled={off}/>
        <MoneyField label="到账额度" value={d.firstTopup.credit_cents ?? credit ?? ''} onChange={v => setTopup({ credit_cents: v || null })} hint="默认为实付加赠送" disabled={off}/>
      </>}
    </FormGroup>}
    {item && <FormGroup footer="已记录的付款和充值不会因停用而消失。"><DateField label={mode === 'single' ? '结束使用日期' : '停用日期'} value={f.stopped_on ?? ''} onChange={v => setF({ stopped_on: v || null })} allowClear disabled={off}/></FormGroup>}
    <FormGroup>
      <TextField label="网址" value={f.url} onChange={url => setF({ url })} inputMode="text" disabled={off}/>
      <TextAreaField label="备注" value={f.notes} onChange={notes => setF({ notes })} disabled={off}/>
    </FormGroup>
  </EditorFrame>;
}
