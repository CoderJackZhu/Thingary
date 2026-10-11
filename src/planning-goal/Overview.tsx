import { money } from '../asset';
import { forecastMoney } from '../plan-format';
import type { BasicCapabilities, PlanningAnnotation } from '../plan';
import { medicalCheck } from '../plan-medical';
import { missingText, requirementLine } from '../planning-basic-view';
import type { Refinement } from '../planning-first-run';
import { medicalView } from './medical-view';
import { contributionTimeline, ageAtMonth } from './contribution-timeline';
import type { GoalEdit, Saved } from './inputs';
export type GoalAction = GoalEdit | 'income' | 'contributions' | 'cost' | 'funds' | 'costs' | 'debt' | 'events';

export function GoalOverview({ saved, caps, today, cards, onEdit, onRefine, onDetail }: { saved: Saved; caps: BasicCapabilities; today: string; cards: Refinement[]; onEdit: (action: GoalAction, from: HTMLElement) => void; onRefine: (card: Refinement, from: HTMLElement) => void; onDetail: () => void }) {
  const p = saved.profile, r = p.retire, b = r.basic!;
  const funds = caps.funds.status === 'ready' ? caps.funds.value : null;
  const req = caps.requirement.status === 'ready' ? caps.requirement.value : null;
  const pension = caps.pension.status === 'ready' ? caps.pension.value : null;
  const payable = pension?.included && pension.start_month !== null;
  const ineligible = b.retirement_income.mode === 'employee' && pension?.included && !pension.start_month;
  const medical = medicalCheck(p, b, today), med = medicalView(medical, p.medical_topup_cents);
  const onlyScheduleMissing = medical.status === 'unknown' && medical.missing.length === 1 && medical.missing[0] === '未来缴费起止月份';
  const t = contributionTimeline(p, b.pension_contributions.stop_month, today), cost = b.retirement_contribution_cost;
  const annotations = caps.annotations ?? [];
  const uncertain = annotations.some(a => a.effect !== 'none');
  const difference = req && 'monthly_cents' in req.set && b.contribution.monthly_cents !== null && Number(b.contribution.monthly_cents) >= 0 ? Number(b.contribution.monthly_cents) - Number(req.set.monthly_cents) : null;
  const rows: { id: GoalAction; title: string; value: string; description: string; state: string }[] = [
    { id: 'time', title: '停止工作时间', value: r.target_age === null ? '还没填写目标年龄' : `${r.target_age} 岁不再工作 · 安排到 ${r.horizon_age} 岁`, description: `出生年月 ${p.birth_month ?? '未填'}。${r.mode === 'fire' ? '已选择 FIRE：达到资金条件时可能更早停止工作。' : '按填写的年龄停止工作。'} 停工不等于开始领取养老金。`, state: '你设定的目标' },
    { id: 'spend', title: '退休生活费', value: r.spend_cents === null ? '还没估计' : `${money(r.spend_cents)} / 月`, description: '按现在物价的生活费总额；缴费、租金等是否包含，单独核对。', state: '你估计的预算' },
    { id: 'start', title: '现在可用的钱', value: funds ? money(funds.available_cents) : '资金待确认', description: funds ? `截至 ${funds.date}，受限资金 ${money(funds.restricted_cents)} 单独计算，不作为现在可用的钱。` : '选择用于规划的资金来源，并确认账户用途或模拟金额。', state: b.start.kind === 'simulation' ? '模拟金额' : '账户盘点' },
    { id: 'saving', title: '每月能存的钱', value: b.contribution.monthly_cents === null ? '还没估计' : `${money(b.contribution.monthly_cents)} / 月`, description: '不工作前，扣除日常开支和缴费后的净存入；负数表示取用存款。', state: b.contribution.monthly_cents === null ? '可以稍后填写' : '你估计的投入' },
    { id: 'income', title: '退休后收入', value: ineligible ? '当前缴费计划不足以按月领取养老金' : payable ? `养老金约 ${forecastMoney(pension.monthly_cents)} / 月` : b.retirement_income.mode === 'excluded' ? '暂不计退休收入' : b.retirement_income.mode === 'manual' ? '计入所选手填收入' : '退休收入待补充', description: payable ? `${pension.start_month} 起领取；预计最后缴费 ${t.last ?? '未填'}。` : b.retirement_income.mode === 'manual' ? r.income_items.filter(i => b.retirement_income.selected.some(s => s.id === i.id)).map(i => `${i.label} ${money(i.monthly_cents)}/月，${i.start_age}岁起`).join('；') || '尚未选择收入来源。' : '停工、停缴和养老金起领是三个不同时间；养老金页可核对个人资料。', state: payable || b.retirement_income.mode === 'manual' ? '按选择计入 · 估算' : '未计入月养老金' },
    { id: 'cost', title: '不工作后自己缴社保', value: r.mode === 'traditional' && t.months === 0 ? '当前计划无停工后续缴区间' : cost && ['extra', 'included'].includes(cost.treatment) ? `${money(cost.monthly_cents)} / 月 · ${cost.treatment === 'extra' ? '额外支付' : '生活费已含'}` : cost?.treatment === 'external' ? '已确认由他人承担' : cost?.treatment === 'excluded' ? '本次不计费用' : '续缴费用待确认', description: `停止工作 ${t.work ?? '未填'}；最后缴费 ${t.last ?? '未填'}（${ageAtMonth(p.birth_month, t.last)}）。${r.mode === 'fire' ? 'FIRE 若提前停工，仍需要安排后续缴费。' : '缴费计划与费用一起核对，不代表已满足退休资格。'}`, state: '缴费排期与费用' },
    { id: 'medical', title: '退休医保', value: med.title, description: `${med.explanation} 已缴累计 ${p.medical_paid_months ?? '未知'} 个月，本地 ${p.medical_local_paid_months ?? '未知'} 个月。${p.medical_topup_cents != null ? `补缴估算 ${money(p.medical_topup_cents)}。` : ''}`, state: '已填资料与预计年限' },
    { id: 'assumptions', title: '计算假设', value: `实际年收益 ${r.real_return_before_hundredths / 100}% / ${r.real_return_after_hundredths / 100}%`, description: `依次为退休前／后，已扣除通胀。通胀假设 ${p.assumptions.inflation_hundredths / 100}%；实际收益 0% 表示购买力不变。`, state: '测算假设' },
  ];
  const required = cards.find(c => c.required);
  const impact = cards.find(c => c.impacts);
  const next: GoalAction = !p.birth_month || r.target_age === null ? 'time' : r.spend_cents === null ? 'spend' : !funds ? 'start' : !b.retirement_income.mode ? 'income' : ineligible ? 'cost' : onlyScheduleMissing ? 'contributions' : med.pending ? 'medical' : b.contribution.monthly_cents === null ? 'saving' : 'assumptions';
  const card = required ?? impact;
  const nextTitle = card?.title ?? (next === 'contributions' ? '补充未来缴费安排' : next === 'medical' ? med.next : next === 'cost' ? '调整养老金缴费安排' : `调整${rows.find(row => row.id === next)!.title}`);
  return <div className="goal-layout">
    <section className="ui-card goal-conditions" aria-label="计算条件"><div className="ui-content"><h3>这次计算用了什么</h3><p className="muted small">已填条件一直保留，可单独调整。</p></div>
      {rows.map((row, index) => <article key={row.id} className="goal-condition" data-condition={row.id}><span className="goal-step">{index + 1}</span><div><h4>{row.title} <span className="ui-tag">{row.state}</span></h4><strong>{row.value}</strong><p className="muted small">{row.description}</p>{row.id === 'start' && b.start.kind === 'live' && <button className="ui-link" onClick={e => onEdit('funds', e.currentTarget)}>核对账户用途</button>}</div><button id={row.id === 'time' ? 'plan-budget-entry' : undefined} className="ui-btn" aria-label={`调整${row.title}`} onClick={e => onEdit(row.id, e.currentTarget)}>调整</button></article>)}
      <div className="ui-content goal-secondary"><button className="ui-link" onClick={e => onEdit('costs', e.currentTarget)}>核对费用是否包含</button><button className="ui-link" onClick={e => onEdit('debt', e.currentTarget)}>贷款还款安排</button><button className="ui-link" onClick={e => onEdit('events', e.currentTarget)}>买房买车等大额计划</button></div>
    </section>
    <aside><article className="ui-card ui-content" aria-label="退休目标"><p className="eyebrow">{!req ? '还不能算出结果' : uncertain ? '当前暂算结果' : '按当前条件估算'}</p><h3>{r.target_age === null ? '先设置停止工作年龄' : `${r.target_age} 岁起不工作`}</h3><div className="goal-amounts"><div><span>目标需要每月存</span><strong>{req && 'monthly_cents' in req.set ? forecastMoney(req.set.monthly_cents) : '待计算'}</strong></div><div><span>你估计每月能存</span><strong>{b.contribution.monthly_cents === null ? '还没填' : money(b.contribution.monthly_cents)}</strong></div></div>
      {req ? <p>{uncertain && req.set.status === 'no_positive_contribution' ? '只看已计入的条件，暂不要求额外存钱。请先核对下方遗漏。' : requirementLine(req.set, forecastMoney).text}</p> : caps.requirement.status === 'blocked' && <p>{[...new Set(caps.requirement.missing.map(missingText))].join(' ')}</p>}
      {difference !== null && req?.set.status === 'found' && <p>{difference < 0 ? '每月还差约' : '每月余量约'} {forecastMoney(Math.abs(difference))}（按已计入的条件）。</p>}
      {req && <button type="button" id="plan-detail-entry" className="primary goal-detail-entry" onClick={onDetail}>查看计算详情与图表</button>}
      <GoalCaution annotations={annotations}/>
      <p className="muted small">按当前条件估算，不保证未来一定够用；收入、支出或政策变化后需要重算。</p>
    </article><article className="ui-card ui-content goal-next"><p className="eyebrow">建议下一步</p><h3>{nextTitle}</h3><p className="muted">{card?.benefit ?? (next === 'contributions' ? '已缴医保资料已保存；还缺未来缴费起止月份，补充后才能判断预计年限。' : next === 'medical' ? med.guidance : '只调整这一项，其余已填条件保留。')}</p><button className="primary" onClick={e => card ? onRefine(card, e.currentTarget) : onEdit(next, e.currentTarget)}>{card ? nextTitle : next === 'medical' ? med.action : nextTitle}</button></article></aside>
  </div>;
}

function GoalCaution({ annotations }: { annotations: PlanningAnnotation[] }) {
  const affecting = annotations.filter(a => a.effect !== 'none');
  return affecting.length > 0 ? <div className="goal-caution"><strong>这些情况还会影响结果</strong><ul>{affecting.map(a => <li key={a.id}>{a.message}</li>)}</ul></div> : null;
}
