import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { ready } from '../src/review.ts';
import { occurrenceIssues } from '../src/plan-core.ts';
import { retractOccurrence } from '../src/plan-occurrence-actions.ts';
import { eventsInput } from '../src/planning-basic-forms.ts';

const noop = () => {};
const leaf = () => null;
function runtime(file, deps) {
  const slots = []; let cursor = 0;
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useEffect: noop, useMemo: f => f(), useCallback: f => f, useRef: initial => ({ current: initial }) };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, requestAnimationFrame: noop, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : deps[name] ?? new Proxy({}, { get: () => leaf }) });
  return { render(name, props) { cursor = 0; return exports[name](props); } };
}
function all(tree) { if (Array.isArray(tree)) return tree.flatMap(all); if (!tree || typeof tree !== 'object') return []; return [tree, ...all(tree.props?.children)]; }
function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(''); if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return text(tree.props?.children); }
const event = { id: 'fictional-event', label: '虚构购买安排', date: '2027-01', price_cents: '10000', down_cents: '10000', fees_cents: '0', loan_months: 0, loan_rate_hundredths: 0, monthly_cost_cents: '0' };
const occurred = { id: 'fictional-occurrence', event_id: event.id, status: 'occurred', actual_date: '2026-10-01', payments_complete: true, payments: [], loan: null };
const source = () => ({ generation: 'fictional', write_version: 1, modules: { planning: true, wealth: true }, profile: { status: 'ready', value: { saved: { revision: 1, profile: { retire: { basic: {}, life_events: [event], core: { occurrences: [occurred] } } } } } }, snapshot: { status: 'ready', value: { id: 'fictional-snapshot', revision: 1, date: '2026-10-01', entries: [] } }, accounts: { status: 'ready', value: [] }, incomes: { status: 'error', value: { message: 'fictional income failure' } }, review: { status: 'error', value: { message: 'fictional review failure' } } });
const props = sources => ({ sources, today: '2026-10-12', reload: noop, onPending: noop, onEditingChange: noop });
function occurrencesRuntime(saver) { return runtime('PlanningGoalOccurrences.tsx', { './review': { ready }, './plan-core': { occurrenceIssues }, './plan-occurrence-actions': { retractOccurrence }, './planning-basic-forms': { eventsInput }, './planning-basic-data': { useSectionSaver: () => saver } }); }

test('all goal arrangements remain reachable with income errors, including retractable occurred records', async () => {
  const saved = []; const r = occurrencesRuntime({ busy: false, stuck: false, notice: '', save: async input => { saved.push(input); return {}; } });
  const s = source(); const before = structuredClone(s); const p = props(s);
  let tree = r.render('PlanningGoalOccurrences', p);
  assert.match(text(tree), /虚构购买安排.*已发生/);
  const open = all(tree).find(n => n.type === 'button' && text(n) === '查看／更正发生核对');
  assert.equal(open.props.disabled, false); open.props.onClick({ currentTarget: { isConnected: false } });
  tree = r.render('PlanningGoalOccurrences', p);
  const dialog = all(tree).find(n => n.props?.event === event);
  assert.equal(dialog.props.existing.id, occurred.id);
  assert.equal(dialog.props.saveDisabled, false);
  dialog.props.onSave(null); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0].fields.occurrences)), []);
  assert.deepEqual(s, before);
});

test('unavailable accounts and snapshots preserve existing occurrence while disabling save', () => {
  const s = source(); s.accounts = { status: 'error', value: { message: 'fictional account failure' } }; s.snapshot = { status: 'error', value: { message: 'fictional snapshot failure' } };
  let writes = 0; const r = occurrencesRuntime({ busy: false, stuck: false, notice: '', save: () => { writes++; } }), p = props(s);
  let tree = r.render('PlanningGoalOccurrences', p);
  assert.match(text(tree), /补齐后才能保存核对/);
  all(tree).find(n => n.type === 'button' && text(n) === '查看／更正发生核对').props.onClick({ currentTarget: {} });
  tree = r.render('PlanningGoalOccurrences', p);
  const dialog = all(tree).find(n => n.props?.event === event);
  assert.equal(dialog.props.existing.id, occurred.id); assert.equal(dialog.props.saveDisabled, true); dialog.props.onSave(null); assert.equal(writes, 0);
});

test('goalsOnly forces goal content and topbar setup, without income newRecord', () => {
  const s = source(); let bar;
  const Goal = () => null, Occurrences = () => null, Income = () => null;
  const r = runtime('PlanningPage.tsx', { './review': { ready }, './planning-basic-view': { modeOf: () => 'basic' }, './planning-basic-data': { usePlanningSources: () => ({ load: { status: 'ready', sources: s }, reload: noop }) }, './topbar': { usePageBar: (_, value) => { bar = value; } }, './WealthPage': { usePendingReceipt: () => ({ pending: null, busy: false }) }, './PlanningBasicGoals': { PlanningBasicGoals: Goal }, './PlanningGoalOccurrences': { PlanningGoalOccurrences: Occurrences }, './IncomeRecords': { IncomeRecords: Income } });
  const tree = r.render('PlanningPage', { today: '2026-10-12', tab: 'savings', goalsOnly: true, onTab: noop, onEditingChange: noop, onFocusDone: noop });
  assert.equal(bar.primary.label, '调整条件'); assert.equal(bar.newRecord, undefined);
  assert.ok(all(tree).some(n => n.type === Goal)); assert.ok(all(tree).some(n => n.type === Occurrences)); assert.ok(!all(tree).some(n => n.type === Income));
  assert.doesNotMatch(text(tree), /收入与复盘视图|选择复盘区间/);
});


test('a fully checked occurred arrangement stays editable when occurrenceIssues is empty', () => {
  const s = source();
  s.profile.value.saved.profile.retire.core = { occurrences: [{ ...occurred, payments: [{ id: 'fictional-payment', date: '2026-10-01', amount_cents: '10000', account_id: 'fictional-account', absorbed_snapshot_id: 'fictional-snapshot', absorbed_revision: 1, source_kind: null, source_id: null }] }], fund_rules: [{ account_id: 'fictional-account', availability: 'available', share_hundredths: 10000 }] };
  assert.equal(occurrenceIssues(s.snapshot.value, s.profile.value.saved.profile.retire.core, [event], '2026-10-12').length, 0);
  const r = occurrencesRuntime({ busy: false, stuck: false, notice: '', save: noop }), p = props(s);
  let tree = r.render('PlanningGoalOccurrences', p);
  const entry = all(tree).find(n => n.type === 'button' && text(n) === '查看／更正发生核对');
  assert.equal(entry.props.disabled, false); entry.props.onClick({ currentTarget: {} });
  tree = r.render('PlanningGoalOccurrences', p);
  assert.ok(all(tree).some(n => n.props?.event === event && n.props.existing.payments.length === 1));
});


test('closing occurrence review discards edits without submitting, and pending receipt locks reopening', () => {
  let writes = 0;
  const saver = { busy: false, stuck: false, notice: '', save: () => { writes++; } };
  const r = occurrencesRuntime(saver), p = props(source());
  let tree = r.render('PlanningGoalOccurrences', p);
  all(tree).find(n => n.type === 'button' && text(n) === '查看／更正发生核对').props.onClick({ currentTarget: {} });
  tree = r.render('PlanningGoalOccurrences', p);
  all(tree).find(n => n.props?.event === event).props.onClose();
  tree = r.render('PlanningGoalOccurrences', p);
  assert.ok(!all(tree).some(n => n.props?.event === event)); assert.equal(writes, 0);
  saver.stuck = true;
  tree = r.render('PlanningGoalOccurrences', p);
  assert.equal(all(tree).find(n => n.type === 'button' && text(n) === '查看／更正发生核对').props.disabled, true);
});
