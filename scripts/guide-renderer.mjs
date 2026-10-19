// Dependency-free website renderer for the trusted canonical help Markdown.
// No filesystem or browser globals.
export const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function headingSlug(title) {
  return title.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
}
export function renderMarkdown(source, { resolveUrl = value => value } = {}) {
const assets = new Set(), headings = [], seen = new Map();
function inline(value) {
  const tokens = [];
  const token = html => `\u0000${tokens.push(html) - 1}\u0000`;
  value = value.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`));
  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => (assets.add(src), token(`<img src="${escapeHtml(resolveUrl(src))}" alt="${escapeHtml(alt)}" loading="lazy">`)));
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => token(`<a href="${escapeHtml(resolveUrl(href))}">${escapeHtml(label)}</a>`));
  value = escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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
    i++; html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); continue;
  }
  const heading = /^(#{1,6}) (.+)$/.exec(line);
  if (heading) { const base = headingSlug(heading[2]); const count = seen.get(base) ?? 0; seen.set(base, count + 1); const id = count ? `${base}-${count}` : base; headings.push({ level: heading[1].length, title: heading[2], id }); html.push(`<h${heading[1].length} id="${escapeHtml(id)}">${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
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

return { html: html.join("\n"), headings, assets: [...assets] };
}
