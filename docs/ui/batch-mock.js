// D19 批量操作界面对照稿（设计稿，不是实现）。
// 用法：`npm run dev -- --port 1429` 后打开 /visual-preview.html，窗口 1280×820，
// 在控制台执行 `await import('/docs/ui/batch-mock.js').then(m => m.show('panel'))`；
// 可选状态：'panel'（选中 3 件与批量面板）、'category'（批量分类表）、'retire'（批量退役表）。
// 只改当前页面的 DOM，复用现有 class 与 tokens；新增的 class 均以 batch- 开头，列在下方样式中。
const css = `
.batch-select-toggle{font-size:11px;padding:6px 10px}
.batch-check{width:15px;height:15px;flex:0 0 15px;border:1px solid var(--line);border-radius:4px;background:var(--card);display:grid;place-items:center;font-size:10px;color:var(--button-text)}
.asset-row.selected .batch-check{background:var(--accent);border-color:var(--accent)}
.batch-panel .batch-count{font-size:18px;margin:0 0 4px}
.batch-panel .batch-actions{display:grid;gap:8px;margin-top:16px}
.batch-panel .batch-actions button{text-align:left}
.batch-panel .batch-hint{margin-top:14px;font-size:11px;line-height:1.7}
.batch-editor{width:min(1040px,calc(100vw - 40px))}
.batch-editor table{width:100%}
.batch-editor select,.batch-editor input{font-size:12px;padding:5px 8px}
.batch-editor input[type=checkbox]{width:auto;margin-right:6px}
.batch-editor tr.batch-fill td{background:var(--side)}
.batch-editor tr[aria-disabled=true] td{color:var(--muted)}
.batch-editor .batch-changed{color:var(--accent);font-size:10px;display:block;margin-top:3px}
.toast,[class*=notification]{display:none!important}`;

function reset() {
  document.querySelectorAll('.batch-mock').forEach(n => n.remove());
  document.querySelectorAll('.asset-row.selected').forEach(r => r.classList.remove('selected'));
}
function panel() {
  if (!document.getElementById('batch-mock-style')) {
    const s = document.createElement('style'); s.id = 'batch-mock-style'; s.className = 'batch-mock-keep'; s.textContent = css; document.head.append(s);
  }
  const controls = document.querySelector('.view-controls');
  controls.insertAdjacentHTML('afterbegin', '<button class="batch-mock batch-select-toggle" aria-pressed="true">完成选择</button>');
  document.querySelectorAll('.asset-row').forEach((row, i) => {
    row.querySelector('.asset-name').insertAdjacentHTML('afterbegin', `<span class="batch-mock batch-check">${[0, 1, 3].includes(i) ? '✓' : ''}</span>`);
  });
  [...document.querySelectorAll('.asset-row')].forEach((r, i) => { if ([0, 1, 3].includes(i)) r.classList.add('selected'); });
  const caption = document.querySelector('.collection-caption');
  caption.insertAdjacentHTML('beforeend', '<span class="batch-mock" style="color:var(--accent);font-size:11px">已选 3 件 · Esc 取消</span>');
  const aside = document.querySelector('aside.summary');
  aside.dataset.mockOriginal ??= aside.innerHTML;
  aside.innerHTML = `<div class="batch-mock summary-body batch-panel">
    <div class="panel-top"><span>批量操作</span><button aria-label="取消选择">×</button></div>
    <h2 class="batch-count">已选 3 件</h2>
    <p class="muted small">使用中 2 · 已退役 1</p>
    <dl class="facts"><dt>购入合计</dt><dd>¥32,288.00</dd><dt>金额未知</dt><dd>0 件</dd></dl>
    <div class="batch-actions">
      <button>设置分类与渠道…</button>
      <button>设置状态标签…</button>
      <button>退役…</button>
      <button>统计口径…</button>
      <button class="danger">删除 3 件…</button>
    </div>
    <p class="muted batch-hint">⌘ 点击加选 · ⇧ 点击连选 · ⌘A 全选当前筛选结果</p>
  </div>`;
}
function table(kind) {
  const category = kind === 'category';
  const head = category
    ? '<tr><th>物品</th><th>当前分类</th><th>新分类</th><th>当前渠道</th><th>新渠道</th></tr>'
    : '<tr><th>物品</th><th>当前状态</th><th>退役</th><th>退役日期</th></tr>';
  const sel = (value, options) => `<select>${options.map(o => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  const cats = ['保持不变', '电脑与办公', '摄影器材', '音频设备', '手机与平板'];
  const chans = ['保持不变', 'Apple Store', '京东', '淘宝', '线下'];
  const body = category ? `
    <tr class="batch-fill"><td><strong>全部设为</strong></td><td></td><td>${sel('选择…', ['选择…', ...cats.slice(1)])}</td><td></td><td>${sel('选择…', ['选择…', ...chans.slice(1)])}</td></tr>
    <tr><td><strong>MacBook Pro 14″</strong></td><td>电脑与办公</td><td>${sel('保持不变', cats)}</td><td>Apple Store</td><td>${sel('保持不变', chans)}</td></tr>
    <tr><td><strong>Fujifilm X100V</strong></td><td>摄影器材</td><td>${sel('保持不变', cats)}</td><td>京东</td><td>${sel('线下', chans)}<small class="batch-changed">将更改</small></td></tr>
    <tr><td><strong>iPhone 12 mini</strong></td><td>手机与平板</td><td>${sel('电脑与办公', cats)}<small class="batch-changed">将更改</small></td><td>Apple Store</td><td>${sel('保持不变', chans)}</td></tr>`
    : `
    <tr class="batch-fill"><td><strong>全部设为</strong></td><td></td><td><input type="checkbox" checked> 退役</td><td><input value="2026-09-28" style="width:120px"> <button>选日期</button></td></tr>
    <tr><td><strong>MacBook Pro 14″</strong></td><td>使用中</td><td><input type="checkbox" checked> 退役</td><td><input value="2026-09-28" style="width:120px"> <button>选日期</button></td></tr>
    <tr><td><strong>Fujifilm X100V</strong></td><td>使用中</td><td><input type="checkbox" checked> 退役</td><td><input value="2026-09-20" style="width:120px"> <button>选日期</button><small class="batch-changed">单独改为 9 月 20 日</small></td></tr>
    <tr aria-disabled="true"><td><strong>iPhone 12 mini</strong></td><td>已退役</td><td colspan="2">已退役 · 不适用，不参与保存</td></tr>`;
  const title = category ? '批量分类 · 为 3 件物品分别设置分类与渠道' : '批量退役 · 为 3 件物品分别设置退役';
  const save = category ? '保存 2 项更改' : '保存 2 项更改';
  const note = category ? '每行默认保持不变；在“全部设为”选择可一次填满整列，再单独改个别行。' : '退役日期默认今天，不早于购入与上一条状态记录；不适用的行不参与保存。';
  document.body.insertAdjacentHTML('beforeend', `<dialog class="batch-mock editor batch-editor" open style="position:fixed;inset:0;margin:auto;z-index:30">
    <header><div><p class="eyebrow">物品 · 批量操作</p><h2>${title}</h2><p class="muted">${note}</p></div>
    <div class="editor-header-actions"><button>取消</button><button class="primary">${save}</button></div></header>
    <table class="distribution-table check-in-table"><thead>${head}</thead><tbody>${body}</tbody></table>
  </dialog>`);
  document.body.insertAdjacentHTML('beforeend', '<div class="batch-mock" style="position:fixed;inset:0;background:#151b2b66;z-index:29"></div>');
}
export function show(state = 'panel') {
  reset();
  panel();
  if (state !== 'panel') table(state);
}
export function clear() {
  reset();
  const aside = document.querySelector('aside.summary');
  if (aside?.dataset.mockOriginal) aside.innerHTML = aside.dataset.mockOriginal;
}
