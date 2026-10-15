import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as imports from '../src/financial-import.ts';
const ts = createRequire(import.meta.url)('typescript');
const pendingKey = 'thingary.wealth.request';
const jsx = (type, props) => ({ type, props });
const FinancialImportDialog = () => null;
function runtime(file, props, initialPending = null, invoke = async () => null) {
  const slots = [], effects = [], calls = [], events = new Map(), storage = new Map();
  if (initialPending) storage.set(pendingKey, JSON.stringify(initialPending));
  let at = 0, reloads = 0;
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k), key: i => [...storage.keys()][i], get length() { return storage.size; } };
  const storedPending = () => JSON.parse(localStorage.getItem(pendingKey) ?? 'null');
  const hooks = {
    useCallback(fn) { at++; return fn; },
    useState(value) { const i = at++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(value) { const i = at++; return slots[i] ??= { current: value }; },
    useEffect(fn, deps) { const i = at++; if (!slots[i] || deps.some((v, n) => v !== slots[i].deps[n])) { effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } },
  };
  const window = { addEventListener: (n, f) => events.set(n, f), removeEventListener: n => events.delete(n), dispatchEvent: e => events.get(e.type)?.(), setInterval: () => 1, clearInterval() {} };
  const context = { exports: {}, localStorage, window, Event, crypto: { randomUUID: () => 'new-request' }, location: { reload() { reloads++; } }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === '@tauri-apps/api/core') return { invoke: async (name, args) => { calls.push({ name, args }); const result = await invoke(name, args); return name === 'backup_task_begin' && typeof result !== 'string' ? `fictional-task-${calls.length}` : result; } };
    if (name === './wealth') return { pendingKey, storedPending, kindLabel: s => s, code: e => e?.code };
    if (name === './asset') return { errorMessage: e => e?.message ?? String(e) };
    if (name === './financial-import') return imports;
    if (name === './FinancialImportDialog') return { FinancialImportDialog };
    if (name === './income-classification') return { incomeCategories: {} };
    if (name === './AssetViews') return { Icon: () => null };
    if (name === './AutoBackup') return { AutoBackup: () => null };
    if (name === './BackupSecurity') return { BackupSecurity: () => null };
    if (name === './backup-security-format') return { looksLikeRecoveryKey: v => ({ ok: !!v }), RESTORE_DISCLOSURE: 'disclosure', securitySummary: () => 'summary', STATE_LABELS: { disabled: '未加密', unconfigured: '待设置', enabled: '已加密' } };
    if (name === './SupportLink') return { SupportLink: 'a' };
    if (name === './CloseButton') return { CloseButton: 'button' };
    if (name === './FormControls') return { FormRow: 'section' };
    if (name.endsWith('.css')) return {};
    throw new Error(name);
  } };
  const source = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  function nodes(node, out = []) { if (node?.props) { out.push(node); for (const child of [node.props.children].flat(Infinity)) nodes(child, out); } return out; }
  const render = () => { at = 0; const tree = context.exports[file](props); while (effects.length) effects.shift()(); return tree; };
  const all = () => nodes(render());
  const find = predicate => all().find(predicate);
  const button = text => find(n => n.type === 'button' && [n.props.children].flat(Infinity).join('') === text);
  const click = text => { const b = button(text); assert.ok(b, text); assert.ok(!b.props.disabled, text); return b.props.onClick(); };
  return { render, all, find, button, click, calls, storedPending, props, storage, get reloads() { return reloads; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const pending = { command: 'financial_import_commit', input: { request_id: 'original-request', generation: 'old-library' }, label: '金融历史导入' };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const settings = extra => ({ generation: 'current-library', blocked: false, demo: false, onTrash() {}, onBusyChange() {}, onImported() {}, ...extra });

test('blocked/demo settings reopen original financial receipt using its generation and lock new operations', () => {
  const busy = [];
  const ui = runtime('DataManagement', settings({ blocked: true, demo: true, onBusyChange: b => busy.push(b) }), pending);
  assert.equal(ui.button('核对金融导入回执').props.disabled, false);
  assert.equal(ui.button('选择表格…').props.disabled, true);
  ui.click('核对金融导入回执');
  const host = ui.find(n => n.type === FinancialImportDialog);
  assert.equal(host.props.generation, 'old-library');
  assert.equal(host.props.currentGeneration, 'current-library');
  assert.equal(host.props.recoveryOnly, true);
  assert.equal(busy.at(-1), true);
  host.props.onClose(false); ui.render();
  assert.equal(busy.at(-1), false);
  assert.equal(ui.storedPending().input.request_id, 'original-request');
  assert.equal(ui.button('核对金融导入回执').props.disabled, false);
});

test('new financial import cannot open when blocked/demo or any other pending request exists', () => {
  for (const [props, savedRequest] of [[{ blocked: true }, null], [{ demo: true }, null], [{}, { ...pending, command: 'wealth_account_save' }]]) {
    const ui = runtime('DataManagement', settings(props), savedRequest);
    const b = ui.button('选择金融历史…'); assert.equal(b.props.disabled, true);
    b.props.onClick(); assert.equal(ui.find(n => n.type === FinancialImportDialog), undefined);
  }
});

test('financial wizard, item preview and restore preview are mutually exclusive', async () => {
  const ui = runtime('DataManagement', settings());
  ui.click('选择金融历史…');
  for (const name of ['备份…', '导出…', '选择…', '选择表格…']) assert.equal(ui.button(name).props.disabled, true);
  ui.button('选择表格…').props.onClick(); await settle(); assert.equal(ui.calls.length, 0);
  ui.find(n => n.type === FinancialImportDialog).props.onClose(false); ui.render();
  assert.equal(ui.button('选择表格…').props.disabled, false);
  for (const [name, result] of [['选择表格…', { path: '/tmp/fake.xlsx', name: '虚构表格', preview: { hash: 'hash', valid: 1, invalid: [], duplicates: [], new_categories: [], new_channels: [] } }], ['选择…', { path: '/tmp/fake.thingary', name: '虚构备份', summary: { created_at: '2026-10-12', hash: 'hash' } }]]) {
    const preview = runtime('DataManagement', settings(), null, async () => result);
    preview.click(name); await settle();
    assert.equal(preview.button('选择金融历史…').props.disabled, true);
    assert.equal(preview.button('备份…').props.disabled, true);
    preview.button('选择金融历史…').props.onClick();
    assert.equal(preview.find(n => n.type === FinancialImportDialog), undefined);
  }
});

test('settings request flag is consumed and opens recovery even while blocked', () => {
  let done = 0;
  const ui = runtime('DataManagement', settings({ blocked: true, financeImportRequested: true, onFinanceImportRequestDone: () => done++ }), pending);
  ui.render();
  assert.equal(ui.find(n => n.type === FinancialImportDialog).props.recoveryOnly, true);
  assert.equal(done, 1);
});

const receipt = { request_id: 'original-request', source_name: '虚构', mapping_set_id: 'mapping', created_at: '2026-10-12', counts: { created_accounts: 1, created_snapshots: 1, created_incomes: 1, corrected: 0, skipped: 1 }, origin_changed: false, objects: [{ kind: 'account', action: 'create', id: 'account' }, { kind: 'income', action: 'correct', id: 'income' }, { kind: 'snapshot', action: 'create', id: 'snapshot' }] };
test('recovery only queries original request, stays at receipt and navigates only on explicit result choice', async () => {
  const navigation = [], closed = [];
  const ui = runtime('FinancialImportDialog', { generation: 'old-library', currentGeneration: 'current-library', recoveryOnly: true, onClose: saved => closed.push(saved), onViewFinance: target => navigation.push(target) }, pending, async () => receipt);
  assert.equal(ui.button('选择工作簿…'), undefined);
  ui.click('按原请求核对回执'); await settle(); ui.render();
  assert.equal(ui.calls[0].name, 'financial_import_receipt');
  assert.equal(ui.calls[0].args.generation, 'old-library');
  assert.equal(ui.calls[0].args.request, 'original-request');
  assert.equal(ui.storedPending(), null); assert.equal(navigation.length, 0); assert.equal(closed.length, 0);
  for (const text of ['查看收入', '查看账户', '查看盘点']) assert.ok(ui.button(text));
  ui.click('查看收入'); assert.deepEqual(navigation, ['income']); assert.deepEqual(closed, [true]);
});

test('current-library receipt absence cannot clear unknown original request and recovery never offers a new import', async () => {
  const ui = runtime('FinancialImportDialog', { generation: 'old-library', currentGeneration: 'current-library', recoveryOnly: true, onClose() {} }, pending);
  ui.click('在当前资料库只读核对同一回执'); await settle(); ui.render();
  assert.equal(ui.calls[0].args.generation, 'current-library');
  assert.equal(ui.calls[0].args.request, 'original-request');
  assert.equal(ui.storedPending().input.generation, 'old-library');
  assert.equal(ui.button('选择工作簿…'), undefined);
  assert.equal(ui.button('确认导入整批'), undefined);
});

test('receipt lookup failure retains request; confirmed no receipt clears it without enabling file selection in recovery', async () => {
  for (const fail of [true, false]) {
    const ui = runtime('FinancialImportDialog', { generation: 'old-library', recoveryOnly: true, onClose() {} }, pending, async () => { if (fail) throw { code: 'STALE_DATASET', message: '切库' }; return null; });
    ui.click('按原请求核对回执'); await settle(); ui.render();
    assert.equal(!!ui.storedPending(), fail);
    assert.equal(ui.button('选择工作簿…'), undefined);
    assert.equal(ui.button('确认导入整批'), undefined);
  }
});

test('result choices reflect actual created/corrected tables rather than skipped objects', async () => {
  const ui = runtime('FinancialImportDialog', { generation: 'old-library', recoveryOnly: true, onClose() {}, onViewFinance() {} }, pending, async () => ({ ...receipt, objects: [{ kind: 'income', action: 'keep' }, { kind: 'account', action: 'create' }] }));
  ui.click('按原请求核对回执'); await settle(); ui.render();
  assert.ok(ui.button('查看账户'));
  assert.equal(ui.button('查看收入'), undefined); assert.equal(ui.button('查看盘点'), undefined);
});

test('new workbook import completes transaction, keeps receipt visible and closes ordinary previews without saving', async () => {
  const navigation = [], closed = [];
  const preview = { page: 0, total: 1, objects: [], issues: [], referenced_keys: [], accounts: [], account_names: {}, external_keys: {}, can_commit: true, counts: { new_accounts: 1, new_snapshots: 0, new_incomes: 0, same: 0, conflicts: 0 }, context_digest: 'context', normalized_digest: 'digest', file_fingerprints: [] };
  const ui = runtime('FinancialImportDialog', { generation: 'current-library', onClose: saved => closed.push(saved), onViewFinance: target => navigation.push(target) }, null, async name => {
    if (name === 'financial_import_read_workbook') return { name: '虚构.xlsx', files: [{ kind: 'accounts', name: '账户', csv_text: 'external_key,name\na,虚构', column_mapping: {} }] };
    if (name === 'financial_import_preview') return preview;
    if (name === 'financial_import_commit') return { ...receipt, objects: [{ kind: 'account', action: 'create' }] };
    return null;
  });
  ui.click('选择工作簿…'); await settle();
  ui.click('对应账户与列'); await settle();
  ui.click('预览所选集合'); await settle();
  ui.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  ui.click('确认导入整批'); await settle(); ui.render();
  assert.equal(ui.calls.filter(c => c.name === 'financial_import_commit').length, 1);
  assert.equal(ui.storedPending(), null);
  assert.equal(navigation.length, 0); assert.equal(closed.length, 0);
  assert.ok(ui.button('查看账户')); ui.click('完成'); assert.deepEqual(closed, [true]);
  const ordinary = runtime('FinancialImportDialog', { generation: 'current-library', onClose() {} });
  ordinary.click('关闭'); assert.equal(ordinary.storage.size, 0);
});

test('unknown commit preserves original request and reopening recovery never resubmits', async () => {
  const preview = { page: 0, total: 1, objects: [], issues: [], referenced_keys: [], accounts: [], account_names: {}, external_keys: {}, can_commit: true, counts: { new_accounts: 1, new_snapshots: 0, new_incomes: 0, same: 0, conflicts: 0 }, context_digest: 'context', normalized_digest: 'digest', file_fingerprints: [] };
  const ui = runtime('FinancialImportDialog', { generation: 'current-library', onClose() {} }, null, async name => {
    if (name === 'financial_import_read_workbook') return { name: '虚构.xlsx', files: [{ kind: 'accounts', name: '账户', csv_text: 'external_key,name\na,虚构', column_mapping: {} }] };
    if (name === 'financial_import_preview') return preview;
    throw new Error('响应中断');
  });
  ui.click('选择工作簿…'); await settle(); ui.click('对应账户与列'); await settle(); ui.click('预览所选集合'); await settle();
  ui.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  ui.click('确认导入整批'); await settle(); ui.render();
  assert.equal(ui.storedPending().input.request_id, 'new-request');
  assert.equal(ui.storedPending().input.generation, 'current-library');
  assert.doesNotMatch(JSON.stringify(ui.storedPending()), /csv_text|虚构.xlsx/);
  assert.equal(ui.button('确认导入整批'), undefined);
  ui.click('关闭');
  const recovery = runtime('FinancialImportDialog', { generation: 'current-library', recoveryOnly: true, onClose() {} }, ui.storedPending(), async () => receipt);
  recovery.click('按原请求核对回执'); await settle();
  assert.deepEqual(recovery.calls.map(c => c.name), ['financial_import_receipt']);
  assert.equal(recovery.calls[0].args.request, 'new-request');
});


const checkedBackup = { path: '/tmp/fictional.thingary', name: '虚构备份', encrypted: false, token: 'frozen-token', summary: { created_at: '2026-10-15', schema: 42 } };
test('lost restore response preserves its token and only the read-only result command resolves it', async () => {
  let receipt = 'unknown';
  const ui = runtime('DataManagement', settings(), null, async name => {
    if (name === 'inspect_backup') return checkedBackup;
    if (name === 'restore_backup_session') throw new Error('reply lost');
    if (name === 'backup_session_result') { if (receipt === 'unknown') throw new Error('temporarily unavailable'); return receipt; }
  });
  ui.click('选择…'); await settle(); ui.click('确认替换当前资料'); await settle();
  assert.equal(ui.button('确认替换当前资料').props.disabled, true);
  assert.equal(ui.button('取消').props.disabled, true);
  assert.equal(ui.button('备份…').props.disabled, true);
  ui.click('核对恢复结果'); await settle();
  assert.ok(ui.button('核对恢复结果'));
  receipt = 'restored-generation'; ui.click('核对恢复结果'); await settle();
  assert.equal(ui.reloads, 1);
  assert.equal(ui.calls.filter(c => c.name === 'restore_backup_session').length, 1);
  assert.equal(ui.calls.filter(c => c.name === 'backup_session_result').length, 2);
});
test('read-only absence unlocks an explicit second confirmation without replaying the restore', async () => {
  const ui = runtime('DataManagement', settings(), null, async name => {
    if (name === 'inspect_backup') return checkedBackup;
    if (name === 'restore_backup_session') throw new Error('not submitted');
    if (name === 'backup_session_result') return null;
  });
  ui.click('选择…'); await settle(); ui.click('确认替换当前资料'); await settle();
  ui.click('核对恢复结果'); await settle();
  assert.equal(ui.button('确认替换当前资料').props.disabled, false);
  assert.equal(ui.calls.filter(c => c.name === 'restore_backup_session').length, 1);
});
test('late inspection after dataset switch is cancelled and cannot become a new-library restore candidate', async () => {
  let resolve;
  const ui = runtime('DataManagement', settings(), null, name => name === 'inspect_backup' ? new Promise(r => { resolve = r; }) : Promise.resolve());
  ui.click('选择…'); await settle(); ui.props.generation = 'new-library'; ui.render(); resolve(checkedBackup); await settle();
  assert.equal(ui.button('确认替换当前资料'), undefined);
  assert.equal(ui.calls.filter(c => c.name === 'cancel_backup_session')[0].args.token, 'frozen-token');
});
test('security wizard locks the parent page and its data operations', () => {
  const busy = [], ui = runtime('DataManagement', settings({ onBusyChange: b => busy.push(b) }));
  ui.find(n => n.props.onStatusChange && n.props.onBusyChange).props.onBusyChange(true); ui.render();
  assert.equal(busy.at(-1), true);
  for (const name of ['备份…', '导出…', '选择…', '选择表格…']) assert.equal(ui.button(name).props.disabled, true);
  assert.equal(ui.find(n => n.type === 'fieldset').props.disabled, true);
});
test('closing the security panel cancels its generated session and ignores delayed begin replies', async () => {
  for (const delayed of [false, true]) {
    let resolve;
    const busy = [];
    const ui = runtime('BackupSecurity', { demo: false, blocked: false, onStatusChange() {}, onBusyChange: b => busy.push(b) }, null, name => {
      if (name === 'backup_security_status') return Promise.resolve({ state: 'unconfigured' });
      if (name === 'backup_security_begin_setup') return delayed ? new Promise(r => { resolve = r; }) : Promise.resolve({ session_id: 'fictional-key-session', recipient_id: 'public-id', recovery_key: 'fictional-unused-key' });
      return Promise.resolve();
    });
    ui.render(); await settle(); ui.click('启用加密…');
    if (!delayed) { await settle(); ui.render(); assert.equal(busy.at(-1), true); }
    ui.unmount();
    if (delayed) resolve({ session_id: 'fictional-key-session', recipient_id: 'public-id', recovery_key: 'fictional-unused-key' });
    await settle();
    assert.equal(ui.calls.filter(c => c.name === 'backup_security_cancel_setup').at(-1).args.sessionId, 'fictional-key-session');
    assert.equal(ui.calls.filter(c => c.name === 'backup_security_confirm_setup').length, 0);
  }
});

test('accepted task cancellation keeps all locks until the original operation rejects after cleanup', async () => {
  let reject, cancels = 0;
  const busy = [];
  const ui = runtime('DataManagement', settings({ onBusyChange: value => busy.push(value) }), null, name => {
    if (name === 'inspect_backup') return new Promise((_, no) => { reject = no; });
    if (name === 'backup_task_cancel') { cancels++; return Promise.resolve(true); }
    return Promise.resolve(null);
  });
  ui.click('选择…'); await settle();
  ui.click('取消本次备份操作'); await settle();
  assert.equal(cancels, 1);
  assert.equal(ui.button('取消本次备份操作').props.disabled, true);
  assert.equal(ui.button('备份…').props.disabled, true);
  assert.equal(busy.at(-1), true);
  assert.ok(ui.all().some(n => n.props.role === 'status' && n.props.children === '正在取消，请等待清理'));
  reject({ code: 'CANCELLED', message: 'cleaned' }); await settle(); ui.render();
  assert.equal(ui.button('取消本次备份操作'), undefined);
  assert.equal(ui.button('备份…').props.disabled, false);
  assert.equal(busy.at(-1), false);
  assert.ok(ui.all().some(n => n.props.role === 'alert' && n.props.children === '已取消，原成品保留。'));
  assert.equal(ui.storage.size, 0, 'task tokens and keys are never persisted');
});
test('late cancellation refusal waits for the original success and does not discard its candidate', async () => {
  let resolve;
  const ui = runtime('DataManagement', settings(), null, name => {
    if (name === 'inspect_backup') return new Promise(done => { resolve = done; });
    if (name === 'backup_task_cancel') return Promise.resolve(false);
    return Promise.resolve(null);
  });
  ui.click('选择…'); await settle(); ui.click('取消本次备份操作'); await settle();
  assert.ok(ui.all().some(n => n.props.children === '本次操作已发布或完成，请等待原结果'));
  assert.equal(ui.button('备份…').props.disabled, true);
  resolve(checkedBackup); await settle();
  assert.ok(ui.button('确认替换当前资料'));
  assert.equal(ui.calls.filter(c => c.name === 'restore_backup_session').length, 0);
});
test('a failed task allocation sends no long operation; an unmounted late allocation cancels only its own id', async () => {
  const failed = runtime('DataManagement', settings(), null, async name => { if (name === 'backup_task_begin') throw new Error('allocation failed'); });
  failed.click('选择…'); await settle();
  assert.equal(failed.calls.filter(c => c.name === 'inspect_backup').length, 0);
  let resolve;
  const late = runtime('DataManagement', settings(), null, name => name === 'backup_task_begin' ? new Promise(done => { resolve = done; }) : Promise.resolve(true));
  late.click('选择…'); late.unmount(); resolve('late-owned-task'); await settle();
  assert.equal(late.calls.filter(c => c.name === 'inspect_backup').length, 0);
  assert.equal(late.calls.filter(c => c.name === 'backup_task_cancel').at(-1).args.taskId, 'late-owned-task');
});
test('cancelling the first encrypted backup keeps the verified policy and refreshes its independent outcome', async () => {
  let reject, enabled = false;
  const busy = [];
  const ui = runtime('BackupSecurity', { demo: false, blocked: false, onStatusChange() {}, onBusyChange: value => busy.push(value) }, null, name => {
    if (name === 'backup_security_status') return Promise.resolve({ state: enabled ? 'enabled' : 'unconfigured', first_backup: enabled ? { state: 'failed', message: 'cancelled' } : null });
    if (name === 'backup_security_begin_setup') return Promise.resolve({ session_id: 'fixture-session', recipient_id: 'public-only', recovery_key: 'fictional-key' });
    if (name === 'backup_security_confirm_setup') { enabled = true; return new Promise((_, no) => { reject = no; }); }
    if (name === 'backup_task_cancel') return Promise.resolve(true);
    return Promise.resolve(null);
  });
  ui.render(); await settle(); ui.click('启用加密…'); await settle();
  const input = ui.find(n => n.props.onChange && n.props.value === '' && n.props.busy !== undefined);
  input.props.onChange('fictional-key'); ui.click('验证并开启加密'); await settle();
  ui.click('取消本次加密备份'); await settle(); ui.render();
  assert.equal(busy.at(-1), true);
  reject({ code: 'CANCELLED', message: 'cleaned' }); await settle(); ui.render();
  assert.equal(busy.at(-1), false);
  assert.ok(ui.button('轮换密钥…'), 'committed encryption remains enabled');
  assert.equal(ui.button('验证并开启加密'), undefined, 'secret setup inputs are cleared');
  assert.equal(ui.calls.filter(c => c.name === 'backup_security_confirm_setup').length, 1);
  assert.ok(ui.calls.some(c => c.name === 'backup_task_cancel'));
});
