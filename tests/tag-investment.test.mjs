// U17 · 前端验收：纯展示辅助的数值断言 + 关键接线的源码断言。
// 数值预期来自产品设计 D23 的人工计算；后台聚合已由 Rust 测试独立断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentText, percentBar, itemMatches, visibleItems, restoredShown, missingNotice, TAG_PAGE_SIZE,
  purchaseSummaryText, maintenanceSummaryText, maintenanceCellText, analysisAfterScopeChange,
  labelFilterOptions, requestTagView } from '../src/tag-investment.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync as fsRead, writeFileSync, readdirSync } from 'node:fs';

const src = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const app = src('main.tsx');

const view = items => ({
  generation: 'g', today: '2026-09-10', label: { id: 'l', name: '摄影', inactive: false }, scope: 'all',
  counts: { matched: items.length, included: items.length, excluded: 0, active: 2, retired: 1, sold: 1 },
  totals: {
    known_purchase_cents: items.reduce((n, i) => n + BigInt(i.purchase_cents ?? 0), 0n).toString(),
    known_maintenance_cents: '1000', known_investment_cents: '36000', sale_proceeds_cents: '5000', known_net_cents: '31000',
    complete_investment_cents: '36000', complete_net_cents: '31000',
    has_known_purchase: true, has_known_maintenance_record: true, has_known_investment: true,
    missing_purchase_count: 0, missing_maintenance_count: 0, incomplete_asset_count: 0,
  },
  items,
});
const row = (id, investment, purchase = investment) => ({
  id, name: '物品' + id, category_name: '未分类', lifecycle_state: 'active', brand: '', model: '', serial_number: '', notes: '',
  purchase_cents: purchase, known_maintenance_cents: '0', known_maintenance_record_count: 0, missing_maintenance_count: 0,
  known_investment_cents: investment, complete_investment_cents: investment, has_known_investment: true, sale_proceeds_cents: '0', incomplete: false,
});

test('D23 基准占比：41.7／36.1／13.9／8.3，零为 0.0%，微小为 <0.1%', () => {
  const T = '36000';
  assert.equal(percentText(T, '15000'), '41.7%');
  assert.equal(percentText(T, '13000'), '36.1%');
  assert.equal(percentText(T, '5000'), '13.9%');
  assert.equal(percentText(T, '3000'), '8.3%');
  assert.equal(percentText(T, '0'), '0.0%');
  assert.equal(percentText(T, '1'), '<0.1%', '1000×1 < 36000');
  assert.equal(percentText('0', '15000'), null, 'T=0 不计算');
  assert.equal(percentText(T, '36000'), '100.0%');
  // 四舍五入到十分之一百分点：36,000 里 17,500 是 48.611% → 48.6%；18,001 → 50.0%。
  assert.equal(percentText('36000', '17500'), '48.6%');
  assert.equal(percentText('36000', '18001'), '50.0%');
});

test('比例条只是显示投影，且不产生负值或超界', () => {
  assert.equal(percentBar('36000', '18000'), 50);
  assert.equal(percentBar('36000', '0'), null);
  assert.equal(percentBar('0', '100'), null);
  assert.equal(percentBar('36000', '36000'), 100);
});

test('搜索覆盖名称、品牌、型号、分类、备注与序列号，且不重排', () => {
  const item = { ...row('a', '100'), name: '镜头', brand: '虚构品牌', model: '样例型号', category_name: '影音摄影', notes: '周末散步', serial_number: 'TEST-001' };
  for (const keyword of ['镜头', '虚构', '样例', '影音', '散步', 'test-001', 'TEST']) assert.ok(itemMatches(item, keyword), keyword);
  assert.ok(!itemMatches(item, '防水壳'));
  assert.ok(itemMatches(item, ''), '空关键词放行全部');
});

test('分段：先全量搜索再取前 n 件；恢复条数受合法上限约束', () => {
  const items = Array.from({ length: 250 }, (_, i) => row('id' + String(i).padStart(3, '0'), String(i + 1)));
  const v = view(items);
  const first = visibleItems(v, '', TAG_PAGE_SIZE);
  assert.equal(first.rows.length, 100);
  assert.equal(first.matched, 250);
  const more = visibleItems(v, '', 200);
  assert.equal(more.rows.length, 200);
  const searched = visibleItems(v, '物品id24', 100);
  assert.equal(searched.matched, 10, 'id240–id249');
  assert.equal(searched.rows.length, 10);
  assert.equal(restoredShown(500, 103), 200, '总数减少时取合法上限');
  assert.equal(restoredShown(500, 30), 100, '少于首段回到首段');
  assert.equal(restoredShown(100, 250), 100);
});

test('未知提示逐项列出缺失与排除，完整组不显示', () => {
  const totals = {
    known_purchase_cents: '0', known_maintenance_cents: '0', known_investment_cents: '0', sale_proceeds_cents: '0', known_net_cents: '0',
    complete_investment_cents: null, complete_net_cents: null, has_known_purchase: false, has_known_maintenance_record: false, has_known_investment: false,
    missing_purchase_count: 1, missing_maintenance_count: 2, incomplete_asset_count: 2,
  };
  assert.equal(missingNotice(totals, 3), '购入金额未知 1 件 · 维护费用未知 2 条 · 3 件已设为不计入统计 · 补全金额后可查看占比。');
  assert.equal(missingNotice({ ...totals, missing_purchase_count: 0, missing_maintenance_count: 0, complete_investment_cents: '10' }, 0), null);
  assert.equal(missingNotice({ ...totals, missing_purchase_count: 0, missing_maintenance_count: 0, complete_investment_cents: '10' }, 2), '2 件已设为不计入统计。');
});

test('入口与快捷键接线：分析子视图没有新增动作，⌘A 不触发批量', () => {
  assert.match(app, /query\.label && query\.label !== 'none' && <button type="button" className="ui-btn sm analysis-entry" onClick=\{enterAnalysis\}>查看投入分析/);
  assert.match(app, /if \(analysis && !detailId\) return \{ search: \{ key: 'assets', placeholder: '搜索标签内物品' \} \};/, '顶栏只注册搜索');
  assert.match(app, /if \(analysis && !detailId\) return \{ search: \{ key: 'assets', placeholder: '搜索标签内物品' \} \};\s*return detailId/, '分析分支立即返回，不带新增主操作');
  assert.match(app, /if \(section !== 'assets' \|\| detailId \|\| analysis \|\| !page\) return;/, '⌘A 在分析中不动作');
  assert.match(app, /if \(key === 'assets' && analysis && !detailId\) \{ analysisSearch\(value\); return; \}/, '分析搜索不写列表查询');
  assert.match(app, /if \(detailId\) \{ event\.preventDefault\(\); back\(\); return; \}\s*if \(analysis\) \{ event\.preventDefault\(\); exitToAssetList\(\); \}/, 'Esc 先详情回分析、再分析回列表');
});

test('两层返回与失效：切库清空分析与标签范围，详情返回重查', () => {
  assert.match(app, /setAnalysis\(null\);\s*if \(query\.search \|\| query\.label\) adjust\(\{ search: '', label: null \}\);/, '切库退出分析并清标签');
  assert.match(app, /if \(section !== 'assets'\) setAnalysis\(null\);/, '离开物品区退出分析链');
  assert.match(app, /if \(analysis\) \{\s*\/\/ 详情 → 分析：重查已提交事实[\s\S]*?void refresh\(\);/, '详情返回重查');
  assert.match(app, /focusAsset: id, viewScroll: mainRef\.current\?\.scrollTop \?\? 0/, '打开详情保存分析视图状态');
});

const totalsOf = (over = {}) => ({
  known_purchase_cents: '0', known_maintenance_cents: '0', known_investment_cents: '0',
  sale_proceeds_cents: '0', known_net_cents: '0', complete_investment_cents: null, complete_net_cents: null,
  has_known_purchase: false, has_known_maintenance_record: false, has_known_investment: false,
  missing_purchase_count: 0, missing_maintenance_count: 0, incomplete_asset_count: 0, ...over,
});
const itemOf = (over = {}) => ({
  id: 'a', name: '物品', category_name: '未分类', lifecycle_state: 'active', brand: '', model: '', serial_number: '', notes: '',
  purchase_cents: '10000', known_maintenance_cents: '0', known_maintenance_record_count: 0, missing_maintenance_count: 0,
  known_investment_cents: '10000', complete_investment_cents: '10000', has_known_investment: true,
  sale_proceeds_cents: '0', incomplete: false, ...over,
});
const viewOf = (over = {}) => ({
  generation: 'g', today: '2026-09-30', label: { id: 'l', name: '摄影', inactive: false }, scope: 'all',
  counts: { matched: 1, included: 1, excluded: 0, active: 1, retired: 0, sold: 0 },
  totals: totalsOf({ has_known_purchase: true, known_purchase_cents: '10000', known_investment_cents: '10000', complete_investment_cents: '10000', complete_net_cents: '10000' }),
  items: [itemOf()], ...over,
});

test('R1 维护分项：无记录为确定零、只有未知为待补录、混合标已知（摘要一致）', () => {
  assert.equal(maintenanceSummaryText(totalsOf({ missing_maintenance_count: 1 })), '待补录');
  assert.equal(maintenanceSummaryText(totalsOf()), '¥0');
  assert.equal(maintenanceSummaryText(totalsOf({ has_known_maintenance_record: true, known_maintenance_cents: '100000', missing_maintenance_count: 1 })), '已知 ¥1,000');
  assert.equal(maintenanceSummaryText(totalsOf({ has_known_maintenance_record: true, known_maintenance_cents: '100000' })), '¥1,000');
  assert.equal(purchaseSummaryText(totalsOf()), '待补录');
  assert.equal(purchaseSummaryText(totalsOf({ has_known_purchase: true, known_purchase_cents: '100000' })), '¥1,000');
  assert.equal(purchaseSummaryText(totalsOf({ has_known_purchase: true, known_purchase_cents: '100000', missing_purchase_count: 1 })), '已知 ¥1,000');
});

test('R1 明细维护单元格与窄窗副行共用同一文案（三处一致）', () => {
  assert.equal(maintenanceCellText(itemOf()), '¥0');
  assert.equal(maintenanceCellText(itemOf({ missing_maintenance_count: 2 })), '待补录', '只有未知记录不得显示 ¥0 + 待补录');
  assert.equal(maintenanceCellText(itemOf({ known_maintenance_record_count: 1, known_maintenance_cents: '50000', missing_maintenance_count: 1 })), '已知 ¥500 · 待补录');
  assert.equal(maintenanceCellText(itemOf({ known_maintenance_record_count: 2, known_maintenance_cents: '100000' })), '¥1,000');
});

// 真实渲染：tsc 预编译 TagInvestment.tsx（CJS，输出在 node_modules/.cache 不入库），
// renderToStaticMarkup 以内存 DTO 夹具断言输出——不是源码正则。
let renderBodyCache;
async function renderBody() {
  if (renderBodyCache) return renderBodyCache;
  const { root } = { root: new URL('..', import.meta.url).pathname };
  // 项目源码用 .ts 扩展名导入（TS5097 使 tsc 退出非零，但产物正常输出）。
  try {
    execFileSync('npx', ['tsc', 'src/TagInvestment.tsx', '--jsx', 'react-jsx', '--module', 'commonjs',
      '--target', 'es2022', '--moduleResolution', 'node', '--esModuleInterop', '--skipLibCheck',
      '--outDir', 'node_modules/.cache/u17-render'], { cwd: root, stdio: 'pipe' });
  } catch { /* 产物存在性由下方导入校验 */ }
  // tsc 不重写扩展名：把产物中的 require("./x.ts") 归一为 require("./x")。
  const outDir = new URL('../node_modules/.cache/u17-render/', import.meta.url).pathname;
  for (const file of readdirSync(outDir)) {
    if (!file.endsWith('.js')) continue;
    const path = outDir + file;
    writeFileSync(path, readFileSync(path, 'utf8').replace(/(require\(["']\.[^"']*)\.ts(["'])/g, '$1$2'));
  }
  const mod = await import(new URL('../node_modules/.cache/u17-render/TagInvestment.js', import.meta.url).href);
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  renderBodyCache = (state, view, loading, error, callbacks) =>
    // React SSR 在文本表达式边界插入 <!-- -->，归一化后断言。
    renderToStaticMarkup(React.createElement(mod.TagInvestmentBody, { state, view, loading, error, ...callbacks })).replace(/<!-- -->/g, '');
  return renderBodyCache;
}

test('R1 渲染断言：内存 DTO 夹具真实渲染组件，三处文案不冒零', async () => {
  const render = await renderBody();
  const noops = { onRetry: () => {}, onScope: () => {}, onSearch: () => {}, onMore: () => {}, onOpenAsset: () => {}, onBackToList: () => {} };
  const state = { labelId: 'l', labelName: '摄影', scope: 'all', search: '', shown: TAG_PAGE_SIZE, listScroll: 0, viewScroll: 0, focusAsset: null };
  const cell = over => itemOf({ purchase_cents: '1500000', known_investment_cents: '1500000', complete_investment_cents: null, incomplete: true, ...over });
  // Review R1 复现态：维护已知记录 0、未知 1。
  const unknownOnly = viewOf({ totals: totalsOf({ missing_maintenance_count: 1, missing_purchase_count: 0, has_known_purchase: true, known_purchase_cents: '1500000', known_investment_cents: '1500000' }), items: [cell({ missing_maintenance_count: 1, known_maintenance_record_count: 0, known_maintenance_cents: '0' })] });
  const html = render(state, unknownOnly, false, '', noops);
  assert.ok(html.includes('维护 待补录'), '摘要行待补录');
  assert.ok(!html.includes('维护 ¥0'), '摘要不得冒零');
  assert.ok((html.match(/>待补录</g) ?? []).length >= 2, '宽表与窄窗副行的维护单元格都是待补录');
  // 混合态：已知 ¥1,000 + 1 条未知。
  const mixed = viewOf({ totals: totalsOf({ has_known_purchase: true, known_purchase_cents: '1200000', has_known_maintenance_record: true, known_maintenance_cents: '100000', known_investment_cents: '1300000', missing_maintenance_count: 1 }), items: [cell({ purchase_cents: '1200000', known_maintenance_record_count: 1, known_maintenance_cents: '100000', missing_maintenance_count: 1, known_investment_cents: '1300000' })] });
  const mixedHtml = render(state, mixed, false, '', noops);
  assert.ok(mixedHtml.includes('维护 已知 ¥1,000'), '混合态摘要标已知');
  assert.ok(mixedHtml.includes('已知 ¥1,000 · 待补录'), '明细单元格列出已知与缺失');
  // 无记录：确定零。
  const cleanHtml = render(state, viewOf(), false, '', noops);
  assert.ok(cleanHtml.includes('维护 ¥0'), '无记录时显示确定零');
});

test('R2 停用标签保留在筛选选项并标注（回顾入口可达）', () => {
  const options = labelFilterOptions([
    { id: 'a', name: '工作用', enabled: true },
    { id: 'b', name: '摄影', enabled: false },
    { id: 'c', name: '回顾', enabled: false },
  ]);
  assert.equal(options.length, 3, '停用标签不被过滤');
  assert.deepEqual(options.filter(o => o.inactive).map(o => o.text), ['摄影（已停用）', '回顾（已停用）']);
  assert.deepEqual(options.filter(o => !o.inactive).map(o => o.text), ['工作用']);
  assert.equal(options.find(o => o.id === 'b').name, '摄影', '原名称保留供分析标题使用');
  assert.match(app, /labelFilterOptions\(tags\)\.map/);
  assert.ok(!app.includes('tags.filter(t => t.enabled || t.id === query.label)'), '旧过滤表达式已移除');
});

test('R4 切范围重置明细分段并保留关键词；详情返回路径不经此函数', () => {
  const before = { labelId: 'l', labelName: '摄影', scope: 'all', search: '镜头', shown: 200, listScroll: 42, viewScroll: 1000, focusAsset: null };
  const after = analysisAfterScopeChange(before, 'held');
  assert.equal(after.scope, 'held');
  assert.equal(after.shown, TAG_PAGE_SIZE, '超过一页时切范围回到首段（Review R4）');
  assert.equal(after.search, '镜头', '关键词保留（D23）');
  assert.equal(after.listScroll, 42, '来源列表上下文保留');
  assert.equal(before.shown, 200, '原状态不被就地修改');
  const backBranch = app.slice(app.indexOf('if (analysis) {'), app.indexOf('if (analysis) {') + 320);
  assert.ok(!backBranch.includes('analysisAfterScopeChange'), '详情返回不重置分段');
  assert.match(app, /analysisAfterScopeChange\(a, scope\)/, '范围切换经统一函数');
});

test('乱序响应（执行测试）：旧成功/旧失败晚于新请求均不覆盖，失效后为 late', async () => {
  const named = name => viewOf({ label: { id: 'l', name, inactive: false } });
  // 场景 1：A 成功慢、B 成功快 → 只应用 B。
  {
    let resolveA;
    const send = labelId => labelId === 'a'
      ? new Promise(resolve => { resolveA = resolve; })
      : Promise.resolve(named('B'));
    let current = 1;
    const outcomeA = requestTagView(send, () => current === 1, 'a', 'all');
    const outcomeB = requestTagView(send, () => current === 2, 'b', 'all');
    current = 2;
    assert.equal((await outcomeB).state, 'applied');
    resolveA(named('A'));
    assert.equal((await outcomeA).state, 'late', '旧成功不得覆盖新结果');
  }
  // 场景 2：A 失败慢、B 成功快 → B 保留。
  {
    let rejectA;
    const send = labelId => labelId === 'a'
      ? new Promise((_, reject) => { rejectA = reject; })
      : Promise.resolve(named('B'));
    let current = 1;
    const outcomeA = requestTagView(send, () => current === 1, 'a', 'all');
    const outcomeB = requestTagView(send, () => current === 2, 'b', 'all');
    current = 2;
    assert.equal((await outcomeB).state, 'applied');
    rejectA(new Error('旧请求失败'));
    assert.equal((await outcomeA).state, 'late', '旧失败不得清掉新结果');
  }
  // 场景 3：当前票据的失败 → failed 且携带可读信息。
  {
    const outcome = await requestTagView(() => Promise.reject(new Error('boom')), () => true, 'a', 'all');
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.message, 'boom');
  }
  // 场景 4：组件卸载（票据失效）后的晚失败 → late。
  {
    let reject;
    const send = () => new Promise((_, r) => { reject = r; });
    let alive = true;
    const outcome = requestTagView(send, () => alive, 'a', 'all');
    alive = false;
    reject(new Error('late failure'));
    assert.equal((await outcome).state, 'late');
  }
});

test('汇总不受搜索影响（KPI 直读响应整体；分页脚注明分母差异）', () => {
  const comp = src('TagInvestment.tsx');
  for (const field of ['totals.known_investment_cents', 'totals.sale_proceeds_cents', 'counts.included', 'complete_investment_cents']) {
    assert.ok(comp.includes(field), field);
  }
  assert.match(comp, /visibleItems\(view, state\.search, state\.shown\)/);
  assert.match(comp, /已显示 \{shownRows\} \/ 共 \{matched\} 件/);
  assert.match(comp, /汇总仍为全部 \$\{view\.counts\.included\} 件/);
  assert.match(comp, /「\{label\}」投入读取失败：\{error\}/);
  assert.match(comp, /已保留标签与范围，未展示部分汇总/);
});

test('前端占比用 BigInt 精确整数比，不做浮点累加', () => {
  const helpers = src('tag-investment.ts');
  assert.match(helpers, /1000n \* v < t/);
  assert.match(helpers, /\(2000n \* v \+ t\) \/ \(2n \* t\)/);
  assert.ok(!/Number\((totals|known)/.test(helpers), '金额不求和，只由后端返回');
});

test('预览与原生共享虚构标签事实；状态文案区分空、排除与搜索无结果', () => {
  const preview = src('visual-preview.ts');
  assert.match(preview, /id:'label-photo',name:'摄影'/);
  assert.match(preview, /previewPrefs\(\(a as \{label\?: string\}\)\.label\)/);
  assert.match(preview, /tag_investment_view/);
  assert.match(preview, /exclude\.statistics/);
  const comp = src('TagInvestment.tsx');
  assert.match(comp, /这个标签下还没有物品/);
  assert.match(comp, /这个标签下没有当前持有的物品/);
  assert.match(comp, /件物品均设置了不计入统计/);
  assert.match(comp, /没有匹配「\{state\.search\.trim\(\)\}」的物品/);
  assert.match(comp, /清除搜索/);
});
