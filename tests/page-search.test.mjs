import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const src = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('every module page binds its topbar search to the App session words', () => {
  for (const [file, key] of [
    ['WealthPage.tsx', 'wealth'], ['ExpensesPage.tsx', 'expenses'],
    ['RecurringPage.tsx', 'recurring'], ['VirtualPage.tsx', 'virtual'],
    ['Timeline.tsx', 'timeline'], ['Trash.tsx', 'trash'],
    ['MaterialLibrary.tsx', 'materials'], ['WishlistPanel.tsx', 'wishlist'],
  ]) {
    assert.ok(src(file).includes(`key: '${key}'`), `${file} registers search key ${key}`);
  }
  assert.match(app, /search=\{searches\.wealth\}/);
  assert.match(app, /search=\{searches\.trash\}/);
});

test('search filters the list only; KPI summaries come straight from the backend view', () => {
  const expenses = src('ExpensesPage.tsx');
  // The four KPI cards read the view's own aggregates...
  for (const field of ['view.spent_cents', 'view.refund_cents', 'view.net_cents', 'view.sale_cents']) {
    assert.ok(expenses.includes(field), `KPI keeps ${field}`);
  }
  // ...while only the table receives the filtered rows.
  assert.match(expenses, /<LineTable lines=\{shownLines\} undated=\{shownUndated\}/);
  const recurring = src('RecurringPage.tsx');
  assert.match(recurring, /data\.annual_cents/, 'annual burden is not a search subtotal');
  assert.match(recurring, /data\.due\.length/, 'due count ignores the keyword');
  const virtual = src('VirtualPage.tsx');
  assert.match(virtual, /data\.in_use/, 'in-use count ignores the keyword');
  assert.match(virtual, /data\.spent_cents/, 'spent total ignores the keyword');
});

test('expense search covers title, category label, notes and source label', () => {
  const expenses = src('ExpensesPage.tsx');
  assert.match(expenses, /lineMatches = \(l: Line\) => !keyword \|\| \[l\.title, categoryText\(l\), l\.notes \?\? '', sourceLabel\[l\.source\]\]/);
});

test('the asset list keeps the tag in its searchable fields (preview mirrors the backend)', () => {
  assert.match(src('visual-preview.ts'), /labelName\(r\.preferences\?\.label_id\)/, 'preview search includes tag names');
  const catalog = readFileSync(new URL('../src-tauri/src/catalog.rs', import.meta.url), 'utf8');
  assert.ok(catalog.includes("LEFT JOIN named_choices lbl ON lbl.kind='label'"), 'backend joins the label name');
  assert.ok(catalog.includes("coalesce(lbl.name,'')"), 'label name joins the haystack');
});

test('trash search is backend-side and paginates the filtered count', () => {
  const trash = src('Trash.tsx');
  assert.match(trash, /list_trash', \{ query: \{ filter, offset, search \} \}/);
  const rust = readFileSync(new URL('../src-tauri/src/trash.rs', import.meta.url), 'utf8');
  assert.match(rust, /entries\.retain\(\|e\| \{/, 'backend filters the full entry list');
  assert.match(rust, /let total = entries\.len\(\) as i64;/, 'total is counted after the filter');
});

test('timeline search intersects with the domain/year/type filters', () => {
  const timeline = src('Timeline.tsx');
  assert.match(timeline, /hidden\?\.size \? list\.filter\(e => !hidden\.has\(e\.kind\)\) : list/);
  assert.match(timeline, /out\.filter\(e => \[e\.title, eventLabel\(e\), eventDetail\(e\)\]/);
});

test('empty results explain themselves; failures and empty libraries keep their own states', () => {
  assert.ok(app.includes('当前条件下没有找到记录'), 'assets empty-search state');
  for (const file of ['WealthPage.tsx', 'ExpensesPage.tsx', 'RecurringPage.tsx', 'VirtualPage.tsx', 'Trash.tsx', 'Timeline.tsx', 'WishlistPanel.tsx', 'MaterialLibrary.tsx']) {
    assert.ok(src(file).includes('当前条件下没有找到记录'), `${file} search empty state`);
  }
  // Loading errors still surface as failures, not as "no records".
  assert.ok(app.includes('资料加载失败'));
  assert.ok(src('Trash.tsx').includes('最近删除读取失败'));
});

test('topbar search reaches lists with their own query, and wealth shows the list it filters', () => {
  // WishlistPanel keeps a server query; the topbar word must flow into it after mount.
  assert.match(src('WishlistPanel.tsx'), /setQuery\(q => \(q\.search === search \? q : \{ \.\.\.q, search, offset: 0 \}\)\);\s*\}, \[search\]\);/);
  // Typing on 概览/盘点记录 switches to the account list (3.5.1).
  assert.match(src('WealthPage.tsx'), /search !== lastSearch\.current && search\.trim\(\)\) setTab\('accounts'\)/);
  assert.ok(!/新增资产/.test(app), 'no user-facing 新增资产 left in App');
});

test('asset overview cards read the same filters without the search word (3.5.2)', () => {
  assert.match(app, /const overviewPage = query\.search \? summaryPage : page;/);
  assert.match(app, /invoke<Page>\('list_assets', \{ query: \{ \.\.\.query, search: '', offset: 0 \} \}\)/);
  assert.match(app, /<AssetOverview page=\{overviewPage\} filtered=\{narrowed\}\/>/);
  // A stale summary reply never overwrites a newer one.
  assert.match(app, /if \(ticket === summaryTicket\.current\) setSummaryPage\(r\)/);
});
