import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from '../../asset';
import type { VirtualAsset, VirtualOverview, VirtualSave } from '../../virtual';
import { billingOf, billingText, cumulativeCost, paymentScheduleText, planAssociationText, validityText, virtualKindText, virtualStatusText } from '../../virtual';
import { submit } from '../../wealth';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { FormGroup, NavBar, ListGroup, ListRow, Metric, MetricGrid, Notice } from '../ui';
import { stopFields } from './forms';
import { GroupDeleteSheet } from './PlanActions';
import { ConfirmSheet, Loaded, Tag } from './parts';
import { trash, useRead, useSaver } from './read';
import { ReminderGroup } from './Reminder';
import { virtualLine } from './model';

/** spending.virtualDetail: one virtual asset with its cost, validity, top-ups and balance. */
export default function VirtualDetail({ params }: PageProps) {
  const id = String(params.id ?? '');
  const read = useRead(async () => {
    const overview = await invoke<VirtualOverview>('virtual_overview');
    const item = overview.items.find(v => v.id === id);
    if (!item) throw new Error('这项虚拟资产已不存在，可能已被删除。');
    return { overview, item };
  }, id);
  return <><NavBar/><Loaded read={read} what="虚拟资产">{({ overview, item }) => <Body generation={overview.generation} item={item} reload={read.reload}/>}</Loaded></>;
}

function Body({ generation, item, reload }: { generation: string; item: VirtualAsset; reload: () => void }) {
  const nav = useNav(), { today } = useSession(), { modules } = useModules(), saver = useSaver();
  const [sheet, setSheet] = useState<'' | 'stop' | 'delete'>(''), [notice, setNotice] = useState('');
  const mode = billingOf(item), cost = cumulativeCost(item), line = virtualLine(item, today), f = item.fields;
  const linkedPlan = mode === 'subscription' && !!item.plan && !item.plan_deleted;
  const recurringOn = modules ? modules.recurring : true;
  const topups = [...(item.topups ?? [])].sort((a, b) => (b.fields.topup_date ?? '').localeCompare(a.fields.topup_date ?? ''));
  const stop = () => {
    const input = { request_id: '', generation, id: item.id, expected_revision: item.revision, fields: stopFields(f, today) };
    void saver.run(requestId => submit({ command: 'virtual_save', input: { ...input, request_id: requestId } as VirtualSave, label: '停用 ' + f.name }), { onDone: () => { setNotice(`已${mode === 'single' ? '结束使用' : '停用'}「${f.name}」。`); setSheet(''); reload(); } });
  };
  return <div className="m-page">
    <h1 className="sp-detail-title">{f.name}</h1>
    <p className="sp-detail-sub"><Tag tone="accent">{line.typeLabel}</Tag> <Tag tone={item.status === 'expiring' ? 'warn' : item.status === 'stopped' || item.status === 'expired' ? 'neutral' : 'positive'}>{virtualStatusText(item)}</Tag> {f.kind !== 'general' ? virtualKindText(f.kind) : ''}</p>
    {notice && <Notice tone="positive">{notice}</Notice>}
    {item.needs_review && <Notice>档案停用{f.stopped_on ? `于 ${f.stopped_on}` : ''}，但关联计划仍在进行；请在电脑上核对停用记录。</Notice>}
    {item.plan_deleted && f.plan_id && <Notice>关联付款计划在最近删除中，可在电脑上恢复或核对。</Notice>}
    <MetricGrid>
      <Metric label="有效期" value={/^\d{4}-\d{2}-\d{2}$/.test(validityText(item)) ? <span className="sp-nowrap-date">{validityText(item)}</span> : validityText(item)}/>
      <Metric label={cost.estimated ? '累计费用（估算）' : mode === 'topup' ? '累计充值实付' : '累计费用'} value={cost.cents !== null ? money(cost.cents) : '未知'} unknown={cost.cents === null} sub={line.cost.note || undefined}/>
    </MetricGrid>
    <FormGroup title="档案"><ul className="sp-rows sp-facts sp-pad">
      <li><span>计费方式</span><span>{billingText(mode)}</span></li>
      <li><span>周期计划</span><span className="sp-right">{planAssociationText(item)}</span></li>
      {mode === 'subscription' && <li><span>付款安排</span><span>{paymentScheduleText(item)}</span></li>}
      {mode === 'single' && <li><span>单次价格</span><span>{f.price_cents != null ? money(f.price_cents) : '待补充'}</span></li>}
      <li><span>标签</span><span>{item.label_name || '未设置'}</span></li>
      {f.provider && <li><span>服务商</span><span>{f.provider}</span></li>}
      <li><span>开始日期</span><span>{f.purchase_date || '待补充'}</span></li>
      {f.url && <li><span>网址</span><span className="sp-right">{f.url}</span></li>}
      {f.notes && <li><span>备注</span><span className="sp-right">{f.notes}</span></li>}
    </ul></FormGroup>
    {linkedPlan && item.plan && <>
      <ListGroup title="付款计划">
        <ListRow icon="calendar" title={item.plan.fields.name} subtitle={`每期 ${money(item.plan.fields.amount_cents)} · ${paymentScheduleText(item)}`} onClick={recurringOn ? () => nav.push('spending.recurring', { id: item.plan!.id }) : undefined}
          valueSub={recurringOn ? '付款期次' : '周期费用已关闭'}/>
      </ListGroup>
      <ReminderGroup assetId={item.id} assetRevision={item.revision} reminder={item.reminder ?? null} nextDue={item.plan.next_due} hasServiceStart={!!item.plan.fields.service_start} generation={generation} today={today} moduleEnabled onSaved={reload}/>
    </>}
    {mode === 'topup' && <>
      <ListGroup title="余额" footer="余额只按你记录的盘点显示；没有记录就是未知，不会按充值推算。">
        <ListRow icon="wallet" title={item.balance ? money(item.balance.balance_cents) : '余额未记录'} subtitle={item.balance ? `${item.balance.recorded_on} 盘点${item.balance.notes ? ' · ' + item.balance.notes : ''}` : '去充值卡或服务页面看一下剩余额度后记录'} unknown={!item.balance}
          onClick={() => nav.push('spending.balance', { asset: item.id })} valueSub="记录余额"/>
      </ListGroup>
      <ListGroup title={`充值记录 · ${topups.length} 笔`} action={<button type="button" className="sp-link" onClick={() => nav.push('spending.topup', { asset: item.id })}>＋ 记录充值</button>}
        footer={item.topup_unknown_paid ? `${item.topup_unknown_paid} 笔实付未知，未计入累计。` : '实付计入重要支出；赠送额度不算花费。'}>
        {!topups.length ? <ListRow title="尚未记录充值"/> : topups.map(t => <ListRow key={t.id} onClick={() => nav.push('spending.topup', { asset: item.id, id: t.id })}
          title={t.fields.topup_date ?? '日期待补'} subtitle={[t.fields.gift_cents ? `赠送 ${money(t.fields.gift_cents)}` : '', t.fields.credit_cents ? `到账 ${money(t.fields.credit_cents)}` : '', t.fields.pay_method].filter(Boolean).join(' · ') || undefined}
          value={t.fields.paid_cents != null ? money(t.fields.paid_cents) : '实付未知'} unknown={t.fields.paid_cents == null}/>)}
      </ListGroup>
    </>}
    <ListGroup title="管理">
      <ListRow icon="doc" title="编辑" subtitle="名称、计费方式、有效期、备注" onClick={() => nav.push('spending.virtualEdit', { id: item.id })}/>
      {item.status !== 'stopped' && !linkedPlan && <ListRow icon="clock" title={mode === 'single' ? '结束使用' : '停用'} subtitle="记为今天停用，历史花费保留" onClick={() => { saver.setError(''); setSheet('stop'); }}/>}
      {linkedPlan && item.status !== 'stopped' && recurringOn && <ListRow icon="warning" tone="danger" title="结束订阅" subtitle="在付款计划里确认最后使用日" onClick={() => nav.push('spending.recurring', { id: item.plan!.id })}/>}
      <ListRow icon="trash" tone="danger" title={linkedPlan ? '整组删除' : '删除'} subtitle="移入最近删除，可恢复" onClick={() => { saver.setError(''); setSheet('delete'); }}/>
    </ListGroup>
    {sheet === 'stop' && <ConfirmSheet title={mode === 'single' ? '结束使用？' : '停用？'} confirm="确认" busy={saver.busy} error={saver.error} onClose={() => setSheet('')} onConfirm={stop} message={`「${f.name}」将记为今天（${today}）${mode === 'single' ? '结束使用' : '停用'}；已有的付款和充值记录保留。`}/>}
    {sheet === 'delete' && (linkedPlan ? <GroupDeleteSheet side="virtual" id={item.id} generation={generation} onClose={() => setSheet('')}/>
      : <ConfirmSheet title="移入最近删除？" confirm="移入最近删除" danger busy={saver.busy} error={saver.error} onClose={() => setSheet('')}
        onConfirm={() => void saver.run(requestId => trash('virtual', item.id, item.revision, generation, f.name, requestId), { close: true })} message={`「${f.name}」会移入最近删除，可以恢复。`}/>)}
  </div>;
}
