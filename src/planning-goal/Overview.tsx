import { HouseholdLines } from '../planning-simplified-ui/HouseholdLines';
import { SPLIT_REQUIREMENT_HINT, householdOf, isCouple, isSplitCouple } from '../planning-simplified-ui/household-view';
import { money } from '../asset';
import { annotationSummary, annotationDirection } from '../plan-annotations';
import type { ReactNode } from 'react';
import { ageAtMonth, ageText } from '../planning-simplified-ui/income-view';
import { forecastMoney } from '../plan-format';
import { monthIndexV1, monthTextV1 } from '../plan-simplified';
import type { BasicCapabilities, PlanningAnnotation } from '../plan';
import { missingText, requirementLine } from '../planning-basic-view';
import type { Refinement } from '../planning-first-run';
import type { AssumptionReadV1, FollowupRead } from '../planning-followup-contract';
import type { GoalEdit, Saved } from './inputs';
import type { fundScopeSummary } from '../planning-fund-scope';
import type { SavingHint } from '../plan-saving-hint';
import { GoalTrajectory } from './Trajectory';

export type SavingHintAction = { hint: SavingHint; onReview: () => void; onDismiss: () => void };
export type GoalAction = GoalEdit | 'income' | 'funds' | 'costs' | 'debt' | 'events';

const conditionOrder: GoalAction[] = ['mode', 'time', 'saving', 'spend', 'start', 'income', 'assumptions', 'emergency'];

const assumptionTagText: Record<AssumptionReadV1['confirmation'], string> = { unconfirmed: '试算值，未确认', confirmed: '已核对', needs_review: '条件已变，请确认' };

export function GoalOverview({ saved, caps, today, cards, accountFunds, purchasePlans, onAnnotation, onEdit, onRefine, onDetail, onTrial, savingHint, onReport, reportDisabled = false, assumptionRead }: {
  saved: Saved; caps: BasicCapabilities; today: string; cards: Refinement[]; accountFunds?: ReturnType<typeof fundScopeSummary>; purchasePlans?: ReactNode;
  onAnnotation?: (annotation: PlanningAnnotation, from: HTMLElement) => void; onEdit: (action: GoalAction, from: HTMLElement) => void; onRefine: (card: Refinement, from: HTMLElement) => void; onDetail?: () => void; onTrial?: () => void; savingHint?: SavingHintAction | null;
  onReport?: (from: HTMLElement) => void; reportDisabled?: boolean; assumptionRead?: FollowupRead<AssumptionReadV1> | null;
}) {
  const p = saved.profile, r = p.retire, b = r.basic!;
  const funds = caps.funds.status === 'ready' ? caps.funds.value : null;
  const req = caps.requirement.status === 'ready' ? caps.requirement.value : null;
  const pred = caps.prediction.status === 'ready' ? caps.prediction.value : null;
  const plan = pred?.plan ?? null, projection = pred?.projection ?? null, outcome = pred?.outcome ?? null;
  const annotations = caps.annotations ?? [];
  const uncertain = annotations.some(a => a.effect !== 'none');
  const time = r.simplified.time, retirementAge = ageAtMonth(time.reference, time.target_month), horizonAge = ageAtMonth(time.reference, time.horizon_month);
  const retirementText = retirementAge === null ? time.target_month ?? '退休时间未填写' : `${ageText(retirementAge)}退休（${time.target_month}）`;
  const horizonText = horizonAge === null ? time.horizon_month ?? '尚未确定' : `${ageText(horizonAge)}（${time.horizon_month}）`;
  const difference = req && 'monthly_cents' in req.set && b.contribution.monthly_cents !== null && Number(b.contribution.monthly_cents) >= 0 ? Number(b.contribution.monthly_cents) - Number(req.set.monthly_cents) : null;
  const predictedMonth = (m: number | null) => m === null || !plan?.anchor_date ? null : monthTextV1(monthIndexV1(plan.anchor_date) + m - plan.now_months);
  const household = householdOf(r.simplified), splitCouple = isSplitCouple(household, today);
  const fiMonth = projection?.fi_month ?? null, predictedRetire = projection?.retire_month ?? null;
  const myStopMonth = r.mode === 'fire' ? predictedMonth(predictedRetire) : plan ? predictedMonth(plan.target_months) : null;
  const capMonth = plan ? predictedMonth(Math.min(plan.search_cap_months, plan.horizon_months - 1)) : null;
  const assumptionTag = assumptionRead === undefined ? '测算假设'
    : assumptionRead === null ? '读取中'
    : assumptionRead.status !== 'ready' ? (assumptionRead.status === 'disabled' ? '暂不可用' : '读取失败')
    : assumptionTagText[assumptionRead.value.confirmation];
  const rows: { id: GoalAction; title: string; value: string; description: string; state: string }[] = [
    { id: 'mode', title: '目标类型', value: r.mode === 'fire' ? '财务自由：资金够用后退休' : '按计划月份退休', description: '财务自由按资金是否够用决定退休时间；按计划月份退休固定到目标月份再检查是否够用。需求反求始终按固定目标月份计算。', state: '你选择的方式' },
    { id: 'time', title: '停止工作时间', value: retirementText, description: `规划到 ${horizonText}；${time.reference?.age_months === 0 ? `出生年月 ${time.reference.month}。` : !time.reference ? '填写出生年月后可按年龄设置。' : ''}退休目标不等于养老金领取时间。`, state: '你设定的目标' },
    { id: 'income', title: '未来固定收入', value: r.simplified.income_mode === 'excluded' ? '暂不计入' : r.simplified.income_mode === 'unconfirmed' ? '尚未确认' : `${r.simplified.future_incomes.filter(i => i.included).length} 项已选择`, description: r.simplified.future_incomes.map(i => `${i.name}：${i.start_month ?? '开始月待定'}，${i.monthly_cents === null ? '金额待定' : money(i.monthly_cents) + '/月'}`).join('；') || '可以添加官方测算的养老金或其他固定收入。', state: '用户维护的预计收入' },
    { id: 'spend', title: '退休生活费', value: r.spend_cents === null ? '还没估计' : `${money(r.spend_cents)} / 月`, description: `${isCouple(household) ? '两人合计，' : ''}按现在物价的生活费总额；缴费、租金等是否包含，单独核对。`, state: '你估计的预算' },
    { id: 'start', title: '现在可用的钱', value: funds ? money(funds.available_cents) : '资金待确认', description: funds ? b.start.kind === 'simulation' ? `截至 ${funds.date} 的手填模拟金额，替代账户盘点。` : `截至 ${funds.date}，包含已确认可动用的现金、存款及可变现投资。暂不能动用的 ${money(funds.restricted_cents)} 单列。` : '选择用于规划的资金来源，并确认账户用途或模拟金额。', state: b.start.kind === 'simulation' ? '模拟金额' : '账户盘点' },
    { id: 'saving', title: '每月能存的钱', value: b.contribution.monthly_cents === null ? '还没估计' : `${money(b.contribution.monthly_cents)} / 月`, description: `${isCouple(household) ? '两人合计，' : ''}不工作前，扣除日常开支和缴费后的净存入；负数表示取用存款。`, state: b.contribution.monthly_cents === null ? '可以稍后填写' : '你估计的投入' },
    { id: 'assumptions', title: '计算假设', value: `实际年收益 ${r.real_return_before_hundredths / 100}% / ${r.real_return_after_hundredths / 100}% · 波动率 ${r.volatility_hundredths / 100}%`, description: `依次为退休前／后，已扣除通胀。通胀假设 ${p.assumptions.inflation_hundredths / 100}%；波动率只用于市场模拟。`, state: assumptionTag },
    { id: 'emergency', title: '应急金', value: `${r.emergency_months} 个月`, description: '按退休后每月必需支出计的参考金，用于大额计划的应急金线提示；不会从退休月账本另外扣除。', state: '参考线' },
  ];
  const required = cards.find(c => c.required);
  const impact = cards.find(c => c.impacts);
  const card = required ?? impact;
  const missingCondition: GoalAction | null = !time.target_month || !time.horizon_month ? 'time' : r.spend_cents === null ? 'spend' : !funds ? 'start' : r.simplified.income_mode === 'unconfirmed' ? 'income' : b.contribution.monthly_cents === null ? 'saving' : null;
  const reloadCard: Refinement = { id: 'assumptions-read', title: '重新读取试算假设', benefit: assumptionRead?.status === 'error' ? assumptionRead.message : '试算假设读取失败。', duration: '约几秒', action: 'reload', required: false };
  let nextCard: { title: string; benefit: string; disabled?: boolean; run: (from: HTMLElement) => void } | null;
  if (card) nextCard = { title: card.title, benefit: card.benefit || '只调整这一项，其余已填条件保留。', run: from => onRefine(card, from) };
  else if (missingCondition) nextCard = { title: `填写${rows.find(row => row.id === missingCondition)!.title}`, benefit: missingCondition === 'saving' ? '可暂不填写；补充后可判断按当前投入能否达成目标。' : '补充这项计算条件，其余已填条件保留。', run: from => onEdit(missingCondition, from) };
  else nextCard = null;
  const headline = r.mode === 'fire' && projection
    ? predictedRetire !== null ? `预计 ${predictedMonth(predictedRetire)} 退休` : `按当前假设，${capMonth ?? '规划终点'} 前尚未达成`
    : time.target_month === null ? '先设置退休年龄' : retirementText;
  const predictionLines: { label: string; text: string }[] = [];
  if (pred && plan && projection && outcome) {
    if (pred.source === 'temporary') predictionLines.push({ label: '数据来源', text: '临时试算，未保存' });
    if (r.mode === 'fire') {
      predictionLines.push({ label: '资金预计够用', text: fiMonth === null ? '规划终点前未见资金够用' : predictedMonth(fiMonth)! });
      predictionLines.push({ label: '预计退休月份', text: predictedRetire === null ? `${capMonth ?? '规划终点'} 前尚未达成` : predictedMonth(predictedRetire)! });
    } else predictionLines.push({ label: '目标年龄时资金', text: outcome.funded_at_goal ? '已够用' : `还差 ${forecastMoney(String(Math.round(outcome.shortfall_at_goal)))}` });
    // The verdict line above the amounts already states the overall conclusion.
    predictionLines.push({ label: '终点资产', text: forecastMoney(String(Math.round(outcome.at_horizon))) });
  }
  const renderCondition = (row: (typeof rows)[number], index: number) => <article key={row.id} className="goal-condition" data-condition={row.id}><span className="goal-step">{index + 1}</span><div><h4>{row.title} {row.id !== 'assumptions' && <span className="ui-tag">{row.state}</span>}</h4><strong>{row.value}</strong><p className="muted small">{row.description}</p>{row.id === 'assumptions' && <>
          {assumptionRead?.status === 'ready' && assumptionRead.value.confirmation !== 'confirmed' && <p className="muted small">{assumptionTag}；展开「条件与核对」可查看与确认。</p>}
          <details><summary>条件与核对</summary><p className="muted small" role="status">{assumptionTag}</p><button type="button" className="ui-btn" aria-label="调整计算假设" onClick={e => onEdit('assumptions', e.currentTarget)}>查看与确认假设</button></details>
          {assumptionRead && assumptionRead.status !== 'ready' && <p className="notice" role="alert">{assumptionRead.message}{assumptionRead.status === 'error' && <button type="button" className="ui-link" onClick={e => onRefine(reloadCard, e.currentTarget)}>重新读取试算假设</button>}</p>}
        </>}{row.id === 'saving' && savingHint && <div className="goal-saving-hint" role="note"><p className="small">近 {savingHint.hint.count} 个盘点区间{savingHint.hint.window_from ? `（${savingHint.hint.window_from.slice(0, 7)} 起）` : ''}，按已记录的收入估计每月存下约 {forecastMoney(savingHint.hint.historical_cents)}（{savingHint.hint.direction === 'higher' ? '高于' : '低于'}你填的 {money(savingHint.hint.entered_cents)}）。这只看现金、存款和负债，是估计，不会自动改你的数字。</p><button className="ui-link" onClick={savingHint.onReview}>去财务复盘查看依据</button><button className="ui-link" onClick={savingHint.onDismiss}>先不提醒</button></div>}
        {row.id === 'start' && b.start.kind === 'live' && <>
        {funds && accountFunds && <p className="muted small">按参与比例计入：现金与存款 {money(accountFunds.totals.cash)} · 投资 {money(accountFunds.totals.investment)}{accountFunds.totals.other !== '0' && ` · 其他 ${money(accountFunds.totals.other)}`}</p>}
        {!!accountFunds?.unavailable.length && <p className="goal-fund-exclusions small">未作可用资金：{accountFunds.unavailable.join('、')}。</p>}
        <button className="ui-link" onClick={e => onEdit('funds', e.currentTarget)}>核对账户用途与投资计入</button>
      </>}</div>{row.id !== 'assumptions' && <button id={row.id === 'time' ? 'plan-budget-entry' : undefined} className="ui-btn" aria-label={`调整${row.title}`} onClick={e => onEdit(row.id, e.currentTarget)}>调整</button>}</article>;
  const trajectoryInput = pred && plan && projection && outcome ? { plan, projection, outcome, assets: plan.assets_cents } : null;
  return <><div className="goal-layout">
    <div className="goal-side"><article className="ui-card ui-content goal-answer" aria-label="退休目标"><p className="eyebrow">{!req && !pred ? '还不能算出结果' : uncertain ? '当前暂算结果' : '按当前条件估算'}</p><h3>{headline}</h3><p className="muted small">{r.mode === 'fire' && time.target_month ? `你希望 ${retirementText}；规划到 ${horizonText}` : `规划到 ${horizonText}`}</p><p className="goal-verdict">{pred ? !pred.outcome.success ? '按当前投入，尚未满足完整目标' : uncertain ? '已计入条件可覆盖，仍有事项需确认' : pred.terminal === 'no_margin' ? '所选期间可覆盖，终点没有余量' : '按当前投入，所选期间可覆盖' : '先看目标需求，补充投入后判断能否达成'}</p>{pred && <HouseholdLines household={household} summary={pred.household} myStopMonth={myStopMonth}/>}<div className="goal-amounts"><div><span>固定目标需要每月存</span><strong>{req && 'monthly_cents' in req.set ? forecastMoney(req.set.monthly_cents) : '待计算'}</strong><small className="muted">按固定目标月份反求，不是未来预测{splitCouple && req && 'monthly_cents' in req.set ? `。${SPLIT_REQUIREMENT_HINT}` : ''}</small></div><div><span>你估计每月能存</span><strong>{b.contribution.monthly_cents === null ? '还没填' : money(b.contribution.monthly_cents)}</strong><button type="button" className="ui-link" onClick={e => onEdit('saving', e.currentTarget)}>{b.contribution.monthly_cents === null ? '填写每月能存的钱' : '修改每月能存的钱'}</button></div></div>
      <div className="goal-result-actions">
        {onDetail && <button type="button" id="plan-detail-entry" className="primary goal-detail-entry" onClick={onDetail}>查看测算详情与图表</button>}
        {onReport && <button type="button" className="ui-btn goal-report-entry" disabled={reportDisabled} onClick={e => onReport(e.currentTarget)}>查看当前报告</button>}
      </div>
      {onTrial && (pred ? !pred.outcome.success : difference !== null && difference < 0) && <button type="button" className="ui-link goal-trial-entry" onClick={onTrial}>试算：歇一阵或换工作会怎样 →</button>}
      {req ? req.set.status !== 'found' && <p>{uncertain && req.set.status === 'no_positive_contribution' ? '只看已计入的条件，暂不要求额外存钱。请先核对下方遗漏。' : requirementLine(req.set, forecastMoney).text}</p> : caps.requirement.status === 'blocked' && <p>{[...new Set(caps.requirement.missing.map(missingText))].join(' ')}</p>}
      {difference !== null && req?.set.status === 'found' && <p>{difference < 0 ? '每月还差约' : '每月余量约'} {forecastMoney(Math.abs(difference))}（按已计入的条件）。</p>}
      {req && pred && <p className="muted small">上面“需要每月存”按固定目标月份反求；预测按已保存的每月投入推演，两者口径不同，不能只看差额下结论。</p>}
      {!pred && caps.prediction.status === 'blocked' && <p className="muted small">{caps.prediction.missing.some(m => m.code === 'CONTRIBUTION_UNKNOWN') ? '填好每月能存的钱后，这里会显示预计退休时间与资金结论。' : [...new Set(caps.prediction.missing.map(missingText))].join(' ')}</p>}
    </article><GoalTrajectory calc={trajectoryInput}/><article className="ui-card ui-content goal-evidence" aria-label="依据与提醒"><h3>依据与提醒</h3>
      {pred && predictionLines.length > 0 && <div className="goal-result" aria-label="预测结果"><h4>按已保存投入的预测</h4><dl>{predictionLines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.text}</dd></div>)}</dl></div>}
      <GoalCaution annotations={annotations} saved={saved} onAnnotation={onAnnotation}/>
      <p className="muted small">按当前条件估算，不保证未来一定够用；收入、支出或政策变化后需要重算。</p>
    </article>{nextCard && <article className="ui-card ui-content goal-next"><p className="eyebrow">{nextCard.disabled ? '假设核对状态' : '建议下一步'}</p><h3>{nextCard.title}</h3><p className="muted">{nextCard.benefit}</p><button className="primary" disabled={nextCard.disabled} onClick={e => nextCard!.run(e.currentTarget)}>{nextCard.title}</button></article>}</div>
    <section className="ui-card goal-conditions" aria-label="计算条件"><div className="ui-content"><h3>这次计算用了什么</h3><p className="muted small">已填条件一直保留，可单独调整；先看上方结论，再按需要核对各项条件。</p></div>
      {[...rows].sort((a, b) => conditionOrder.indexOf(a.id) - conditionOrder.indexOf(b.id)).map(renderCondition)}
      {!!r.life_events.length && <div className="ui-content goal-event-summary"><h4>这次的大额计划</h4><ul>{r.life_events.map(event => {
        const occurred = r.core?.occurrences.find(o => o.event_id === event.id)?.status;
        return <li key={event.id}><strong>{event.label}</strong><span className="muted small">{occurred === 'cancelled' ? '已取消' : occurred === 'occurred' ? '已发生，计入后续安排' : event.included ? '计入目标' : '未计入'} · {event.date}</span></li>;
      })}</ul><button className="ui-link" onClick={e => onEdit('events', e.currentTarget)}>查看与调整大额计划</button></div>}
      <div className="ui-content goal-secondary"><button className="ui-link" onClick={e => onEdit('costs', e.currentTarget)}>核对费用是否包含</button><button className="ui-link" onClick={e => onEdit('debt', e.currentTarget)}>贷款还款安排</button><button className="ui-link" onClick={e => onEdit('events', e.currentTarget)}>买房买车等大额计划</button></div>
    </section>
  </div>
    {purchasePlans && <div className="goal-purchase-plans">{purchasePlans}</div>}</>;
}

function GoalCaution({ annotations, saved, onAnnotation }: { annotations: PlanningAnnotation[]; saved: Saved; onAnnotation?: (annotation: PlanningAnnotation, from: HTMLElement) => void }) {
  const affecting = annotations.filter(a => a.effect !== 'none');
  return affecting.length > 0 ? <div className="goal-caution"><strong>这些情况还会影响结果</strong>
    {annotationSummary(affecting).map(line => <p className="coverage-summary" key={line}>{line}</p>)}
    <details><summary>查看未计入的安排与需确认的条件</summary><ul>{affecting.map(a => {
    const event = saved.profile.retire.life_events.find(e => e.id === a.refinement.event_id);
    return <li key={a.id}>{a.message}<small>{annotationDirection(a)}</small>{a.missing_fields.length > 0 && <small>还差：{a.missing_fields.join('、')}</small>}{onAnnotation && a.actionable !== false && <button type="button" className="ui-link" onClick={e => onAnnotation(a, e.currentTarget)}>{event ? `查看计划：${event.label}` : '去核对'}</button>}</li>;
  })}</ul></details></div> : null;
}
