import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import { fixture } from './planning-ui-fixture.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { refinementCards } from '../src/planning-first-run.ts';
import { eventsInput } from '../src/planning-basic-forms.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';

test('a complete future purchase toggles directly into the calculation without creating occurrence facts', async () => {
  const sources = fixture(), retire = sources.profile.value.saved.profile.retire;
  const car = { id: 'fictional-toggle', label: '虚构未来购车', kind: 'car', date: '2028-10', included: false, price_cents: '7000000', down_cents: '7000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1, holding_cents: '120000', rent_saved_cents: '0', cycle_years: null, until_month: null, time_unconfirmed: false, resale_cents: '0' };
  retire.life_events.push(car);
  const before = structuredClone(retire.core.occurrences), writes = [];
  const store = { retire, ready: null, snapshot: sources.snapshot.value, accounts: sources.accounts.value, busy: false, stuck: false, notice: '', blocked: '', write: async (events, core) => { writes.push(eventsInput({ life_events: events, occurrences: core.occurrences })); return true; } };
  const r = runtime('PlanningEvents', { store, today: sources.today });
  r.find('Switch', p => p.label === '计入虚构未来购车').props.onChange(true); await r.settle();
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].fields.occurrences, before);
  assert.equal(r.find('dialog'), undefined);
  const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, writes));
  assert.equal(caps.requirement.status, 'ready');
  assert.ok(!caps.annotations.some(a => a.refinement.event_id === car.id && ['PAYMENT_PENDING', 'LOAN_PENDING', 'EVENT_OVERDUE'].includes(a.reason_code)));
});

test('using the plan horizon resolves only the selected endpoint and leaves actual facts intact', async () => {
  const sources = fixture(), retire = sources.profile.value.saved.profile.retire;
  const car = { id: 'fictional-horizon', label: '虚构终点购车', kind: 'car', date: '2028-10', included: true, price_cents: '7000000', down_cents: '7000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1, holding_cents: '120000', rent_saved_cents: '0', cycle_years: 8, until_month: null, time_unconfirmed: true, resale_cents: '0' };
  retire.life_events.push(car);
  const original = structuredClone(retire), writes = [];
  const store = { retire, ready: null, busy: false, stuck: false, notice: '', blocked: '', write: async (events, core) => { writes.push({ events, core }); return true; } };
  const r = runtime('PlanningEvents', { store, today: sources.today });
  r.button('虚构终点购车按规划终点计算').props.onClick(); await r.settle();
  assert.equal(writes.length, 1);
  assert.deepEqual(structuredClone(writes[0].events.at(-1)), { ...car, time_unconfirmed: false, until_month: null });
  assert.deepEqual(structuredClone(writes[0].core), original.core); assert.deepEqual(retire, original);
  const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, [eventsInput({ life_events: writes[0].events, occurrences: writes[0].core.occurrences })]));
  assert.equal(caps.requirement.status, 'ready');
  assert.ok(!caps.annotations.some(a => a.reason_code === 'TIME_PENDING' && a.refinement.event_id === car.id));
});
test('a car endpoint warning locates its own plan editor rather than opening occurrence review', () => {
  const sources = fixture(), saved = sources.profile.value.saved;
  const car = { id: 'fictional-car', label: '虚构二手车', kind: 'car', date: '2028-10', included: true, price_cents: '7000000', down_cents: '7000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1, holding_cents: '120000', rent_saved_cents: '0', cycle_years: 8, until_month: null, time_unconfirmed: true, resale_cents: '0' };
  saved.profile.retire.life_events.push(car);
  const caps = buildBasicCapabilities(sources), focused = [];
  const card = refinementCards(saved, caps, sources.today).find(c => c.event?.id === car.id);
  assert.equal(card.action, 'events');
  const r = runtime('PlanningBasicGoals', { sources }, undefined, caps, { document: { getElementById: id => ({ closest() { return null; }, scrollIntoView() {}, focus: () => focused.push(id) }) } });
  r.button('查看计划：虚构二手车').props.onClick({ currentTarget: {} });
  r.render();
  assert.deepEqual(focused, ['plan-event-edit-fictional-car']);
  assert.equal(r.find('dialog'), undefined);
  assert.equal(r.calls.length, 0);
});
test('goal loan editor retains input on save failure and locks replay when the result is unknown', async () => {
  const sources=fixture();
  for (const outcome of ['failed','unknown']) {
    let r;
    r=runtime('PlanningBasicGoals',{sources},async()=>{
      if(outcome==='unknown'){r.saver.stuck=true;return null;}
      throw Error('虚构保存失败');
    },buildBasicCapabilities(sources));
    r.button('贷款还款安排').props.onClick({currentTarget:{isConnected:true,focus(){}}});r.render();
    const option=r.nodes().find(n=>n.type==='input'&&n.props['aria-label']?.endsWith('：这次先不考虑'));
    assert.ok(option);const label=option.props['aria-label'];option.props.onChange();r.render();
    r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
    assert.equal(r.calls.length,1);assert.ok(r.find('dialog'));
    assert.equal(r.find('input',p=>p['aria-label']===label).props.checked,true);
    if(outcome==='failed')assert.match(r.text(r.find('dialog')),/虚构保存失败/);
    else {
      assert.equal(r.button('保存，查看结果').props.disabled,true);
      assert.equal(r.button('取消').props.disabled,false);
      r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
      assert.equal(r.calls.length,1);
    }
  }
});

import * as firstRun from '../src/planning-first-run.ts';
test('the disclosed condition action opens the shared four-value editor', () => {
  const sources = fixture(), p = sources.profile.value.saved.profile;
  p.retire.simplified.time.target_month = '2050-06';
  p.retire.simplified.income_mode = 'excluded';
  p.retire.spend_cents = '500000';
  p.retire.basic.contribution.monthly_cents = '200000';
  const caps = buildBasicCapabilities(sources);
  caps.funds = { status: 'ready', value: { available_cents: '1000000', restricted_cents: '0', date: '2026-10-12' } };
  const port = {};
  // The shared runtime does not load the follow-up UI; supply the actual unconfirmed state.
  const read = { status: 'ready', value: { generation: sources.generation, revision: null, values: { real_return_before_hundredths: 0, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 }, confirmation: 'unconfirmed', confirmed_values: null } };
  const StubSummary = props => { props.onReadChange?.(read); return { type: 'AssumptionsSummary', props, key: null }; };
  const r = runtime('PlanningBasicGoals', { sources, assumptionsPort: port }, undefined, caps, {
    modules: { './planning-first-run': { ...firstRun, refinementCards: () => [] }, './planning-followup-ui/AssumptionsSummary': { AssumptionsSummary: StubSummary } },
  });
  const button = r.find('button', p => p['aria-label'] === '调整计算假设');
  assert.ok(button);
  button.props.onClick({ currentTarget: { isConnected: true, focus() {} } }); r.render();
  const shared = r.find('AssumptionsSummary');
  assert.equal(shared.props.open, true);
  assert.equal(shared.props.port, port);
  assert.equal(r.find('GoalEditor'), undefined);
  shared.props.onOpenChange(false); r.render();
  assert.equal(r.find('AssumptionsSummary').props.open, false);
  assert.equal(r.calls.length, 0);
});
