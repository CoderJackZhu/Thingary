import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const confirm = readFileSync(new URL('../src/LeaveConfirm.tsx', import.meta.url), 'utf8');
test('sidebar entries are never greyed out by an open form', () => {
  const nav = main.slice(main.indexOf('<nav className="sidebar-main"'), main.indexOf('</aside>'));
  assert.doesNotMatch(nav, /disabled=\{modeBlocked\}/);
  for (const key of ['overview', 'assets', 'wishlist', 'stats', 'wealth', 'finance-records', 'finance-review', 'recurring', 'virtual', 'planning', 'timeline', 'settings']) assert.match(nav, new RegExp(`nav\\('${key}'`), key);
});
test('only an open finance or planning form may be abandoned, and only after a confirmation', () => {
  assert.match(main, /const discardable = featureEditing && !durablePending && !dataBusy && !modeBusy && !batch && !otherEditing;/);
  assert.match(main, /else if \(discardable\) setLeaveKey\(key\);/);
  assert.match(main, /onClickCapture=\{event => \{ if \(!modeBlocked \|\| discardable \|\|/);
  assert.match(main, /<LeaveConfirm onStay=\{\(\) => setLeaveKey\(null\)\} onLeave=/);
  assert.match(confirm, /放弃未保存的输入？/);
  assert.match(confirm, /继续编辑/);
  assert.match(confirm, /放弃并离开/);
  assert.match(confirm, /onCancel=\{event => \{ event\.preventDefault\(\); onStay\(\); \}\}/);
});
