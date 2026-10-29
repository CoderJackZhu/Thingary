import test from 'node:test';
import assert from 'node:assert/strict';
import { revealNotice } from '../src/reveal-notice.ts';
const notice = (text, log) => ({ textContent: text, scrollIntoView: o => log.push([text, o.block]) });
const root = (notices, dialogs = []) => ({ querySelectorAll: s => (s === '.notice' ? notices : dialogs) });
test('scrolls the notice carrying the delete error, not other notices', () => {
  const log = [];
  revealNotice('这个账户已出现在盘点中，请改为停用', root([notice('上次保存未确认', log), notice('这个账户已出现在盘点中，请改为停用', log)]));
  assert.deepEqual(log, [['这个账户已出现在盘点中，请改为停用', 'nearest']]);
});
test('uses the topmost open dialog as the search scope', () => {
  const log = [], inner = root([notice('错误', log)]);
  revealNotice('错误', root([], [root([]), inner]));
  assert.deepEqual(log, [['错误', 'nearest']]);
});
test('missing notice is a no-op', () => { revealNotice('x', root([])); });
