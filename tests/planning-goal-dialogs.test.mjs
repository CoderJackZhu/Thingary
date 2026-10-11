import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtime } from './planning-component-runtime.mjs';
import { pensionFixture } from '../src/planning-pension-fixture.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
const fixture = () => pensionFixture(raw, 'normal');
const dialogs = ['ProfileDialog', 'PlanningPensionRefinementDialog', 'PlanningDebtDialog', 'FundsDialog', 'CostsDialog', 'PlanningOccurrenceDialog'];
const opened = r => r.nodes().filter(n => dialogs.includes(n.type));
function goals(options = {}) {
  const sources = fixture(), edits = [], setup = [];
  const r = runtime('PlanningBasicGoals', { sources, onEditingChange: v => edits.push(v), openSetup: (...args) => setup.push(args) }, undefined, buildBasicCapabilities(sources), { components: [], ...options });
  const action = (card, from) => { r.find('PlanningRefinements').props.onAction(card, from); r.render(); };
  return { r, edits, setup, action };
}

test('goal card dialogs are exclusive; each close restores its own trigger and clears completion options', () => {
  const { r, edits, action } = goals();
  const cases = [
    [{ id:'medical', action:'pension' }, 'ProfileDialog'],
    [{ id:'transfer', action:'pension' }, 'PlanningPensionRefinementDialog'],
    [{ id:'income-switch', action:'pension' }, 'PlanningPensionRefinementDialog'],
    [{ id:'debt-review', action:'debts' }, 'PlanningDebtDialog'],
    [{ id:'funds', action:'funds' }, 'FundsDialog'],
    [{ id:'costs', action:'costs' }, 'CostsDialog'],
    [{ id:'event', action:'event', event:{ id:'fictional-event' } }, 'PlanningOccurrenceDialog'],
  ];
  for (const [card, name] of cases) {
    let focused = 0;
    action(card, { isConnected:true, focus(){ focused++; } });
    assert.equal(opened(r).length, 1); assert.equal(opened(r)[0].type, name);
    assert.equal(edits.at(-1), true);
    if(name === 'PlanningPensionRefinementDialog') {
      assert.equal(opened(r)[0].props.reviewContributions, card.id === 'transfer');
      assert.equal(opened(r)[0].props.switchIncome, card.id === 'income-switch');
    }
    opened(r)[0].props.onClose(); r.render();
    assert.equal(opened(r).length, 0); assert.equal(focused, 1); assert.equal(edits.at(-1), false);
  }
  // An ordinary owner entry after completing a card must not inherit its flags.
  r.find('RunwayCard').props.onOwner('pension'); r.render();
  assert.equal(opened(r)[0].props.completion, false);
  assert.equal(opened(r)[0].props.reviewContributions, false);
  assert.equal(opened(r)[0].props.switchIncome, false);
  r.unmount(); assert.equal(edits.at(-1), false); assert.equal(r.calls.length, 0);
});

test('annotation and owner entries share dialog routing; missing trigger falls back and navigation opens no dialog', () => {
  let focus = 0;
  const { r, action, setup } = goals({ document: { activeElement:{isConnected:true,focus(){focus++;}} } });
  for (const [owner, field, type] of [['pension','medical_paid_months','ProfileDialog'],['pension','basic.pension_contributions','PlanningPensionRefinementDialog'],['basic','core.debt_repayments','PlanningDebtDialog'],['basic','basic.retirement_costs','CostsDialog']]) {
    r.find('CoverageNote').props.onRefine({ refinement:{owner,field} }); r.render();
    assert.equal(opened(r).length, 1); assert.equal(opened(r)[0].type,type);
    opened(r)[0].props.onClose(); r.render();
  }
  assert.equal(focus,4);
  action({id:'funds',action:'funds'}, {isConnected:false,focus(){throw Error('detached trigger');}});
  opened(r)[0].props.onClose(); r.render(); assert.ok(r.focuses.includes('plan-budget-entry'));
  action({id:'contribution',action:'contribution'}, null);
  assert.equal(opened(r).length,0); assert.equal(setup.at(-1)[0],4);
});

test('cancel and reopen use a fresh pension draft, keep one modal and send no save', () => {
  const sources=fixture(),r=runtime('PlanningBasicGoals',{sources},undefined,buildBasicCapabilities(sources));
  const open=()=>{r.button('修改计入方式').props.onClick({currentTarget:{isConnected:true,focus(){}}});r.render();};
  open();
  r.find('input',p=>p['aria-label']==='职工养老金估算').props.onChange();r.render();
  r.button('关闭国家养老金精修').props.onClick();r.render();
  assert.equal(r.find('dialog'),undefined);
  open();assert.equal(r.nodes().filter(n=>n.type==='dialog').length,1);
  assert.equal(r.find('input',p=>p['aria-label']==='先不算（推荐先这样）').props.checked,true);
  r.find('dialog').props.onCancel({preventDefault(){}});r.render();
  assert.equal(r.find('dialog'),undefined);assert.equal(r.calls.length,0);
});

test('goal loan editor retains input on save failure and locks replay when the result is unknown', async () => {
  const sources=fixture();
  for (const outcome of ['failed','unknown']) {
    let r;
    r=runtime('PlanningBasicGoals',{sources},async()=>{
      if(outcome==='unknown'){r.saver.stuck=true;return null;}
      throw Error('虚构保存失败');
    },buildBasicCapabilities(sources));
    r.button('查看或修改贷款还款安排').props.onClick({currentTarget:{isConnected:true,focus(){}}});r.render();
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
