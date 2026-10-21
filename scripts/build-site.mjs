// Build a portable static website from the canonical Markdown, without dependencies.
import { readFileSync, writeFileSync, mkdirSync, cpSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, escapeHtml } from './guide-renderer.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(root, '.local/pages-preview'));
if (output === root || output === join(root, 'site')) throw new Error('Choose a separate build output directory');
mkdirSync(output, { recursive: true });
cpSync(join(root, 'site'), output, { recursive: true });
// The calculator runs the same planning engine as the app, from its committed WASM build.
const engineSource = readFileSync(join(root, 'src/planning-engine-wasm.ts'), 'utf8').match(/planningEngineWasm = '([A-Za-z0-9+/=]+)'/);
if (!engineSource) throw new Error('Planning engine WASM not found');
writeFileSync(join(output, 'calc/engine.wasm'), Buffer.from(engineSource[1], 'base64'));
mkdirSync(join(output, 'docs/images'), { recursive: true });
// Copy only image assets; never publish internal acceptance or user records.
const homepage = readFileSync(join(root, 'site/index.html'), 'utf8').replaceAll('../docs/images/', 'docs/images/');
writeFileSync(join(output, 'index.html'), homepage);
// The homepage owns the shared site header, language controls and brand symbols.
// Reuse its markup so documentation cannot drift into a separate navigation.
const sharedPrelude = homepage.match(/<body>([\s\S]*?)<div class="site">/)[1];
const sharedHeader = homepage.match(/<header class="header wrap">[\s\S]*?<\/header>/)[0];
function siteHeader(prefix) {
  return sharedHeader.replace(/href="(#main|#features|#privacy|guide\/|calc\/)"/g,
    (_, target) => `href="${prefix}${target}"${target === 'guide/' ? ' aria-current="page"' : ''}`);
}

const images = new Set([...homepage.matchAll(/docs\/(images\/[\w.-]+)/g)].map(m => m[1]));
const source = readFileSync(join(root, 'docs/USER_GUIDE.md'), 'utf8');
const quickstart = readFileSync(join(root, 'docs/QUICKSTART.md'), 'utf8');
const groups = [
  ['start', '安装与第一次使用', '选对安装包，从样例开始，完成第一次记录。', ['三步上手','下载、安装与首次打开','五分钟入门：完成第一次账户盘点','五分钟入门：记录第一件物品','样例体验']],
  ['accounts', '账户、盘点与收支', '核对余额、外币和投资，区分收入、支出与资金流动。', ['账户与盘点','重要支出','周期费用','虚拟资产']],
  ['planning', '目标、试算与回顾', '用自己的条件探索下一步，读懂假设和未知项。', ['规划：目标','总览与时间轴']],
  ['belongings', '物品与心愿', '记录购买、维护、状态与持有成本。', ['首页的物品日均成本','记录与保护资料','成本、状态与心愿','批量处理物品']],
  ['backup', '备份、恢复与导入', '先保护资料，再了解加密、表格和误删恢复。', ['先保护资料：完整备份与恢复','数据管理与资料操作的区别']],
  ['everyday', '日常操作与隐私', '导航、快捷键、列表、功能开关与提醒。', ['界面与导航','关于与帮助','列表排序','桌面快捷键与关闭窗口','心愿完成与系统通知','桌面录入与心愿操作']],
  ['update', '更新、换机与卸载', '保留旧资料与备份，按步骤更换应用或电脑。', ['更新、换机与卸载']],
  ['faq', '常见问题与限制', '遇到问题先查这里，了解当前平台的验证范围。', ['常见问题','当前限制']],
].map(([slug, title, description, titles]) => ({slug,title,description,titles,markdown:''}));
// Move explicit anchors immediately preceding a section with that section.
const starts = [...source.matchAll(/^## (.+)$/gm)].map(m => {
  const prefix = source.slice(0, m.index);
  const trailing = /(?:<a id="[a-z-]+"><\/a>\s*)+$/.exec(prefix);
  return {title:m[1], index: trailing ? trailing.index : m.index};
});
for (let i=0; i<starts.length; i++) {
  const section = starts[i], group = groups.find(g => g.titles.includes(section.title));
  if (!group) throw new Error(`Unassigned guide section: ${section.title}`);
  group.markdown += '\n' + source.slice(section.index, starts[i+1]?.index ?? source.length);
}
groups[0].markdown = source.slice(0, starts[0].index).replace(/^# .+\n/, '') + groups[0].markdown;
const anchorRoutes = {};
for (const g of groups) {
  const parsed = renderMarkdown(g.markdown);
  for (const id of [...parsed.headings.map(h=>h.id), ...[...g.markdown.matchAll(/<a id="([a-z-]+)"><\/a>/g)].map(m=>m[1])]) {
    if (anchorRoutes[id]) throw new Error(`Duplicate guide anchor: ${id}`);
    anchorRoutes[id] = g.slug;
  }
}
function link(value, prefix, context='guide') {
  if (value.startsWith('images/')) {
    if (!/^images\/[\w.-]+$/.test(value)) throw new Error(`Unsafe image: ${value}`);
    images.add(value); return `${prefix}docs/${value}`;
  }
  if (value.startsWith('#')) {
    if (context === 'quickstart') return value;
    const id = decodeURIComponent(value.slice(1));
    if (!anchorRoutes[id]) throw new Error(`Unknown guide anchor: ${id}`);
    return `${prefix}guide/${anchorRoutes[id]}/${value}`;
  }
  const core = /^(?:https:\/\/github.com\/CoderJackZhu\/Thingary\/blob\/main\/docs\/)?(USER_GUIDE|QUICKSTART)\.md(#.*)?$/.exec(value);
  if (core) {
    if (core[1] === 'QUICKSTART') return `${prefix}quickstart/${core[2] ?? ''}`;
    return core[2] ? link(core[2], prefix) : `${prefix}guide/`;
  }
  if (/^https:\/\//.test(value)) return value;
  if (/^\.\.\/[A-Z_]+\.md(?:#.*)?$/.test(value)) return `https://github.com/CoderJackZhu/Thingary/blob/main/${value.slice(3)}`;
  if (/^[A-Z_]+\.md(?:#.*)?$/.test(value)) return `https://github.com/CoderJackZhu/Thingary/blob/main/docs/${value}`;
  throw new Error(`Unsupported guide link: ${value}`);
}
function page(path,title,content,{toc=[],current='',prefix='../',script=''}={}) {
  const nav = groups.map(g=>`<a ${g.slug===current?'aria-current="page" ':''}href="${prefix}guide/${g.slug}/">${escapeHtml(g.title)}</a>`).join('');
  const local = toc.length ? `<nav class="article-toc" aria-label="本页目录"><strong>本页内容</strong>${toc.filter(h=>h.level===2).map(h=>`<a href="#${escapeHtml(h.id)}">${escapeHtml(h.title)}</a>`).join('')}</nav>` : '';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} · 物谱帮助</title><link rel="canonical" href="https://thingary.jackzhu.top/${path}/"><link rel="stylesheet" href="${prefix}style.css"><link rel="stylesheet" href="${prefix}help.css"></head><body class="help-page">${sharedPrelude}<div class="site">${siteHeader(prefix)}<div class="help-layout"><aside class="help-sidebar"><details open><summary>使用指南</summary><nav aria-label="指南主题">${nav}</nav></details></aside><main id="main" tabindex="-1"><div class="help-breadcrumb"><a href="${prefix}guide/">帮助中心</a> / ${escapeHtml(title)}</div>${content.replace('<!--contents-->',local)}<footer class="help-footer">说明与应用源码同步维护；公开安装包的功能以对应版本说明为准。截图均使用虚构资料。阅读本站使用说明无需访问 GitHub；下载镜像、反馈和开发参考是外部链接。<p><a href="${prefix}quickstart/">快速上手</a> · <a href="${prefix}guide/">返回帮助中心</a></p></footer></main></div></div>${script}</body></html>`;
  mkdirSync(join(output,path),{recursive:true}); writeFileSync(join(output,path,'index.html'),html);
}
for (const g of groups) {
  const parsed = renderMarkdown(g.markdown,{resolveUrl:value=>link(value,'../../')});
  page(`guide/${g.slug}`,g.title,`<h1>${g.title}</h1><p class="help-lead">${g.description}</p><!--contents--><article class="guide-article">${parsed.html}</article>`, {toc:parsed.headings,current:g.slug,prefix:'../../'});
}
const quick = renderMarkdown(quickstart,{resolveUrl:value=>link(value,'../','quickstart')});
page('quickstart','快速上手',`<article class="guide-article">${quick.html.replace('<a id="install"></a>', '<!--contents--><a id="install"></a>')}</article>`,{toc:quick.headings});
const cards = groups.map((g,i)=>`<article class="help-card"><span class="help-number">0${i+1}</span><h2><a href="${g.slug}/">${g.title}<span aria-hidden="true"> ↗</span></a></h2><p>${g.description}</p></article>`).join('');
const directory = groups.map(g=>`<section><h3>${g.title}</h3>${renderMarkdown(g.markdown).headings.map(h=>`<a id="${escapeHtml(h.id)}" href="${g.slug}/#${escapeHtml(h.id)}">${escapeHtml(h.title)}</a>`).join('')}${[...g.markdown.matchAll(/<a id="([a-z-]+)"><\/a>/g)].map(m=>`<a id="${m[1]}" href="${g.slug}/#${m[1]}">查看${g.title}相关说明 →</a>`).join('')}</section>`).join('');
page('guide','使用指南',`<p class="section-label">按需查阅 · 不必从头读到尾</p><h1 id="物谱使用说明">今天想了解什么？</h1><p class="help-lead">从第一次记录，到每月盘点和保护资料。选一个主题，找到眼前需要的步骤。</p><a class="quick-banner" href="../quickstart/"><span><strong>第一次使用物谱？</strong><small>从安装、第一次记录到备份，一页开始。</small></span><span aria-hidden="true">快速上手 →</span></a><div class="help-cards">${cards}</div><details class="full-directory"><summary>展开全部章节目录</summary><div>${directory}</div></details>`,{script:`<script>const routes=${JSON.stringify(anchorRoutes)};function followAnchor(){let id;try{id=decodeURIComponent(location.hash.slice(1))}catch{return}if(routes[id])location.replace(routes[id]+'/'+location.hash)}followAnchor();addEventListener('hashchange',followAnchor);</script>`});
for(const asset of images) copyFileSync(join(root,'docs',asset),join(output,'docs',asset));
writeFileSync(join(output,'.nojekyll'),'');
console.log(JSON.stringify({output,topics:groups.length,images:images.size,anchors:Object.keys(anchorRoutes).length}));
