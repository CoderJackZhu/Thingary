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
import { t } from '../i18n.ts';
export type SavingHintAction = { hint: SavingHint; onReview: () => void; onDismiss: () => void };
export type GoalAction = GoalEdit | 'income' | 'funds' | 'costs' | 'debt' | 'events';

const conditionOrder: GoalAction[] = ['mode', 'time', 'saving', 'spend', 'start', 'income', 'assumptions', 'emergency'];

const assumptionTagText: Record<AssumptionReadV1['confirmation'], string> = { unconfirmed: t('试算值，未确认'), confirmed: t('已核对'), needs_review: t('条件已变，请确认') };

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
  const retirementText = retirementAge === null ? time.target_month ?? t('退休时间未填写') : t('{v1}退休（{target_month}）', { v1: ageText(retirementAge), target_month: time.target_month });
  const horizonText = horizonAge === null ? time.horizon_month ?? t('尚未确定') : `${ageText(horizonAge)}（${time.horizon_month}）`;
  const difference = req && 'monthly_cents' in req.set && b.contribution.monthly_cents !== null && Number(b.contribution.monthly_cents) >= 0 ? Number(b.contribution.monthly_cents) - Number(req.set.monthly_cents) : null;
  const predictedMonth = (m: number | null) => m === null || !plan?.anchor_date ? null : monthTextV1(monthIndexV1(plan.anchor_date) + m - plan.now_months);
  const household = householdOf(r.simplified), splitCouple = isSplitCouple(household, today);
  const fiMonth = projection?.fi_month ?? null, predictedRetire = projection?.retire_month ?? null;
  const myStopMonth = r.mode === 'fire' ? predictedMonth(predictedRetire) : plan ? predictedMonth(plan.target_months) : null;
  const capMonth = plan ? predictedMonth(Math.min(plan.search_cap_months, plan.horizon_months - 1)) : null;
  const assumptionTag = assumptionRead === undefined ? t('测算假设')
    : assumptionRead === null ? t('读取中')
    : assumptionRead.status !== 'ready' ? (assumptionRead.status === 'disabled' ? t('暂不可用') : t('读取失败'))
    : assumptionTagText[assumptionRead.value.confirmation];
  const rows: { id: GoalAction; title: string; value: string; description: string }[] = [
    { id: 'mode', title: t('退休方式'), value: r.mode === 'fire' ? t('钱够用后退休') : t('按计划时间退休'), description: r.mode === 'fire' ? t('从你希望的时间起，看看什么时候可以不靠工资生活。') : t('看看按你选的时间退休，钱能不能用到最后。') },
    { id: 'time', title: t('停止工作时间'), value: retirementText, description: t('规划到 {horizonText}；{v2}退休目标不等于养老金领取时间。', { horizonText, v2: time.reference?.age_months === 0 ? t('出生年月 {month}。', { month: time.reference.month }) : !time.reference ? t('填写出生年月后可按年龄设置。') : '' }) },
    { id: 'income', title: t('未来固定收入'), value: r.simplified.income_mode === 'excluded' ? t('暂不计入') : r.simplified.income_mode === 'unconfirmed' ? t('尚未确认') : `${r.simplified.future_incomes.filter(i => i.included).length} 项已选择`, description: r.simplified.future_incomes.map(i => `${i.name}：${i.start_month ?? t('开始月待定')}，${i.monthly_cents === null ? t('金额待定') : money(i.monthly_cents) + t('/月')}`).join('；') || t('可以添加官方测算的养老金或其他固定收入。') },
    { id: 'spend', title: t('退休生活费'), value: r.spend_cents === null ? t('还没估计') : t('{v1} / 月', { v1: money(r.spend_cents) }), description: t('{v1}按现在物价的生活费总额；缴费、租金等是否包含，单独核对。', { v1: isCouple(household) ? t('两人合计，') : '' }) },
    { id: 'start', title: t('准备拿来养老的钱'), value: funds ? money(funds.available_cents) : t('资金待确认'), description: funds ? b.start.kind === 'simulation' ? t('你手填的金额，截至 {date}；不与账户余额相加。', { date: funds.date }) : t('来自 {date} 的盘点，只算你确认愿意用、现在能动用的钱。', { date: funds.date }) : t('从账户中选择，或先手填一个金额；不改变实际余额。') },
    { id: 'saving', title: t('每月能存的钱'), value: b.contribution.monthly_cents === null ? t('还没估计') : t('{v1} / 月', { v1: money(b.contribution.monthly_cents) }), description: t('{v1}还在工作时，每月收入扣掉全部开销后剩下的钱；需要动用存款就填负数。', { v1: isCouple(household) ? t('两人合计，') : '' }) },
    { id: 'assumptions', title: t('计算假设'), value: t('实际年收益 {v1}% / {v2}% · 波动率 {v3}%', { v1: r.real_return_before_hundredths / 100, v2: r.real_return_after_hundredths / 100, v3: r.volatility_hundredths / 100 }), description: t('依次为退休前／后，已扣除通胀。通胀假设 {v1}%；波动率只用于市场模拟。', { v1: p.assumptions.inflation_hundredths / 100 }) },
    { id: 'emergency', title: t('应急金'), value: t('{emergency_months} 个月', { emergency_months: r.emergency_months }), description: t('按退休后每月必需支出计的参考金，用于大额计划的应急金线提示；不会从退休月账本另外扣除。') },
  ];
  const required = cards.find(c => c.required);
  const impact = cards.find(c => c.impacts);
  const card = required ?? impact;
  const missingCondition: GoalAction | null = !time.target_month || !time.horizon_month ? 'time' : r.spend_cents === null ? 'spend' : !funds ? 'start' : r.simplified.income_mode === 'unconfirmed' ? 'income' : b.contribution.monthly_cents === null ? 'saving' : null;
  const reloadCard: Refinement = { id: 'assumptions-read', title: t('重新读取试算假设'), benefit: assumptionRead?.status === 'error' ? assumptionRead.message : t('试算假设读取失败。'), duration: t('约几秒'), action: 'reload', required: false };
  let nextCard: { title: string; benefit: string; disabled?: boolean; run: (from: HTMLElement) => void } | null;
  if (card) nextCard = { title: card.title, benefit: card.benefit || t('只调整这一项，其余已填条件保留。'), run: from => onRefine(card, from) };
  else if (missingCondition) nextCard = { title: `填写${rows.find(row => row.id === missingCondition)!.title}`, benefit: missingCondition === 'saving' ? t('可暂不填写；补充后可判断按当前投入能否达成目标。') : t('补充这项计算条件，其余已填条件保留。'), run: from => onEdit(missingCondition, from) };
  else nextCard = null;
  const headline = r.mode === 'fire' && projection
    ? predictedRetire !== null ? t('预计 {v1} 退休', { v1: predictedMonth(predictedRetire) }) : t('按当前假设，{v1} 前尚未达成', { v1: capMonth ?? '规划终点' })
    : time.target_month === null ? t('先设置退休时间') : t('希望 {retirementText}{v2}', { retirementText, v2: retirementAge === null ? t(' 退休') : '' });
  const predictionLines: { label: string; text: string }[] = [];
  if (pred && plan && projection && outcome) {
    if (pred.source === 'temporary') predictionLines.push({ label: t('数据来源'), text: t('临时试算，未保存') });
    if (r.mode === 'fire') {
      predictionLines.push({ label: t('资金预计够用'), text: fiMonth === null ? t('规划终点前未见资金够用') : predictedMonth(fiMonth)! });
      predictionLines.push({ label: t('预计退休月份'), text: predictedRetire === null ? t('{v1} 前尚未达成', { v1: capMonth ?? t('规划终点') }) : predictedMonth(predictedRetire)! });
    } else predictionLines.push({ label: t('目标年龄时资金'), text: outcome.funded_at_goal ? t('已够用') : t('还差 {v1}', { v1: forecastMoney(String(Math.round(outcome.shortfall_at_goal))) }) });
    // The verdict line above the amounts already states the overall conclusion.
    predictionLines.push({ label: t('最后一个月预计剩下'), text: forecastMoney(String(Math.round(outcome.at_horizon))) });
  }
  const renderCondition = (row: (typeof rows)[number], index: number) => <article key={row.id} className="goal-condition" data-condition={row.id}><span className="goal-step" aria-hidden="true">{index + 1}</span><div><h4>{row.title}</h4><strong>{row.value}</strong><p className="muted small">{row.description}</p>{row.id === 'assumptions' && <>
          <p className="muted small" role="status">{assumptionTag}</p><button type="button" className="ui-btn" aria-label={t('调整计算假设')} onClick={e => onEdit('assumptions', e.currentTarget)}>{t('查看与确认假设')}</button>
        </>}{row.id === 'saving' && savingHint && <div className="goal-saving-hint" role="note"><p className="small">{t('近 {count} 个盘点区间', { count: savingHint.hint.count })}{savingHint.hint.window_from ? t('（{v1} 起）', { v1: savingHint.hint.window_from.slice(0, 7) }) : ''}{t('，按已记录的收入估计每月存下约 {v1}（', { v1: forecastMoney(savingHint.hint.historical_cents) })}{savingHint.hint.direction === 'higher' ? t('高于') : t('低于')}{t('你填的 {v1}）。这只看现金、存款和负债，是估计，不会自动改你的数字。', { v1: money(savingHint.hint.entered_cents) })}</p><button className="ui-link" onClick={savingHint.onReview}>{t('去财务复盘查看依据')}</button><button className="ui-link" onClick={savingHint.onDismiss}>{t('先不提醒')}</button></div>}
        {row.id === 'start' && b.start.kind === 'live' && <>
        <details className="goal-fund-detail"><summary>{t('哪些钱算进来了？')}</summary>
        {funds && <p className="muted small">{t('暂不能动用的 {v1} 单列，不计入上面的金额。', { v1: money(funds.restricted_cents) })}</p>}
        {funds && accountFunds && <p className="muted small">{t('按你选择的比例：现金与存款 {v1} · 投资 {v2}', { v1: money(accountFunds.totals.cash), v2: money(accountFunds.totals.investment) })}{accountFunds.totals.other !== '0' && t(' · 其他 {v1}', { v1: money(accountFunds.totals.other) })}</p>}
        {!!accountFunds?.unavailable.length && <p className="goal-fund-exclusions small">{t('本次没用到：{v1}。', { v1: accountFunds.unavailable.join('、') })}</p>}
        <button className="ui-link" onClick={e => onEdit('funds', e.currentTarget)}>{t('选择用于养老的账户')}</button></details>
      </>}</div>{row.id !== 'assumptions' && <button id={row.id === 'time' ? 'plan-budget-entry' : undefined} className="ui-btn" aria-label={t('调整{title}', { title: row.title })} onClick={e => onEdit(row.id, e.currentTarget)}>{t('调整')}</button>}</article>;
  const requirementMissing = [...new Set(caps.requirement.status === 'blocked' ? caps.requirement.missing.map(missingText) : [])];
  const predictionMissing = [...new Set(caps.prediction.status === 'blocked' ? caps.prediction.missing.map(missingText) : [])].filter(text => !requirementMissing.includes(text));
  const trajectoryInput = pred && plan && projection && outcome ? { plan, projection, outcome, assets: plan.assets_cents } : null;
  return <><div className="goal-layout">
    <div className="goal-side"><article className="ui-card ui-content goal-answer" aria-label={t('退休目标')}><p className="eyebrow">{!req && !pred ? t('还不能算出结果') : uncertain ? t('当前暂算结果') : t('按当前条件估算')}</p><h3>{headline}</h3><p className="muted small">{r.mode === 'fire' && time.target_month ? t('你希望 {retirementText}；生活费准备到 {horizonText}', { retirementText, horizonText }) : t('生活费准备到 {horizonText}', { horizonText })}</p><p className="goal-verdict">{pred ? !pred.outcome.success ? t('按你每月能存的钱，还不能完成这个计划') : uncertain ? t('已算入的部分够用，还有事项需确认') : pred.terminal === 'no_margin' ? t('钱能用到最后，但没有余钱') : t('按你每月能存的钱，这段时间够用') : t('先算每月需要存多少，再填你能存多少来比较')}</p>{pred && <HouseholdLines household={household} summary={pred.household} myStopMonth={myStopMonth}/>}<GoalCaution annotations={annotations} saved={saved} onAnnotation={onAnnotation}/><div className="goal-amounts"><div><span>{t('为目标每月需存')}</span><strong>{req && 'monthly_cents' in req.set ? forecastMoney(req.set.monthly_cents) : t('待计算')}</strong><small className="muted">{t('以你选的')} {time.target_month ?? t('目标月份')} {t('退休来算')}{splitCouple && req && 'monthly_cents' in req.set ? `。${SPLIT_REQUIREMENT_HINT}` : ''}</small></div><div><span>{t('你估计每月能存')}</span><strong>{b.contribution.monthly_cents === null ? t('还没填') : money(b.contribution.monthly_cents)}</strong><button type="button" className="ui-link" onClick={e => onEdit('saving', e.currentTarget)}>{b.contribution.monthly_cents === null ? t('填写每月能存的钱') : t('修改每月能存的钱')}</button></div></div>
      <div className="goal-result-actions">
        {onDetail && <button type="button" id="plan-detail-entry" className="primary goal-detail-entry" onClick={onDetail}>{t('查看详细结果')}</button>}
        {onReport && <button type="button" className="ui-btn goal-report-entry" disabled={reportDisabled} onClick={e => onReport(e.currentTarget)}>{t('查看当前报告')}</button>}
      </div>
      {onTrial && (pred ? !pred.outcome.success : difference !== null && difference < 0) && <button type="button" className="ui-link goal-trial-entry" onClick={onTrial}>{t('试算：歇一阵或换工作会怎样 →')}</button>}
      {req ? req.set.status !== 'found' && <p>{uncertain && req.set.status === 'no_positive_contribution' ? t('只看已计入的条件，暂不要求额外存钱。请先核对下方遗漏。') : requirementLine(req.set, forecastMoney).text}</p> : caps.requirement.status === 'blocked' && <p>{requirementMissing.join(' ')}</p>}
      {difference !== null && req?.set.status === 'found' && <p>{difference < 0 ? t('每月还差约') : t('每月余量约')} {t('{v1}（按已计入的条件）。', { v1: forecastMoney(Math.abs(difference)) })}</p>}
      {req && pred && <details className="goal-explanation"><summary>{t('这两个金额怎么看？')}</summary><p className="muted small">{t('“为目标每月需存”是以你选的退休时间来算，要每月存多少；“你估计每月能存”是你自己的估计。上面的结论用你的估计来判断，也会考虑能否按时付款，不能只比较两个金额。')}</p></details>}
      {!pred && caps.prediction.status === 'blocked' && (caps.prediction.missing.some(m => m.code === 'CONTRIBUTION_UNKNOWN') ? <p className="muted small">{t('填好每月能存的钱后，这里会显示预计退休时间与资金结论。')}</p> : predictionMissing.length > 0 && <p className="muted small">{predictionMissing.join(' ')}</p>)}
    </article>{nextCard && <article className="ui-card ui-content goal-next"><p className="eyebrow">{t('建议下一步')}</p><h3>{nextCard.title}</h3><p className="muted">{nextCard.benefit}</p><button className="primary" disabled={nextCard.disabled} onClick={e => nextCard!.run(e.currentTarget)}>{nextCard.title}</button></article>}<GoalTrajectory calc={trajectoryInput}/><details className="ui-card goal-evidence" aria-label={t('依据与提醒')}><summary>{t('查看结果依据')}</summary><div className="ui-content">
      {pred && predictionLines.length > 0 && <div className="goal-result" aria-label={t('预测结果')}><h4>{t('按你每月能存的钱估算')}</h4><dl>{predictionLines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.text}</dd></div>)}</dl></div>}
      <p className="muted small">{t('按当前条件估算，不保证未来一定够用；收入、支出或政策变化后需要重算。')}</p>
    </div></details></div>
    <section className="ui-card goal-conditions" aria-label={t('计算条件')}><div className="ui-content"><h3>{t('你的计划')}</h3><p className="muted small">{t('改一项就会更新结果，不用重新填写。')}</p></div>
      {[...rows].filter(row => row.id !== 'assumptions' && row.id !== 'emergency').sort((a, b) => conditionOrder.indexOf(a.id) - conditionOrder.indexOf(b.id)).map(renderCondition)}
      <div className="ui-content goal-assumption-status" role="status"><span>{t('收益与物价设置：{assumptionTag}', { assumptionTag })}</span>{assumptionRead?.status === 'ready' && assumptionRead.value.confirmation !== 'confirmed' && <p className="muted small">{assumptionRead.value.confirmation === 'needs_review' ? t('条件有变化，需要再核对一次。') : t('这些是假设，还没有核对。')}{t('可在下方「更多设置」查看与确认。')}</p>}</div>
      {assumptionRead && assumptionRead.status !== 'ready' && <div className="ui-content notice" role="alert">{assumptionRead.message}{assumptionRead.status === 'error' && <button type="button" className="ui-link" onClick={e => onRefine(reloadCard, e.currentTarget)}>{t('重新读取试算假设')}</button>}</div>}
      <details className="goal-more-settings"><summary><strong>{t('更多设置')}</strong><span className="muted small">{t('收益、物价与应急金')}</span></summary>{rows.filter(row => row.id === 'assumptions' || row.id === 'emergency').map((row, i) => renderCondition(row, i + 6))}</details>
      {!!r.life_events.length && <div className="ui-content goal-event-summary"><h4>{t('这次的大额计划')}</h4><ul>{r.life_events.map(event => {
        const occurred = r.core?.occurrences.find(o => o.event_id === event.id)?.status;
        return <li key={event.id}><strong>{event.label}</strong><span className="muted small">{occurred === 'cancelled' ? t('已取消') : occurred === 'occurred' ? t('已发生，计入后续安排') : event.included ? t('计入目标') : t('未计入')} · {event.date}</span></li>;
      })}</ul><button className="ui-link" onClick={e => onEdit('events', e.currentTarget)}>{t('查看与调整大额计划')}</button></div>}
      <div className="ui-content goal-secondary"><button className="ui-link" onClick={e => onEdit('costs', e.currentTarget)}>{t('核对费用是否包含')}</button><button className="ui-link" onClick={e => onEdit('debt', e.currentTarget)}>{t('贷款还款安排')}</button><button className="ui-link" onClick={e => onEdit('events', e.currentTarget)}>{t('买房买车等大额计划')}</button></div>
    </section>
  </div>
    {purchasePlans && <div className="goal-purchase-plans">{purchasePlans}</div>}</>;
}

function GoalCaution({ annotations, saved, onAnnotation }: { annotations: PlanningAnnotation[]; saved: Saved; onAnnotation?: (annotation: PlanningAnnotation, from: HTMLElement) => void }) {
  const affecting = annotations.filter(a => a.effect !== 'none');
  return affecting.length > 0 ? <div className="goal-caution"><strong>{t('这些情况还会影响结果')}</strong>
    {annotationSummary(affecting).map(line => <p className="coverage-summary" key={line}>{line}</p>)}
    <details><summary>{t('查看未计入的安排与需确认的条件')}</summary><ul>{affecting.map(a => {
    const event = saved.profile.retire.life_events.find(e => e.id === a.refinement.event_id);
    return <li key={a.id}>{a.message}<small>{annotationDirection(a)}</small>{a.missing_fields.length > 0 && <small>{t('还差：{v1}', { v1: a.missing_fields.join('、') })}</small>}{onAnnotation && a.actionable !== false && <button type="button" className="ui-link" onClick={e => onAnnotation(a, e.currentTarget)}>{event ? t('查看计划：{label}', { label: event.label }) : t('去核对')}</button>}</li>;
  })}</ul></details></div> : null;
}
