import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import { fixture } from './planning-ui-fixture.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
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
test('condition and next-step assumption actions open the shared four-value editor', () => {
  for (const entry of ['condition', 'next']) {
    const sources = fixture(), p = sources.profile.value.saved.profile;
    p.retire.simplified.time.target_month = '2050-06';
    p.retire.simplified.income_mode = 'excluded';
    p.retire.spend_cents = '500000';
    p.retire.basic.contribution.monthly_cents = '200000';
    const caps = buildBasicCapabilities(sources);
    caps.funds = { status: 'ready', value: { available_cents: '1000000', restricted_cents: '0', date: '2026-10-12' } };
    const port = {}, r = runtime('PlanningBasicGoals', { sources, assumptionsPort: port }, undefined, caps, {
      modules: { './planning-first-run': { ...firstRun, refinementCards: () => [] } },
    });
    const button = entry === 'condition'
      ? r.find('button', p => p['aria-label'] === '调整计算假设')
      : r.nodes().find(n => n.type === 'button' && !n.props['aria-label'] && r.text(n) === '调整计算假设');
    assert.ok(button, entry);
    button.props.onClick({ currentTarget: { isConnected: true, focus() {} } }); r.render();
    const shared = r.find('AssumptionsSummary');
    assert.equal(shared.props.open, true);
    assert.equal(shared.props.port, port);
    assert.equal(r.find('GoalEditor'), undefined);
    shared.props.onOpenChange(false); r.render();
    assert.equal(r.find('AssumptionsSummary').props.open, false);
    assert.equal(r.calls.length, 0);
  }
});
