// Calculator page: reads the form, runs the planning engine (WASM) locally, renders the result.
import { RETURN_PRESETS, DEFAULTS, validate, calculate, durationText, yuanText } from './model.js';
import { GOATCOUNTER_ENDPOINT } from './config.js';

const STORE = 'thingary-calc-v1';
const form = document.getElementById('calc-form');
const resultBox = document.querySelector('[data-result]');
const historyBox = document.querySelector('[data-history]');
const historyList = document.querySelector('[data-history-list]');
const presetBox = document.querySelector('[data-presets]');
const presetNote = document.querySelector('[data-preset-note]');
const fields = ['age', 'assets_wan', 'spend', 'saving', 'income', 'income_age', 'wish_age', 'end_age', 'inflation'];
const optional = { income: DEFAULTS.income, income_age: DEFAULTS.income_age, end_age: DEFAULTS.end_age, inflation: DEFAULTS.inflation, wish_age: null };

let state = load();
const returning = Boolean(state.inputs || state.history?.length);
let counted = false, edited = false;
let preset = state.inputs?.preset ?? DEFAULTS.preset;
let run = null, last = null, timer = 0;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode: the page still works */ }
}
// Counts only page views and these events: calc-done, calc-return, calc-record.
const pending = [];
function track(name) {
  if (!GOATCOUNTER_ENDPOINT) return;
  const counter = window.goatcounter;
  if (counter?.count) counter.count({ path: name, title: name, event: true });
  else pending.push(name);
}
function loadAnalytics() {
  if (!/^https:\/\/[\w.-]+\/count$/.test(GOATCOUNTER_ENDPOINT)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.dataset.goatcounter = GOATCOUNTER_ENDPOINT;
  script.addEventListener('load', () => { for (const name of pending.splice(0)) track(name); });
  document.head.append(script);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const parse = text => { const t = text.replace(/[,，\s]/g, ''); return t === '' ? null : Number(t); };

function readInputs() {
  const v = { preset };
  for (const name of fields) {
    const raw = parse(form.elements[name].value);
    v[name] = raw === null && name in optional ? optional[name] : raw;
  }
  return v;
}

async function engine() {
  const url = new URL('engine.wasm', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`engine ${response.status}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  const w = instance.exports;
  return request => {
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    const pointer = w.alloc(bytes.length) >>> 0;
    if (!pointer) throw new Error('计算引擎无法分配内存');
    try {
      new Uint8Array(w.memory.buffer, pointer, bytes.length).set(bytes);
      const at = w.evaluate(pointer, bytes.length) >>> 0;
      const out = JSON.parse(new TextDecoder().decode(new Uint8Array(w.memory.buffer, at, w.result_len() >>> 0)));
      if (!out.ok) throw new Error(out.error);
      return out.value;
    } finally { w.release(pointer, bytes.length); }
  };
}

function todayText() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const monthLabel = text => `${Number(text.slice(0, 4))} 年 ${Number(text.slice(5, 7))} 月`;

function chart(series, stopAge, age, width) {
  const points = series.filter(p => p.age !== null);
  if (points.length < 2) return '';
  // Draw at the card's own pixel width so labels keep their size on phones and wide screens.
  const W = Math.round(Math.max(260, width)), H = Math.round(Math.min(220, W * 0.45)), L = 8, R = 8, T = 10, B = 22;
  const max = Math.max(...points.map(p => p.end), 1), first = points[0].age, lastAge = points.at(-1).age;
  const x = a => L + (a - first) / Math.max(lastAge - first, 1) * (W - L - R);
  const y = v => T + (1 - Math.max(v, 0) / max) * (H - T - B);
  const line = points.map(p => `${x(p.age).toFixed(1)},${y(p.end).toFixed(1)}`).join(' ');
  const marker = stopAge === null ? '' : `<line class="marker" x1="${x(stopAge).toFixed(1)}" x2="${x(stopAge).toFixed(1)}" y1="${T}" y2="${H - B}"/><text x="${Math.min(x(stopAge) + 4, W - 60).toFixed(1)}" y="${T + 12}">${Math.floor(stopAge)} 岁停工</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="家底随年龄的变化，按今天的钱">
    <polygon class="area" points="${x(first)},${H - B} ${line} ${x(lastAge)},${H - B}"/><polyline class="line" points="${line}"/>
    <line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${marker}
    <text x="${L}" y="${H - 6}">${age} 岁</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${lastAge} 岁</text></svg>
    <p class="chart-caption">家底随年龄的变化，最高约 ${yuanText(max)}（按今天的钱）</p>`;
}

function render(v, r) {
  const parts = [];
  if (r.reachable && r.months === 0) {
    parts.push(`<p class="result-label">按你填的条件</p><p class="result-big">现在就可以不上班</p><p class="result-sub">家底已经够支付到 ${v.end_age} 岁的生活费。</p>`);
  } else if (r.reachable) {
    parts.push(`<p class="result-label">最早大约在</p><p class="result-big">${Math.floor(r.stop_age)} 岁</p>
      <p class="result-sub">还要上 <strong>${durationText(r.months)}</strong> 班，约 ${monthLabel(r.stop_month)}</p>`);
    // Near the end age any balance covers the few remaining months, so say what that really means.
    if (r.stop_age > v.end_age - 5) parts.push(`<p class="result-sub result-warn">这几乎等于要一直工作到 ${v.end_age} 岁。可以试试多存一点或降低生活费。</p>`);
  } else {
    parts.push(`<p class="result-label">按你填的条件</p><p class="result-big result-warn">${v.end_age} 岁前都攒不够</p>
      <p class="result-sub">可以试试多存一点、降低生活费，或者在更多设置里填「希望几岁不上班」看看每月要存多少。</p>`);
  }
  const facts = [];
  if (r.need_yuan !== null && r.months > 0) facts.push(['那时大约需要攒到', yuanText(r.need_yuan)]);
  if (r.wish) {
    const w = r.wish, text = w.status === 'found' ? `每月存 ${yuanText(w.monthly_yuan)}` : w.status === 'no_positive_contribution' ? '不用再存也够' : w.status === 'search_not_found' ? '每月要存超过 100 万元' : '条件无法实现';
    facts.push([`想在 ${w.age} 岁停下`, text]);
  }
  if (facts.length) parts.push(`<dl class="result-facts">${facts.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>`);
  if (r.extra_1000_months > 0) parts.push(`<p class="result-tip">每月多存 1000 元，可以提前约 <strong>${durationText(r.extra_1000_months)}</strong>。</p>`);
  parts.push(chart(r.series, r.reachable ? r.stop_age : null, v.age, resultBox.clientWidth - 42));
  parts.push(`<div class="result-actions"><button type="button" class="button" data-record>记下这次结果</button><small>下个月更新数字再来对比</small></div>`);
  resultBox.innerHTML = `<div class="result-card">${parts.join('')}</div>`;
  resultBox.querySelector('[data-record]').addEventListener('click', record);
}

function showIssues(issues) {
  for (const el of form.querySelectorAll('.field-error')) el.remove();
  for (const el of form.querySelectorAll('[data-invalid]')) el.removeAttribute('data-invalid');
  for (const issue of issues) {
    const input = form.elements[issue.key];
    if (!input || input.value.trim() === '') continue;
    const field = input.closest('.field');
    field.setAttribute('data-invalid', '');
    field.insertAdjacentHTML('beforeend', `<span class="field-error">${esc(issue.message)}</span>`);
  }
  const missing = issues.filter(i => form.elements[i.key]?.value.trim() === '');
  resultBox.innerHTML = `<p class="result-empty">${missing.length ? esc(missing.map(i => i.message).join('，')) + '。' : '请先修改标出的内容。'}</p>`;
  last = null;
}

function update() {
  const v = readInputs();
  state.inputs = Object.fromEntries([...fields.map(n => [n, form.elements[n].value]), ['preset', preset]]);
  save();
  const issues = validate(v);
  if (issues.length) return showIssues(issues);
  showIssues([]);
  if (!run) { resultBox.innerHTML = '<p class="result-empty">正在准备计算…</p>'; return; }
  try {
    last = { v, r: calculate(run, v, todayText()) };
    render(last.v, last.r);
    // One count per visit, and only after the visitor typed: restoring saved answers is not a new calculation.
    if (edited && !counted) { counted = true; track('calc-done'); }
  } catch (error) {
    last = null;
    resultBox.innerHTML = `<p class="result-empty result-warn">没能算出结果：${esc(error.message)}</p>`;
  }
}

function record() {
  if (!last) return;
  track('calc-record');
  const entry = { date: todayText(), months: last.r.reachable ? last.r.months : null, stop_age: last.r.stop_age, end_age: last.v.end_age };
  state.history = [entry, ...(state.history ?? []).filter(h => h.date !== entry.date)].slice(0, 36);
  save();
  renderHistory();
  historyBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderHistory() {
  const list = state.history ?? [];
  historyBox.hidden = list.length === 0;
  historyList.innerHTML = list.map((h, i) => {
    const text = h.months === null ? `${h.end_age} 岁前攒不够` : h.months === 0 ? '已经可以不上班' : `还要 ${durationText(h.months)}（约 ${Math.floor(h.stop_age)} 岁）`;
    const prev = list[i + 1];
    let delta = '';
    if (prev && prev.months !== null && h.months !== null) {
      // Compare stop dates, not remaining time: a month passing alone should not look like progress.
      const sooner = prev.months - (h.months + monthsBetween(prev.date, h.date));
      if (sooner !== 0) delta = ` <span class="${sooner > 0 ? 'delta-good' : 'delta-bad'}">${sooner > 0 ? '提前' : '推后'} ${durationText(Math.abs(sooner))}</span>`;
    }
    return `<li><span>${esc(h.date)}</span><span>${esc(text)}${delta} <button type="button" data-remove="${i}">删除</button></span></li>`;
  }).join('');
}
function monthsBetween(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}
historyList.addEventListener('click', event => {
  const i = event.target.closest('[data-remove]')?.dataset.remove;
  if (i === undefined) return;
  state.history.splice(Number(i), 1);
  save();
  renderHistory();
});

function renderPresets() {
  presetBox.innerHTML = RETURN_PRESETS.map(p => `<button type="button" role="radio" aria-checked="${p.key === preset}" data-preset="${p.key}">${p.label}</button>`).join('');
  presetNote.textContent = `${RETURN_PRESETS.find(p => p.key === preset).note}。收益越高结果越早，但越没把握。`;
}
presetBox.addEventListener('click', event => {
  const key = event.target.closest('[data-preset]')?.dataset.preset;
  if (!key) return;
  preset = key;
  edited = true;
  renderPresets();
  update();
});
presetBox.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const i = RETURN_PRESETS.findIndex(p => p.key === preset), step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
  preset = RETURN_PRESETS[(i + step + RETURN_PRESETS.length) % RETURN_PRESETS.length].key;
  edited = true;
  renderPresets();
  presetBox.querySelector(`[data-preset="${preset}"]`).focus();
  update();
});

for (const name of fields) if (state.inputs?.[name] != null) form.elements[name].value = state.inputs[name];
form.addEventListener('input', () => { edited = true; clearTimeout(timer); timer = setTimeout(update, 250); });
form.addEventListener('submit', event => event.preventDefault());
addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => last && render(last.v, last.r), 200); });
renderPresets();
renderHistory();
loadAnalytics();
document.querySelector('[data-analytics-note]').hidden = !GOATCOUNTER_ENDPOINT;
if (returning) track('calc-return');
update();
engine().then(r => { run = r; update(); }, error => {
  resultBox.innerHTML = `<p class="result-empty result-warn">计算引擎加载失败，请刷新重试。（${esc(error.message)}）</p>`;
});
