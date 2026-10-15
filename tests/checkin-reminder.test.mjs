import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as model from '../src/checkin-reminder.ts';
import * as virtual from '../src/virtual.ts';

const TODAY = '2026-10-13';
const events = [];
const windowWithListeners = () => {
  const listeners = new Map();
  return {
    dispatchEvent: e => { events.push(e.type); for (const fn of listeners.get(e.type) ?? []) fn(e); return true; },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn)),
  };
};
const globals = { Event: class { constructor(type) { this.type = type; } }, window: windowWithListeners() };
const status = (months, last = '2026-09-30', next = '2026-10-30') => ({ months, last_check_in: last, next_date: months ? next : null });

test('summary explains each state without promising delivery', () => {
  assert.equal(model.checkinReminderSummary(null, true, TODAY), '');
  assert.match(model.checkinReminderSummary(status(0), true, TODAY), /未开启/);
  assert.match(model.checkinReminderSummary(status(1), false, TODAY), /已关闭，提醒暂停/);
  assert.match(model.checkinReminderSummary(status(1, null, null), true, TODAY), /还没有完整盘点/);
  assert.match(model.checkinReminderSummary(status(1), true, TODAY), /下次提醒：2026-10-30 9:00.*一周后/);
  assert.match(model.checkinReminderSummary(status(1, '2026-08-01', '2026-09-01'), true, TODAY), /已过.*重新计时/);
  assert.deepEqual(model.checkinIntervals.map(i => i.value), ['0', '1', '2', '3']);
});

function mount(invoke, props = { wealthOn: true, today: TODAY }) {
  return runtime('CheckinReminder', props, undefined, undefined, { components: [], globals, modules: {
    './checkin-reminder': model, './virtual': virtual, './asset': { errorMessage: e => e.message },
    '@tauri-apps/api/core': { invoke },
  } });
}

test('opening the control reads the saved interval and shows the summary', async () => {
  const calls = [];
  const r = mount(async name => { calls.push(name); return status(2); });
  await r.settle();
  assert.deepEqual(calls, ['checkin_reminder_status']);
  const seg = r.find('Segments', p => p.label === '盘点提醒间隔');
  assert.equal(seg.props.value, '2');
  assert.match(r.text(r.nodes()[0]), /下次提醒：2026-10-30/);
});

test('turning it on asks for notification permission, then saves the interval', async () => {
  const calls = [];
  let saved = status(0);
  const r = mount(async (name, args) => { calls.push([name, args]); if (name === 'checkin_reminder_set') saved = status(args.months); return name === 'notification_permission' ? null : saved; });
  await r.settle();
  r.find('Segments', p => p.label === '盘点提醒间隔').props.onChange('1');
  await r.settle();
  assert.deepEqual(calls.map(c => c[0]), ['checkin_reminder_status', 'notification_permission', 'checkin_reminder_set', 'checkin_reminder_status']);
  assert.equal(calls[2][1].months, 1);
  assert.equal(r.find('Segments', p => p.label === '盘点提醒间隔').props.value, '1');
  assert.ok(events.includes('thingary-reminders-changed'), 'the notification banner re-reads its status');
});

test('the settings control re-reads when another surface changes the reminder', async () => {
  let months = 0;
  const calls = [];
  const r = mount(async name => { calls.push(name); return status(months); });
  await r.settle();
  months = 2;
  globals.window.dispatchEvent(new globals.Event('thingary-reminders-changed'));
  await r.settle();
  assert.deepEqual(calls, ['checkin_reminder_status', 'checkin_reminder_status']);
  assert.equal(r.find('Segments', p => p.label === '盘点提醒间隔').props.value, '2');
});

test('a refused permission still saves the interval and says notifications cannot be sent yet', async () => {
  const calls = [];
  const r = mount(async (name, args) => {
    calls.push(name);
    if (name === 'notification_permission') throw Error('通知权限未开启');
    return name === 'checkin_reminder_set' ? status(args.months) : status(0);
  });
  await r.settle();
  r.find('Segments', p => p.label === '盘点提醒间隔').props.onChange('3');
  await r.settle();
  assert.ok(calls.includes('checkin_reminder_set'));
  assert.match(r.text(r.nodes()[0]), /已保存，但尚不能发送系统通知：通知权限未开启/);
});

test('turning it off never asks for permission; a failed save reports and rereads', async () => {
  const calls = [];
  const r = mount(async name => { calls.push(name); if (name === 'checkin_reminder_set') throw Error('写入失败'); return status(1); });
  await r.settle();
  r.find('Segments', p => p.label === '盘点提醒间隔').props.onChange('0');
  await r.settle();
  assert.deepEqual(calls, ['checkin_reminder_status', 'checkin_reminder_set', 'checkin_reminder_status']);
  assert.match(r.text(r.nodes()[0]), /盘点提醒未保存：写入失败/);
});

test('a read failure is reported with a retry and no control is shown', async () => {
  const r = mount(async () => { throw Error('读取失败'); });
  await r.settle();
  assert.equal(r.find('Segments', p => p.label === '盘点提醒间隔'), undefined);
  assert.match(r.text(r.nodes()[0]), /盘点提醒读取失败：读取失败/);
  assert.ok(r.button('重新读取'));
});

const makeStorage = () => { const saved = new Map(); return { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }; };

function mountAsk(invoke, props = {}, storage = makeStorage()) {
  return runtime('CheckinReminderAsk', { savedComplete: true, completeCount: 1, wealthOn: true, today: TODAY, ...props }, undefined, undefined, { components: [], globals: { Event: globals.Event, window: windowWithListeners() }, modules: {
    './checkin-reminder': model, './virtual': virtual, './asset': { errorMessage: e => e.message },
    '@tauri-apps/api/core': { invoke }, './start-choice': { choiceStorage: () => storage },
  } });
}

test('the ask shows only after this library’s first complete check-in with reminders off and not yet asked', () => {
  assert.equal(model.checkinReminderAskVisible(true, 1, 0, false), true);
  for (const [label, args] of [['不完整盘点', [false, 1, 0, false]], ['第二次完整盘点', [true, 2, 0, false]], ['提醒已开启', [true, 1, 1, false]], ['已问过', [true, 1, 0, true]]]) assert.equal(model.checkinReminderAskVisible(...args), false, label);
});

test('the asked marker is machine-local and tolerates failing or corrupt storage', () => {
  const s = makeStorage();
  assert.equal(model.checkinReminderAsked(s), false);
  model.markCheckinReminderAsked(s);
  assert.equal(model.checkinReminderAsked(s), true);
  assert.equal(s.getItem(model.checkinReminderAskedKey), '1');
  assert.equal(model.checkinReminderAsked({ getItem: () => 'corrupt', setItem() {} }), false);
  assert.equal(model.checkinReminderAsked({ getItem: () => null, setItem() { throw Error('readonly'); } }), false);
  for (const bad of [null, { getItem() { throw Error('unavailable'); }, setItem() {} }]) {
    assert.equal(model.checkinReminderAsked(bad), true);
    assert.doesNotThrow(() => model.markCheckinReminderAsked(bad));
  }
  assert.doesNotThrow(() => model.markCheckinReminderAsked({ getItem: () => null, setItem() { throw Error('readonly'); } }));
});

test('the shared interval flow requests permission before saving, then notifies listeners', async () => {
  const calls = [];
  const notified = [];
  const { status: saved, warning } = await model.applyCheckinReminderInterval(2, async (name, args) => { calls.push([name, args]); return name === 'checkin_reminder_set' ? status(args.months) : status(0); }, () => notified.push('changed'));
  assert.deepEqual(calls, [['notification_permission', undefined], ['checkin_reminder_set', { months: 2 }]]);
  assert.equal(saved.months, 2);
  assert.equal(warning, null);
  assert.deepEqual(notified, ['changed']);
  const off = [];
  await model.applyCheckinReminderInterval(0, async name => { off.push(name); return status(0); }, () => {});
  assert.deepEqual(off, ['checkin_reminder_set']);
});

test('a refused permission still saves with a warning; a failed save throws without notifying', async () => {
  const refused = await model.applyCheckinReminderInterval(1, async name => { if (name === 'notification_permission') throw Error('通知权限未开启'); return status(name === 'checkin_reminder_set' ? 1 : 0); }, () => {});
  assert.match(refused.warning, /提醒设置已保存，但尚不能发送系统通知：通知权限未开启/);
  assert.equal(refused.status.months, 1);
  let notified = 0;
  await assert.rejects(model.applyCheckinReminderInterval(1, async () => { throw Error('写入失败'); }, () => { notified++; }), /写入失败/);
  assert.equal(notified, 0);
});

test('the ask card appears for the first complete check-in and hides for every other state', async () => {
  const r = mountAsk(async () => status(0));
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /要不要每月提醒你盘一次/);
  assert.ok(r.button('每月') && r.button('每 2 个月') && r.button('每 3 个月') && r.button('先不用'));
  const hidden = async (label, invoke, props = {}, storage = makeStorage()) => {
    const ui = mountAsk(invoke, props, storage);
    await ui.settle();
    assert.equal(ui.nodes().length, 0, label);
  };
  const asked = makeStorage(); asked.setItem(model.checkinReminderAskedKey, '1');
  await hidden('已问过', async () => status(0), {}, asked);
  await hidden('第二次完整盘点', async () => status(0), { completeCount: 2 });
  await hidden('不完整盘点', async () => status(0), { savedComplete: false });
  await hidden('提醒已开启', async () => status(1));
  await hidden('状态读取失败', async name => { if (name === 'checkin_reminder_status') throw Error('读取失败'); return status(0); });
  await hidden('存储不可用', async () => status(0), {}, null);
});

test('choosing an interval from the ask saves it, marks this machine as asked, and collapses to the summary line', async () => {
  const calls = [];
  const storage = makeStorage();
  let months = 0;
  const r = mountAsk(async (name, args) => { calls.push([name, args]); if (name === 'checkin_reminder_set') months = args.months; return name === 'checkin_reminder_set' ? status(months, TODAY, '2026-11-15') : status(0); }, {}, storage);
  await r.settle();
  r.button('每 2 个月').props.onClick();
  await r.settle();
  assert.deepEqual(calls.map(c => c[0]), ['checkin_reminder_status', 'notification_permission', 'checkin_reminder_set', 'checkin_reminder_status']);
  assert.equal(calls[2][1].months, 2);
  assert.equal(storage.getItem(model.checkinReminderAskedKey), '1');
  assert.equal(r.button('每月'), undefined);
  assert.match(r.text(r.nodes()[0]), /下次提醒：2026-11-15 9:00/);
  assert.ok(events.includes('thingary-reminders-changed'));
});

test('a refused permission still saves from the ask and shows the warning with the result line', async () => {
  const storage = makeStorage();
  const r = mountAsk(async name => { if (name === 'notification_permission') throw Error('通知权限未开启'); return status(name === 'checkin_reminder_set' ? 3 : 0); }, {}, storage);
  await r.settle();
  r.button('每 3 个月').props.onClick();
  await r.settle();
  assert.equal(storage.getItem(model.checkinReminderAskedKey), '1');
  assert.equal(r.button('每 3 个月'), undefined);
  assert.match(r.text(r.nodes()[0]), /下次提醒/);
  assert.match(r.text(r.nodes()[0]), /已保存，但尚不能发送系统通知：通知权限未开启/);
});

test('a failed save from the ask keeps the card retryable and does not mark this machine as asked', async () => {
  const storage = makeStorage();
  let fail = true;
  const r = mountAsk(async name => { if (name === 'checkin_reminder_set' && fail) throw Error('写入失败'); return status(name === 'checkin_reminder_set' ? 1 : 0); }, {}, storage);
  await r.settle();
  r.button('每月').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /盘点提醒未保存：写入失败/);
  assert.ok(r.button('每月'), 'the card stays for a retry');
  assert.equal(storage.getItem(model.checkinReminderAskedKey), null);
  fail = false;
  r.button('每月').props.onClick();
  await r.settle();
  assert.equal(storage.getItem(model.checkinReminderAskedKey), '1');
  assert.match(r.text(r.nodes()[0]), /下次提醒/);
});

test('declining the ask marks this machine as asked without saving anything', async () => {
  const calls = [];
  const storage = makeStorage();
  const r = mountAsk(async name => { calls.push(name); return status(0); }, {}, storage);
  await r.settle();
  r.button('先不用').props.onClick();
  await r.settle();
  assert.deepEqual(calls, ['checkin_reminder_status']);
  assert.equal(storage.getItem(model.checkinReminderAskedKey), '1');
  assert.equal(r.nodes().length, 0);
});
