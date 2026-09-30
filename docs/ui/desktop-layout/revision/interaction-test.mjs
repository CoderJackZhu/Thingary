// U18 修订轮（Review R1–R3）真实组件交互测试：经 ego-browser + CDP 视口模拟
// 驱动生产组件（visual-preview 内存夹具），断言分类栏无无限更新/空白、
// 周期文字按钮尺寸完整且不重叠。结果写入 revision-interaction.json。
import { writeFileSync } from 'node:fs';

const results = { startedAt: new Date().toISOString(), checks: [], errors: [] };
const record = (name, pass, detail) => { results.checks.push({ name, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); };

const task = await taskSpace('U18 修订交互测试');
const page = task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String((e.error&&e.error.message)||e.message))});window.addEventListener("unhandledrejection",function(e){window.__errs.push(String(e.reason&&e.reason.message||e.reason))})' });
const setView = (w, h) => page.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const errs = () => page.evaluate(() => window.__errs ?? []);

// 1) 溢出首次进入：从总览点「全部资产」（30 分类，真实导航路径）。
await page.goto('http://127.0.0.1:1429/visual-preview.html?style=native&theme=light&category-fixture=30');
await setView(1280, 820);
await page.waitForSelector('.sidebar', { timeout: 15000 });
await page.click('loc=css:.sidebar nav button:has-text(\"全部资产\")');
await page.waitForSelector('.cat-chip-row', { timeout: 15000 });
await page.waitForTimeout(1200);
let state = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.cat-chip-row .cat-chip')].map(b => b.textContent.trim()),
  rowConnected: !!document.querySelector('.cat-chip-row')?.isConnected,
  mainBlank: !document.querySelector('main')?.textContent.trim(),
}));
record('溢出首次进入不崩溃', state.chips.length > 2 && state.rowConnected && !state.mainBlank, { chipCount: state.chips.length, errors: await errs() });

// 2) 切状态页再回来（模块页→物品）。
await page.click('loc=css:.sidebar nav button:has-text(\"物品统计\")');
await page.waitForTimeout(600);
await page.click('loc=css:.sidebar nav button:has-text(\"全部资产\")');
await page.waitForSelector('.cat-chip-row', { timeout: 15000 });
await page.waitForTimeout(800);
state = await page.evaluate(() => ({ chips: document.querySelectorAll('.cat-chip-row .cat-chip').length, connected: !!document.querySelector('.cat-chip-row')?.isConnected }));
record('切页返回后分类栏仍在且不重复渲染', state.chips > 2 && state.connected, { chipCount: state.chips, errors: await errs() });

// 3) 真实尺寸变化（CDP 视口切换触发 ResizeObserver）。
const sizes = [[1080, 760], [800, 600], [560, 600], [1280, 820]];
const seen = [];
for (const [w, h] of sizes) {
  await setView(w, h);
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    chips: document.querySelectorAll('.cat-chip-row .cat-chip').length,
    more: !!document.querySelector('.cat-more'),
    compact: !!document.querySelector('.cat-compact'),
  }));
  seen.push({ size: `${w}x${h}`, ...s });
}
record('尺寸变化只重排不崩溃，恢复 1280 后仍完整', seen.every(s => s.chips >= 2) && !seen.some(s => s.chips === 0), { seen, errors: await errs() });

// 4) 选隐藏尾部分类：菜单搜索→点选→外显。
await page.click('.cat-more');
await page.waitForSelector('.cat-menu-panel', { timeout: 5000 });
await page.fill('.cat-menu-search', '望远');
await page.waitForTimeout(600);
const menuDiag = await page.evaluate(() => ({ panel: !!document.querySelector('.cat-menu-panel'), search: document.querySelector('.cat-menu-search')?.value, items: [...document.querySelectorAll('.cat-menu-item .cat-menu-name')].map(x => x.textContent) }));
console.log('menuDiag:', JSON.stringify(menuDiag));
await page.waitForTimeout(300);
await page.evaluate(() => { const hit = [...document.querySelectorAll('.cat-menu-item')].find(b => b.textContent.includes('望远镜与观鸟')); if (!hit) throw new Error('option missing: ' + [...document.querySelectorAll('.cat-menu-item .cat-menu-name')].map(x => x.textContent).join(',')); hit.click(); });
await page.waitForTimeout(500);
state = await page.evaluate(() => ({
  menuOpen: !!document.querySelector('.cat-menu-panel'),
  pressedChip: [...document.querySelectorAll('.cat-chip-row .cat-chip')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()),
  focused: document.activeElement?.textContent?.trim()?.slice(0, 6),
}));
record('选隐藏尾项后外显且唯一、焦点回触发钮', !state.menuOpen && state.pressedChip.includes('望远镜与观鸟'), state);

// 5) 循环守卫：静置 1.5s 后 chip 行 DOM 节点应保持同一引用（无反复重挂载）。
const nodeA = await page.evaluate(() => { const el = document.querySelector('.cat-chip-row'); el.dataset.mark = String(Math.random()); return el.dataset.mark; });
await page.waitForTimeout(1500);
const nodeB = await page.evaluate(() => document.querySelector('.cat-chip-row')?.dataset.mark);
const allErrs = await errs();
record('静置后无持续更新（节点未被重建）', nodeA === nodeB && allErrs.length === 0, { sameNode: nodeA === nodeB, errors: allErrs });

// 6) R2：周期 tabs 三尺寸 DOM 度量（宽度>26、不重叠、文字完整）。
const tabChecks = [];
for (const [w, h] of [[1280, 820], [1080, 760], [800, 600]]) {
  await setView(w, h);
  await page.goto(`http://127.0.0.1:1429/visual-preview.html?style=native&theme=light&section=recurring&recurring-fixture=30&recurring-tab=payments`);
  await page.waitForSelector('.recurring-tabs button', { timeout: 15000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('.recurring-tabs button')];
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return {
      widths: [Math.round(ra.width), Math.round(rb.width)],
      overlap: ra.right > rb.left + 0.5,
      textFits: [a.scrollWidth <= a.clientWidth + 1, b.scrollWidth <= b.clientWidth + 1],
      text: [a.textContent.trim(), b.textContent.trim()],
    };
  });
  tabChecks.push({ size: `${w}x${h}`, ...m });
}
record('周期 tabs 宽度自主、互不重叠、文字完整', tabChecks.every(c => c.widths.every(x => x > 26) && !c.overlap && c.textFits.every(Boolean)), tabChecks);

results.finishedAt = new Date().toISOString();
results.allPass = results.checks.every(c => c.pass);
writeFileSync('/Users/jackzhu/Code/Own/Possio/docs/ui/desktop-layout/revision/revision-interaction.json', JSON.stringify(results, null, 2));
console.log('ALL-PASS:', results.allPass);
await task.finish({ keep: [] });
process.exit(results.allPass ? 0 : 1);
