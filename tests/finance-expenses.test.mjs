import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as expenses from '../src/expenses.ts';
import * as sorting from '../src/list-sort.ts';

const line = (id, source = 'expense', amount = '800000', date = '2026-09-15') => ({ id, source, title: id, asset_id: null, category: 'travel', amount_cents: amount, date });
const fixture = (extra = {}) => ({ generation: 'fictional', year: null, period: { kind: 'all' }, years: [2026], lines: [line('trip')], undated: [], months: [], annual_totals: [], spent_cents: '800000', refund_cents: '100000', net_cents: '700000', sale_cents: '200000', undated_cents: '0', unknown_amount_count: 0, ...extra });
function page(props = {}, options = {}) {
  const ipc = [], bars = [], requests = [], refreshed = [], sources = [];
  const receipt = { pending: null, busy: false, notice: '', setPending() {}, verify() {} , ...options.receipt };
  const r = runtime('ExpensesPage', { today: '2026-10-12', search: '', onSearch() {}, onOpenAsset: id => sources.push(id), onOpenSource: target => sources.push(target), onEditingChange() {}, onSourceDone() {}, embedded: true, period: { kind: 'all' }, controlledView: fixture(), onPeriodChange: p => requests.push(structuredClone(p)), onRefresh: () => refreshed.push(true), ...props }, undefined, undefined, {
    components: [], document: { querySelector: () => null }, modules: {
      './expenses': expenses, './list-sort': sorting,
      './asset': { money: c => `¥${c}`, errorMessage: e => e.message },
      './topbar': { usePageBar: (owner, bar) => bars.push({ owner, bar }) },
      './topbar-model': { refocusHeading() {} },
      './undo': { useRestored: fn => { options.restored = fn; } },
      './useSource': { useSource: (_props, _generation, resolve) => { options.resolve = resolve; return ''; } },
      './WealthPage': { DeleteButton: 'DeleteButton', usePendingReceipt: reload => { receipt.verify = async () => { receipt.pending = null; reload(); }; return receipt; } },
      './wealth': { storedPending: () => receipt.pending, submit: async () => {}, Unresolved: class extends Error {} },
      '@tauri-apps/api/core': { invoke: async (command, input) => { ipc.push({ command, input: structuredClone(input) }); return options.invoke ? options.invoke(command, input) : fixture(); } },
    },
  });
  return Object.assign(r, { ipc, bars, requests, refreshed, sources, receipt, options });
}
const summary = r => r.text(r.find('div', p => p.className === 'ui-metrics ui-card'));

test('embedded consumes exactly the host view without expense_view or topbar registration', async () => {
  const r = page({ period: { kind: 'month', month: '2026-09' }, controlledView: fixture({ spent_cents: '123456' }) });
  await r.settle();
  assert.deepEqual(r.ipc, []);
  assert.deepEqual(r.bars, []);
  assert.equal(r.find('HeaderSlot'), undefined);
  assert.match(summary(r), /123456/);
  assert.match(summary(r), /2026 年 9 月/);
  assert.match(summary(r), /100000.*700000.*200000/);
  r.props.search = 'nothing'; r.render();
  assert.match(r.text(r.nodes()[0]), /当前条件下没有找到记录/);
  assert.match(summary(r), /123456/);
  assert.match(r.text(r.nodes()[0]), /搜索只筛选明细/);
});

test('loading, errors, stale generation and empty never pretend to be ready totals', () => {
  const loading = page({ controlledView: null });
  assert.match(loading.text(loading.nodes()[0]), /正在读取/);
  assert.equal(loading.find('div', p => p.className === 'ui-metrics ui-card'), undefined);
  const error = page({ controlledError: 'fictional failure' });
  assert.match(error.text(error.find('article', p => p.role === 'alert')), /fictional failure/);
  error.button('重新读取').props.onClick();
  assert.equal(error.refreshed.length, 1);
  assert.equal(error.ipc.length, 0);
  const stale = page({ generation: 'new-library' });
  assert.match(stale.text(stale.nodes()[0]), /正在读取/);
  assert.equal(stale.find('div', p => p.className === 'ui-metrics ui-card'), undefined);
  const empty = page({ controlledView: fixture({ lines: [], spent_cents: '0' }) });
  assert.match(summary(empty), /未记录支出/);
  assert.match(empty.text(empty.nodes()[0]), /还没有重要支出/);
});

test('unknown values and undated lines remain separate from the host period aggregate', () => {
  const r = page({ period: { kind: 'range', from: '2026-09-01', to: '2026-09-30', includeFrom: false }, controlledView: fixture({ lines: [line('unknown', 'purchase', null)], undated: [line('undated', 'purchase', '900000', null)], spent_cents: '0', unknown_amount_count: 1, undated_cents: '900000' }) });
  assert.match(summary(r), /金额待补/);
  assert.match(summary(r), /仅已知部分/);
  assert.doesNotMatch(summary(r), /900000/);
  assert.match(r.text(r.nodes()[0]), /不含起点当日/);
  assert.match(r.text(r.find('tbody', p => p['aria-label'] === '日期待补')), /undated/);
  assert.match(r.text(r.nodes()[0]), /所有可见但无法归期的记录/);
});

test('all years drill through host and month/range never synthesize charts', () => {
  const annual = { year: 2026, spent_cents: '800000', refund_cents: '100000', net_cents: '700000', sale_cents: '200000', count: 1, known_count: 1, unknown_count: 0 };
  const view = fixture({ annual_totals: [annual], months: [{ month: '2026-09', spent_cents: '800000', refund_cents: '100000', count: 1, known_count: 1, unknown_count: 0 }] });
  const r = page({ controlledView: view });
  const bar = r.find('rect', p => p.role === 'button');
  bar.props.onKeyDown({ key: 'Enter', preventDefault() {} }); r.render();
  assert.deepEqual(r.requests, [{ kind: 'year', year: 2026 }]);
  assert.equal(r.props.period.kind, 'all');
  r.props.period = { kind: 'year', year: 2026 }; r.render();
  assert.match(r.text(r.nodes()[0]), /各月支出/);
  assert.doesNotMatch(r.text(r.nodes()[0]), /各年支出/);
  r.props.period = { kind: 'month', month: '2026-09' }; r.render();
  assert.equal(r.find('svg'), undefined);
  r.props.period = { kind: 'range', from: '2026-09-01', to: '2026-09-30', includeFrom: true }; r.render();
  assert.equal(r.find('svg'), undefined);
  r.props.period = { kind: 'all' }; r.render();
  assert.ok(r.find('rect', p => p.role === 'button'));
});

test('blocked and pending prevent autoNew, empty-state new and source editing', async () => {
  for (const options of [{}, { receipt: { pending: { label: 'fictional pending' } } }]) {
    const r = page({ controlledView: fixture({ lines: [] }), blocked: !options.receipt, autoNew: true }, options);
    assert.equal(r.find('dialog'), undefined);
    assert.equal(r.button('记一笔支出').props.disabled, true);
    r.button('记一笔支出').props.onClick(); r.render();
    assert.equal(r.find('dialog'), undefined);
    await assert.rejects(options.resolve({ kind: 'expense', id: 'trip' }, () => true));
    assert.equal(r.ipc.length, 0);
  }
});

test('source correction keeps the host range; save and receipt verification refresh the host', async () => {
  const period = { kind: 'range', from: '2026-09-01', to: '2026-09-30', includeFrom: false };
  const options = { invoke: () => ({ id: 'trip', revision: 1, asset_deleted: false, asset_name: null, fields: { title: 'trip', date: '2025-01-01', amount_cents: '800000', category: 'travel', notes: '', refund_cents: null, refund_date: null, asset_id: null } }) };
  const r = page({ period }, options);
  assert.equal(await options.resolve({ kind: 'expense', id: 'trip' }, () => true), true); r.render();
  assert.ok(r.find('dialog'));
  assert.equal(r.requests.length, 0);
  assert.deepEqual(r.props.period, period);
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  assert.equal(r.refreshed.length, 1);
  assert.equal(r.find('dialog'), undefined);
  await r.receipt.verify();
  assert.equal(r.refreshed.length, 2);
});

test('source owners and identical payment amounts retain stable domain identifiers', () => {
  const r = page({ controlledView: fixture({ lines: [
    { ...line('a', 'payment'), plan_id: 'plan-a' }, { ...line('b', 'payment'), plan_id: 'plan-b' }, { ...line('physical', 'purchase'), asset_id: 'asset-a' },
  ], spent_cents: '800000' }) });
  r.button('查看 a 来源').props.onClick(); r.button('查看 b 来源').props.onClick(); r.button('查看 physical 来源').props.onClick();
  assert.deepEqual(r.sources, [{ kind: 'payment', id: 'a', plan_id: 'plan-a' }, { kind: 'payment', id: 'b', plan_id: 'plan-b' }, 'asset-a']);
  assert.match(summary(r), /800000/);
});

test('legacy standalone keeps its read, topbar and year selector', async () => {
  const r = page({ embedded: false }); await r.settle();
  assert.equal(r.ipc[0].command, 'expense_view');
  assert.deepEqual(r.ipc[0].input, { year: null });
  assert.ok(r.bars.some(b => b.owner === 'expenses'));
  assert.ok(r.find('HeaderSlot'));
  r.button('2026').props.onClick(); r.render(); await r.settle();
  assert.deepEqual(r.ipc.at(-1).input, { year: 2026 });
});

test('late expense detail cannot reopen after the host changes generation or period view', async () => {
  for (const change of ['generation', 'view']) {
    let finish;
    const r = page({}, { invoke: () => new Promise(resolve => { finish = resolve; }) });
    r.button('查看 trip 来源').props.onClick();
    if (change === 'generation') r.props.generation = 'next-library';
    else r.props.controlledView = fixture({ period: { kind: 'year', year: 2025 } });
    r.render();
    finish({ id: 'trip', revision: 1, fields: {}, asset_deleted: false });
    await r.settle();
    assert.equal(r.find('dialog'), undefined);
  }
});

test('embedded delegates the pending receipt UI and lock to its host', () => {
  const locks=[];
  const pending={command:'financial_import_commit',label:'import',input:{request_id:'original'}};
  const r=page({onEditingChange:value=>locks.push(value)}, {receipt:{pending,notice:'host-owned receipt status'}});
  assert.equal(r.button('核对结果'),undefined);
  assert.doesNotMatch(r.text(r.nodes()[0]),/host-owned receipt status/);
  assert.ok(locks.includes(true));
  assert.equal(r.receipt.pending.input.request_id,'original');
});

test('expense async opening locks new drafts and releases only its own operation', async () => {
 let resolve;const delayed=new Promise(done=>{resolve=done;});
 const r=page({}, {invoke:()=>delayed});await r.settle();
 const opening=r.options.resolve({kind:'expense',id:'e'},()=>true);r.render();
 r.props.autoNew=true; r.render(); assert.equal(r.find('dialog'),undefined);
 const newButton=r.nodes().find(n=>n.type==='button'&&r.text(n)==='记一笔支出');
 if(newButton) { assert.equal(newButton.props.disabled,true); newButton.props.onClick(); }
 const edit={id:'e',revision:1,fields:{date:'2026-10-12',amount_cents:'100',title:'E',category:'other',notes:''}};
 resolve(edit);assert.equal(await opening,true);r.render();
 assert.ok(r.find('dialog')); assert.match(r.text(r.find('dialog')),/编辑支出/);
});

test('ordinary expense detail loading blocks a new draft before its response arrives', async () => {
 let resolve; const delayed=new Promise(done=>{resolve=done;});
 const r=page({}, {invoke:()=>delayed}); await r.settle();
 r.button('查看 trip 来源').props.onClick(); r.render();
 assert.equal(r.button('查看 trip 来源').props.disabled,true);
 r.props.autoNew=true; r.render(); assert.equal(r.find('dialog'),undefined);
 resolve({id:'trip',revision:1,asset_deleted:false,fields:{title:'trip',date:'2026-09-15',amount_cents:'800000',category:'travel',notes:'',refund_cents:null,refund_date:null,asset_id:null}});
 await r.settle(); assert.ok(r.find('dialog')); assert.match(r.text(r.find('dialog')),/编辑支出/);
});
