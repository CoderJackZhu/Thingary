// Render the canonical user guide for the DMG. No network or runtime dependency.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? `${root}/.local/distribution/offline-guide`);
const source = readFileSync(`${root}/docs/USER_GUIDE.md`, 'utf8');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const assets = new Set();
function url(value) {
  if (value.startsWith('images/')) {
    if (!/^images\/[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Unsafe image path: ${value}`);
    assets.add(value);
    return `使用说明/${value}`;
  }
  if (/^(https:\/\/|#)/.test(value)) return value;
  if (/^\.\.\/[A-Z_]+\.md(?:#.*)?$/.test(value)) return `https://github.com/CoderJackZhu/Thingary/blob/main/${value.slice(3)}`;
  if (/^[A-Z_]+\.md(?:#.*)?$/.test(value)) return `https://github.com/CoderJackZhu/Thingary/blob/main/docs/${value}`;
  throw new Error(`Unsupported guide link: ${value}`);
}
function inline(value) {
  const tokens = [];
  const token = html => `\u0000${tokens.push(html) - 1}\u0000`;
  value = value.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escape(code)}</code>`));
  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => token(`<img src="${escape(url(src))}" alt="${escape(alt)}" loading="lazy">`));
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => token(`<a href="${escape(url(href))}">${escape(label)}</a>`));
  value = escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return value.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}
const lines = source.split(/\r?\n/), html = [];
for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  if (/^<a id="[a-z-]+"><\/a>$/.test(line)) { html.push(line); i++; continue; }
  if (line.startsWith('```')) {
    const code = []; i++;
    while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
    if (i === lines.length) throw new Error('Unclosed code fence');
    i++; html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); continue;
  }
  const heading = /^(#{1,6}) (.+)$/.exec(line);
  if (heading) { html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
  if (line.startsWith('|')) {
    const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
    const head = cells(line); i++;
    if (!/^\|[\s:|-]+\|$/.test(lines[i] ?? '')) throw new Error('Invalid table');
    i++; const rows = [];
    while ((lines[i] ?? '').startsWith('|')) rows.push(`<tr>${cells(lines[i++]).map(c => `<td>${c}</td>`).join('')}</tr>`);
    html.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`); continue;
  }
  const list = /^(?:- |\d+\. )/.exec(line);
  if (list) {
    const ordered = /^\d/.test(line), pattern = ordered ? /^\d+\. / : /^- /, rows = [];
    while (pattern.test(lines[i] ?? '')) rows.push(`<li>${inline(lines[i++].replace(pattern, ''))}</li>`);
    const tag = ordered ? 'ol' : 'ul'; html.push(`<${tag}>${rows.join('')}</${tag}>`); continue;
  }
  if (line.startsWith('> ')) { html.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); i++; continue; }
  const paragraph = [line]; i++;
  while (i < lines.length && lines[i].trim() && !/^(#|<a |```|\||- |\d+\. |> )/.test(lines[i])) paragraph.push(lines[i++]);
  html.push(`<p>${inline(paragraph.join(' '))}</p>`);
}
mkdirSync(`${output}/使用说明/images`, { recursive: true });
for (const asset of assets) copyFileSync(`${root}/docs/${asset}`, `${output}/使用说明/${asset}`);
writeFileSync(`${output}/开始使用.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>物谱使用说明</title><style>body{margin:0 auto;padding:32px 22px 80px;max-width:960px;color:#202b29;background:#fafbf9;font:17px/1.8 -apple-system,BlinkMacSystemFont,sans-serif}h1,h2,h3{line-height:1.35;margin-top:1.8em}h1{margin-top:0}a{color:#236652}img{max-width:100%;height:auto;border:1px solid #dde5df;border-radius:12px}li{margin:.5em 0}code{background:#eaf0ec;padding:.15em .3em;border-radius:4px;font-size:.9em}pre{overflow:auto;padding:16px;background:#eaf0ec}pre code{padding:0}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.9em}th,td{border:1px solid #d4dfd7;padding:10px;vertical-align:top}th{background:#eaf0ec}blockquote{border-left:4px solid #799887;margin:16px 0;padding:8px 16px}footer{margin-top:48px;border-top:1px solid #d4dfd7;font-size:.85em;color:#53615a}</style><main>${html.join('\n')}</main><footer>离线说明来自本安装包所对应源码中的 docs/USER_GUIDE.md。图片均为虚构资料演示；外部链接需联网，应用本身无需联网使用。</footer></html>\n`);
console.log(JSON.stringify({ guide: `${output}/开始使用.html`, images: assets.size }));
