import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtime } from './planning-component-runtime.mjs';
import { fixture } from './planning-ui-fixture.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { householdLines, isSplitCouple, stopAgeFromText, switchHousehold } from '../src/planning-simplified-ui/household-view.ts';
import { annotationSummary } from '../src/plan-annotations.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
const sources = (household) => { const s = structuredClone(raw); if (household) s.profile.value.saved.profile.retire.simplified.household = household; return s; };
const couple = (stop_age_months, monthly_cents, birth_month = '1990-03') => ({ mode: 'couple', partner: { birth_month, stop_age_months, monthly_cents } });
const click = (r, name) => { r.button(name).props.onClick(); r.render(); };
const enter = (r, type, label, value) => { r.find(type, p => p.label === label || p['aria-label'] === label).props.onChange(type === 'input' ? { target: { value } } : value); r.render(); };
const pick = (r, group, label) => { r.find('Segments', p => p.label === group).props.onChange(label); r.render(); };
const save = async r => { const early = r.button('先保存，稍后继续'); if (early) early.props.onClick(); else r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle(); };
const shown = r => r.text(r.nodes()[0]);
const row = (r, label) => r.find('FormRow', p => p.label === label);
const has = (r, type, label) => !!r.find(type, p => p.label === label || p['aria-label'] === label);

test('the switch is shown for one person and adds no partner fields', () => {
  const r = runtime('PlanningSetup', { sources: sources() });
  assert.equal(r.find('Segments', p => p.label === '规划给谁').props.value, 'single');
  assert.equal(has(r, 'MonthInput', '伴侣出生年月'), false);
  assert.equal(r.find('Segments', p => p.label === '伴侣停工时间'), undefined);
});

test('two people shows partner birth month and stop choice; the age box only for 指定年龄', () => {
  const r = runtime('PlanningSetup', { sources: sources() });
  pick(r, '规划给谁', 'couple');
  assert.equal(r.find('MonthInput', p => p.label === '伴侣出生年月').props.max, r.props.today.slice(0, 7));
  assert.equal(r.find('Segments', p => p.label === '伴侣停工时间').props.value, 'same');
  assert.equal(has(r, 'input', '伴侣停工年龄（岁）'), false);
  pick(r, '伴侣停工时间', 'age');
  assert.ok(has(r, 'input', '伴侣停工年龄（岁）'));
  pick(r, '伴侣停工时间', 'same');
  assert.equal(has(r, 'input', '伴侣停工年龄（岁）'), false);
});

test('partner share exists only on the saving step and only with an age', () => {
  const same = runtime('PlanningSetup', { sources: sources(couple(null, null)), initialStep: 4 });
  assert.equal(has(same, 'CentInput', '其中伴侣每月存多少'), false);
  const aged = runtime('PlanningSetup', { sources: sources(couple(720, null)), initialStep: 4 });
  assert.ok(has(aged, 'CentInput', '其中伴侣每月存多少'));
  assert.equal(row(aged, '其中伴侣每月存多少').props.hint, '已包含在两人每月一共能存的金额里，不是另外加的；不确定可以先空着。');
  const single = runtime('PlanningSetup', { sources: sources(), initialStep: 4 });
  assert.equal(has(single, 'CentInput', '其中伴侣每月存多少'), false);
});

test('household totals read as totals only for two people', () => {
  const labels = (household, initialStep) => { const r = runtime('PlanningSetup', { sources: sources(household), initialStep }); return r.nodes().filter(n => n.type === 'FormRow').map(n => n.props.label + '|' + (n.props.hint ?? '')).join('\n'); };
  assert.match(labels(couple(null, null), 1), /两人每月生活费总额/);
  const saving = labels(couple(null, null), 4);
  assert.match(saving, /两人每月一共能存多少钱？/);
  assert.match(saving, /两个人加起来，每月到账减去全部开销后剩下的钱/);
  assert.doesNotMatch(labels(undefined, 1), /两人/);
  assert.doesNotMatch(labels(undefined, 4), /两人|两个人/);
  assert.match(labels(undefined, 4), /^每月大约能存下多少钱？\|每月到账减去全部开销后剩下的钱/);
});

test('household payload: age, share and switching back', async () => {
  const r = runtime('PlanningSetup', { sources: sources(couple(null, null)), initialStep: 4 });
  // age first (step 0), then the share on the saving step
  r.button('1. 目标与时间').props.onClick(); r.render();
  pick(r, '伴侣停工时间', 'age'); enter(r, 'input', '伴侣停工年龄（岁）', '60');
  r.button('5. 每月净投入').props.onClick(); r.render();
  enter(r, 'CentInput', '其中伴侣每月存多少', '30000');
  await save(r);
  assert.deepEqual(r.calls.at(-1).fields.simplified.household, couple(720, '30000'));
  // back to one person: no stale partner data
  const back = runtime('PlanningSetup', { sources: sources(couple(720, '30000')) });
  pick(back, '规划给谁', 'single');
  assert.equal(has(back, 'MonthInput', '伴侣出生年月'), false);
  await save(back);
  assert.deepEqual(back.calls.at(-1).fields.simplified.household, { mode: 'single', partner: null });
  assert.deepEqual(switchHousehold(couple(720, '30000'), 'single'), { mode: 'single', partner: null });
});

test('same-time partner saves no age and no share', async () => {
  const r = runtime('PlanningSetup', { sources: sources(couple(720, '30000')) });
  pick(r, '伴侣停工时间', 'same');
  await save(r);
  assert.deepEqual(r.calls.at(-1).fields.simplified.household, couple(null, null));
});

test('missing birth month or a bad age blocks the save and shows the issue on the field', async () => {
  const r = runtime('PlanningSetup', { sources: sources(), initialStep: 4 });
  r.button('1. 目标与时间').props.onClick(); r.render();
  pick(r, '规划给谁', 'couple');
  await save(r);
  assert.equal(r.calls.length, 0);
  assert.match(shown(r), /请填写有效的伴侣出生年月/);
  enter(r, 'MonthInput', '伴侣出生年月', '1990-03');
  pick(r, '伴侣停工时间', 'age'); enter(r, 'input', '伴侣停工年龄（岁）', '12');
  await save(r);
  assert.equal(r.calls.length, 0);
  assert.match(shown(r), /伴侣停工年龄请填 18 到 100 的整岁数/);
  enter(r, 'input', '伴侣停工年龄（岁）', '101');
  await save(r);
  assert.equal(r.calls.length, 0);
  enter(r, 'input', '伴侣停工年龄（岁）', '65');
  await save(r);
  assert.equal(r.calls.at(-1).fields.simplified.household.partner.stop_age_months, 780);
});

test('age text conversion keeps only whole years from 18 to 100', () => {
  assert.equal(stopAgeFromText('60'), 720);
  for (const bad of ['', '17', '101', '60.5', 'abc']) assert.equal(stopAgeFromText(bad), -1);
});

test('partner pension can be entered by the partner age; it still stores a plain month', async () => {
  const r = runtime('PlanningSetup', { sources: sources(couple(null, null, '1992-05')), initialStep: 3 });
  r.find('input', p => p['aria-label'] === '填写预计收入').props.onChange(); r.render();
  click(r, '+ 养老金');
  assert.ok(r.find('Segments', p => p.label === '按谁的年龄'));
  enter(r, 'input', '收入名称', '伴侣养老金');
  pick(r, '按谁的年龄', 'partner');
  enter(r, 'input', '开始领取年龄', '60');
  click(r, '换算成开始月份');
  assert.equal(r.find('MonthInput', p => p.label === '开始领取时间').props.value, '2052-05');
  click(r, '完成');
  await save(r);
  const income = r.calls.at(-1).fields.simplified.future_incomes.find(i => i.name === '伴侣养老金');
  assert.equal(income.start_month, '2052-05');
  assert.deepEqual(Object.keys(income).sort(), Object.keys(r.calls.at(-1).fields.simplified.future_incomes[0]).sort());
  const single = runtime('PlanningSetup', { sources: sources(), initialStep: 3 });
  single.find('input', p => p['aria-label'] === '填写预计收入').props.onChange(); single.render();
  click(single, '+ 养老金');
  assert.equal(single.find('Segments', p => p.label === '按谁的年龄'), undefined);
});

// ---- results ----
const coupleCaps = (household, mutate) => {
  const s = fixture(); const saved = s.profile.value.saved; saved.profile.retire.simplified.household = household;
  const caps = buildBasicCapabilities(s); if (mutate) mutate(caps, saved);
  return { s, saved, caps };
};
const overview = ({ s, saved, caps }) => runtime('planning-goal/Overview', { saved, caps, today: s.today, cards: [], onEdit() {}, onRefine() {}, onDetail() {} });
const answer = r => r.text(r.nodes().find(n => n.props?.['aria-label'] === '退休目标'));

test('lines: both-stop month with partner age, and earlier or later than stopping together', () => {
  const h = couple(720, '30000', '1990-03');
  assert.deepEqual(householdLines(h, { both_stop_month: '2050-06', same_time_stop_month: '2049-06' }, '2049-10'), ['两人都不上班：2050 年 6 月，那时伴侣 60 岁', '伴侣工作到 60 岁，你比两人同时停工晚 4 个月']);
  assert.deepEqual(householdLines(h, { both_stop_month: '2050-06', same_time_stop_month: '2050-02' }, '2049-10'), ['两人都不上班：2050 年 6 月，那时伴侣 60 岁', '伴侣工作到 60 岁，你能比两人同时停工早 4 个月']);
  assert.deepEqual(householdLines(h, { both_stop_month: null, same_time_stop_month: '2049-10' }, '2049-10'), []);
  assert.deepEqual(householdLines(h, { both_stop_month: null, same_time_stop_month: null }, '2049-10'), []);
  assert.deepEqual(householdLines({ mode: 'single', partner: null }, { both_stop_month: '2050-06', same_time_stop_month: null }, '2049-10'), []);
});

test('result card shows the couple lines and the household-total hint; single shows none', () => {
  const h = couple(720, '30000', '1990-03');
  const c = coupleCaps(h, caps => { caps.prediction.value.household = { partner_stop_month: '2050-03', both_stop_month: '2050-06', same_time_stop_month: '2049-01' }; });
  const text = answer(overview(c));
  assert.match(text, /两人都不上班：2050 年 6 月，那时伴侣 60 岁/);
  assert.match(text, /伴侣工作到 60 岁，你/);
  assert.match(text, /这是两人合计每月要存的钱：伴侣还在工作时，包含伴侣那一份。/);
  const single = coupleCaps({ mode: 'single', partner: null });
  assert.doesNotMatch(answer(overview(single)), /两人都不上班|伴侣工作到|两人合计/);
});

test('household annotations render as readable lines in the caution list', () => {
  const c = coupleCaps(couple(720, null, '1995-03'));
  const rows = c.caps.annotations.filter(a => a.reason_code.startsWith('HOUSEHOLD_'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason_code, 'HOUSEHOLD_SHARE_UNKNOWN');
  assert.deepEqual(annotationSummary(rows), ['伴侣的存款没有单独计算，每月需要存的钱可能变化，方向尚不确定']);
  assert.match(shown(overview(c)), /伴侣每月存多少未填，暂按两人同时停工计算。/);
});

test('split couple detection needs a known share and a partner stop after this month', () => {
  assert.equal(isSplitCouple(couple(720, '30000', '1990-03'), '2026-10-12'), true);
  assert.equal(isSplitCouple(couple(720, null), '2026-10-12'), false);
  assert.equal(isSplitCouple(couple(null, null), '2026-10-12'), false);
  assert.equal(isSplitCouple(couple(300, '30000', '1990-03'), '2026-10-12'), false);
  assert.equal(isSplitCouple({ mode: 'single', partner: null }, '2026-10-12'), false);
});

// ---- goal editors (standalone saves) ----
const submit = async r => { r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle(); };

test('time editor: switch, validation and a standalone simplified save with the household', async () => {
  const s = fixture(), saved = s.profile.value.saved;
  const r = runtime('planning-goal/Editor', { kind: 'time', sources: s, saved });
  r.find('Segments', p => p.label === '规划给谁').props.onChange('couple'); r.render();
  await submit(r);
  assert.equal(r.calls.length, 0);
  assert.match(shown(r), /请填写有效的伴侣出生年月/);
  r.find('MonthInput', p => p.label === '伴侣出生年月').props.onChange('1991-02'); r.render();
  await submit(r);
  assert.equal(r.calls[0].section, 'simplified');
  assert.deepEqual(r.calls[0].fields.household, couple(null, null, '1991-02'));
});

test('saving editor: couple totals wording, share field only with an age, one atomic setup save', async () => {
  const s = fixture(), saved = s.profile.value.saved; saved.profile.retire.simplified.household = couple(720, null);
  const r = runtime('planning-goal/Editor', { kind: 'saving', sources: s, saved });
  assert.ok(r.find('FormRow', p => p.label === '两人每月一共能存多少钱（元）'));
  r.find('CentInput', p => p.label === '其中伴侣每月存多少').props.onChange('20000'); r.render();
  await submit(r);
  assert.equal(r.calls[0].section, 'setup');
  assert.equal(r.calls[0].fields.simplified.household.partner.monthly_cents, '20000');
  assert.equal(r.calls[0].fields.budget, null); assert.equal(r.calls[0].fields.funds, null);
  const same = fixture(); same.profile.value.saved.profile.retire.simplified.household = couple(null, null);
  assert.equal(runtime('planning-goal/Editor', { kind: 'saving', sources: same, saved: same.profile.value.saved }).find('CentInput', p => p.label === '其中伴侣每月存多少'), undefined);
  const one = fixture(), solo = runtime('planning-goal/Editor', { kind: 'saving', sources: one, saved: one.profile.value.saved });
  assert.equal(solo.find('CentInput', p => p.label === '其中伴侣每月存多少'), undefined);
  await submit(solo);
  assert.equal(solo.calls[0].section, 'basic');
});
