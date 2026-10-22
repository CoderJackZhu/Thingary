import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DirtyRegistry, changedSince, snapshot, discardTitle } from '../src/mobile/dirty.ts';
import { HistorySync } from '../src/mobile/history.ts';
import { nextField } from '../src/mobile/ui/field-advance.ts';
import { flipSign, parseDecimal } from '../src/currency.ts';
import { closeFields, nextDay, quickBlockedReason, savedText, stopDateRange } from '../src/mobile/wealth/model.ts';

const src = path => readFileSync(new URL(`../src/mobile/${path}`, import.meta.url), 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) { const p = `${dir}/${name}`; if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(name)) out.push(p); }
  return out;
}

// ---- 未保存修改保护 ----
test('dirty registry tracks one flag per page entry and forgets a closed page', () => {
  const r = new DirtyRegistry();
  assert.equal(r.isDirty(3), false); assert.equal(r.isDirty(undefined), false);
  r.set(3, true); assert.equal(r.isDirty(3), true); assert.equal(r.isDirty(4), false);
  r.set(3, false); assert.equal(r.isDirty(3), false);
  r.set(5, true); r.clear(5); assert.equal(r.isDirty(5), false);
});
test('a form is clean until it differs from the first loaded value', () => {
  assert.equal(changedSince(null, { a: 1 }), false, 'still loading');
  const base = snapshot({ name: '', amount: '' });
  assert.equal(changedSince(base, { name: '', amount: '' }), false);
  assert.equal(changedSince(base, { name: '虚构', amount: '' }), true);
  assert.equal(changedSince(base, { name: '', amount: '' }), false, 'typing then deleting is clean again');
  assert.equal(snapshot({ n: 10n }), '{"n":"10n"}');
  const cyclic = {}; cyclic.self = cyclic; assert.equal(snapshot(cyclic), null); assert.equal(changedSince(base, cyclic), false);
  assert.equal(discardTitle, '放弃这次修改？');
});
test('swiping back is refused while the page has changes and works after discarding', () => {
  const log = []; const h = { pushState: s => log.push(['push', s.seq]), replaceState() {}, back: () => log.push(['back']), go: n => log.push(['go', n]) };
  const registry = new DirtyRegistry(); registry.set(2, true);
  let asked = 0, popped = 0;
  const sync = new HistorySync(h, () => { if (registry.isDirty(2)) { asked++; return false; } popped++; return true; });
  sync.push();
  sync.handlePop({ thingaryMobile: true, seq: 0 });
  assert.equal(asked, 1); assert.equal(popped, 0); assert.deepEqual(log.at(-1), ['go', 1]); assert.equal(sync.seq, 1);
  registry.clear(2);
  sync.handlePop({ thingaryMobile: true, seq: 1 }); // the go(1) landing
  sync.handlePop({ thingaryMobile: true, seq: 0 });
  assert.equal(popped, 1); assert.equal(sync.seq, 0);
});
test('取消 and the back button go through nav.close, saving still uses nav.pop', () => {
  const chrome = src('ui/Chrome.tsx'), nav = src('nav-context.tsx');
  assert.match(chrome, /onCancel \?\? \(\(\) => nav\.close\(\)\)/);
  assert.match(nav, /close: \(\) => \{[\s\S]*?if \(topIsDirty\(\)\) \{ setAsking\(true\); return; \}/);
  assert.match(nav, /confirm="放弃" cancelLabel="继续编辑" danger/);
  assert.match(nav, /if \(topIsDirty\(\)\) \{ setAsking\(true\); return false; \}/, 'history pop');
  assert.doesNotMatch(nav.match(/pop: \(\) => \{[\s\S]*?\},\n    close/)[0], /Dirty/, 'pop never asks, so a save can close the page');
});
test('every modal form named in the review reports its unsaved changes', () => {
  for (const file of ['wealth/CheckIn.tsx', 'wealth/AccountEdit.tsx', 'wishes/WishEdit.tsx', 'wishes/WishPurchase.tsx', 'items/ItemEdit.tsx',
    'spending/ExpenseEdit.tsx', 'spending/IncomeEdit.tsx', 'spending/PaymentEdit.tsx', 'spending/PaymentRange.tsx', 'spending/PlanEdit.tsx', 'spending/PlanResume.tsx', 'spending/TopupEdit.tsx', 'spending/BalanceEdit.tsx', 'spending/VirtualEdit.tsx'])
    assert.match(src(file), /useDirtyGuard\(/, file);
  assert.match(src('wishes/WishEdit.tsx'), /nav\.close\(\)/); assert.match(src('wishes/WishPurchase.tsx'), /nav\.close\(\)/);
});

// ---- 带符号金额与键盘 ----
test('± flips the leading minus of what is typed and the result still parses as signed money', () => {
  assert.equal(flipSign('500'), '-500'); assert.equal(flipSign('-500'), '500'); assert.equal(flipSign(''), '-'); assert.equal(flipSign('-'), '');
  assert.equal(parseDecimal(flipSign('12.5'), 2, true), '-1250');
});
test('signed MoneyField shows the ± button, every amount field has a Return hint', () => {
  const forms = src('ui/Forms.tsx'), input = readFileSync(new URL('../src/CurrencyInput.tsx', import.meta.url), 'utf8');
  assert.match(forms, /signToggle=\{signed\}/); assert.match(forms, /enterKeyHint="next"/);
  assert.match(input, /signed && signToggle &&[\s\S]*?className="currency-sign"/);
  assert.match(input, /event\.key === 'Enter'/);
  const quick = src('wealth/QuickUpdate.tsx');
  assert.match(quick, /label=\{holdingMode==='quantity'\?'份额变化':'新份额'\}[^>]*signed=\{holdingMode==='quantity'\}/);
  assert.match(quick, /signed=\{mode==='delta'\}/);
});
test('Return moves to the next field and leaves the keyboard after the last', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(nextField(list, 'a'), 'b'); assert.equal(nextField(list, 'c'), null); assert.equal(nextField(list, 'zzz'), null);
  assert.match(src('ui/field-advance.ts'), /from\.blur\(\)/);
  assert.match(src('MobileApp.tsx'), /<KeyboardBar\/>/);
  assert.match(src('ui/KeyboardBar.tsx'), /下一项[\s\S]*完成/);
});
test('the check-in routes Return to the next unfilled account', () => {
  const page = src('wealth/CheckIn.tsx');
  assert.equal((page.match(/onEnter=\{enter\}/g) ?? []).length, 4);
  assert.match(page, /function enter\(\) \{[\s\S]*?nextUnfilled\(\)/);
});

// ---- 盘点页 ----
test('check-in has one save, a confirm sheet for the date change, and tells where it saved', () => {
  const page = src('wealth/CheckIn.tsx');
  assert.match(page, /return <><NavBar\/>\{header\}/);
  assert.equal((page.match(/保存本次盘点/g) ?? []).length, 1);
  assert.match(page, /confirm="切换并放弃输入" cancelLabel="继续编辑" danger/);
  assert.match(page, /if\(entered\.current\)setChange\(v\);else setDate\(v\)/, 'nothing entered switches at once');
  assert.doesNotMatch(page, /确认切换日期|保留输入/);
  assert.match(page, /savedText\(draft\.date,s\.today\)/);
  assert.equal(savedText('2026-10-22', '2026-10-22'), '已保存 10月22日 的盘点');
});

// ---- 弹层头部按钮 ----
test('sheet header: 取消 left, 完成/保存 right, read-only sheets 关闭 on the right', () => {
  const sheet = src('ui/Sheet.tsx');
  assert.match(sheet, /doneLabel = '关闭'/);
  assert.match(sheet, /\{cancelLabel && <button[^>]*onClick=\{onClose\}>\{cancelLabel\}/);
  assert.match(sheet, /\(onDone \|\| !cancelLabel\) &&[\s\S]*?onClick=\{onDone \?\? onClose\}/);
  assert.match(src('ui/ConfirmSheet.tsx'), /cancelLabel = '取消'/);
  for (const file of walk(fileURLToPath(new URL('../src/mobile', import.meta.url))))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /doneLabel="(取消|继续编辑)"/, `${file} puts 取消 on the right`);
});

// ---- 账户详情 ----
test('stop date range follows the backend rule: after opening and after the latest check-in, not after today', () => {
  const account = { fields: { opened_on: '2026-01-01' }, latest: { date: '2026-10-01' } };
  assert.deepEqual(stopDateRange(account, '2026-10-22'), { min: '2026-10-02', max: '2026-10-22', ok: true });
  assert.equal(stopDateRange({ fields: { opened_on: '2026-10-22' }, latest: null }, '2026-10-22').ok, false);
  assert.equal(stopDateRange({ fields: { opened_on: '2026-01-01' }, latest: { date: '2026-10-22' } }, '2026-10-22').ok, false);
  assert.equal(nextDay('2026-02-28'), '2026-03-01'); assert.equal(nextDay('2026-12-31'), '2027-01-01');
});
test('stop and re-enable keep every other account field and drop the defaults the editor drops', () => {
  const fields = { name: '虚构卡', institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: '2026-01-01', closed_on: null, notes: '', currency: 'CNY', holding_mode: false, holding_unit: null };
  const stopped = closeFields(fields, '2026-10-22');
  assert.equal(stopped.closed_on, '2026-10-22'); assert.equal(stopped.name, '虚构卡'); assert.ok(!('currency' in stopped) && !('holding_mode' in stopped) && !('holding_unit' in stopped));
  assert.equal(closeFields({ ...fields, currency: 'USD', holding_mode: true, holding_unit: '股', closed_on: '2026-10-22' }, null).closed_on, null);
  assert.equal(closeFields({ ...fields, currency: 'USD', holding_mode: true, holding_unit: '股' }, null).holding_unit, '股');
});
test('更新余额 explains why it is disabled; the account page has one 编辑 and a stop sheet', () => {
  const open = { id: 'a', revision: 1, fields: { opened_on: '2026-01-01', closed_on: null } };
  assert.equal(quickBlockedReason(open, [{ date: '2026-10-01' }], '2026-10-22'), '');
  assert.match(quickBlockedReason({ ...open, fields: { ...open.fields, closed_on: '2026-10-02' } }, [{ date: '2026-10-05' }], '2026-10-22'), /已在 2026-10-02 停用/);
  const page = src('wealth/Account.tsx');
  assert.equal((page.match(/>编辑账户</g) ?? []).length, 0);
  assert.equal((page.match(/wealth\.accountEdit/g) ?? []).length, 1, 'only the NavBar 编辑 opens the form');
  assert.match(page, /title="停用账户？" confirm="停用" danger/); assert.match(page, /wealth_account_save/);
  assert.match(page, /\{blocked && <p/);
});

// ---- 财富页 ----
test('wealth overview: no account list, 待确认付款 above the trend, one 盘点 action, 财务复盘 once', () => {
  const page = src('wealth/Overview.tsx');
  const overview = page.slice(page.indexOf('export default function Overview'));
  assert.doesNotMatch(overview, /<AccountList\/>/);
  assert.ok(overview.indexOf('<PendingPayments/>') > 0 && overview.indexOf('<PendingPayments/>') < overview.indexOf('净资产趋势'));
  assert.match(overview, /<Fab label="盘点" text="盘点"/); assert.doesNotMatch(overview, /IconButton/);
  assert.match(page, /<Fab label="新增账户" text="新增账户"/);
  assert.match(src('spending/SpendingHome.tsx'), /!wealthHub && \(virtualOn \|\| reviewOn\)/);
});

// ---- 浮动 Tab 栏 ----
test('tab bar is more opaque and rows fade out under it', () => {
  const css = src('mobile.css');
  assert.match(css, /\.m-tabbar\{[^}]*background:var\(--m-glass-bar,var\(--m-glass\)\)/);
  const alpha = [...css.matchAll(/--m-glass-bar:rgba\([^)]*?,\.(\d+)\)/g)].map(m => Number(m[1]));
  assert.equal(alpha.length, 2); assert.ok(alpha.every(a => a >= 90));
  assert.match(css, /\.m-app::after\{[^}]*linear-gradient/);
});
