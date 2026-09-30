// U18 第二修订轮（复审 P2-1）真实按键交互测试：Tab/Enter/方向键/Esc/键入
// 全部走浏览器键盘输入管线（不用 fill 直写值，键入必须以焦点为前提）。
// 结果写 revision/revision2-interaction.json，不覆盖首轮 revision-interaction.json。
import { writeFileSync } from 'node:fs';
const OUT = '/Users/jackzhu/Code/Own/Possio/docs/ui/desktop-layout/revision/revision2-interaction.json';
const results = { startedAt: new Date().toISOString(), checks: [], errors: [] };
const record = (name, pass, detail) => { results.checks.push({ name, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail).slice(0, 200)); };

const task = await taskSpace('U18 第二修订轮键盘测试');
const page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String((e.error&&e.error.message)||e.message))});window.addEventListener("unhandledrejection",function(e){window.__errs.push(String(e.reason&&e.reason.message||e.reason))})' });
const setView = (w, h) => page.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const errs = () => page.evaluate(() => window.__errs ?? []);
const PRE = 'http://127.0.0.1:1429/visual-preview.html';

// 1) 键盘打开：Tab 循环聚焦「更多分类」→ Enter → 焦点应进搜索框。
await setView(1280, 820);
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30`);
await page.waitForSelector('.cat-more', { timeout: 15000 });
await page.waitForTimeout(600);
let focused = '';
for (let i = 0; i < 80 && focused !== '更多分类 ▾'; i++) {
  await page.keyboard.press('Tab');
  focused = await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName || '');
}
await page.keyboard.press('Enter');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.waitForTimeout(400);
let s = await page.evaluate(() => ({
  active: document.activeElement?.className,
  isSearch: document.activeElement === document.querySelector('.cat-menu-search'),
  visible: getComputedStyle(document.querySelector('.cat-menu-panel')).visibility,
}));
record('1 键盘打开菜单后焦点进搜索框', s.isSearch && s.visible === 'visible', s);

// 2) 真实键入「望远」：搜索框值更新、选项过滤（不用 fill）。
await page.keyboard.type('望远');
await page.waitForTimeout(400);
s = await page.evaluate(() => ({
  value: document.querySelector('.cat-menu-search')?.value,
  items: [...document.querySelectorAll('.cat-menu-item .cat-menu-name')].map(x => x.textContent),
}));
record('2 键入过滤（值与选项）', s.value === '望远' && s.items.includes('望远镜与观鸟') && s.items.length === 3, s);

// 3) ↓ 进第一个选项（列表首位是固定项「全部分类」）；↑ 回搜索框；继续 ↓ 到
// 具体匹配项；Enter 选中并关闭、焦点回触发钮、外显。
await page.keyboard.press('ArrowDown');
let mid = await page.evaluate(() => document.activeElement?.textContent?.trim());
await page.keyboard.press('ArrowUp');
mid += '|' + await page.evaluate(() => document.activeElement === document.querySelector('.cat-menu-search') ? 'search' : 'other');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
const beforeClose = await page.evaluate(() => document.activeElement?.textContent?.trim());
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
s = await page.evaluate(() => ({
  menuOpen: !!document.querySelector('.cat-menu-panel'),
  pressed: [...document.querySelectorAll('.cat-chip-row .cat-chip')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()),
  focused: document.activeElement?.textContent?.trim() ?? '',
}));
record('3 方向键导航与 Enter 选中', mid.startsWith('✓全部分类|search') && beforeClose === '望远镜与观鸟' && !s.menuOpen && s.pressed.includes('望远镜与观鸟') && s.focused.startsWith('更多分类'), { mid, beforeClose, ...s });

// 4) 再次键盘打开 → Esc 关闭回触发钮，页面无副作用。
await page.keyboard.press('Enter');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
s = await page.evaluate(() => ({
  menuOpen: !!document.querySelector('.cat-menu-panel'),
  focused: document.activeElement?.textContent?.trim()?.slice(0, 8),
  dialogs: document.querySelectorAll('dialog[open]').length,
}));
record('4 Esc 关菜单回触发钮且不穿透页面', !s.menuOpen && s.focused.startsWith('更多分类') && s.dialogs === 0, s);

// 5) 错误态：键盘打开后焦点在「重试」，Enter 触发重试无报错。
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30&taxonomy-error=1`);
await page.waitForSelector('.cat-more', { timeout: 15000 });
await page.waitForTimeout(600);
focused = '';
for (let i = 0; i < 80 && !focused.startsWith('更多分类'); i++) {
  await page.keyboard.press('Tab');
  focused = await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName || '');
}
await page.keyboard.press('Enter');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.waitForTimeout(400);
s = await page.evaluate(() => ({
  active: document.activeElement?.textContent?.trim(),
  isRetry: document.activeElement?.hasAttribute?.('data-cat-retry'),
}));
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const afterRetry = await page.evaluate(() => ({ panel: !!document.querySelector('.cat-menu-panel'), errs: window.__errs ?? [] }));
record('5 错误态键盘打开焦点在重试且 Enter 可重试', s.isRetry && afterRetry.panel && afterRetry.errs.length === 0, { ...s, afterRetry });

// 6) 鼠标路径回归：点开菜单焦点同样进搜索框；选项点击；点外部关闭。
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30`);
await page.waitForSelector('.cat-more', { timeout: 15000 });
await page.waitForTimeout(600);
await page.click('.cat-more');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.waitForTimeout(400);
s = await page.evaluate(() => ({ isSearch: document.activeElement === document.querySelector('.cat-menu-search') }));
await page.evaluate(() => { [...document.querySelectorAll('.cat-menu-item')].find(b => b.textContent.includes('电脑与办公'))?.click(); });
await page.waitForTimeout(500);
s = { ...s, pressed: await page.evaluate(() => [...document.querySelectorAll('.cat-chip-row .cat-chip')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim())) };
await page.click('.cat-more');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.mouse.click(640, 500);
await page.waitForTimeout(400);
const closed = await page.evaluate(() => !!document.querySelector('.cat-menu-panel'));
record('6 鼠标路径回归（打开聚焦/点选/点外关闭）', s.isSearch && s.pressed.includes('电脑与办公') && !closed, { ...s, closedByOutside: !closed });

// 7) 回归：R1 无页面错误；R2 tabs 三档不重叠。
const allErrs = await errs();
await setView(1080, 760);
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30`);
await page.waitForSelector('.cat-chip-row', { timeout: 15000 });
await page.waitForTimeout(600);
const r1 = await page.evaluate(() => ({ chips: document.querySelectorAll('.cat-chip-row .cat-chip').length, errs: window.__errs ?? [] }));
await setView(800, 600);
await page.goto(`${PRE}?style=native&theme=light&section=recurring&recurring-fixture=30&recurring-tab=payments`);
await page.waitForSelector('.recurring-tabs button', { timeout: 15000 });
const r2 = await page.evaluate(() => {
  const [a, b] = [...document.querySelectorAll('.recurring-tabs button')];
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return { widths: [Math.round(ra.width), Math.round(rb.width)], overlap: ra.right > rb.left + 0.5, fits: a.scrollWidth <= a.clientWidth + 1 && b.scrollWidth <= b.clientWidth + 1 };
});
record('7 回归 R1/R2', r1.chips >= 2 && r1.errs.length === 0 && r2.widths.every(x => x > 26) && !r2.overlap && r2.fits, { r1, r2 });

// 8) 键盘打开菜单的证据截图（1280×820 B 浅，焦点在搜索框）。
await setView(1280, 820);
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30`);
await page.waitForSelector('.cat-more', { timeout: 15000 });
await page.waitForTimeout(600);
focused = '';
for (let i = 0; i < 80 && focused !== '更多分类 ▾'; i++) {
  await page.keyboard.press('Tab');
  focused = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
}
await page.keyboard.press('Enter');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.waitForTimeout(400);
s = await page.evaluate(() => ({ isSearch: document.activeElement === document.querySelector('.cat-menu-search') }));
if (s.isSearch) {
  await page.screenshot({ path: '/Users/jackzhu/Code/Own/Possio/docs/ui/desktop-layout/after/category-menu-keyboard-1280x820-B-light.png' });
  record('8 键盘打开菜单证据截图（焦点在搜索框）', true, s);
} else record('8 键盘打开菜单证据截图', false, s);

results.finishedAt = new Date().toISOString();
results.allPass = results.checks.every(c => c.pass);
results.errors = await errs();
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('ALL-PASS:', results.allPass);
await task.finish({ keep: [] });
process.exit(results.allPass ? 0 : 1);
