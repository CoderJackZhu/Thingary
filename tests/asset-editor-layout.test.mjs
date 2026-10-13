import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { initialSupplementalOpen, supplementalField } from '../src/asset-editor-layout.ts';
import { emptyFields, validate, inputMoney } from '../src/asset.ts';
import { defaultPreferences } from '../src/preferences.ts';

const blank = () => ({ id: null, revision: null, generation: 'fictional-generation', fields: { ...emptyFields, name: '虚构物品' }, original: { ...emptyFields }, options: { preferences: defaultPreferences() }, photos: [], cover: null, pending: null });
test('new and converted items stay collapsed; editing opens meaningful supplemental values', () => {
  const initial = blank();
  assert.equal(initialSupplementalOpen(initial), false);
  assert.equal(initialSupplementalOpen({ ...initial, id: 'fictional-id' }), false);
  const changes = [
    { fields: { ...initial.fields, brand: '虚构品牌' } }, { fields: { ...initial.fields, model: '虚构型号' } }, { fields: { ...initial.fields, serial_number: 'fictional-serial' } },
    { classification: { category_id: 'fictional-category', channel_id: null } }, { classification: { category_id: null, channel_id: 'fictional-channel' } }, { hasSupplemental: true },
    ...[{ label_id: 'fictional-label' }, { cost_mode: 'per_use' }, { use_count: 1 }, { goal: { mode: 'cost', cents: '100' } }, { pinned: true }, { exclude: { total: true, daily: false, statistics: false, timeline: false } }].map(preferences => ({ options: { preferences: { ...defaultPreferences(), ...preferences } } })),
  ];
  for (const change of changes) {
    assert.equal(initialSupplementalOpen({ ...initial, id: 'fictional-id', ...change }), true);
    assert.equal(initialSupplementalOpen({ ...initial, ...change }), false, 'new items remain collapsed');
    assert.equal(initialSupplementalOpen({ ...initial, conversion: { wishlist_id: 'fictional-wish' }, ...change }), false);
  }
  assert.equal(initialSupplementalOpen({ ...initial, id: 'fictional-id', fields: { ...initial.fields, notes: '首屏备注' } }), false);
  assert.equal(supplementalField('brand'), true); assert.equal(supplementalField('notes'), false);
});

const require = createRequire(import.meta.url), ts = require('typescript');
const source = ts.createSourceFile('AssetEditor.tsx', readFileSync(new URL('../src/AssetEditor.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'AssetEditor');
const compiled = ts.transpileModule(`${fn.getText(source)}\nmodule.exports = AssetEditor;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function runtime(initial = blank()) {
  const states = [], refs = [], frames = [], focused = [], commands = []; let si = 0, ri = 0, saved;
  const context = { module: { exports: {} }, exports: {}, require,
    useState(value) { const i = si++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(value) { const i = ri++; return refs[i] ?? (refs[i] = { current: value }); }, useEffect() {}, useLayoutEffect() {},
    initialSupplementalOpen, supplementalField, validate, inputMoney, defaultPreferences, localDay: () => '2026-10-13', money: String, errorMessage: String,
    requestAnimationFrame: fn => frames.push(fn), document: { getElementById: id => ({ focus: () => focused.push(id) }) },
    persistSubmission() {}, draftKey: 'fictional-draft', localStorage: { removeItem() {} }, crypto: { randomUUID: () => 'fictional-request' },
    invoke: async (command, args) => { commands.push([command, args]); return { asset: { id: 'saved-fictional' } }; },
    PhotoView() {}, DefaultAssetIcon() {}, IconPicker() {}, FormRow() {}, ChoiceField() {}, AddImageButton() {}, AssetOptionsFields() {}, DateInput() {}, CloseButton() {},
  };
  vm.runInNewContext(compiled, context);
  function render() {
    si = ri = 0;
    const tree = context.module.exports({ initial, taxonomy: {}, closeIntent: null, onKeep() {}, onClose() {}, onSaved: record => { saved = record; } });
    const nodes = [];
    function walk(node, folded = false) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(n => walk(n, folded)); return; } if (node.props) { nodes.push({ node, folded }); walk(node.props.children, folded || node.type === 'details'); } }
    walk(tree); return nodes;
  }
  return { render, focused, commands, get saved() { return saved; }, async save() { render().find(({ node }) => node.type === 'form').node.props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate); }, flushFocus() { render(); frames.splice(0).forEach(fn => fn()); } };
}
test('the real editor keeps notes and date outside a single supplemental disclosure', async () => {
  const ui = runtime(), nodes = ui.render();
  const fold = nodes.filter(({ node }) => node.type === 'details'); assert.equal(fold.length, 1); assert.equal(fold[0].node.props.open, false);
  for (const id of ['field-name', 'field-price', 'field-date', 'field-notes']) assert.equal(nodes.find(({ node }) => node.props.id === id).folded, false, id);
  for (const id of ['field-brand', 'field-model', 'field-serial_number']) assert.equal(nodes.find(({ node }) => node.props.id === id).folded, true, id);
  for (const kind of ['category', 'label', 'channel']) assert.equal(nodes.find(({ node }) => node.props.kind === kind).folded, true, kind);
  await ui.save();
  const input = ui.commands.find(([command]) => command === 'save_asset')[1].input;
  assert.equal(input.base.purchase_date, null); assert.equal(input.base.price_cents, null); assert.equal(input.base.name, '虚构物品'); assert.ok(ui.saved);
});
test('validation inside the collapsed disclosure opens it and focuses its first error', async () => {
  const initial = blank(); initial.fields.brand = 'x'.repeat(201);
  const ui = runtime(initial); assert.equal(ui.render().find(({ node }) => node.type === 'details').node.props.open, false);
  await ui.save(); ui.flushFocus();
  assert.equal(ui.render().find(({ node }) => node.type === 'details').node.props.open, true);
  assert.deepEqual(ui.focused, ['field-brand']); assert.deepEqual(ui.commands, []);
});
test('wishlist conversion preserves today and uses the same folded layout and save path', async () => {
  const initial = blank(); initial.fields.date = '2026-10-13'; initial.conversion = { wishlist_id: 'fictional-wish', expected_revision: 2, wish_name: '虚构心愿', estimated_price_cents: null };
  const ui = runtime(initial); assert.equal(ui.render().find(({ node }) => node.type === 'details').node.props.open, false);
  await ui.save(); const payload = ui.commands.find(([command]) => command === 'convert_wishlist')[1].input;
  assert.equal(payload.asset.base.purchase_date, '2026-10-13'); assert.equal(payload.wishlist_id, 'fictional-wish'); assert.equal(payload.asset.base.price_cents, null);
});
