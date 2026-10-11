import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtime } from './pension-runtime.mjs';
import { pensionFixture } from '../src/planning-pension-fixture.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
const savedOf = s => s.profile.value.saved;
const capsOf = s => buildBasicCapabilities(s);
const event = () => ({ preventDefault() {} });
const dialogOf = (r, heading) => r.find('dialog', p => p['aria-labelledby'] === heading);

test('详情页缺养老金资料：两个入口都在原地打开共用精修窗口，不再跳转养老金页', () => {
  const s = pensionFixture(raw, 'unknown');
  const navigated = [];
  const r = runtime('PlanningBasicDetail', { sources: s, saved: savedOf(s), onGoto: t => navigated.push(t), openSetup() {}, onEvents() {}, onBack() {} }, undefined, () => capsOf(s));
  // 侧栏「退休收入」卡：填写养老金事实
  const entry = r.button('填写养老金事实');
  assert.ok(entry, '侧栏入口存在');
  let refocused = false;
  entry.props.onClick({ currentTarget: { isConnected: true, focus() { refocused = true; } } });
  r.render();
  assert.deepEqual(navigated, [], '不得调用 onGoto(pension)');
  assert.ok(dialogOf(r, 'pension-refinement-heading'), '原地渲染精修窗口');
  r.button('取消').props.onClick();
  r.render();
  assert.equal(dialogOf(r, 'pension-refinement-heading'), undefined, '取消后窗口关闭');
  assert.equal(refocused, true, '关闭后焦点回到触发按钮');
  // 缺项清单按钮（owner=pension）同样原地打开
  const card = r.find('RequirementCard');
  assert.ok(card, '需求卡渲染缺项清单');
  card.props.onOwner('pension');
  r.render();
  assert.deepEqual(navigated, []);
  assert.ok(dialogOf(r, 'pension-refinement-heading'));
});

test('养老金页公积金提示：文案不再指向目标页，按钮原地打开资金核对，保存写入 funds 节后按新资料重算', async () => {
  const s = pensionFixture(raw, 'transfer');
  const r = runtime('PlanningPension', { sources: s });
  const body = r.text(r.render());
  assert.doesNotMatch(body, /目标页核对资金/, '旧文案已移除');
  assert.match(body, /未来公积金每月缴存还没确认，这里只按已有余额估算。/);
  const button = r.button('确认公积金缴存');
  assert.ok(button, '提示旁有入口按钮');
  button.props.onClick();
  r.render();
  assert.ok(dialogOf(r, 'funds-heading'), '原地打开资金核对窗口');
  const hpf = r.find('CentInput', p => p.label === '未来公积金月缴存');
  assert.ok(hpf, '窗口里直接是缺的那一项');
  hpf.props.onChange('400000');
  r.render();
  r.nodes().filter(n => n.type === 'form').at(-1).props.onSubmit(event());
  await r.settle();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].section, 'funds');
  assert.equal(r.calls[0].fields.hpf_monthly_cents, '400000');
  assert.equal(dialogOf(r, 'funds-heading'), undefined, '保存后窗口关闭');
  // 保存（重读）后按新资料重算：缴存已知，提示与按钮都不再出现
  const next = overlayPlanningDrafts(s, [r.calls[0]]);
  const after = runtime('PlanningPension', { sources: next });
  const text = after.text(after.render());
  assert.doesNotMatch(text, /还没确认/);
  assert.equal(after.button('确认公积金缴存'), undefined);
});
