import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as model from '../src/checkin-reminder.ts';
import * as virtual from '../src/virtual.ts';

const TODAY = '2026-10-13';
const events = [];
const globals = { Event: class { constructor(type) { this.type = type; } }, window: { dispatchEvent: e => { events.push(e.type); return true; } } };
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
  assert.deepEqual(calls.map(c => c[0]), ['checkin_reminder_status', 'notification_permission', 'checkin_reminder_set']);
  assert.equal(calls[2][1].months, 1);
  assert.equal(r.find('Segments', p => p.label === '盘点提醒间隔').props.value, '1');
  assert.ok(events.includes('thingary-reminders-changed'), 'the notification banner re-reads its status');
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
