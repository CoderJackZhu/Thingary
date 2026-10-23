import * as holdings from '../src/holdings.ts';
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
function runtime({ failure = null, hidden = false, fixtureDraft = draft, fixtureAccount = account, receiptReadFailures = 0 } = {}) {
  const states = [], refs = [], deps = [], effects = [], calls = [], closes = [];
  let si = 0, ri = 0, ei = 0, nextDraft = structuredClone(fixtureDraft), pending = null, writes = 0, confirmed = null;
  const context = { ...wealth, ...currency, ...holdings, HoldingInput: 'holding-input', CurrencyInput: 'currency-input', CurrencyPicker: 'CurrencyPicker', module: { exports: {} }, exports: {}, require: () => jsx, CloseButton: 'close', DateInput: 'date', CentInput: 'cents', FormRow: 'row',
    errorMessage: e => e.message, money: value => `金额${value}`, localStorage: { getItem: () => hidden ? '1' : null }, crypto,
    invoke: async (command, input) => { calls.push({ command, input }); if (confirmed && receiptReadFailures-- > 0) throw new Error('虚构只读暂时失败'); return structuredClone({ ...nextDraft, date: input.date, ...(confirmed ? { existing: confirmed } : {}) }); },
    submit: async request => { calls.push(request); writes++; if (failure) { if (failure instanceof wealth.Unresolved) pending = request; throw failure; } return { id: 'saved', ...nextDraft }; },
    storedPending: () => pending, resolvePending: async () => { calls.push({ command: 'read-only-receipt' }); confirmed = { id: 'confirmed', date: pending.input.date, notes: '虚构已保存盘点', revision: 1, entries: [], missing: [] }; pending = null; return 'saved'; },
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
  assert.equal(r.writes, 1); assert.equal(r.closes.length, 1); assert.equal(r.closes[0][0], true); assert.equal(r.closes[0][1].date, '2026-10-17'); assert.equal(r.closes[0][1].id, 'confirmed');
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
  const context = { ...wealth, ...currency, ...holdings, HoldingInput: 'holding-input', CurrencyInput: 'currency-input', CurrencyPicker: 'CurrencyPicker', module: { exports: {} }, exports: {}, require: () => jsx, CloseButton: 'close', DeleteButton: 'delete', FormRow: 'row', DateInput: 'date', CentInput: 'cents', Switch: 'switch',
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
  element(tree, node => node.props.label === '账户币种').props.onChange('USD');
  tree = render(); assert.equal(element(tree, node => node.type === 'button' && node.props.children === '更新此账户').props.disabled, true); assert.match(text(tree), /请先保存币种/);
  element(tree, node => node.props.label === '账户币种').props.onChange('CNY');
  tree = render(); element(tree, node => node.type === 'button' && node.props.children === '更新此账户').props.onClick();
  assert.deepEqual(opened, ['cash']); assert.deepEqual(closed, []);
  current = { ...current, latest: { date: '2026-10-17', amount_cents: '12345' }, last_entered_on: '2026-10-17', has_entries: true };
  tree = render();
  assert.equal(element(tree, node => node.props.label === '账户币种').props.disabled, true);
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

test('虚构实际持仓Quick处理器：三操作提交完整数量价格且增减默认上次价格',async()=>{
 const a={...account,fields:{...account.fields,kind:'fund',holding_mode:true}},d={...draft,rows:[{account:a,previous:{amount_cents:'100',date:'2026-10-01',quantity_e8:'100000000',unit_price_e6:'1000000'}}]};
 for(const operation of ['增减持仓','更新价格','修改持仓']){const r=runtime({fixtureDraft:d,fixtureAccount:a});let tree=await ready(r);element(tree,n=>n.type==='button'&&n.props.children===operation).props.onClick();tree=r.render();
 if(operation!=='更新价格')element(tree,n=>n.type==='holding-input'&&n.props.label===(operation==='增减持仓'?'持仓份额变化':'持仓份额')).props.onChange(operation==='增减持仓'?'50000000':'200000000');
 tree=r.render();const price=element(tree,n=>n.type==='holding-input'&&n.props.label==='持仓单价');if(operation==='增减持仓')assert.equal(price.props.value,'1000000');else price.props.onChange('2000000');await submit(r);const row=r.calls.find(c=>c.command==='wealth_quick_update').input.changes[0];assert.equal(row.quantity_e8,operation==='增减持仓'?'150000000':operation==='更新价格'?'100000000':'200000000');assert.equal(row.unit_price_e6,operation==='增减持仓'?'1000000':'2000000');if(operation!=='修改持仓')assert.equal(row.expected_quantity_e8,'100000000');}
});
test('虚构持仓陈旧与未知：保留数量输入价格备注，冻结后只读核对不重复写',async()=>{
 const a={...account,fields:{...account.fields,kind:'fund',holding_mode:true}},d={...draft,rows:[{account:a,previous:{amount_cents:'1',date:'2026-10-01',quantity_e8:'100000000',unit_price_e6:'5000'}}]};
 const r=runtime({failure:{code:'QUICK_STALE',message:'份额已经变化'},fixtureDraft:d,fixtureAccount:a});let tree=await ready(r);element(tree,n=>n.type==='button'&&n.props.children==='增减持仓').props.onClick();tree=r.render();element(tree,n=>n.type==='holding-input'&&n.props.label==='持仓份额变化').props.onChange('100000000');element(tree,n=>n.type==='textarea').props.onChange({target:{value:'虚构保留持仓备注'}});r.setDraft({...d,rows:[{account:a,previous:{...d.rows[0].previous,quantity_e8:'200000000',unit_price_e6:'2500'}}]});await submit(r);tree=await ready(r);assert.equal(element(tree,n=>n.type==='holding-input'&&n.props.label==='持仓份额变化').props.value,'100000000');assert.equal(element(tree,n=>n.type==='holding-input'&&n.props.label==='持仓单价').props.value,'5000');assert.equal(element(tree,n=>n.type==='textarea').props.value,'虚构保留持仓备注');assert.equal(r.writes,1);assert.equal(r.calls.find(c=>c.command==='wealth_quick_update').input.changes[0].expected_quantity_e8,'100000000');
 const u=runtime({failure:new wealth.Unresolved('虚构持仓未知'),fixtureDraft:d,fixtureAccount:a});tree=await ready(u);element(tree,n=>n.type==='holding-input'&&n.props.label==='持仓份额').props.onChange('100000000');tree=u.render();element(tree,n=>n.type==='holding-input'&&n.props.label==='持仓单价').props.onChange('1000000');await submit(u);tree=u.render();assert.equal(element(tree,n=>n.type==='holding-input').props.disabled,true);element(tree,n=>n.type==='button'&&n.props.children==='核对结果').props.onClick();await new Promise(setImmediate);assert.equal(u.writes,1);assert.ok(u.calls.some(c=>c.command==='read-only-receipt'));
});


test('虚构已确认保存但快照读取失败：保持已保存状态，只读重试返回原请求日期快照', async () => {
  const r = runtime({ failure: new wealth.Unresolved('虚构结果未知'), receiptReadFailures: 1 });
  let tree = await ready(r);
  element(tree, n => n.type === 'date').props.onChange('2026-10-16'); tree = await ready(r);
  element(tree, n => n.type === 'cents').props.onChange('12345'); await submit(r);
  element(r.render(), n => n.type === 'button' && n.props.children === '核对结果').props.onClick(); await new Promise(setImmediate);
  tree = r.render(); assert.match(text(tree), /已确认保存/); assert.match(text(tree), /只读暂时失败/); assert.equal(r.closes.length, 0);
  element(tree, n => n.type === 'button' && n.props.children === '重新读取已保存盘点').props.onClick(); await new Promise(setImmediate);
  assert.equal(r.writes, 1); assert.equal(r.calls.filter(c => c.command === 'read-only-receipt').length, 1);
  assert.equal(r.closes.length, 1); assert.equal(r.closes[0][0], true); assert.equal(r.closes[0][1].date, '2026-10-16');
  assert.equal(r.calls.filter(c => c.command === 'wealth_snapshot_draft').at(-1).input.date, '2026-10-16');
});

test('虚构所选账户不在日期范围：即使其他账户能转账，按钮与实际提交均阻止写入', async () => {
  for (const outside of [
    { ...account, id: 'not-in-draft' },
    { ...account, fields: { ...account.fields, opened_on: '2026-10-18', closed_on: null } },
    { ...account, fields: { ...account.fields, opened_on: '2026-01-01', closed_on: '2026-10-17' } },
  ]) {
    const d = { ...draft, rows: [...draft.rows.filter(r => r.account.id !== outside.id), { account: { id: 'other', fields: { ...account.fields } }, previous: { amount_cents: '20000' } }, ...(outside.id === 'not-in-draft' ? [] : [{ account: outside, previous: { amount_cents: '10000' } }])] };
    const r = runtime({ fixtureAccount: outside, fixtureDraft: d }); let tree = await ready(r);
    element(tree, n => n.type === 'button' && n.props.children === '转账').props.onClick(); tree = r.render();
    element(tree, n => n.type === 'cents' && n.props.label === '转账金额').props.onChange('100'); tree = r.render();
    assert.equal(element(tree, n => n.type === 'button' && n.props.children === '保存快速更新').props.disabled, true);
    assert.match(text(tree), /不在所选日期/); await submit(r); assert.equal(r.writes, 0);
  }
});

test('虚构转账说明明确余额更新、同币种原币及人民币零变化限制', async () => {
  const r = runtime(); let tree = await ready(r);
  element(tree, n => n.type === 'button' && n.props.children === '转账').props.onClick(); tree = r.render();
  assert.match(text(tree), /只更新两个账户的余额，不建立收入、支出或资金流动记录/);
  assert.match(text(tree), /外币按原币金额转账/); assert.match(text(tree), /旧汇率不同或逐账户舍入/);
  assert.match(text(tree), /人民币净变化为零才能保存/);
});

test('虚构已保存盘点读取属于另一资料库时不误关闭，回原库后只读重试', async () => {
  const r = runtime({ failure: new wealth.Unresolved('虚构结果未知') });
  let tree = await ready(r); element(tree, n => n.type === 'cents').props.onChange('12345'); await submit(r);
  r.setDraft({ ...draft, generation: 'fictional-other' });
  element(r.render(), n => n.type === 'button' && n.props.children === '核对结果').props.onClick(); await new Promise(setImmediate);
  tree = r.render(); assert.equal(r.closes.length, 0); assert.match(text(tree), /已确认保存/); assert.match(text(tree), /原资料库/);
  r.setDraft(draft); element(tree, n => n.type === 'button' && n.props.children === '重新读取已保存盘点').props.onClick(); await new Promise(setImmediate);
  assert.equal(r.closes[0][1].date, '2026-10-17'); assert.equal(r.writes, 1);
  assert.equal(r.calls.filter(c => c.command === 'read-only-receipt').length, 1);
});
