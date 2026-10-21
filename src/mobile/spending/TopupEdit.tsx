import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TopupFields, VirtualAsset, VirtualOverview } from '../../virtual';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, FormGroup, MoneyField, TextAreaField, TextField } from '../ui';
import { autoCredit, blankTopup, topupSave, validateTopup } from './forms';
import { ConfirmSheet, EditorFrame, Loaded } from './parts';
import { trash, useRead, useSaver } from './read';

/** spending.topup: record, correct or delete one top-up of a stored-value asset. */
export default function TopupEdit({ params }: PageProps) {
  const asset = String(params.asset ?? ''), id = typeof params.id === 'string' ? params.id : null;
  const read = useRead(async () => {
    const overview = await invoke<VirtualOverview>('virtual_overview');
    const item = overview.items.find(v => v.id === asset);
    if (!item) throw new Error('这项虚拟资产已不存在。');
    const record = id ? item.topups?.find(t => t.id === id) ?? null : null;
    if (id && !record) throw new Error('这笔充值已不存在。');
    return { generation: overview.generation, item, record };
  }, `${asset}:${id ?? ''}`);
  return <Loaded nav read={read} what="充值">{data => <Form generation={data.generation} item={data.item} record={data.record}/>}</Loaded>;
}

function Form({ generation, item, record }: { generation: string; item: VirtualAsset; record: { id: string; revision: number; fields: TopupFields } | null }) {
  const { today } = useSession(), saver = useSaver();
  const [f, setF] = useState<TopupFields>(() => record?.fields ?? blankTopup(today)), [touched, setTouched] = useState(!!record?.fields.credit_cents), [problem, setProblem] = useState(''), [asking, setAsking] = useState(false);
  const set = (patch: Partial<TopupFields>) => { setProblem(''); setF(x => ({ ...x, ...patch })); };
  const credit = touched ? null : autoCredit(f);
  function save() {
    const check = validateTopup(f, credit);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'virtual_topup_save', input: topupSave(f, credit, item, record, generation, requestId), label: '充值 ' + item.fields.name }), { close: true });
  }
  const remove = () => record && void saver.run(requestId => trash('topup', record.id, record.revision, generation, '充值', requestId), { close: true });
  return <EditorFrame title={record ? '更正充值' : '记录充值'} onSave={save} busy={saver.busy} error={problem || (asking ? '' : saver.error)}>
    <p className="sp-note sp-note-pad">{item.fields.name}。实付计入重要支出；赠送额度不算花费。</p>
    <FormGroup footer="实付未知就留空，不会记成 0；到账额度默认为实付加赠送。">
      <DateField label="充值日期" value={f.topup_date ?? ''} onChange={v => set({ topup_date: v || null })} disabled={saver.busy}/>
      <MoneyField label="实付" value={f.paid_cents ?? ''} onChange={v => set({ paid_cents: v })} disabled={saver.busy}/>
      <MoneyField label="赠送" value={f.gift_cents ?? ''} onChange={v => set({ gift_cents: v || null })} disabled={saver.busy}/>
      <MoneyField label="到账额度" value={f.credit_cents ?? credit ?? ''} onChange={v => { setTouched(true); set({ credit_cents: v || null }); }} disabled={saver.busy}/>
      <TextField label="付款方式" value={f.pay_method} onChange={pay_method => set({ pay_method })} disabled={saver.busy}/>
    </FormGroup>
    <FormGroup><TextAreaField label="备注" value={f.notes} onChange={notes => set({ notes })} disabled={saver.busy}/></FormGroup>
    {record && <Button variant="danger" block disabled={saver.busy} onClick={() => setAsking(true)}>删除这笔充值</Button>}
    {asking && <ConfirmSheet title="删除这笔充值？" confirm="移入最近删除" danger busy={saver.busy} error={saver.error} onClose={() => setAsking(false)} onConfirm={remove} message="这笔充值会移入最近删除，可以恢复；累计充值随之减少。"/>}
  </EditorFrame>;
}
