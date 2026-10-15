import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';

const readOf = (generation, confirmation) => ({
  status: 'ready',
  value: {
    generation, revision: null,
    values: { real_return_before_hundredths: 0, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 },
    confirmation,
    confirmed_values: confirmation === 'confirmed' ? { real_return_before_hundredths: 0, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 } : null,
  },
});
const goalArticle = r => r.nodes().find(n => n.props?.['aria-label'] === '退休目标');
const assumptionsArticle = r => r.nodes().find(n => n.props?.['data-condition'] === 'assumptions');
const render = (extra = {}) => {
  const sources = fixture(), saved = sources.profile.value.saved;
  const caps = buildBasicCapabilities(sources);
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, ...extra });
  return { sources, saved, caps, r };
};

test('confirmed assumptions do not hide a missing optional contribution or turn surplus into success',()=>{
 const {sources,saved}=render();saved.profile.retire.basic.contribution.monthly_cents=null;
 const caps=buildBasicCapabilities(sources);
 const r=runtime('planning-goal/Overview',{saved,caps,today:sources.today,cards:[],onEdit(){},onRefine(){},onDetail(){},assumptionRead:readOf(sources.generation,'confirmed')});
 assert.ok(r.button('填写每月能存的钱'));assert.match(r.text(r.nodes()),/可暂不填写/);
 const known=fixture(),knownSaved=known.profile.value.saved,knownCaps=buildBasicCapabilities(known);
 knownCaps.prediction.value.outcome.success=false;knownCaps.prediction.value.terminal='surplus';
 let trials=0;const failed=runtime('planning-goal/Overview',{saved:knownSaved,caps:knownCaps,today:known.today,cards:[],onEdit(){},onRefine(){},onDetail(){},onTrial(){trials++;},assumptionRead:readOf(known.generation,'confirmed')});
 assert.match(failed.text(goalArticle(failed)),/尚未满足完整目标/); failed.button('试算：歇一阵或换工作会怎样 →').props.onClick();assert.equal(trials,1); assert.doesNotMatch(failed.text(failed.nodes().find(n=>n.props?.['aria-label']==='预测结果')),/全程结论/);
});

test('embedded assumption read retry issues a fresh request even when profile write version stays unchanged',async()=>{
 const sources=fixture(),caps=buildBasicCapabilities(sources);caps.annotations=[];let reads=0;
 const port={async readAssumptions(generation){reads++;return reads===1?{status:'error',code:'READ_ERROR',message:'虚构读取失败'}:readOf(generation,'confirmed');}};
 const r=runtime('PlanningBasicGoals',{sources,today:sources.today,mode:'basic',onGoto(){},openSetup(){},assumptionsPort:port},undefined,caps,{components:['planning-goal/Overview','planning-followup-ui/AssumptionsSummary']});
 await r.settle();assert.equal(reads,1);assert.ok(r.button('重新读取试算假设'));
 r.button('重新读取试算假设').props.onClick({currentTarget:{focus(){}}});r.render();await r.settle();
 assert.equal(reads,2);assert.equal(r.button('重新读取试算假设'),undefined);assert.equal(r.button('核对计算假设'),undefined);
});

test('the monthly contribution edit entry sits in the result area and only asks for that field', () => {
  const { sources, saved, caps } = render();
  saved.profile.retire.basic.contribution.monthly_cents = null;
  const edits = [];
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit: (action, from) => edits.push([action, from]), onRefine() {}, onDetail() {}, realSummary: true });
  const add = r.button('填写每月能存的钱');
  assert.ok(add, 'unfilled contribution offers a fill entry');
  assert.deepEqual([add.props.id, add.props.className], [undefined, 'ui-link']);
  const from = { tag: 'saving-entry' };
  add.props.onClick({ currentTarget: from });
  assert.deepEqual(edits, [['saving', from]]);
  saved.profile.retire.basic.contribution.monthly_cents = '100000';
  const filled = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit: (action, from) => edits.push([action, from]), onRefine() {}, onDetail() {}, realSummary: true });
  filled.button('修改每月能存的钱').props.onClick({ currentTarget: from });
  assert.deepEqual(edits.at(-1), ['saving', from]);
});

test('the report remains in goals while detail moves to the view selector', () => {
  const { sources, saved, caps } = render();
  const calls = [];
  const blocked = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, onReport: from => calls.push(from), reportDisabled: true, realSummary: true });
  const blockedButton = blocked.button('查看当前报告');
  assert.ok(blockedButton);
  assert.equal(blockedButton.props.disabled, true);
  assert.equal(blocked.button('查看计算详情与图表'), undefined);
  const open = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, onReport: from => calls.push(from), reportDisabled: false, realSummary: true });
  const from = { tag: 'report' };
  open.button('查看当前报告').props.onClick({ currentTarget: from });
  assert.deepEqual(calls, [from]);
});

test('the result shows the saved prediction instead of reading the requirement gap as success', () => {
  const sources = fixture(), saved = sources.profile.value.saved, caps = buildBasicCapabilities(sources);
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, assumptionRead: readOf(sources.generation, 'confirmed') });
  assert.equal(caps.prediction.status, 'ready');
  const result = r.nodes().find(n => n.props?.['aria-label'] === '预测结果');
  assert.ok(result, 'saved prediction renders');
  const text = r.text(result);
  assert.match(text, /按已保存投入的预测/);
  assert.doesNotMatch(text, /全程结论/);
  assert.match(text, /终点资产/);
  const article = r.text(goalArticle(r));
  assert.match(article, /固定目标需要每月存/);
  assert.match(article, /每月(还差|余量)约/);
  assert.match(article, /两者口径不同/);
});

test('FIRE separates the hoped month from the predicted retirement month', () => {
  const sources = fixture(), saved = sources.profile.value.saved;
  saved.profile.retire.mode = 'fire';
  const caps = buildBasicCapabilities(sources);
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, assumptionRead: readOf(sources.generation, 'confirmed') });
  const text = r.text(goalArticle(r));
  assert.match(text, /你希望/);
  assert.match(text, /预计退休月份/);
  assert.match(text, /希望时间|你希望/);
});

test('unconfirmed and changed assumptions keep a light hint outside the closed disclosure, with read failures visible', () => {
  const { sources, saved, caps } = render();
  saved.profile.retire.real_return_before_hundredths = 175;
  const edits = [];
  const show = assumptionRead => runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit: (action, from) => edits.push([action, from]), onRefine() {}, onDetail() {}, realSummary: true, assumptionRead });
  const outsideHint = r => r.nodes().find(n => n.type === 'p' && r.text(n).includes('展开「条件与核对」'));
  for (const [state, label] of [['unconfirmed', '试算值，未确认'], ['needs_review', '条件已变，请确认'], ['confirmed', '已核对']]) {
    const read = readOf(sources.generation, state); read.value.values.real_return_before_hundredths = 175;
    const r = show(read), row = assumptionsArticle(r);
    const disclosure = r.nodes().find(n => n.type === 'details' && r.text(n).includes('条件与核对'));
    assert.ok(disclosure); assert.ok(!disclosure.props.open);
    assert.ok(r.text(disclosure).includes(label));
    const hint = outsideHint(r);
    if (state === 'confirmed') assert.equal(hint, undefined);
    else {
      assert.equal(r.text(hint), `${label}；展开「条件与核对」可查看与确认。`);
      assert.equal(hint.props.className, 'muted small');
      assert.doesNotMatch(r.text(disclosure), /展开「条件与核对」/, 'the hint remains visible while details are closed');
    }
    assert.match(r.text(row), /1.75%/);
    assert.doesNotMatch(r.text(row), /默认值/);
    assert.equal(r.nodes().find(n => n.props?.className === 'goal-next'), undefined, 'confirmation metadata does not create a first-screen task');
    const edit = r.find('button', p => p['aria-label'] === '调整计算假设');
    assert.ok(edit);
    const from = { tag: state };
    edit.props.onClick({ currentTarget: from });
    assert.deepEqual(edits.at(-1), ['assumptions', from]);
  }
  for (const read of [undefined, null, { status: 'disabled', message: '虚构：规划模块关闭' }, { status: 'error', code: 'READ_ERROR', message: '虚构读取失败' }]) {
    assert.equal(outsideHint(show(read)), undefined, 'unavailable confirmation does not invent an assumption status');
  }
  const loading = show(null);
  assert.match(loading.text(assumptionsArticle(loading)), /读取中/);
  const failed = show({ status: 'error', code: 'READ_ERROR', message: '虚构读取失败' });
  const alert = failed.nodes().find(n => n.props?.role === 'alert');
  assert.match(failed.text(alert), /虚构读取失败/);
  assert.ok(failed.button('重新读取试算假设'));
});


test('a real required card outranks the assumption review, and the read error keeps a retry entry', () => {
  const { sources, saved, caps } = render();
  const card = { id: 'costs', title: '核对有没有重复费用', benefit: '虚构费用待核对', duration: '约 1 分钟', action: 'costs', required: true };
  const refined = [];
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [card], onEdit() {}, onRefine: (c, from) => refined.push([c.id, from]), onDetail() {}, realSummary: true, assumptionRead: readOf(sources.generation, 'unconfirmed') });
  assert.ok(r.button('核对有没有重复费用'));
  assert.equal(r.button('核对计算假设'), undefined);
  const from = { tag: 'card' };
  r.button('核对有没有重复费用').props.onClick({ currentTarget: from });
  assert.deepEqual(refined, [['costs', from]]);
  const retried = [];
  const failed = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [card], onEdit() {}, onRefine: (c, from) => retried.push([c.action, from]), onDetail() {}, realSummary: true, assumptionRead: { status: 'error', code: 'READ_ERROR', message: '虚构读取失败' } });
  const retryFrom = { tag: 'retry' };
  failed.button('重新读取试算假设').props.onClick({ currentTarget: retryFrom });
  assert.deepEqual(retried, [['reload', retryFrom]]);
});

test('an explicitly excluded debt stays a caution without a nag action', () => {
  const { sources, saved, caps } = render();
  const callbacks = from => null;
  const before = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, onAnnotation: callbacks, realSummary: true, assumptionRead: readOf(sources.generation, 'confirmed') });
  const countBefore = before.nodes().filter(n => n.type === 'button' && before.text(n) === '去核对').length;
  caps.annotations = [...(caps.annotations ?? []), { id: 'debt:虚构:excluded', reason_code: 'DEBT_EXCLUDED', message: '你选择了虚构房贷先不考虑，还款未计入。', effect: 'requirement_lower', treatment: 'omitted', actionable: false, source_ids: ['虚构账户'], missing_fields: [], refinement: { owner: 'basic', field: 'core.debt_repayments' } }];
  const after = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, onAnnotation: callbacks, realSummary: true, assumptionRead: readOf(sources.generation, 'confirmed') });
  assert.match(after.text(goalArticle(after)), /先不考虑/);
  const excluded = after.nodes().find(n => n.type === 'li' && after.text(n).includes('先不考虑'));
  assert.ok(excluded);
  assert.ok(!after.text(excluded).includes('去核对'), 'an explicitly excluded item keeps its caution but offers no nag');
  const countAfter = after.nodes().filter(n => n.type === 'button' && after.text(n) === '去核对').length;
  assert.equal(countAfter, countBefore);
});

test('a saving hint sits under the monthly saving row, offers the review and a dismissal, and never edits the plan', () => {
  const sources = fixture(), saved = sources.profile.value.saved, caps = buildBasicCapabilities(sources);
  const clicks = [];
  const hint = { count: 5, historical_cents: '350000', entered_cents: '500000', direction: 'lower', window_from: '2025-11-01', latest_date: '2026-10-13' };
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() { clicks.push('edit'); }, onRefine() {}, onDetail() {}, savingHint: { hint, onReview: () => clicks.push('review'), onDismiss: () => clicks.push('dismiss') }, assumptionRead: readOf(sources.generation, 'confirmed') });
  const row = r.nodes().find(n => n.props?.['data-condition'] === 'saving');
  const text = r.text(row);
  assert.match(text, /近 5 个盘点区间（2025-11 起）/);
  assert.match(text, /每月存下约 ¥3,500（低于你填的 ¥500000）/); // the harness prints entered cents raw
  assert.match(text, /只看现金、存款和负债，是估计，不会自动改你的数字/);
  r.button('去财务复盘查看依据').props.onClick();
  r.button('先不提醒').props.onClick();
  assert.deepEqual(clicks, ['review', 'dismiss']);
  const other = r.nodes().find(n => n.props?.['data-condition'] === 'spend');
  assert.doesNotMatch(r.text(other), /去财务复盘/);
  const quiet = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, assumptionRead: readOf(sources.generation, 'confirmed') });
  assert.equal(quiet.button('去财务复盘查看依据'), undefined);
});


test('goal cautions keep all three impact directions visible while their actionable detail remains available', () => {
  const { sources, saved, caps } = render();
  const base = { reason_code: 'PAYMENT_PENDING', treatment: 'omitted', missing_fields: ['付款金额'], refinement: { owner: 'events', field: 'core.occurrences' } };
  caps.annotations = ['requirement_lower', 'requirement_higher', 'uncertain'].map((effect, i) => ({ ...base, id: `fictional-${i}`, message: `虚构安排 ${i}未计入`, effect, source_ids: [`source-${i}`] }));
  const r = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onAnnotation() {}, realSummary: true });
  const summaries = r.nodes().filter(n => n.props?.className === 'coverage-summary');
  assert.equal(summaries.length, 3);
  assert.match(r.text(summaries), /可能偏低/); assert.match(r.text(summaries), /可能偏高/); assert.match(r.text(summaries), /方向尚不确定/);
  assert.ok(summaries.every(n => /1 项安排未计入/.test(r.text(n))));
  const details = r.nodes().find(n => n.type === 'details' && r.text(n).includes('查看未计入的安排与需确认的条件'));
  assert.ok(details); assert.ok(!details.props.open);
  assert.equal(r.nodes().filter(n => n.type === 'li' && /虚构安排/.test(r.text(n))).length, 3);
  assert.match(r.text(details), /还差：付款金额/);
  assert.equal(r.nodes().filter(n => n.type === 'button' && r.text(n) === '去核对').length, 3);
});
