import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseReportInput, redactReport, formatCents, formatMoney, formatRatio,
  trendModel, trendAriaLabel, trendSvg, copyText, printableHtml, exportFileName, escapeHtml,
} from '../src/planning-report/model.ts';
import { currentReport, baselineReport, comparisonReport } from '../src/planning-report/fixtures.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// 夹具中故意埋入的敏感值：可检索金额、带金额的标题、姓名/账号式字符串、派生比例、图表金额。
const SENSITIVE = ['100000000', '1,000,000', '张三', '招商银行', '8888', '45000000', '30000000', '45.00%', '装修', '工资卡', '李四', '12000000', '87.20%'];

test('fixtures are valid ReportInputV1 with fixed fictional dates', () => {
  for (const f of [currentReport, baselineReport, comparisonReport]) {
    const r = parseReportInput(f);
    assert.ok(r.ok, JSON.stringify(r.ok ? null : r.issues));
    assert.equal(r.report.generated_on, '2026-10-07');
  }
});

test('unknown contract version is an explicit error, never read as v1', () => {
  for (const v of [0, 2, 99, '1', undefined]) {
    const r = parseReportInput({ ...currentReport, contract_version: v });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'unsupported_contract_version');
  }
});

test('boundary validation: money strings, real calendar dates, integer ratios', () => {
  const bad = (patch, path) => {
    const input = structuredClone(currentReport);
    Object.assign(input.funds[0].amount, patch.amount ?? {});
    if (patch.date) input.generated_on = patch.date;
    if (patch.ratio) input.goals[1].ratio = patch.ratio;
    const r = parseReportInput(input);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'invalid_report_input');
    assert.ok(r.issues.some(i => i.path.startsWith(path)), JSON.stringify(r.issues));
  };
  bad({ amount: { cents: '12.3' } }, 'funds[0].amount.cents');
  bad({ amount: { cents: 100 } }, 'funds[0].amount.cents');
  bad({ amount: { basis: 'guessed' } }, 'funds[0].amount.basis');
  bad({ date: '2026-02-30' }, 'generated_on');
  bad({ date: '2026-10-7' }, 'generated_on');
  bad({ ratio: { kind: 'ratio', hundredths: 45.5 } }, 'goals[1].ratio');
});

test('formatCents: BigInt formatting, no Number round-trip, negatives and huge values exact', () => {
  assert.equal(formatCents('0'), '¥0');
  assert.equal(formatCents('5'), '¥0.05');
  assert.equal(formatCents('100'), '¥1');
  assert.equal(formatCents('-105'), '−¥1.05');
  assert.equal(formatCents('-23000000'), '−¥230,000');
  assert.equal(formatCents('100000000'), '¥1,000,000');
  assert.equal(formatCents('100001'), '¥1,000.01');
  assert.equal(formatCents('123456789012345678901'), '¥1,234,567,890,123,456,789.01');
});

test('money display: hidden / unknown / estimated never collapse to 0', () => {
  assert.equal(formatMoney({ kind: 'money', cents: null, basis: 'unknown' }), '未知');
  assert.equal(formatMoney({ kind: 'money', cents: null, basis: 'known', hidden: true }), '金额已隐藏');
  assert.equal(formatMoney({ kind: 'money', cents: '45000000', basis: 'estimated' }), '约 ¥450,000');
  assert.equal(formatRatio({ kind: 'ratio', hundredths: 4500 }), '45.00%');
  assert.equal(formatRatio({ kind: 'ratio', hundredths: -250 }), '−2.50%');
  assert.equal(formatRatio({ kind: 'ratio', hundredths: null }), '未知');
  assert.equal(formatRatio({ kind: 'ratio', hundredths: null, hidden: true }), '已隐藏');
});

test('redaction is deterministic and preserves snapshot structure and dates', () => {
  const a = redactReport(currentReport), b = redactReport(currentReport);
  assert.deepEqual(a, b);
  assert.equal(a.generated_on, currentReport.generated_on);
  assert.equal(a.series.length, currentReport.series.length);
  assert.deepEqual(a.series.map(s => s.date), currentReport.series.map(s => s.date));
  assert.equal(a.goals.length, currentReport.goals.length);
  // 同一快照：完整视图与隐私视图的结构性字段一致
  assert.equal(a.status, currentReport.status);
  assert.equal(a.headline.status, currentReport.headline.status);
});

test('privacy projection aliases free names, hides notes, blanks money and derived ratios', () => {
  const v = redactReport(currentReport);
  assert.equal(v.subject_name, '当前方案');
  assert.deepEqual(v.funds.map(f => f.name), ['账户 1', '账户 2', '账户 3']);
  assert.deepEqual(v.goals.map(g => g.name), ['目标 1', '目标 2']);
  assert.ok(v.funds.every(f => f.note === null));
  assert.ok(v.goals.every(g => g.note === null));
  assert.ok(v.funds.every(f => f.amount.cents === null));
  assert.equal(v.funds[0].amount.hidden, true);
  assert.equal(v.goals[1].ratio.hidden, true);
  assert.equal(v.goals[1].ratio.hundredths, null);
  assert.equal(v.next_step.detail, null);
  // 真正未知的值 hidden=false，显示“未知”而不是“已隐藏”
  assert.equal(v.funds[0].amount.hidden, true);
  const bv = redactReport(baselineReport);
  assert.equal(bv.funds[1].amount.hidden, false);
  assert.equal(bv.funds[1].amount.cents, null);
});

test('serialized privacy payload contains none of the planted sensitive values', () => {
  for (const f of [currentReport, baselineReport, comparisonReport]) {
    const json = JSON.stringify(redactReport(f));
    for (const s of SENSITIVE) assert.ok(!json.includes(s), `leaked ${s} in redacted ${f.kind}`);
  }
  // 完整视图仍然包含（对照 sanity check）
  assert.ok(JSON.stringify(currentReport).includes('张三'));
});

test('printable HTML: escaping blocks malicious names, privacy leak-free, full contains values', () => {
  const full = printableHtml(comparisonReport, { privacy: false });
  assert.ok(!full.includes('<img src=x onerror'), 'raw malicious HTML must not appear');
  assert.ok(full.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(full.includes('张三'));
  const priv = printableHtml(comparisonReport, { privacy: true });
  for (const s of SENSITIVE) assert.ok(!priv.includes(s), `leaked ${s} in privacy print`);
  assert.ok(priv.includes('金额已隐藏'));
  assert.ok(priv.includes('方案 A') && priv.includes('方案 B'));
  const fullCur = printableHtml(currentReport, { privacy: false });
  assert.ok(fullCur.includes('¥1,000,000'));
  const privCur = printableHtml(currentReport, { privacy: true });
  for (const s of SENSITIVE) assert.ok(!privCur.includes(s), `leaked ${s} in privacy print current`);
  // A4 排版与长表分页
  assert.ok(full.includes('@page') && full.includes('size:A4'));
  assert.ok(full.includes('table-header-group'));
  assert.ok(full.includes('break-inside:avoid'));
});

test('copy text boundary follows the same privacy projection', () => {
  const priv = copyText(currentReport, true);
  for (const s of SENSITIVE) assert.ok(!priv.includes(s), `leaked ${s} in privacy copy`);
  const full = copyText(currentReport, false);
  assert.ok(full.includes('张三') && full.includes('¥1,000,000'));
});

test('export file name carries only kind and date, never amounts or sensitive names', () => {
  for (const privacy of [true, false]) {
    for (const f of [currentReport, baselineReport, comparisonReport]) {
      const name = exportFileName(f, privacy);
      assert.ok(name.includes('2026-10-07'));
      for (const s of SENSITIVE) assert.ok(!name.includes(s), `leaked ${s} in file name`);
    }
  }
  assert.equal(exportFileName(currentReport, true), '当前方案决策报告-2026-10-07-隐私版.html');
});

test('sparse actual points are never interpolated: dots only, labelled by real date', () => {
  const trend = trendModel(currentReport.series);
  assert.equal(trend.actual.length, 2);
  assert.deepEqual(trend.actual.map(p => p.date), ['2026-06-30', '2026-09-30']);
  const aria = trendAriaLabel(trend);
  assert.ok(aria.includes('2026-06-30 实际可用资金'));
  const svg = trendSvg(trend);
  // 实际点只有圆点（r="4"），不参与任何连线
  assert.equal(svg.match(/r="4"/g).length, 2);
  assert.equal(svg.match(/<path/g).length, 2); // 预计实线 + 参考虚线，无第三条实际连线
  assert.ok(svg.includes('stroke-dasharray'));
});

test('partial report keeps unknowns; error state stays separate in component', () => {
  const r = parseReportInput(baselineReport);
  assert.ok(r.ok);
  assert.equal(r.report.status, 'partial');
  assert.equal(r.report.funds[1].amount.cents, null);
  assert.equal(r.report.headline.status, 'incomplete');
  const html = printableHtml(baselineReport, { privacy: false });
  assert.ok(html.includes('输入不完整'));
  assert.ok(html.includes('未知'));
  const src = read('../src/planning-report/PlanningReport.tsx');
  assert.match(src, /报告读取失败/);
  assert.match(src, /输入不完整/);
  assert.match(src, /报告读取中/);
  assert.match(src, /尚未选择报告内容/);
});

test('component renders only from the view model: privacy redaction before render, no raw DTO in DOM', () => {
  const src = read('../src/planning-report/PlanningReport.tsx');
  assert.ok(!src.includes('dangerouslySetInnerHTML'));
  assert.match(src, /redactReport\(report\)/);
  // 打印/复制都只把（可能已脱敏的）原始快照交给导出函数，导出函数内部先脱敏
  assert.match(src, /printableHtml\(report!, \{ privacy \}\)/);
  assert.match(src, /copyText\(report!, privacy\)/);
});

test('escapeHtml covers the five dangerous characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

// Every free-text/ID channel and every nested extra property carries a unique marker.
function hostileReport() {
  let n = 0;
  const markers = [];
  const plant = () => { const s = `虚构秘密${++n}姓名账户余额123456元`; markers.push(s); return s; };
  const visit = v => {
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        out[k] = ['id', 'name', 'label', 'text', 'note', 'hint', 'detail', 'subject_name', 'other_name', 'model_version'].includes(k)
          ? plant() : k === 'missing' && Array.isArray(x) && 'template' in v ? [plant()] : visit(x);
      }
      out.extra_secret = plant();
      return out;
    }
    return v;
  };
  const fixture = structuredClone(comparisonReport);
  fixture.missing = [{ id: 'missing', label: 'label', impact: 'blocks_headline', hint: 'hint' }];
  fixture.assumptions.push({ id: 'free', label: 'free', value: { kind: 'text', text: 'free' }, source: 'confirmed', confirmed_on: null });
  return { input: visit(fixture), markers };
}

test('all free strings and extra fields are removed from privacy payload, copy and print', () => {
  const { input, markers } = hostileReport();
  const parsed = parseReportInput(input);
  assert.equal(parsed.ok, true);
  const outputs = [JSON.stringify(redactReport(input)), copyText(parsed.report, true), printableHtml(parsed.report, { privacy: true })];
  for (const output of outputs) for (const marker of markers) assert.ok(!output.includes(marker), marker);
  assert.deepEqual(redactReport(redactReport(parsed.report)), redactReport(parsed.report));
  assert.equal(parsed.report.extra_secret, undefined);
  assert.equal(parsed.report.goals[0].extra_secret, undefined);
  assert.equal(parsed.report.funds[0].amount.extra_secret, undefined);
  const before = JSON.stringify(parsed.report);
  input.funds[0].amount.cents = '1';
  input.goals[0].missing.push('changed');
  assert.equal(JSON.stringify(parsed.report), before, 'validated snapshot must not retain input references');
});

test('required nullable money/ratio fields reject missing values and accept explicit null/unknown', () => {
  for (const key of ['available', 'restricted', 'debt']) {
    const input = structuredClone(currentReport);
    delete input.series[0][key];
    assert.equal(parseReportInput(input).ok, false, key);
    for (const v of [null, { kind: 'money', cents: null, basis: 'unknown' }]) {
      input.series[0][key] = v;
      const parsed = parseReportInput(input);
      assert.equal(parsed.ok, true);
      assert.doesNotThrow(() => printableHtml(parsed.report, { privacy: false }));
    }
  }
  const input = structuredClone(comparisonReport);
  delete input.goals[0].ratio;
  assert.equal(parseReportInput(input).ok, false);
  input.goals[0].ratio = null;
  delete input.differences[0].delta;
  assert.equal(parseReportInput(input).ok, false);
  input.differences[0].delta = null;
  assert.equal(parseReportInput(input).ok, true);
  input.funds[0].amount.hidden = 'secret';
  assert.equal(parseReportInput(input).ok, false);
});

test('actual component DOM/ARIA is private in ready and error states; malformed inputs render an alert', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const ts = (await import('typescript')).default;
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const cache = new URL('../node_modules/.cache/', import.meta.url);
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(cache.pathname + 'planning-report-render-');
  try {
    const source = read('../src/planning-report/PlanningReport.tsx').replaceAll("'./model.ts'", JSON.stringify(new URL('../src/planning-report/model.ts', import.meta.url).href));
    writeFileSync(dir + '/component.mjs', ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
    const { PlanningReport } = await import(pathToFileURL(dir + '/component.mjs').href);
    const render = (outer, privacy = true) => renderToStaticMarkup(React.createElement(PlanningReport, { outer, privacy }));
    const { input, markers } = hostileReport();
    const html = render({ status: 'ready', input });
    for (const marker of markers) assert.ok(!html.includes(marker), `DOM/ARIA leaked ${marker}`);
    assert.ok(html.includes('金额已隐藏'));
    const secret = '虚构错误泄漏余额123456元';
    assert.ok(!render({ status: 'error', message: secret, code: secret }).includes(secret));
    input.contract_version = secret;
    assert.ok(!render({ status: 'ready', input }).includes(secret));
    for (const key of ['available', 'restricted', 'debt']) {
      const broken = structuredClone(currentReport);
      delete broken.series[0][key];
      assert.ok(render({ status: 'ready', input: broken }).includes('报告输入无法识别'));
    }
    for (const outer of [{ status: 'loading' }, { status: 'empty' }, { status: 'error', message: secret, code: secret }, { status: 'ready', input: baselineReport }, { status: 'ready', input: currentReport }]) {
      assert.doesNotThrow(() => render(outer));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
