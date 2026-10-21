import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from '../../asset';
import type { LinkView } from '../../link';
import { pendingSubscriptionStart, planStatus, recurringCategoryText, intervalUnit } from '../../recurring';
import type { Due, Overview, SubscriptionDetailData } from '../../recurring';
import { periodLabel } from '../../recurring-model';
import { submit } from '../../wealth';
import { useModules } from '../modules-context';
import { useNav, useReveal } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, Card, EmptyState, FormGroup, NavBar, HeroCard, ListGroup, ListRow, Notice } from '../ui';
import { pausedFields, planSave, skipSave } from './forms';
import { dueBadge, nextPayment, periodLabelText, periodList, planStatusInfo, progressParts, termText } from './model';
import type { PeriodRow } from './model';
import { EndPlanSheet, GroupDeleteSheet, readLink } from './PlanActions';
import { Loaded, Tag, ConfirmSheet } from './parts';
import { trash, useRead, useSaver } from './read';
import { ReminderGroup } from './Reminder';

type Data = { overview: Overview; detail: SubscriptionDetailData; link: LinkView };
const stateText = { pending: '待确认', paid: '已确认', skipped: '已跳过', upcoming: '未到' } as const;
const stateTone = { pending: 'warn', paid: 'positive', skipped: 'neutral', upcoming: 'neutral' } as const;

/** spending.recurring: one plan (design 15): amount, term and cost, reminder, payment periods, edit / pause / end. */
export default function PlanDetail({ params }: PageProps) {
  const id = typeof params.id === 'string' ? params.id : '';
  const read = useRead<Data>(async () => {
    const [overview, detail, link] = await Promise.all([invoke<Overview>('recurring_overview'), invoke<SubscriptionDetailData>('recurring_detail', { planId: id }), readLink('plan', id)]);
    if (overview.generation !== detail.generation || link.generation !== detail.generation) throw new Error('资料刚刚发生变化，请重试。');
    return { overview, detail, link };
  }, id);
  return <>
    <NavBar/>
    <Loaded read={read} what="计划">{data => <Body data={data} reload={read.reload}/>}</Loaded>
  </>;
}

function Body({ data, reload }: { data: Data; reload: () => void }) {
  const { overview, detail, link } = data, plan = detail.plan, f = plan.fields;
  const nav = useNav(), { today } = useSession(), { modules } = useModules(), saver = useSaver();
  const [sheet, setSheet] = useState<'' | 'pause' | 'end' | 'delete' | 'cancelResume'>(''), [skipping, setSkipping] = useState<PeriodRow | null>(null), [notice, setNotice] = useState(''), [shown, setShown] = useState(24);
  const reveal = useReveal();
  // A banner from an action on this page is stale once another page (edit, resume, payment) was opened above and closed.
  useEffect(() => { setNotice(''); }, [reveal]);
  const linked = link.relation === 'linked' && !!link.asset;
  const ended = !!f.end_date && f.end_date < today, pending = pendingSubscriptionStart(plan, today);
  const status = planStatusInfo(plan, today), list = periodList(plan, detail.payments, [...overview.due, ...overview.upcoming] as Due[], today);
  const parts = progressParts(list), next = nextPayment(plan, today);
  const sub = f.category === 'subscription' || linked, canResume = sub && ended && !!f.service_start && (linked || link.relation === 'unlinked');
  const pendingResumption = !!pending && !!plan.resumptions?.length;
  const pendingPayments = pendingResumption && (detail.pending_has_payments ?? detail.payments.some(p => p.coverage_start ? p.coverage_start >= pending! : p.due_date >= f.first_due));
  const editablePending = pendingResumption && !pendingPayments && (linked || link.relation === 'unlinked');
  const cost = plan.contract_cents ?? plan.estimated_cents, monthly = !pending && plan.monthly_cents && !f.interval_days && f.interval_months > 1 ? plan.monthly_cents : null;
  const rows = list.rows, start = Math.max(0, rows.length - shown), visible = rows.slice(start);
  const done = (message: string) => { setNotice(message); setSheet(''); setSkipping(null); reload(); };
  const togglePause = () => {
    const fields = pausedFields(f, !f.paused);
    void saver.run(requestId => linked ? submit({ command: 'link_save', input: { request_id: requestId, generation: link.generation, asset_id: link.asset!.id, asset_expected_revision: link.asset!.revision, plan_id: plan.id, plan_expected_revision: plan.revision, fields }, label: `${f.paused ? '恢复' : '暂停'} ${f.name}` })
      : submit({ command: 'recurring_plan_save', input: planSave(fields, plan, detail.generation, requestId), label: `${f.paused ? '恢复' : '暂停'} ${f.name}` }), { onDone: () => done(f.paused ? `已恢复「${f.name}」的续费。` : `已暂停「${f.name}」；暂停期间不再提醒，已记录的付款保留。`) });
  };
  const skip = () => skipping && void saver.run(requestId => submit({ command: 'recurring_payment_save', input: skipSave({ plan_id: plan.id, due_date: skipping.due }, detail.generation, requestId), label: `${f.name} ${skipping.due} 本期不付` }), { onDone: () => done(`已标记 ${skipping.due} 本期不付。`) });
  const cancelResume = () => void saver.run(requestId => submit({ command: 'recurring_cancel_resumption', input: { request_id: requestId, generation: link.generation, plan_id: plan.id, expected_revision: plan.revision, asset_id: link.asset?.id ?? null, asset_expected_revision: link.asset?.revision ?? null }, label: '撤销待生效安排' }), { onDone: () => done('已撤销待生效的安排，恢复为上段已结束的订阅。') });
  return <div className="m-page">
    <h1 className="sp-detail-title">{f.name}</h1>
    <p className="sp-detail-sub"><Tag tone={status.tone}>{status.text}</Tag> {recurringCategoryText(f.category)}{link.asset ? ` · 关联服务档案「${link.asset.name}」` : ''}</p>
    {notice && <Notice tone="positive">{notice}</Notice>}
    {link.needs_review && <Notice>档案停用{link.asset?.stopped_on ? `于 ${link.asset.stopped_on}` : ''}，但计划仍在进行；请在电脑上核对停用记录。</Notice>}
    <HeroCard eyebrow="每期金额" title={<span className="sp-big">{money(f.amount_cents)}<small>/ {intervalUnit(f)}</small></span>} subtitle={monthly ? `月均 ${money(monthly)}` : f.interval_days ? `每 ${f.interval_days} 天一期` : undefined}
      tags={[{ text: planStatus(plan, today), tone: status.tone === 'positive' ? 'positive' : 'neutral' }]}/>
    {next ? <div className={`sp-banner${next.badge.tone === 'danger' || next.badge.tone === 'warn' ? ' sp-banner-warn' : ''}`}><span>下次付款 {next.date}</span><span>{next.badge.text}</span></div>
      : <div className="sp-banner"><span>{ended ? `已于 ${f.end_date} 结束` : f.paused ? '续费已暂停' : pending ? `服务 ${pending} 生效` : '当前没有待记录期'}</span></div>}
    <Card className="sp-term"><h2>租期与费用</h2>
      <div className="sp-kv-row"><span>期间</span><strong>{termText(plan, list)}</strong></div>
      <div className="sp-kv-row"><span>{list.openEnded ? '估算费用' : '合同总额'}</span><strong>{cost ? money(cost) : '—'}</strong></div>
      <div className="sp-kv-row"><span>实际已付</span><strong>{plan.paid_cents ? money(plan.paid_cents) : '未记录付款'}{list.paid ? ` · ${list.paid} 期` : ''}</strong></div>
      {parts && <div className="sp-progress" role="img" aria-label={`已确认 ${list.paid} 期，跳过 ${list.skipped} 期，待确认 ${list.pending} 期，未到 ${list.upcoming} 期`}><i className="p-paid" style={{ width: `${parts.paid}%` }}/><i className="p-skipped" style={{ width: `${parts.skipped}%` }}/><i className="p-pending" style={{ width: `${parts.pending}%` }}/></div>}
      <p className="sp-progress-note">已确认 {list.paid} 期 · 跳过 {list.skipped} 期 · 待确认 {list.pending} 期{list.total !== null ? ` · 共 ${list.total} 期` : ' · 持续进行'}。费用按每期金额与服务期估算，不代表实付。</p>
    </Card>
    {linked && link.asset ? <ReminderGroup assetId={link.asset.id} assetRevision={link.asset.revision} reminder={link.reminder} nextDue={plan.next_due} hasServiceStart={!!f.service_start} generation={link.generation} today={today} moduleEnabled={modules ? modules.virtual : true} onSaved={reload}/>
      : <FormGroup title="到期提醒" footer="提醒挂在服务档案上。订阅关联服务档案后，可以在这里开启每期提前提醒。"><ListRow title="备款提醒" subtitle="未关联服务档案，暂不可用"/></FormGroup>}
    <ListGroup title="付款期次" action={<button type="button" className="sp-link" onClick={() => nav.push('spending.paymentRange', { plan: plan.id })}>补记往期付款</button>}
      footer="已确认才计入重要支出。点已记录的期次可更正金额、日期或改回待确认。">
      {!rows.length ? <ListRow title="还没有期次" subtitle="填好开始日期和每期金额后会按周期生成"/> : <>
        {start > 0 && <div className="sp-more"><button type="button" className="sp-link" onClick={() => setShown(n => n + 24)}>查看更早的 {start} 期</button></div>}
        {visible.map(row => <PeriodItem key={row.key} row={row} today={today} onOpen={() => nav.push('spending.payment', { plan: plan.id, due: row.due })} onSkip={() => { saver.setError(''); setSkipping(row); }}/>)}
      </>}
    </ListGroup>
    <ListGroup title="管理">
      {!pendingResumption && <ListRow icon="doc" title="编辑" subtitle="金额、周期、起止日期、备注" onClick={() => nav.push('spending.recurringEdit', { id: plan.id })}/>}
      {canResume && <ListRow icon="refresh" title="重新订阅" subtitle="沿用原档案，从新的开始日起再订阅" onClick={() => nav.push('spending.planResume', { id: plan.id })}/>}
      {editablePending && <ListRow icon="close" title="撤销待生效安排" subtitle="恢复为上段已结束的订阅" onClick={() => { saver.setError(''); setSheet('cancelResume'); }}/>}
      {!ended && !pending && <ListRow icon="clock" title={f.paused ? '恢复续费' : '暂停续费'} subtitle={f.paused ? '恢复后继续生成待确认的期次' : '暂停期间不生成待确认，也不提醒'} onClick={() => { saver.setError(''); setSheet('pause'); }}/>}
      {!ended && (!pendingResumption || pendingPayments) && (linked || link.relation === 'unlinked') && <ListRow icon="warning" tone="danger" title="结束计划" subtitle="确认最后使用日，之后不再续费" onClick={() => { saver.setError(''); setSheet('end'); }}/>}
      <ListRow icon="trash" tone="danger" title={linked ? '整组删除' : '删除计划'} subtitle="移入最近删除，可恢复" onClick={() => { saver.setError(''); setSheet('delete'); }}/>
    </ListGroup>
    {f.notes && <FormGroup title="备注"><p className="sp-sheet-text sp-pad">{f.notes}</p></FormGroup>}
    {pending && <p className="sp-note sp-note-pad">服务将于 {pending} 生效。若已提前扣款，现在就可以记录；付款不会把生效日提前。</p>}
    {!!plan.resumptions?.length && <p className="sp-note sp-note-pad">曾中断后重新订阅；中间停订的时间不计入费用估算，也不会要求补付款。</p>}
    {sheet === 'pause' && <ConfirmSheet title={f.paused ? '恢复续费？' : '暂停续费？'} confirm={f.paused ? '恢复续费' : '暂停续费'} busy={saver.busy} error={saver.error} onClose={() => setSheet('')} onConfirm={togglePause}
      message={f.paused ? `恢复后「${f.name}」会继续生成待确认的期次。` : `暂停后「${f.name}」不再生成待确认的期次，已记录的付款保留。实际已停订请改用「结束计划」。`}/>}
    {sheet === 'end' && <EndPlanSheet plan={plan} link={link} generation={detail.generation} today={today} onClose={() => setSheet('')} onDone={done}/>}
    {sheet === 'delete' && (linked ? <GroupDeleteSheet side="plan" id={plan.id} generation={link.generation} onClose={() => setSheet('')}/>
      : <ConfirmSheet title="移入最近删除？" confirm="移入最近删除" danger busy={saver.busy} error={saver.error} onClose={() => setSheet('')}
        onConfirm={() => void saver.run(requestId => trash('plan', plan.id, plan.revision, detail.generation, `计划 ${f.name}`, requestId), { close: true })}
        message={`「${f.name}」会连同付款记录一起移入最近删除，可以恢复；其中已确认的付款暂不参与重要支出。`}/>)}
    {sheet === 'cancelResume' && <ConfirmSheet title="撤销待生效安排？" confirm="撤销安排" busy={saver.busy} error={saver.error} onClose={() => setSheet('')} onConfirm={cancelResume}
      message="将恢复为上段已结束的订阅。旧期间与旧付款保持原样；不会取消服务方的订阅或办理退款。"/>}
    {skipping && <ConfirmSheet title="本期不付？" confirm="确认本期不付" busy={saver.busy} error={saver.error} onClose={() => setSkipping(null)} onConfirm={skip}
      message={`${skipping.due} 这一期会记为不付，不计入重要支出，也不会再出现在待确认里。之后可以点这一期更正。`}/>}
    {!rows.length && !detail.payments.length && <EmptyState icon="calendar" title="还没有付款记录" message="已经扣过的钱可以补记；预计费用不会算成实际已付。" action={<Button onClick={() => nav.push('spending.paymentRange', { plan: plan.id })}>补记往期付款</Button>}/>}
  </div>;
}

function PeriodItem({ row, today, onOpen, onSkip }: { row: PeriodRow; today: string; onOpen: () => void; onSkip: () => void }) {
  const coverage = row.coverage ? periodLabel(row.coverage[0], row.coverage[1]) : '';
  const amount = row.state === 'skipped' ? '本期不付' : row.amount !== null ? money(row.amount) : '金额未知';
  const sub = row.state === 'paid' ? `${row.paidDate ?? '日期未记录'} 实付${row.offSchedule ? ' · 原排期已更正' : ''}` : row.state === 'skipped' ? '不计入重要支出' : `${row.due} 付款 · ${dueBadge(row.due, today).text}`;
  return <div className="sp-period-row">
    <button type="button" className="sp-period-main" onClick={onOpen} aria-label={`${periodLabelText(row)} ${row.due} ${stateText[row.state]}，${amount}`}>
      <span className="sp-period-line"><strong>{periodLabelText(row)} · {row.due.slice(2)}</strong><em className={row.amount === null && row.state === 'paid' ? 'm-unknown' : undefined}>{amount}</em></span>
      <span className="sp-period-sub"><span>{sub}{coverage ? ` · ${coverage}` : ''}</span><Tag tone={stateTone[row.state]}>{stateText[row.state]}</Tag></span>
    </button>
    {row.state === 'pending' && <div className="sp-period-actions"><Button variant="primary" onClick={onOpen}>确认付款</Button><Button onClick={onSkip}>跳过</Button></div>}
  </div>;
}
