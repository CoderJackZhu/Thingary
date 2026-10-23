import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runtime } from './planning-component-runtime.mjs';
import { fixture } from './planning-ui-fixture.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { retireCalcFromCapabilities } from '../src/plan-retire-calc.ts';
import * as view from '../src/plan-view.ts';
import * as ledger from '../src/plan-ledger.ts';
import * as events from '../src/plan-events.ts';
import * as imports from '../src/financial-import.ts';

const text = r => r.nodes().map(n => [r.text(n), n.props?.text, n.props?.title, n.props?.['aria-label']].filter(Boolean).join(' ')).join(' ');
const noop = () => {};
test('retirement comparisons use plain labels while preserving every displayed threshold and budget scale', () => {
  const sources = fixture(), saved = sources.profile.value.saved;
  saved.profile.retire.real_return_before_hundredths = 400;
  const calc = retireCalcFromCapabilities(saved, buildBasicCapabilities(sources), sources.today);
  const r = runtime('RetireOverview', { calc, mode: 'today', onMode: noop }, undefined, undefined, { components: [], modules: {
    './plan-view': view, './plan-ledger': ledger, './plan-events': events,
  } });
  const shown = text(r);
  assert.match(shown, /现在停止追加存钱/);
  assert.match(shown, /按完整预算生活/);
  assert.match(shown, /计划支出的 70%/);
  assert.match(shown, /计划支出的 150%/);
  assert.match(shown, /预计资金变化/);
  assert.doesNotMatch(shown, /Coast FIRE|Lean FIRE|Fat FIRE|\bFI\b|计划供款|投资组合轨迹/);
  const amounts = view.milestones(calc.plan, calc.assets, 'today').map(m => view.compactYuan(m.amount));
  for (const amount of amounts) assert.ok(shown.includes(amount), amount);
});

const pendingKey = 'thingary.wealth.request';
function environment(initial, handler) {
  const values = new Map(initial ? [[pendingKey, JSON.stringify(initial)]] : []), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: i => [...values.keys()][i], get length() { return values.size; } };
  const storedPending = () => JSON.parse(storage.getItem(pendingKey) ?? 'null');
  const options = { components: [], globals: { localStorage: storage, window: { setInterval: () => 1, clearInterval: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop }, Event, location: { reload: noop } }, modules: {
    '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push({ command, args: structuredClone(args) }); return handler(command, args); } },
    './wealth': { pendingKey, storedPending, code: error => error.code, kindLabel: value => value },
    './asset': { money: String, errorMessage: error => error.message }, './financial-import': imports,
    './backup-security-format': { looksLikeRecoveryKey: () => ({ ok: true }), RESTORE_DISCLOSURE: '恢复前会保留保护副本', securitySummary: () => '', STATE_LABELS: {} },
  } };
  return { options, calls, storage, storedPending };
}
const pending = { command: 'financial_import_commit', label: '金融历史导入', input: { request_id: 'fictional-original', generation: 'fictional-old-library' } };
test('plain import recovery keeps the original operation and library, including an inconclusive lookup in another library', async () => {
  let result = null;
  const env = environment(pending, () => result);
  const r = runtime('FinancialImportDialog', { generation: pending.input.generation, currentGeneration: 'fictional-current-library', recoveryOnly: true, onClose: noop }, undefined, undefined, env.options);
  assert.match(text(r), /上次操作编号.*fictional-original/);
  assert.match(text(r), /不要重新选择文件重复导入/);
  r.button('在当前资料中检查同一次导入（不写入）').props.onClick(); await r.settle();
  assert.match(text(r), /不能据此判断原来的资料是否已导入/);
  assert.deepEqual(env.storedPending(), pending);
  assert.deepEqual(env.calls.at(-1), { command: 'financial_import_receipt', args: { request: pending.input.request_id, generation: 'fictional-current-library' } });
  result = { request_id: pending.input.request_id, counts: { created_accounts: 2, created_snapshots: 3, corrected: 0, skipped: 1 }, objects: [], source_name: '虚构来源', mapping_set_id: '原方案编号', created_at: '2026-10-19T00:00:00Z', origin_changed: false, unavailable_objects: 1 };
  r.button('核对上次导入结果').props.onClick(); await r.settle();
  assert.deepEqual(env.calls.at(-1), { command: 'financial_import_receipt', args: { request: pending.input.request_id, generation: pending.input.generation } });
  assert.equal(env.storedPending(), null);
  assert.match(text(r), /账户新增 2 个.*盘点新增 3 次/);
  assert.match(text(r), /已永久清除的记录在原方案中用过的表格编号不能再关联新记录/);
  assert.match(text(r), /同一批内容时不会重复写入/);
  assert.equal(env.calls.some(call => call.command === 'financial_import_commit'), false);
});

test('an unknown result keeps its original identifier and a visible retry action', async () => {
  const env = environment(pending, () => { throw Object.assign(Error('虚构无法读取'), { code: 'STALE_DATASET' }); });
  const r = runtime('FinancialImportDialog', { generation: pending.input.generation, recoveryOnly: true, onClose: noop }, undefined, undefined, env.options);
  r.button('核对上次导入结果').props.onClick(); await r.settle();
  assert.match(text(r), /不要在这里重复导入/);
  assert.deepEqual(env.storedPending(), pending);
  assert.ok(r.button('核对上次导入结果'));
});

test('data management opens the same recovery operation from the renamed result action', () => {
  const env = environment(pending, async () => null);
  const r = runtime('DataManagement', { generation: 'fictional-current-library', demo: false, blocked: false, onImported: noop, onBusyChange: noop, onTrash: noop }, undefined, undefined, env.options);
  r.button('核对金融导入结果').props.onClick(); r.render();
  const dialog = r.find('FinancialImportDialog');
  assert.equal(dialog.props.generation, pending.input.generation);
  assert.equal(dialog.props.currentGeneration, 'fictional-current-library');
  assert.equal(dialog.props.recoveryOnly, true);
  assert.deepEqual(env.storedPending(), pending);
  assert.equal(env.calls.length, 0);
});

test('the five owned screens no longer introduce the targeted jargon as UI literals', () => {
  for (const name of ['RetireOverview', 'FinancialImportDialog', 'DataManagement', 'FinanceRecordsPage', 'PlanningPage']) {
    const source = ts.createSourceFile(`${name}.tsx`, readFileSync(new URL(`../src/${name}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const literals = [];
    function visit(node) { if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literals.push(node.text); ts.forEachChild(node, visit); }
    visit(source);
    assert.doesNotMatch(literals.join(' '), /Coast FIRE|Lean FIRE|Fat FIRE|\bFI\b|计划供款|投资组合轨迹|原请求元数据|核对金融导入回执|原子提交|代际/, name);
  }
});
