import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as choice from '../src/start-choice.ts';

const noop = () => {};
const summaryTitle = '过去每月家底变化（含投资涨跌）';
const source = review => ({
  review, incomes: { status: 'ready', value: [] },
  profile: { status: 'ready', value: { generation: 'fictional', saved: null } },
  snapshot: { status: 'ready', value: null }, snapshotId: null, snapshotDate: null,
});
function summary(review, onReload = noop) {
  return runtime('ReviewPlanSummary', { data: review === null ? null : source(review), today: '2026-10-19', onReload, onNavigate: noop, onGotoPlanning: noop }, undefined, undefined, { components: [] });
}
const shown = r => r.text(r.nodes()[0]);
const historical = r => r.find('details', (_, node) => r.text(node).includes(summaryTitle));
const stats = value => ({ mean_monthly_change_cents: value, count: 0, window_from: null, latest_date: null });

test('a deliberately disabled income review hides the historical reference without manufacturing a read error', () => {
  const r = summary({ status: 'error', value: { code: 'MODULE_DISABLED', message: '模块已关闭，本次未读取' } });
  assert.equal(historical(r), undefined);
  assert.doesNotMatch(shown(r), /历史资产参考暂时无法读取|模块已关闭|每月平均变化/);
  assert.match(shown(r), /先设置退休目标/);
  assert.ok(r.button('设置退休计划 →'));
});

test('a real history read failure remains expanded and exposes a working reload action', () => {
  let reloads = 0;
  const r = summary({ status: 'error', value: { code: 'READ_FAILED', message: '虚构读取失败' } }, () => reloads++);
  assert.equal(historical(r).props.open, true);
  assert.match(shown(r), /历史资产参考暂时无法读取/);
  assert.ok(r.find('div', p => p.role === 'alert'));
  r.button('重新读取历史资产参考').props.onClick();
  assert.equal(reloads, 1);
});

test('missing history, explicit zero and loading retain their distinct presentations', () => {
  const unknown = summary({ status: 'ready', value: { intervals: [], stats: stats(null) } });
  assert.ok(historical(unknown));
  assert.equal(historical(unknown).props.open, undefined);
  assert.match(shown(unknown), /待补充 · 还没有完整盘点/);
  assert.doesNotMatch(shown(unknown), /历史资产参考暂时无法读取/);
  const zero = summary({ status: 'ready', value: { intervals: [], stats: stats('0') } });
  assert.match(shown(zero), /¥0／月/);
  assert.doesNotMatch(shown(zero), /待补充/);
  const loading = summary(null);
  assert.ok(historical(loading));
  assert.match(shown(loading), /正在读取/);
  assert.doesNotMatch(shown(loading), /历史资产参考暂时无法读取/);
});

function choices(settings) {
  const applied = [], skipped = [];
  const r = runtime('StartChoice', { ready: true, settings, onApply: async value => applied.push(structuredClone(value)), onSkip: () => skipped.push(true), onReload: noop }, undefined, undefined, { components: [], modules: { './start-choice': choice } });
  const set = (index, checked) => { r.nodes().filter(n => n.type === 'input')[index].props.onChange({ target: { checked } }); r.render(); };
  return { r, set, applied, skipped };
}
for (const settings of [true]) {
  test(`${settings ? 'settings' : 'first-use'} purpose choices explain only the affected reminders before applying`, async () => {
    const { r, set, applied, skipped } = choices(settings);
    assert.doesNotMatch(shown(r), /提醒/);
    set(2, false);
    assert.doesNotMatch(shown(r), /提醒/);
    set(1, false);
    assert.match(shown(r), /心愿提醒也会暂停/);
    assert.match(shown(r), /保障提醒不受影响/);
    assert.doesNotMatch(shown(r), /订阅续期提醒|盘点提醒/);
    assert.equal(applied.length, 0);
    set(1, true);
    set(0, false);
    assert.match(shown(r), /订阅续期提醒和盘点提醒也会暂停/);
    assert.doesNotMatch(shown(r), /心愿提醒/);
    assert.match(shown(r), /重新开启后按原设置安排提醒/);
    set(1, false);
    assert.match(shown(r), /心愿提醒也会暂停/);
    assert.match(shown(r), /订阅续期提醒和盘点提醒也会暂停/);
    set(2, true);
    r.button(settings ? '保存选择' : '开始使用').props.onClick();
    await r.settle();
    assert.deepEqual(applied, [{ money: false, physical: false, planning: true }]);
    r.button(settings ? '取消' : '跳过，直接使用').props.onClick();
    assert.equal(skipped.length, 1);
    set(0, true); set(1, true);
    assert.doesNotMatch(shown(r), /提醒/);
  });
}
