import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as format from '../src/backup-security-format.ts';

const status = (state, paused, extra = {}) => ({ state, reason: state === 'needs_attention' ? '私有原因文本' : null, paused, recipient_id: null, recipient_short: null, verified_at: null, changed_at: null, first_backup: null, setup_active: false, ...extra });
const windowWithListeners = () => {
  const listeners = new Map();
  return {
    dispatchEvent: e => { for (const fn of listeners.get(e.type) ?? []) fn(e); return true; },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn)),
  };
};
const globals = { Event: class { constructor(type) { this.type = type; } }, window: windowWithListeners() };
function mount(invoke, props = { hidden: false, onOpen: () => {} }) {
  return runtime('BackupSecurityNotice', props, undefined, undefined, { components: [], globals, modules: {
    './backup-security-format': format, '@tauri-apps/api/core': { invoke },
  } });
}

test('only paused states produce app-wide text, and backend reason strings never appear', () => {
  assert.equal(format.globalPauseText(status('enabled', false)), null);
  assert.equal(format.globalPauseText(status('disabled', false)), null);
  assert.match(format.globalPauseText(status('unconfigured', true)), /选择加密或继续明文.*不会生成新的自动备份/);
  assert.match(format.globalPauseText(status('restore_review_required', true)), /确认本机后续备份策略/);
  const attention = format.globalPauseText(status('needs_attention', true));
  assert.match(attention, /配置异常/);
  assert.ok(!attention.includes('私有原因文本'));
});

test('an upgrade pausing automatic backups is announced outside the settings page', async () => {
  const opened = [];
  const r = mount(async name => { assert.equal(name, 'backup_security_status'); return status('unconfigured', true); }, { hidden: false, onOpen: () => opened.push('data') });
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /自动备份已暂停.*选择加密或继续明文/);
  r.button('去数据管理处理').props.onClick();
  assert.deepEqual(opened, ['data']);
});

test('nothing shows when backups are running, or while the data page already shows the panel', async () => {
  const running = mount(async () => status('enabled', false));
  await running.settle();
  assert.equal(running.nodes().length, 0);
  const onPage = mount(async () => status('unconfigured', true), { hidden: true, onOpen: () => {} });
  await onPage.settle();
  assert.equal(onPage.nodes().length, 0);
});

test('a failed status read is said out loud and can be retried, never silently treated as fine', async () => {
  let failing = true;
  const r = mount(async () => { if (failing) throw Error('读取失败'); return status('needs_attention', true); });
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /无法确认自动备份是否在运行/);
  failing = false;
  r.button('重新读取').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /配置异常/);
});

test('the notice re-reads when the settings panel changes the policy', async () => {
  let current = status('unconfigured', true);
  const r = mount(async () => current);
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /自动备份已暂停/);
  current = status('enabled', false);
  globals.window.dispatchEvent(new globals.Event('thingary-backup-security-changed'));
  await r.settle();
  assert.equal(r.nodes().length, 0);
});
