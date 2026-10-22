import { useState } from 'react';
import { useDirtyGuard, useFormChanged } from '../nav-context';
import { invoke } from '@tauri-apps/api/core';
import type { VirtualAsset, VirtualOverview } from '../../virtual';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { DateField, FormGroup, MoneyField, TextField } from '../ui';
import { balanceSave } from './forms';
import { EditorFrame, Loaded } from './parts';
import { useRead, useSaver } from './read';
import { t } from '../../i18n.ts';
/** spending.balance: record the remaining balance of a stored-value asset, with the date it was checked. */
export default function BalanceEdit({ params }: PageProps) {
  const asset = String(params.asset ?? '');
  const read = useRead(async () => {
    const overview = await invoke<VirtualOverview>('virtual_overview');
    const item = overview.items.find(v => v.id === asset);
    if (!item) throw new Error(t('这项虚拟资产已不存在。'));
    return { generation: overview.generation, item };
  }, asset);
  return <Loaded nav read={read} what={t('余额')}>{data => <Form generation={data.generation} item={data.item}/>}</Loaded>;
}

function Form({ generation, item }: { generation: string; item: VirtualAsset }) {
  const { today } = useSession(), saver = useSaver();
  const [cents, setCents] = useState(item.balance?.balance_cents ?? ''), [date, setDate] = useState(today), [notes, setNotes] = useState(''), [problem, setProblem] = useState('');
  useDirtyGuard(useFormChanged({cents,date,notes}));
  function save() {
    if (!cents) { setProblem('请填写当前余额；不知道就先不记，余额会保持未知。'); return; }
    if (!date) { setProblem('请填写盘点日期。'); return; }
    void saver.run(requestId => submit({ command: 'virtual_balance_save', input: balanceSave({ cents, date, notes }, item, generation, requestId), label: '余额 ' + item.fields.name }), { close: true });
  }
  return <EditorFrame title={t('记录余额')} onSave={save} busy={saver.busy} error={problem || saver.error}>
    <p className="sp-note sp-note-pad">{t('{name}。按你看到的剩余额度记录；余额不会按充值和消费自动推算。', { name: item.fields.name })}</p>
    <FormGroup>
      <MoneyField label={t('当前余额')} value={cents} onChange={v => { setProblem(''); setCents(v); }} disabled={saver.busy}/>
      <DateField label={t('盘点日期')} value={date} max={today} onChange={setDate} disabled={saver.busy}/>
      <TextField label={t('备注')} value={notes} onChange={setNotes} disabled={saver.busy}/>
    </FormGroup>
  </EditorFrame>;
}
