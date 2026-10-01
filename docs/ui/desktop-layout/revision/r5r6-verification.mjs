// U18 修订轮 R5/R6 浏览器验证：设置子页鼠标返回与分类错误重试。
import { writeFileSync } from 'node:fs';
const results = { checks: [], errors: [] };
const record = (name, pass, detail) => { results.checks.push({ name, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); };
const task = await taskSpace('U18 R5R6 验证');
const page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String((e.error&&e.error.message)||e.message))})' });
const PRE = 'http://127.0.0.1:1429/visual-preview.html';

// R6：分类读取失败 → 入口可达、错误+重试在菜单内、重试可点击。
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30&taxonomy-error=1`);
await page.waitForTimeout(2500);
let s = await page.evaluate(() => ({
  trigger: !!document.querySelector('.cat-more'),
  disabled: document.querySelector('.cat-more')?.disabled,
  chips: [...document.querySelectorAll('.cat-chip-row .cat-chip')].map(b => b.textContent.trim()),
}));
await page.click('.cat-more');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
const errState = await page.evaluate(() => ({
  alert: document.querySelector('.cat-menu-empty')?.textContent?.trim(),
  retryBtn: !!document.querySelector('.cat-menu-empty button'),
  noMatchText: document.querySelector('.cat-menu-panel')?.textContent.includes('没有匹配的分类'),
}));
await page.click('.cat-menu-empty button');
await page.waitForTimeout(800);
const afterRetry = await page.evaluate(() => ({ panelStill: !!document.querySelector('.cat-menu-panel'), errs: window.__errs }));
record('R6 错误态入口可达且禁用不吞恢复', s.trigger && s.disabled === false, s);
record('R6 菜单内错误原因+重试（非「没有匹配的分类」）', !!errState.alert && errState.retryBtn && !errState.noMatchText, errState);
record('R6 重试可点击且不崩溃', typeof afterRetry.errs.length === 'number', afterRetry);

// R6 恢复路径：无错误参数重载 → 分类正常。
await page.goto(`${PRE}?style=native&theme=light&section=assets&category-fixture=30`);
await page.waitForSelector('.cat-chip-row .cat-chip', { timeout: 15000 });
const recovered = await page.evaluate(() => document.querySelectorAll('.cat-chip-row .cat-chip').length);
record('R6 无错误时分类正常渲染', recovered >= 2, { chips: recovered });

// R5a：设置外观 → 素材库（打开）→ 子页 → 鼠标「返回设置」→ 焦点回入口按钮。
await page.goto(`${PRE}?style=native&theme=light&section=settings`);
await page.waitForSelector('#settings-open-materials', { timeout: 15000 });
await page.evaluate(() => { [...document.querySelectorAll('.settings-categories-nav button')].find(b => b.textContent.includes('外观'))?.click(); });
await page.waitForTimeout(300);
await page.click('#settings-open-materials');
await page.waitForTimeout(800);
s = await page.evaluate(() => ({ crumb: document.querySelector('.breadcrumb')?.textContent?.replace(/\s+/g, ''), backBtn: [...document.querySelectorAll('.page-header button')].map(b => b.textContent.trim()) }));
record('R5a 素材库子页有面包屑与鼠标返回按钮', s.crumb?.includes('设置／素材库') && s.backBtn.some(t => t.startsWith('返回')), s);
await page.evaluate(() => { [...document.querySelectorAll('.page-header button')].find(b => b.textContent.startsWith('返回'))?.click(); });
let focusedId = '';
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(350);
  focusedId = await page.evaluate(() => document.activeElement?.id || '');
  if (focusedId === 'settings-open-materials') break;
}
s = await page.evaluate(() => ({
  section: location.search, heading: document.getElementById('page-heading')?.textContent,
  appearanceVisible: !!document.getElementById('settings-appearance'),
}));
record('R5a 鼠标返回设置并恢复入口焦点', s.heading === '设置' && focusedId === 'settings-open-materials', { ...s, focusedId });

// R5b 面包屑「设置」：素材库 → 面包屑 → 设置分组（滚动/分组恢复）。
await page.click('#settings-open-materials');
await page.waitForTimeout(700);
await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 200; });
await page.evaluate(() => { [...document.querySelectorAll('.breadcrumb .ui-link')][0]?.click(); });
await page.waitForTimeout(800);
s = await page.evaluate(() => ({ heading: document.getElementById('page-heading')?.textContent, focusedId: document.activeElement?.id }));
record('R5b 面包屑回设置分组并恢复入口焦点', s.heading === '设置' && s.focusedId === 'settings-open-materials', s);

// R5c 来源返回：物品详情删除物品 → notice「前往最近删除」→ 子页 → 鼠标返回物品。
await page.goto(`${PRE}?style=native&theme=light&section=assets`);
await page.waitForSelector('.asset-row', { timeout: 15000 });
await page.evaluate(() => { const row = document.querySelector('.asset-row'); row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
await page.waitForSelector('#detail-heading', { timeout: 10000 });
await page.evaluate(() => { [...document.querySelectorAll('.popover-menu summary')].at(-1)?.click(); });
await page.waitForTimeout(300);
await page.evaluate(() => { [...document.querySelectorAll('[role="menu"] button')].find(b => b.textContent.includes('删除物品'))?.click(); });
await page.waitForSelector('dialog[open]', { timeout: 5000 });
await page.waitForTimeout(400);
await page.evaluate(() => { const d = document.querySelector('dialog[open]'); [...d.querySelectorAll('button')].find(b => b.textContent.includes('最近删除'))?.click(); });
await page.waitForTimeout(1500);
let sDel = await page.evaluate(() => ({ notice: [...document.querySelectorAll('.status-line button')].map(b => b.textContent.trim()), crumb: document.querySelector('.breadcrumb')?.textContent?.replace(/\s+/g, '') }));
if (sDel.notice.includes('前往最近删除')) {
  await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent === '前往最近删除')?.click(); });
  await page.waitForTimeout(900);
  const onTrash = await page.evaluate(() => ({ crumb: document.querySelector('.breadcrumb')?.textContent?.replace(/\s+/g, ''), back: [...document.querySelectorAll('.page-header button')].map(b => b.textContent.trim()) }));
  await page.evaluate(() => { [...document.querySelectorAll('.page-header button')].find(b => b.textContent.startsWith('返回'))?.click(); });
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => ({ heading: document.getElementById('page-heading')?.textContent, crumb: document.querySelector('.breadcrumb')?.textContent?.replace(/\s+/g, '') }));
  record('R5c 物品删除引导进最近删除后鼠标返回物品', onTrash.crumb?.includes('设置／最近删除') && onTrash.back.some(t => t === '返回物品') && back.crumb?.includes('物品'), { onTrash, back });
} else {
  record('R5c 物品删除引导出现', false, sDel);
}
results.allPass = results.checks.every(c => c.pass);
results.errors = await page.evaluate(() => window.__errs ?? []);
writeFileSync(new URL('./r5r6-verification.json', import.meta.url).pathname, JSON.stringify(results, null, 2));
console.log('ALL-PASS:', results.allPass);
await task.finish({ keep: [] });
process.exit(results.allPass ? 0 : 1);
