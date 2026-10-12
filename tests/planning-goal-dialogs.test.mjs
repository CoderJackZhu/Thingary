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
