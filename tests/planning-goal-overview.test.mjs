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
 const failed=runtime('planning-goal/Overview',{saved:knownSaved,caps:knownCaps,today:known.today,cards:[],onEdit(){},onRefine(){},onDetail(){},assumptionRead:readOf(known.generation,'confirmed')});
 assert.match(failed.text(failed.nodes().find(n=>n.props?.['aria-label']==='预测结果')),/尚未满足完整目标/);
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

test('the report entry lives beside the chart entry and honors the disabled gate', () => {
  const { sources, saved, caps } = render();
  const calls = [];
  const blocked = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, onReport: from => calls.push(from), reportDisabled: true, realSummary: true });
  const blockedButton = blocked.button('查看当前报告');
  assert.ok(blockedButton);
  assert.equal(blockedButton.props.disabled, true);
  assert.ok(blocked.button('查看计算详情与图表'), 'the report entry is并列 with the chart entry');
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
  assert.match(text, /全程结论/);
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

test('the next step follows the real assumption read state and never fakes confirmation', () => {
  const { sources, saved, caps } = render();
  const articleOf = r => r.text(assumptionsArticle(r));
  const unconfirmed = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, assumptionRead: readOf(sources.generation, 'unconfirmed') });
  assert.ok(unconfirmed.button('核对计算假设'), 'unconfirmed suggests review');
  assert.match(articleOf(unconfirmed), /未核对/);
  const needsReview = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, assumptionRead: readOf(sources.generation, 'needs_review') });
  assert.ok(needsReview.button('核对计算假设'), 'needs_review suggests review');
  assert.match(articleOf(needsReview), /待核对/);
  const confirmed = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, assumptionRead: readOf(sources.generation, 'confirmed') });
  assert.equal(confirmed.button('核对计算假设'), undefined, 'confirmed hides the suggestion');
  assert.equal(confirmed.nodes().find(n => n.type === 'p' && n.props?.className === 'eyebrow' && confirmed.text(n) === '建议下一步'), undefined);
  assert.match(articleOf(confirmed), /已核对/);
  const loading = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {}, realSummary: true, assumptionRead: null });
  const loadingButton = loading.button('正在读取试算假设');
  assert.ok(loadingButton);
  assert.equal(loadingButton.props.disabled, true);
  assert.match(articleOf(loading), /读取中/);
  const failed = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine: () => {}, onDetail() {}, realSummary: true, assumptionRead: { status: 'error', code: 'READ_ERROR', message: '虚构读取失败' } });
  assert.ok(failed.button('重新读取试算假设'));
  assert.match(articleOf(failed), /读取失败/);
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
  const failed = runtime('planning-goal/Overview', { saved, caps, today: sources.today, cards: [], onEdit() {}, onRefine: (c, from) => retried.push([c.action, from]), onDetail() {}, realSummary: true, assumptionRead: { status: 'error', code: 'READ_ERROR', message: '虚构读取失败' } });
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
