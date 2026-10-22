import test from 'node:test';
import assert from 'node:assert/strict';
import { readMobile } from '../src/mobile/service.ts';

test('手机读取只接入财富命令，同批资料库代次和日期不匹配时拒绝', async () => {
  const calls = [], accounts = [{ id: 'fictional' }], summary = { generation: 'fictional' };
  let draft = { generation: 'fictional', date: '2026-10-21' };
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    calls.push({ command, args });
    return command === 'wealth_summary' ? summary : command === 'wealth_accounts' ? accounts : draft;
  } } };
  assert.deepEqual(await readMobile('2026-10-21'), { summary, accounts, draft });
  assert.deepEqual(calls.map(c => c.command), ['wealth_summary', 'wealth_accounts', 'wealth_snapshot_draft']);
  assert.deepEqual(calls.at(-1).args, { date: '2026-10-21' });
  draft = { generation: 'other-fictional', date: '2026-10-21' };
  await assert.rejects(readMobile('2026-10-21'), /资料已变化/);
  draft = { generation: 'fictional', date: '2026-10-20' };
  await assert.rejects(readMobile('2026-10-21'), /资料已变化/);
  delete globalThis.window;
});
