import test from 'node:test';
import assert from 'node:assert/strict';
import { activeStack, depth, initialNav, navReducer, topEntry } from '../src/mobile/nav.ts';
import { HistorySync } from '../src/mobile/history.ts';
import { clampSwipe, settleSwipe } from '../src/mobile/ui/swipe.ts';

const start = () => initialNav('items', 'items.list');
const names = state => activeStack(state).map(e => e.route);

test('push、pop 与返回标题所需的栈', () => {
  let s = navReducer(start(), { type: 'push', route: 'items.detail', params: { id: 'a' } });
  s = navReducer(s, { type: 'push', route: 'items.edit' });
  assert.deepEqual(names(s), ['items.list', 'items.detail', 'items.edit']);
  assert.deepEqual(topEntry(s).params, {});
  s = navReducer(s, { type: 'pop' });
  assert.equal(topEntry(s).route, 'items.detail'); assert.equal(topEntry(s).reveal, 1);
  assert.equal(depth(navReducer(s, { type: 'pop', count: 9 })), 1);
  assert.equal(navReducer(start(), { type: 'pop' }).stacks.items.length, 1);
});
test('每个标签有独立的栈，切换后保留，首次进入从根页开始', () => {
  let s = navReducer(start(), { type: 'push', route: 'items.detail' });
  s = navReducer(s, { type: 'switch', tab: 'wealth', root: 'wealth.overview' });
  assert.deepEqual(names(s), ['wealth.overview']);
  s = navReducer(s, { type: 'push', route: 'wealth.checkin' });
  s = navReducer(s, { type: 'switch', tab: 'items', root: 'items.list' });
  assert.deepEqual(names(s), ['items.list', 'items.detail']);
  s = navReducer(s, { type: 'switch', tab: 'wealth', root: 'unused' });
  assert.deepEqual(names(s), ['wealth.overview', 'wealth.checkin']);
  assert.equal(navReducer(s, { type: 'switch', tab: 'wealth', root: 'x' }), s);
});
test('replace、分段切换和回到根页', () => {
  let s = navReducer(start(), { type: 'push', route: 'items.edit' });
  s = navReducer(s, { type: 'replace', route: 'items.detail', params: { id: 'new' } });
  assert.deepEqual(names(s), ['items.list', 'items.detail']);
  s = navReducer(s, { type: 'popToRoot' }); assert.deepEqual(names(s), ['items.list']);
  s = navReducer(s, { type: 'root', route: 'wishes.list' }); assert.deepEqual(names(s), ['wishes.list']);
  assert.equal(new Set(Object.values(s.stacks).flat().map(e => e.id)).size, 1);
});
test('直接打开某页时根页垫在下面，条目编号不重复', () => {
  const s = initialNav('wealth', 'wealth.overview', { name: 'wealth.checkin', params: { a: 1 } });
  assert.deepEqual(names(s), ['wealth.overview', 'wealth.checkin']);
  const ids = activeStack(navReducer(s, { type: 'push', route: 'wealth.compare' })).map(e => e.id);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(names(initialNav('me', 'me.home', { name: 'me.home' })), ['me.home']);
});

function fakeHistory() {
  const log = []; return { log, pushState: s => log.push(['push', s.seq]), replaceState: s => log.push(['replace', s.seq]), back: () => log.push(['back']), go: n => log.push(['go', n]) };
}
test('历史记录：推入页面各加一条，浏览器后退弹出一页', () => {
  const h = fakeHistory(), popped = [];
  const sync = new HistorySync(h, steps => { popped.push(steps); return true; });
  sync.push(); sync.push();
  sync.handlePop({ thingaryMobile: true, seq: 1 });
  assert.deepEqual(popped, [1]); assert.equal(sync.seq, 1);
  sync.handlePop(null); assert.deepEqual(popped, [1, 1]); assert.equal(sync.seq, 0);
});
test('历史记录：界面自己返回时消耗对应条目，不重复弹出', () => {
  const h = fakeHistory(), popped = [];
  const sync = new HistorySync(h, steps => { popped.push(steps); return true; });
  sync.push(); sync.back();
  assert.deepEqual(h.log.at(-1), ['back']);
  sync.handlePop({ thingaryMobile: true, seq: 0 });
  assert.deepEqual(popped, []); assert.equal(sync.seq, 0);
  sync.back(); assert.deepEqual(h.log.at(-1), ['back']); assert.equal(h.log.filter(e => e[0] === 'back').length, 1);
});
test('历史记录：保存结果未确定时拒绝后退并回到原位置', () => {
  const h = fakeHistory(); let blocked = true;
  const sync = new HistorySync(h, () => !blocked);
  sync.push();
  sync.handlePop({ thingaryMobile: true, seq: 0 });
  assert.deepEqual(h.log.at(-1), ['go', 1]); assert.equal(sync.seq, 1);
  sync.handlePop({ thingaryMobile: true, seq: 1 }); assert.equal(sync.seq, 1);
  blocked = false; sync.handlePop({ thingaryMobile: true, seq: 0 }); assert.equal(sync.seq, 0);
});
test('左滑吸附：过半或快速滑动展开，轻触回弹', () => {
  assert.equal(clampSwipe(-300, 176), -176); assert.equal(clampSwipe(20, 176), 0);
  assert.equal(settleSwipe(-100, 176, 0), true); assert.equal(settleSwipe(-60, 176, 0), false);
  assert.equal(settleSwipe(-20, 176, -0.8), true); assert.equal(settleSwipe(-150, 176, 0.8), false);
});
