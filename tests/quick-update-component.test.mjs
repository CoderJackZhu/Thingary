import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as wealth from '../src/wealth.ts';
import * as currency from '../src/currency.ts';
const source = readFileSync(new URL('../src/QuickUpdateDialog.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('QuickUpdateDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'QuickUpdateDialog');
const script = ts.transpileModule(fn.getText() + '\nmodule.exports=QuickUpdateDialog;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const account = { id: 'cash', fields: { name: '虚构现金', side: 'asset', counted: true } };
const draft = { generation: 'fictional', date: '2026-10-17', existing: null, rows: [{ account, previous: { amount_cents: '10000', date: '2026-10-01' } }, { account: { id: 'fund', fields: { name: '虚构基金', side: 'asset', counted: true } }, previous: { amount_cents: '30000', date: '2026-10-01' } }] };
function runtime({ failure = null, hidden = false, fixtureDraft = draft, fixtureAccount = account } = {}) {
  const states = [], refs = [], deps = [], effects = [], calls = [], closes = [];
  let si = 0, ri = 0, ei = 0, nextDraft = structuredClone(fixtureDraft), pending = null, writes = 0;
  const context = { ...wealth, ...currency, CurrencyInput: 'currency-input', module: { exports: {} }, exports: {}, require: () => jsx, CloseButton: 'close', DateInput: 'date', CentInput: 'cents', FormRow: 'row',
    errorMessage: e => e.message, money: value => `金额${value}`, localStorage: { getItem: () => hidden ? '1' : null }, crypto,
    invoke: async (command, input) => { calls.push({ command, input }); return structuredClone(nextDraft); },
    submit: async request => { calls.push(request); writes++; if (failure) { if (failure instanceof wealth.Unresolved) pending = request; throw failure; } return { id: 'saved', ...nextDraft }; },
    storedPending: () => pending, resolvePending: async () => { calls.push({ command: 'read-only-receipt' }); return 'saved'; },
    useState: init => { const i = si++; if (!(i in states)) states[i] = typeof init === 'function' ? init() : init; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: init => { const i = ri++; return refs[i] ??= { current: init }; },
    useEffect: (callback, next) => { const i = ei++, old = deps[i]; if (!old || !next || next.some((v, j) => !Object.is(v, old[j]))) { deps[i] = next; effects.push(callback); } },
  };
  vm.runInNewContext(script, context);
  return { calls, states, closes, setDraft(value) { nextDraft = value; }, get writes() { return writes; }, render() { si = ri = ei = 0; const tree = context.module.exports({ account: fixtureAccount, generation: 'fictional', today: '2026-10-17', points: [{ date: '2026-10-01' }], onClose: (...args) => closes.push(args) }); effects.splice(0).forEach(effect => effect()); return tree; } };
}
function nodes(root) { if (root == null || typeof root === 'boolean') return []; if (Array.isArray(root)) return root.flatMap(nodes); if (typeof root !== 'object') return [root]; return [root, ...nodes(root.props?.children)]; }
const element = (tree, predicate) => nodes(tree).find(node => node?.props && predicate(node));
const text = tree => nodes(tree).filter(value => typeof value === 'string' || typeof value === 'number').join('');
async function ready(runtime) { runtime.render(); await new Promise(setImmediate); return runtime.render(); }
async function submit(runtime) { element(runtime.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate); }

test('虚构实际快速更新处理器：QUICK_STALE重新读原金额，保留增减输入和备注再预览', async () => {
  const r = runtime({ failure: { code: 'QUICK_STALE', message: '虚构金额已经变化' } });
  let tree = await ready(r);
  element(tree, node => node.type === 'button' && node.props.children === '增减金额').props.onClick();
  tree = r.render(); element(tree, node => node.type === 'cents').props.onChange('-500');
  element(tree, node => node.type === 'textarea').props.onChange({ target: { value: '虚构保留备注' } });
  r.setDraft({ ...draft, rows: [{ ...draft.rows[0], previous: { amount_cents: '12000', date: '2026-10-01' } }, draft.rows[1]] });
  await submit(r); tree = await ready(r);
  assert.equal(element(tree, node => node.type === 'cents').props.value, '-500');
  assert.equal(element(tree, node => node.type === 'textarea').props.value, '虚构保留备注');
  assert.match(text(tree), /输入已保留/); assert.match(text(tree), /金额12000 → 金额11500/);
  assert.equal(r.calls.filter(call => call.command === 'wealth_snapshot_draft').length, 2);
  const written = r.calls.find(call => call.command === 'wealth_quick_update');
  assert.equal(written.input.changes[0].amount_cents, '9500'); assert.equal(written.input.changes[0].expected_previous, '10000');
});
test('虚构实际快速更新：结果未知保留原请求、冻结编辑，核对不再次写入', async () => {
  const r = runtime({ failure: new wealth.Unresolved('虚构结果未知') });
  let tree = await ready(r); element(tree, node => node.type === 'cents').props.onChange('12345');
  await submit(r); tree = r.render();
  assert.equal(element(tree, node => node.type === 'cents').props.disabled, true);
  const verify = element(tree, node => node.type === 'button' && node.props.children === '核对结果');
  verify.props.onClick(); await new Promise(setImmediate);
  assert.equal(r.writes, 1); assert.deepEqual(r.closes, [[true]]);
  assert.ok(r.calls.some(call => call.command === 'read-only-receipt'));
});
test('虚构隐藏金额：新增原余额和实时结果不暴露只读金额', async () => {
  const r = runtime({ hidden: true }); let tree = await ready(r);
  element(tree, node => node.type === 'cents').props.onChange('12345'); tree = r.render();
  assert.match(text(tree), /••••/); assert.doesNotMatch(text(tree), /10000|12345/);
});

test('虚构账户编辑入口：打开快速更新及刷新只读观测后，未保存名称和备注仍保留', () => {
  const pageSource = readFileSync(new URL('../src/WealthPage.tsx', import.meta.url), 'utf8');
  const page = ts.createSourceFile('WealthPage.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = page.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'AccountDialog');
  const code = ts.transpileModule(fn.getText() + '\nmodule.exports=AccountDialog;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const states = [], refs = [], opened = [], closed = []; let si = 0, ri = 0;
  const context = { ...wealth, ...currency, CurrencyInput: 'currency-input', module: { exports: {} }, exports: {}, require: () => jsx, CloseButton: 'close', DeleteButton: 'delete', FormRow: 'row', DateInput: 'date', CentInput: 'cents', Switch: 'switch',
    document: { getElementById: () => ({ focus() {} }) },
    useState: init => { const i = si++; if (!(i in states)) states[i] = typeof init === 'function' ? init() : init; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: init => refs[ri++] ??= { current: init }, useEffect: () => {},
  };
  vm.runInNewContext(code, context);
  let current = { ...account, fields: { ...account.fields, kind: 'cash', institution: '', notes: '虚构原备注', opened_on: '2026-01-01', closed_on: null }, revision: 1, latest: null };
  const render = () => { si = ri = 0; return context.module.exports({ account: current, generation: 'fictional', today: '2026-10-17', onQuick: value => opened.push(value.id), onClose: value => closed.push(value) }); };
  let tree = render();
  element(tree, node => node.props['aria-label'] === '账户名称').props.onChange({ target: { value: '虚构未保存名称' } });
  element(tree, node => node.type === 'textarea').props.onChange({ target: { value: '虚构未保存备注' } });
  tree = render();
  element(tree, node => node.props['aria-label'] === '账户币种').props.onChange({ target: { value: 'USD' } });
  tree = render(); assert.equal(element(tree, node => node.type === 'button' && node.props.children === '快速更新').props.disabled, true); assert.match(text(tree), /请先保存币种/);
  element(tree, node => node.props['aria-label'] === '账户币种').props.onChange({ target: { value: 'CNY' } });
  tree = render(); element(tree, node => node.type === 'button' && node.props.children === '快速更新').props.onClick();
  assert.deepEqual(opened, ['cash']); assert.deepEqual(closed, []);
  current = { ...current, latest: { date: '2026-10-17', amount_cents: '12345' }, last_entered_on: '2026-10-17', has_entries: true };
  tree = render();
  assert.equal(element(tree, node => node.props['aria-label'] === '账户币种').props.disabled, true);
  assert.equal(element(tree, node => node.props['aria-label'] === '账户名称').props.value, '虚构未保存名称');
  assert.equal(element(tree, node => node.type === 'textarea').props.value, '虚构未保存备注');
});

test('虚构外币CNY未变的陈旧输入：保留原币增减和汇率，重读原币后重新预览',async()=>{
 const a={...account,fields:{...account.fields,currency:'USD'}},d={...draft,rows:[{account:a,previous:{amount_cents:'1',date:'2026-10-01',original_minor:'1',fx_rate_micro:'500000'}}]};
 const r=runtime({failure:{code:'QUICK_STALE',message:'原币金额已经变化'},fixtureDraft:d,fixtureAccount:a});
 let tree=await ready(r);element(tree,n=>n.type==='button'&&n.props.children==='增减金额').props.onClick();
 tree=r.render();element(tree,n=>n.type==='currency-input'&&n.props.label==='原币增减 USD').props.onChange('2');
 r.setDraft({...d,rows:[{account:a,previous:{amount_cents:'1',date:'2026-10-01',original_minor:'2',fx_rate_micro:'500000'}}]});
 await submit(r);tree=await ready(r);
 assert.equal(element(tree,n=>n.type==='currency-input'&&n.props.label==='原币增减 USD').props.value,'2');
 assert.equal(element(tree,n=>n.type==='currency-input'&&n.props.label==='快速更新汇率').props.value,'500000');
 const written=r.calls.find(c=>c.command==='wealth_quick_update');assert.equal(written.input.changes[0].expected_previous,'1');assert.equal(written.input.changes[0].expected_original_minor,'1');assert.equal(written.input.changes[0].original_minor,'3');
 assert.match(text(tree),/0.02 USD/);assert.match(text(tree),/0.04 USD/);assert.equal(r.writes,1);
});
